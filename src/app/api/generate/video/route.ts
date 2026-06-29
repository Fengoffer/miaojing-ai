import { NextRequest, NextResponse } from 'next/server';
import { VideoGenerationClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';
import { buildCustomApiHeaders, fetchWithRetry, parseCustomApiError, parseCustomApiJsonWithProgress } from '@/lib/custom-api-fetch';
import { getAspectRatioPromptHint } from '@/lib/model-config';
import { localStorage } from '@/lib/local-storage';
import { isUuid, resolveServerApiConfig } from '@/lib/server-api-config';
import { enforceGenerationRouteAccess } from '@/lib/generation-route-auth';
import { updateGenerationJobProgress } from '@/lib/generation-job-estimates';
import {
  compressImageBufferForUpstream,
  dataUrlToImageBuffer,
  imageBufferToDataUrl,
} from '@/lib/server-image-compression';
import { executeUserApiManifest } from '@/lib/user-api-manifest-executor';
import { buildReferenceImagePrompt } from '@/lib/reference-image-prompt';
import { fetchPublicHttpUrlWithRetry } from '@/lib/remote-fetch';
import { AGNES_PROVIDER_NAME, AGNES_VIDEO_FRAME_RATE, getAgnesVideoNumFrames, normalizeAgnesVideoDuration } from '@/lib/agnes-model-templates';

interface CustomApiConfig {
  apiUrl: string;
  modelName: string;
  apiKey: string;
  provider: string;
  customApiKeyId?: string;
  systemApiId?: string;
  manifestPath?: string;
}

const GENERATION_TIMEOUT = 180_000;
const AGNES_VIDEO_GENERATION_TIMEOUT = 20 * 60_000;
const MAX_UPSTREAM_REFERENCE_IMAGE_BYTES = Number(process.env.MAX_UPSTREAM_REFERENCE_IMAGE_BYTES || 1536 * 1024);

export const runtime = 'nodejs';

/**
 * Upload a media data URL to S3 storage and return a presigned URL.
 * Includes a 45s timeout to prevent blocking the response.
 */
async function persistMediaToStorage(dataUrl: string, prefix: string): Promise<string> {
  if (!dataUrl.startsWith('data:')) return dataUrl;

  const match = dataUrl.match(/^data:((?:image|video)\/[^;]+);base64,(.+)$/);
  if (!match) throw new Error('Invalid generated video data URL');
  const [, mimeType, base64Data] = match;
  const ext = getVideoExtension(mimeType);
  return persistVideoBufferToObjectStorage(Buffer.from(base64Data, 'base64'), mimeType, ext, prefix);
}

async function persistRemoteUrlToStorage(url: string, prefix: string): Promise<string> {
  if (!url.startsWith('http')) return url;

  let response: Response;
  try {
    response = await fetchPublicHttpUrlWithRetry(
      url,
      { headers: { Accept: 'video/mp4,video/webm,video/quicktime,video/*,*/*;q=0.8' } },
      { attempts: 3, retryDelayMs: 800, timeoutMs: 90_000 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || '');
    if (/fetch failed|network|timeout|aborted|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND/i.test(message)) {
      throw new Error('上游已返回视频地址，但平台下载或保存结果视频失败：网络连接失败，请稍后重试');
    }
    throw new Error(`上游已返回视频地址，但平台下载或保存结果视频失败：${message || '未知错误'}`);
  }
  if (!response.ok) throw new Error(`Failed to fetch generated video: ${response.status}`);
  const mimeType = response.headers.get('content-type')?.split(';')[0] || getVideoMimeType(url);
  const ext = getVideoExtension(mimeType, url);
  return persistVideoBufferToObjectStorage(Buffer.from(await response.arrayBuffer()), mimeType, ext, prefix);
}

/** Helper: wrap a promise with a timeout that rejects with a descriptive message */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

async function persistAllMediaUrls(urls: string[], prefix: string): Promise<string[]> {
  const MAX_DATA_URL_SIZE = 10 * 1024 * 1024; // 10MB limit for video data URLs
  const results = await Promise.all(
    uniqueStrings(urls).map(async (url) => {
      if (url.startsWith('data:')) {
        if (url.length > MAX_DATA_URL_SIZE) {
          throw new Error('Generated video data URL is too large to persist');
        }
        return persistMediaToStorage(url, prefix);
      }
      if (url.startsWith('http')) return persistRemoteUrlToStorage(url, prefix);
      if (url.startsWith('/api/local-storage/')) return url;
      throw new Error('Generated video did not return a persistable URL');
    }),
  );
  return uniqueStrings(results);
}

async function persistVideoBufferToObjectStorage(buffer: Buffer, mimeType: string, ext: string, prefix: string): Promise<string> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const fileKey = await withTimeout(
    localStorage.uploadFileObjectOnly({
      fileContent: buffer,
      fileName: `${prefix}/${suffix}.${ext || 'mp4'}`,
      contentType: mimeType || 'video/mp4',
    }),
    90_000,
    'Local uploadFileObjectOnly (video)',
  );
  const publicUrl = await withTimeout(
    localStorage.generatePresignedUrl({ key: fileKey, expireTime: 2592000 }),
    10_000,
    'Local generatePresignedUrl (video)',
  );
  console.log('[Persist Video Media] Success, key:', fileKey, 'size:', buffer.length, 'bytes');
  return publicUrl;
}

function getVideoMimeType(url: string): string {
  const ext = getVideoExtension('', url);
  if (ext === 'webm') return 'video/webm';
  if (ext === 'mov') return 'video/quicktime';
  if (ext === 'avi') return 'video/x-msvideo';
  return 'video/mp4';
}

function getVideoExtension(mimeType: string, url = ''): string {
  const normalizedMime = mimeType.split(';')[0]?.trim().toLowerCase();
  if (normalizedMime === 'video/webm') return 'webm';
  if (normalizedMime === 'video/quicktime') return 'mov';
  if (normalizedMime === 'video/x-msvideo') return 'avi';
  if (normalizedMime === 'video/mp4') return 'mp4';
  const match = url.split('?')[0]?.match(/\.([a-z0-9]+)$/i);
  const ext = match?.[1]?.toLowerCase();
  return ext && /^(mp4|webm|mov|avi|m4v)$/i.test(ext) ? ext : 'mp4';
}

function isAgnesVideoApi(config: { provider?: string; modelName?: string }): boolean {
  const provider = (config.provider || '').toLowerCase().replace(/\s+/g, '');
  const modelName = (config.modelName || '').toLowerCase();
  return provider === AGNES_PROVIDER_NAME.toLowerCase().replace(/\s+/g, '')
    || provider.includes('agnes')
    || modelName.startsWith('agnes-video-');
}

async function uploadDataUrlAndGetPublicUrl(dataUrl: string): Promise<string | null> {
  try {
    const match = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
    if (!match) return null;
    const [, mimeType, base64Data] = match;
    const ext = mimeType.split('/')[1] || 'png';
    const buffer = Buffer.from(base64Data, 'base64');
    const fileName = `img2vid-ref/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const fileKey = await localStorage.uploadFile({ fileContent: buffer, fileName, contentType: mimeType });
    if (!fileKey) return null;

    const presignedUrl = await localStorage.generatePresignedUrl({ key: fileKey, expireTime: 3600 });
    console.log('[Upload Ref Video Image] Success, key:', fileKey);
    return presignedUrl || null;
  } catch (err) {
    console.error('[Upload Ref Video Image Error]', err instanceof Error ? err.message : err);
    return null;
  }
}

async function toPublicImageUrl(image: string): Promise<string> {
  if (!image.startsWith('data:')) return image;
  const uploadedUrl = await uploadDataUrlAndGetPublicUrl(image);
  return uploadedUrl || image;
}

async function normalizeReferenceImageForUpstream(image: string): Promise<string> {
  const parsedImage = dataUrlToImageBuffer(image);
  if (!parsedImage) return image;

  try {
    const compressed = await compressImageBufferForUpstream(parsedImage, {
      maxBytes: MAX_UPSTREAM_REFERENCE_IMAGE_BYTES,
    });
    if (compressed.changed) {
      console.log('[Custom API img2vid] Compressed reference image:', compressed.originalBytes, '→', compressed.buffer.length);
    }
    return imageBufferToDataUrl({ buffer: compressed.buffer, mimeType: compressed.mimeType });
  } catch (err) {
    console.warn('[Custom API img2vid] Reference image compression failed, using original:', err instanceof Error ? err.message : err);
    return image;
  }
}

function normalizeReferenceImages(image?: string, images?: unknown, extraImages?: unknown): string[] {
  const refs: string[] = [];
  if (image) refs.push(image);
  if (Array.isArray(images)) {
    for (const item of images) {
      if (typeof item === 'string' && item.trim()) refs.push(item);
    }
  }
  if (Array.isArray(extraImages)) {
    for (const item of extraImages) {
      if (typeof item === 'string' && item.trim()) refs.push(item);
    }
  }
  return Array.from(new Set(refs));
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function summarizeCustomVideoResponse(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== 'object') return { kind: typeof data };
  const record = data as Record<string, unknown>;
  return {
    keys: Object.keys(record).slice(0, 12),
    dataLength: Array.isArray(record.data) ? record.data.length : undefined,
    choicesLength: Array.isArray(record.choices) ? record.choices.length : undefined,
    hasUrl: typeof record.url === 'string' || typeof record.video_url === 'string',
  };
}

function deriveChatCompletionsUrl(originalUrl: string): string {
  if (originalUrl.includes('/chat/completions')) return originalUrl;
  return originalUrl
    .replace(/\/(videos|images)\/(generations|edits).*/i, '/chat/completions')
    .replace(/\/+$/, '');
}

function deriveImagesEditsUrl(originalUrl: string): string {
  if (originalUrl.includes('/images/edits')) return originalUrl;
  return originalUrl
    .replace(/\/(videos|images)\/generations.*/i, '/images/edits')
    .replace(/\/+$/, '');
}

function extractVideosFromChatResponse(data: Record<string, unknown>): string[] {
  const videos: string[] = [];
  const choices = data.choices as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(choices)) {
    for (const choice of choices) {
      const message = choice.message as Record<string, unknown> | undefined;
      if (!message) continue;
      const content = message.content;
      if (typeof content === 'string') {
        if (content.startsWith('http') || content.startsWith('data:video/')) videos.push(content);
        const urlMatch = content.match(/(https?:\/\/[^\s"']+\.(mp4|mov|webm)[^\s"']*)/i);
        if (urlMatch) videos.push(urlMatch[1]);
      } else if (Array.isArray(content)) {
        for (const item of content as Array<Record<string, unknown>>) {
          if (item.type === 'video_url' && item.video_url) {
            const url = (item.video_url as Record<string, unknown>).url;
            if (typeof url === 'string') videos.push(url);
          }
          if (item.type === 'text' && typeof item.text === 'string') {
            const text = item.text as string;
            if (text.startsWith('http') || text.startsWith('data:video/')) videos.push(text);
            const urlMatch = text.match(/(https?:\/\/[^\s"']+\.(mp4|mov|webm)[^\s"']*)/i);
            if (urlMatch) videos.push(urlMatch[1]);
          }
        }
      }
    }
  }
  return videos;
}

function extractVideosFromGenerationsResponse(data: Record<string, unknown>): string[] {
  const videos: string[] = [];
  if (Array.isArray(data.data)) {
    for (const item of data.data as Array<Record<string, unknown>>) {
      if (typeof item === 'string') { videos.push(item); continue; }
      if (item.url && typeof item.url === 'string') videos.push(item.url);
      if (item.video_url && typeof item.video_url === 'string') videos.push(item.video_url);
      if (item.b64_json && typeof item.b64_json === 'string') {
        videos.push(`data:video/mp4;base64,${item.b64_json}`);
      }
    }
  } else if (typeof data.url === 'string') {
    videos.push(data.url);
  } else if (typeof data.video_url === 'string') {
    videos.push(data.video_url);
  }
  return videos;
}

async function customApiImageToVideo(
  customApiConfig: CustomApiConfig,
  prompt: string | undefined,
  negativePrompt: string | undefined,
  image: string,
  referenceImages: string[] = [],
  aspectRatio?: string,
  duration?: number,
  fps?: number,
  onProgress?: (progress: Record<string, unknown>) => void | Promise<void>,
): Promise<NextResponse> {
  const endpoint = customApiConfig.apiUrl;
  if (!endpoint) {
    return NextResponse.json({ error: '自定义API未配置请求地址' }, { status: 400 });
  }
  if (!customApiConfig.modelName) {
    return NextResponse.json({ error: '自定义API未配置模型名称' }, { status: 400 });
  }

  const normalizedImage = await normalizeReferenceImageForUpstream(image);
  const normalizedReferenceImages = uniqueStrings(await Promise.all(
    normalizeReferenceImages(normalizedImage, referenceImages).map(normalizeReferenceImageForUpstream),
  ));

  // Prepare image buffer for FormData upload
  let imageBuffer: Buffer | null = null;
  let imageMimeType = 'image/png';
  if (normalizedImage.startsWith('data:')) {
    const parsedImage = dataUrlToImageBuffer(normalizedImage);
    if (parsedImage) {
      imageMimeType = parsedImage.mimeType;
      imageBuffer = parsedImage.buffer;
    }
  }

  // Upload reference image to S3
  const imageUrl = await toPublicImageUrl(normalizedImage);
  const imageUrls = await Promise.all(normalizedReferenceImages.map(toPublicImageUrl));

  let promptText = prompt || '根据参考图生成视频';
  if (negativePrompt) promptText += `\n\n负面提示词: ${negativePrompt}`;
  // Augment prompt with aspect ratio hint
  if (aspectRatio) {
    const hint = getAspectRatioPromptHint(aspectRatio);
    if (hint) promptText += `\n\n[${hint}]`;
  }

  const headers = buildCustomApiHeaders(customApiConfig.apiKey);

  // Get raw base64 for strategies that need it
  let rawBase64 = normalizedImage;
  if (normalizedImage.startsWith('data:')) {
    const commaIndex = normalizedImage.indexOf(',');
    if (commaIndex !== -1) rawBase64 = normalizedImage.substring(commaIndex + 1);
  }

  const strategyResults: string[] = [];
  let firstUpstreamError: { error: string; status: number } | null = null;

  // --- Strategy 1: images/edits with multipart/form-data ---
  // Same as img2img - Cherry Studio uses multipart/form-data for image-based requests
  if (imageBuffer) {
    const editsUrl = deriveImagesEditsUrl(endpoint);
    console.log('[Custom API img2vid → 策略1: images/edits (FormData)] URL:', editsUrl, '| model:', customApiConfig.modelName);
    try {
      const boundary = `----FormBoundary${Date.now()}${Math.random().toString(36).slice(2)}`;
      const parts: Buffer[] = [];

      const textFields: Record<string, string> = {
        model: customApiConfig.modelName,
        prompt: promptText,
      };
      if (aspectRatio) textFields.aspect_ratio = aspectRatio;
      if (duration) textFields.duration = String(duration);
      if (fps) textFields.fps = String(fps);

      for (const [key, value] of Object.entries(textFields)) {
        parts.push(Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`
        ));
      }

      const ext = imageMimeType.split('/')[1] || 'png';
      const imageBuffers: Array<{ mimeType: string; buffer: Buffer }> = [];
      for (const ref of normalizedReferenceImages) {
        if (!ref.startsWith('data:')) continue;
        const parsedImage = dataUrlToImageBuffer(ref);
        if (!parsedImage) continue;
        imageBuffers.push(parsedImage);
      }

      imageBuffers.forEach((item, index) => {
        const fieldName = index === 0 ? 'image' : 'images[]';
        const itemExt = item.mimeType.split('/')[1] || ext;
        parts.push(Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="image-${index + 1}.${itemExt}"\r\nContent-Type: ${item.mimeType}\r\n\r\n`
        ));
        parts.push(item.buffer);
        parts.push(Buffer.from(`\r\n`));
      });
      parts.push(Buffer.from(`--${boundary}--\r\n`));

      const bodyBuffer = Buffer.concat(parts);

      const editsResponse = await fetchWithRetry(
        editsUrl,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${customApiConfig.apiKey}`,
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          },
          body: bodyBuffer,
        },
        GENERATION_TIMEOUT,
        1,
      );
      if (editsResponse.ok) {
        const editsData = await parseCustomApiJsonWithProgress(editsResponse, onProgress);
        let videos = extractVideosFromGenerationsResponse(editsData as Record<string, unknown>);
        if (videos.length === 0) videos = extractVideosFromChatResponse(editsData as Record<string, unknown>);
        if (videos.length > 0) {
          const persistedVideos = await persistAllMediaUrls(videos, 'generated/videos');
          return NextResponse.json({ videos: persistedVideos });
        }
        strategyResults.push('策略1(images/edits FormData): 响应中无视频数据');
      } else {
        const errorText = await editsResponse.text();
        const parsedError = parseCustomApiError(editsResponse.status, errorText);
        if (!firstUpstreamError) firstUpstreamError = { error: parsedError, status: editsResponse.status };
        strategyResults.push(parsedError);
      }
    } catch (err) {
      strategyResults.push(`策略1(images/edits FormData): ${err instanceof Error ? err.message : '异常'}`);
    }
  }

  // --- Strategy 2: chat/completions with image_url ---
  const chatUrl = deriveChatCompletionsUrl(endpoint);
  const chatBody: Record<string, unknown> = {
    model: customApiConfig.modelName,
    stream: false,
    messages: [
      {
        role: 'user',
        content: [
          ...imageUrls.map(url => ({ type: 'image_url', image_url: { url } })),
          { type: 'text', text: promptText },
        ],
      },
    ],
  };
  if (aspectRatio) chatBody.aspect_ratio = aspectRatio;
  if (duration) chatBody.duration = duration;
  if (fps) chatBody.fps = fps;

  console.log('[Custom API img2vid → 策略2: chat/completions] URL:', chatUrl, '| model:', customApiConfig.modelName);
  try {
    const chatResponse = await fetchWithRetry(chatUrl, { method: 'POST', headers, body: JSON.stringify(chatBody) }, GENERATION_TIMEOUT, 1);
    if (chatResponse.ok) {
      const chatData = await parseCustomApiJsonWithProgress(chatResponse, onProgress);
      let videos = extractVideosFromChatResponse(chatData as Record<string, unknown>);
      if (videos.length === 0) videos = extractVideosFromGenerationsResponse(chatData as Record<string, unknown>);
      if (videos.length > 0) {
        const persistedVideos = await persistAllMediaUrls(videos, 'generated/videos');
        return NextResponse.json({ videos: persistedVideos });
      }
    } else {
      const errorText = await chatResponse.text();
      const parsedError = parseCustomApiError(chatResponse.status, errorText);
      if (!firstUpstreamError) firstUpstreamError = { error: parsedError, status: chatResponse.status };
      strategyResults.push(parsedError);
    }
  } catch (err) {
    strategyResults.push(`策略2(chat/completions): ${err instanceof Error ? err.message : '异常'}`);
  }

  // --- Strategy 3: images/generations with init_image ---
  const imgBody: Record<string, unknown> = {
    model: customApiConfig.modelName,
    prompt: promptText,
    n: 1,
    size: '1024x1024',
    response_format: 'b64_json',
    init_image: rawBase64,
    images: imageUrls,
  };
  if (aspectRatio) imgBody.aspect_ratio = aspectRatio;
  if (duration) imgBody.duration = duration;
  if (fps) imgBody.fps = fps;

  console.log('[Custom API img2vid → 策略3: images/generations] URL:', endpoint, '| model:', customApiConfig.modelName);
  try {
    const imgResponse = await fetchWithRetry(endpoint, { method: 'POST', headers, body: JSON.stringify(imgBody) }, GENERATION_TIMEOUT, 1);
    if (!imgResponse.ok) {
      const errorText = await imgResponse.text();
      const parsedError = parseCustomApiError(imgResponse.status, errorText);
      if (!firstUpstreamError) firstUpstreamError = { error: parsedError, status: imgResponse.status };
      strategyResults.push(parsedError);
    } else {
      const imgData = await parseCustomApiJsonWithProgress(imgResponse, onProgress);
      const videos = extractVideosFromGenerationsResponse(imgData as Record<string, unknown>);
      if (videos.length > 0) {
        const persistedVideos = await persistAllMediaUrls(videos, 'generated/videos');
        return NextResponse.json({ videos: persistedVideos });
      }
      strategyResults.push('策略3(images/generations): 响应中无视频数据');
    }
  } catch (err) {
    strategyResults.push(`策略3(images/generations): ${err instanceof Error ? err.message : '异常'}`);
  }

  return NextResponse.json(
    {
      error: firstUpstreamError?.error || strategyResults.find(Boolean) || '图生视频失败',
    },
    { status: firstUpstreamError && firstUpstreamError.status < 500 ? firstUpstreamError.status : 502 }
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      prompt,
      negativePrompt,
      model = 'doubao-seedance-1-5-pro-251215',
      aspectRatio = '16:9',
      duration = 5,
      resolution = '720p',
      quality,
      mode,
      fps = 30,
      image,
      images,
      extraImages,
      referenceImageAnnotations,
      customApiConfig,
    } = body as {
      prompt?: string;
      negativePrompt?: string;
      model?: string;
      aspectRatio?: string;
      duration?: number | string;
      resolution?: string;
      quality?: string;
      mode?: string;
      fps?: number;
      image?: string;
      images?: string[];
      extraImages?: string[];
      referenceImageAnnotations?: unknown;
      customApiConfig?: CustomApiConfig;
    };
    const referenceImages = normalizeReferenceImages(image, images, extraImages);
    const promptForGeneration = buildReferenceImagePrompt(prompt || '', referenceImages.length, referenceImageAnnotations);
    const numericDuration = Number(duration);
    const sdkDuration = Number.isFinite(numericDuration) ? numericDuration : 5;

    if (!prompt && referenceImages.length === 0) {
      return NextResponse.json({ error: '请提供视频描述或上传图片' }, { status: 400 });
    }
    const routeAccess = await enforceGenerationRouteAccess(request, customApiConfig);
    if (routeAccess.response) return routeAccess.response;
    const trustedUserId = routeAccess.trustedUserId || routeAccess.authenticatedUserId;
    const generationJobId = routeAccess.generationJobId;
    const resolvedCustomApiConfig = await resolveServerApiConfig(
      request,
      customApiConfig,
      isUuid(trustedUserId) ? trustedUserId : null,
    );
    const handleUpstreamProgress = (progress: Record<string, unknown>) => updateGenerationJobProgress(
      isUuid(generationJobId) ? generationJobId : null,
      progress,
    );

    // ---- Custom API mode ----
    if (resolvedCustomApiConfig && resolvedCustomApiConfig.apiKey) {
      const resolvedApiKey = resolvedCustomApiConfig.apiKey;
      try {
        if (resolvedCustomApiConfig.manifestPath) {
          const useAgnesVideoParams = isAgnesVideoApi(resolvedCustomApiConfig);
          const agnesVideoDuration = useAgnesVideoParams ? normalizeAgnesVideoDuration(duration) : null;
          if (useAgnesVideoParams && agnesVideoDuration === null) {
            return NextResponse.json(
              { error: 'Agnes Video V2.0 当前仅开放 3、5、10 秒，18 秒上游生成不稳定，请改选 10 秒后重试' },
              { status: 400 },
            );
          }
          const resolvedAgnesDuration = agnesVideoDuration ?? undefined;
          const manifestResult = await executeUserApiManifest({
            manifestPath: resolvedCustomApiConfig.manifestPath,
            apiUrl: resolvedCustomApiConfig.apiUrl,
            apiKey: resolvedApiKey,
            modelName: resolvedCustomApiConfig.modelName,
            prompt: promptForGeneration,
            params: {
              n: 1,
              aspect_ratio: aspectRatio,
              duration: useAgnesVideoParams ? resolvedAgnesDuration : duration,
              resolution,
              quality: quality || mode,
              mode: mode || quality,
              fps: useAgnesVideoParams ? AGNES_VIDEO_FRAME_RATE : fps,
              num_frames: useAgnesVideoParams ? getAgnesVideoNumFrames(resolvedAgnesDuration) : undefined,
              negative_prompt: negativePrompt,
            },
            inputImages: referenceImages,
            preferEdit: referenceImages.length > 0,
            timeoutMs: useAgnesVideoParams ? AGNES_VIDEO_GENERATION_TIMEOUT : GENERATION_TIMEOUT,
            onProgress: handleUpstreamProgress,
          });
          if (manifestResult) {
            const media = manifestResult.videos.length > 0 ? manifestResult.videos : manifestResult.images;
            if (media.length === 0) {
              return NextResponse.json({ error: '自定义 Manifest 未返回有效视频数据' }, { status: 502 });
            }
            let persistedVideos: string[];
            try {
              persistedVideos = await persistAllMediaUrls(media, 'generated/videos');
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error || '');
              return NextResponse.json(
                { error: message || '上游已返回视频结果，但平台下载或保存结果视频失败' },
                { status: 502 },
              );
            }
            return NextResponse.json({ videos: persistedVideos });
          }
        }

        if (referenceImages.length > 0) {
          return await customApiImageToVideo(
            resolvedCustomApiConfig as CustomApiConfig,
            promptForGeneration,
            negativePrompt,
            referenceImages[0],
            referenceImages,
            aspectRatio,
            sdkDuration,
            fps,
            handleUpstreamProgress,
          );
        }

        // Text-to-video
        const endpoint = resolvedCustomApiConfig.apiUrl;
        if (!endpoint) return NextResponse.json({ error: '自定义API未配置请求地址' }, { status: 400 });
        if (!resolvedCustomApiConfig.modelName) return NextResponse.json({ error: '自定义API未配置模型名称' }, { status: 400 });

        // Augment prompt with aspect ratio hint as fallback
        const ratioHint = aspectRatio ? getAspectRatioPromptHint(aspectRatio) : '';
        const augmentedPrompt = ratioHint ? `${promptForGeneration}\n\n[${ratioHint}]` : promptForGeneration;

        const requestBody: Record<string, unknown> = {
          model: resolvedCustomApiConfig.modelName,
          prompt: augmentedPrompt,
          n: 1,
          size: '1024x1024',
          response_format: 'b64_json',
        };
        if (negativePrompt) requestBody.negative_prompt = negativePrompt;
        // Pass creation parameters for APIs that support them
        if (aspectRatio) requestBody.aspect_ratio = aspectRatio;
        if (duration) requestBody.duration = duration;
        if (resolution) requestBody.resolution = resolution;
        if (fps) requestBody.fps = fps;

        console.log('[Custom API Video] Text-to-video, sending to:', endpoint, '| model:', requestBody.model);

        let customResponse: Response;
        try {
          customResponse = await fetchWithRetry(
            endpoint,
            { method: 'POST', headers: buildCustomApiHeaders(resolvedApiKey), body: JSON.stringify(requestBody) },
            GENERATION_TIMEOUT, 1,
          );
        } catch (fetchError: unknown) {
          if (fetchError instanceof DOMException && fetchError.name === 'AbortError') {
            return NextResponse.json({ error: '自定义API请求超时（180秒）' }, { status: 504 });
          }
          const msg = fetchError instanceof Error ? fetchError.message : '请求失败';
          return NextResponse.json({ error: `自定义API网络错误: ${msg}` }, { status: 502 });
        }

        if (!customResponse.ok) {
          const errorText = await customResponse.text();
          return NextResponse.json(
            { error: parseCustomApiError(customResponse.status, errorText) },
            { status: customResponse.status >= 500 ? 502 : customResponse.status }
          );
        }

        const customData = await parseCustomApiJsonWithProgress(customResponse, handleUpstreamProgress);
        const videos = extractVideosFromGenerationsResponse(customData as Record<string, unknown>);
        if (videos.length === 0) {
          return NextResponse.json({
            error: '自定义API未返回有效视频数据',
            upstreamSummary: summarizeCustomVideoResponse(customData),
          }, { status: 502 });
        }
        // Persist all data URLs and remote URLs to S3
        const persistedVideos = await persistAllMediaUrls(videos, 'generated/videos');
        return NextResponse.json({ videos: persistedVideos });
      } catch (customError: unknown) {
        const msg = customError instanceof Error ? customError.message : '自定义API请求异常';
        console.error('[Custom API Video Exception]', msg);
        return NextResponse.json({ error: `自定义API异常: ${msg}` }, { status: 502 });
      }
    }

    // ---- Default mode: use coze-coding-dev-sdk ----
    const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
    const config = new Config();
    const client = new VideoGenerationClient(config, customHeaders);

    const contentItems: Array<{ type: string; text?: string; image_url?: { url: string }; role?: string }> = [];
    referenceImages.forEach((url, index) => {
      contentItems.push({ type: 'image_url', image_url: { url }, role: index === 0 ? 'first_frame' : 'reference' });
    });
    if (promptForGeneration) {
      contentItems.push({ type: 'text', text: promptForGeneration });
    }

    const ratioMap: Record<string, '16:9' | '9:16' | '1:1' | '4:3' | '3:4'> = {
      '16:9': '16:9', '9:16': '9:16', '1:1': '1:1', '4:3': '4:3', '3:4': '3:4',
    };

    const response = await client.videoGeneration(contentItems as Parameters<typeof client.videoGeneration>[0], {
      model,
      duration: Math.min(Math.max(sdkDuration, 4), 12),
      ratio: ratioMap[aspectRatio] || '16:9',
      resolution: '720p',
      generateAudio: true,
    });

    const videos: string[] = [];
    if (response.videoUrl) videos.push(response.videoUrl);
    if (videos.length === 0) return NextResponse.json({ error: '视频生成失败，请稍后重试' }, { status: 500 });

    // Persist SDK video URLs to S3 for reliable browser access
    const persistedVideos = await persistAllMediaUrls(videos, 'generated/videos');
    return NextResponse.json({ videos: persistedVideos });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '视频生成失败';
    console.error('[Video Generation Error]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
