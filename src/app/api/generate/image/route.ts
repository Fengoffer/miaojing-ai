import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { ImageGenerationClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';
import {
  STREAM_UNSUPPORTED_SYNC_CONFIRM_PREFIX,
  buildCustomApiHeaders,
  fetchWithRetry,
  parseCustomApiError,
  parseCustomApiJsonWithProgress,
} from '@/lib/custom-api-fetch';
import {
  buildSynchronousImageRequestBody,
  getSystemPollingFailureMessage,
  shouldRetryImageRequestWithoutStream,
} from '@/lib/custom-image-fallback';
import {
  getAspectRatioPromptHint,
  inferImageParamsFromPrompt,
  resolveCustomApiImageSize,
  resolveImageSize,
} from '@/lib/model-config';
import { localStorage } from '@/lib/local-storage';
import { fetchPublicHttpUrl, fetchPublicHttpUrlWithRetry } from '@/lib/remote-fetch';
import {
  isUuid,
  resolveServerApiConfig,
  resolveSystemApiPollingCandidates,
} from '@/lib/server-api-config';
import { enforceGenerationRouteAccess } from '@/lib/generation-route-auth';
import { updateGenerationJobProgress } from '@/lib/generation-job-estimates';
import {
  resolveImageApiTemplate,
  type ImageOutputFormat,
  type ImageQuality,
  type ImageApiTemplate,
} from '@/lib/image-api-templates';
import {
  dataUrlToImageBuffer,
} from '@/lib/server-image-compression';
import { executeUserApiManifest } from '@/lib/user-api-manifest-executor';
import { buildReferenceImagePrompt } from '@/lib/reference-image-prompt';
import {
  getImageExtension as getMediaImageExtension,
  normalizeImageBufferForOutputFormat,
  parseImageDataUrl as parseMediaImageDataUrl,
  persistOriginalImageWithThumbnail,
  readImageBufferFromUrl,
} from '@/lib/media-storage';
import { applyLayoutCompositionSkillToPrompt } from '@/lib/layout-composition-skill';

interface CustomApiConfig {
  apiUrl: string;
  modelName: string;
  apiKey: string;
  provider: string;
  customApiKeyId?: string;
  systemApiId?: string;
  manifestPath?: string;
}

const GENERATION_TIMEOUT = Number(process.env.IMAGE_GENERATION_TIMEOUT_MS || 900_000);
const GENERATION_TIMEOUT_SECONDS = GENERATION_TIMEOUT / 1000;
const GENERATED_IMAGE_PERSIST_TIMEOUT_MS = Number(process.env.GENERATED_IMAGE_PERSIST_TIMEOUT_MS || 120_000);

interface TargetImageSize {
  width: number;
  height: number;
}

interface PersistedImageResult {
  url: string;
  thumbnailUrl: string;
  width: number;
  height: number;
  bytes: number;
}

interface QualifiedImageResult {
  url: string;
  thumbnailUrl: string;
  width: number;
  height: number;
  bytes: number;
}

function syncFallbackConfirmationError(message: string): string {
  return `${STREAM_UNSUPPORTED_SYNC_CONFIRM_PREFIX}${message}`;
}

export const runtime = 'nodejs';

function publicAppBaseUrl(): string {
  return (process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '');
}

function toAbsolutePublicUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const baseUrl = publicAppBaseUrl();
  return baseUrl && url.startsWith('/') ? `${baseUrl}${url}` : url;
}

function parseImageSize(size: string | undefined): TargetImageSize | null {
  const match = size?.match(/^(\d{2,5})x(\d{2,5})$/i);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? { width, height } : null;
}

function resolveTargetImageSize(
  size: string | undefined,
  aspectRatio: string | undefined,
  resolution: string | undefined,
  quality: string | undefined,
): TargetImageSize | null {
  const explicit = parseImageSize(size);
  if (explicit) return explicit;

  if (aspectRatio && aspectRatio !== 'original' && resolution) {
    return parseImageSize(resolveImageSize(aspectRatio, resolution));
  }

  const squareByQuality: Record<string, string> = {
    '1K': '1024x1024',
    '1080P': '1024x1024',
    '2K': '2048x2048',
    '4K': '4096x4096',
  };
  return parseImageSize(quality ? squareByQuality[quality] : undefined);
}

function normalizeImageOutputFormat(value: unknown): 'png' | 'jpeg' | 'webp' {
  return value === 'jpeg' || value === 'webp' || value === 'png' ? value : 'png';
}

function normalizeImageQuality(value: unknown): 'auto' | 'high' | 'medium' | 'low' {
  return value === 'high' || value === 'medium' || value === 'low' || value === 'auto' ? value : 'auto';
}

function mergeStylePrompt(prompt: string, stylePrompt: unknown): string {
  if (typeof stylePrompt !== 'string') return prompt;
  const normalized = stylePrompt.trim();
  if (!normalized) return prompt;
  return `${prompt.trim()}\n\nStyle instruction: ${normalized}`;
}

function normalizeImageCount(value: unknown): number | undefined {
  if (value === 'auto' || value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(10, Math.max(1, Math.floor(parsed)));
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

function resolveAutoImageRequestParams(input: {
  prompt: string;
  aspectRatio: unknown;
  resolution: unknown;
  count: unknown;
  hasReferenceImage: boolean;
}): { ok: true; aspectRatio: string; resolution: string; count: number } | { ok: false; message: string } {
  const inferred = inferImageParamsFromPrompt(input.prompt, { allowOriginalAspectRatio: input.hasReferenceImage });
  const rawAspectRatio = typeof input.aspectRatio === 'string' ? input.aspectRatio.trim() : '';
  const rawResolution = typeof input.resolution === 'string' ? input.resolution.trim() : '';
  const aspectRatio = rawAspectRatio && rawAspectRatio !== 'auto' ? rawAspectRatio : inferred.aspectRatio;
  const resolution = rawResolution && rawResolution !== 'auto' ? rawResolution : inferred.resolution;
  const count = normalizeImageCount(input.count) ?? inferred.count;
  const missing: string[] = [];
  if (!aspectRatio) missing.push('画面比例');
  if (!resolution) missing.push('分辨率');
  if (!count) missing.push('生成数量');
  if (missing.length > 0) {
    return { ok: false, message: `请在提示词中写明${missing.join('、')}，或手动设置后再生成` };
  }
  if (!aspectRatio || !resolution || !count) {
    return { ok: false, message: '请完整设置画面比例、分辨率和生成数量后再生成' };
  }
  return { ok: true, aspectRatio, resolution, count };
}

function formatTargetSize(targetSize: TargetImageSize): string {
  return `${targetSize.width}x${targetSize.height}`;
}

function imageMeetsTargetSize(width: number, height: number, targetSize: TargetImageSize): boolean {
  return width >= targetSize.width && height >= targetSize.height;
}

function getImageExtension(mimeType: string | null | undefined, fallbackUrl?: string): string {
  return getMediaImageExtension(mimeType || 'image/png', fallbackUrl || '');
}

function parseImageDataUrl(dataUrl: string): { buffer: Buffer; mimeType: string; ext: string } | null {
  return parseMediaImageDataUrl(dataUrl);
}

function getStoredImageMimeType(key: string): string {
  const extension = key.split('?')[0]?.split('.').pop()?.toLowerCase();
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'gif') return 'image/gif';
  if (extension === 'png') return 'image/png';
  return 'image/png';
}

async function getReferenceImagePublicUrlFromKey(fileKey: string): Promise<string> {
  const objectReadUrl = localStorage.generateObjectReadUrl(fileKey, 3600);
  if (objectReadUrl) return objectReadUrl;
  const publicUrl = await localStorage.generatePresignedUrl({ key: fileKey, expireTime: 3600 });
  return toAbsolutePublicUrl(publicUrl);
}

function getReferenceUrlHostForLog(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    return new URL(value).host;
  } catch {
    return value.startsWith('/api/local-storage/') ? 'app-local-storage' : 'non-url';
  }
}

type ResolvedFallbackReference = {
  source: string;
  imageUrl: string;
  rawBase64: string;
  imageBuffer: Buffer | null;
  imageMimeType: string;
};

async function resolveReferenceImageForFallback(value: string): Promise<ResolvedFallbackReference> {
  const normalizedImage = value.trim();
  const storedReferenceKey = localStorage.getKeyFromPublicUrl(normalizedImage);
  let imageBuffer: Buffer | null = null;
  let imageMimeType = 'image/png';

  if (normalizedImage.startsWith('data:')) {
    const parsedImage = dataUrlToImageBuffer(normalizedImage);
    if (parsedImage) {
      imageMimeType = parsedImage.mimeType;
      imageBuffer = parsedImage.buffer;
    }
  } else if (storedReferenceKey) {
    try {
      imageBuffer = await localStorage.readFileAsync(storedReferenceKey);
      imageMimeType = getStoredImageMimeType(storedReferenceKey);
    } catch (e) {
      console.warn('[Custom API img2img] Failed to read stored reference image:', e);
    }
  } else {
    try {
      const imgRes = await fetchPublicHttpUrlWithRetry(
        toAbsolutePublicUrl(normalizedImage),
        {},
        { attempts: 3, retryDelayMs: 500, timeoutMs: 45_000 },
      );
      if (imgRes.ok) {
        const contentType = imgRes.headers.get('content-type') || 'image/png';
        imageMimeType = contentType.split(';')[0];
        imageBuffer = Buffer.from(await imgRes.arrayBuffer());
      }
    } catch (e) {
      console.warn('[Custom API img2img] Failed to download reference image from URL:', e);
    }
  }

  let imageUrl = storedReferenceKey
    ? await getReferenceImagePublicUrlFromKey(storedReferenceKey)
    : toAbsolutePublicUrl(normalizedImage);
  if (normalizedImage.startsWith('data:')) {
    console.log('[Custom API img2img] Uploading reference image to S3 to reduce payload...');
    const uploadedUrl = await uploadDataUrlAndGetPublicUrl(normalizedImage);
    if (uploadedUrl) {
      imageUrl = uploadedUrl;
      console.log('[Custom API img2img] Using S3 URL, size reduction:', normalizedImage.length, '→', imageUrl.length);
    } else {
      console.warn('[Custom API img2img] S3 upload failed, falling back to data URL in request body');
    }
  }

  let rawBase64 = normalizedImage;
  if (normalizedImage.startsWith('data:')) {
    const commaIndex = normalizedImage.indexOf(',');
    if (commaIndex !== -1) rawBase64 = normalizedImage.substring(commaIndex + 1);
  }

  return { source: normalizedImage, imageUrl, rawBase64, imageBuffer, imageMimeType };
}

async function persistImageWithMetadata(
  url: string,
  prefix: string,
  outputFormat?: ImageOutputFormat,
  imageQuality?: ImageQuality,
): Promise<PersistedImageResult | null> {
  const source = await readImageBufferFromUrl(url);
  if (!source) return null;
  const normalizedSource = await normalizeImageBufferForOutputFormat(source, outputFormat, imageQuality);
  return withTimeout(
    persistOriginalImageWithThumbnail({
      buffer: normalizedSource.buffer,
      mimeType: normalizedSource.mimeType,
      ext: normalizedSource.ext,
      originalPrefix: prefix,
      thumbnailPrefix: 'thumbnails/generated/images',
    }),
    GENERATED_IMAGE_PERSIST_TIMEOUT_MS,
    'Persist generated image media',
  );
}

type GeneratedImagePersistenceFailureKind = 'download' | 'storage' | 'invalid_image';

type PersistQualifiedImageUrlsResult = {
  images: string[];
  thumbnails: Record<string, string>;
  dimensions: Record<string, { width: number; height: number }>;
  rejected: string[];
  failureKinds: GeneratedImagePersistenceFailureKind[];
};

function classifyGeneratedImagePersistenceError(error: unknown): GeneratedImagePersistenceFailureKind {
  if (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return 'download';
  }
  const message = error instanceof Error ? error.message : String(error || '');
  if (/下载图片失败|fetch failed|Too many redirects|Invalid URL|Only HTTP|Private or local network|timeout|timed out|aborted|ECONNRESET|ETIMEDOUT/i.test(message)) {
    return 'download';
  }
  if (/无法读取生成图片尺寸|unsupported image|Input buffer/i.test(message)) {
    return 'invalid_image';
  }
  return 'storage';
}

async function persistQualifiedImageUrls(
  urls: string[],
  prefix: string,
  targetSize: TargetImageSize | null,
  context: string,
  requestedCount = urls.length,
  outputFormat?: ImageOutputFormat,
  imageQuality?: ImageQuality,
): Promise<PersistQualifiedImageUrlsResult> {
  const images: QualifiedImageResult[] = [];
  const rejected: string[] = [];
  const failureKinds: GeneratedImagePersistenceFailureKind[] = [];
  const cappedCount = Math.max(1, Math.floor(Number(requestedCount) || 1));

  for (const url of urls) {
    try {
      const persisted = await persistImageWithMetadata(url, prefix, outputFormat, imageQuality);
      if (!persisted) {
        rejected.push('无法读取生成图片');
        failureKinds.push('download');
        continue;
      }
      if (targetSize && !imageMeetsTargetSize(persisted.width, persisted.height, targetSize)) {
        const message = `${persisted.width}x${persisted.height} < ${formatTargetSize(targetSize)}`;
        console.warn(`[${context}] Accepted upstream image below requested size:`, message);
      }
      console.log(`[${context}] Accepted generated image:`, `${persisted.width}x${persisted.height}`, 'bytes:', persisted.bytes);
      images.push(persisted);
    } catch (err) {
      const message = err instanceof Error ? err.message : '图片处理失败';
      console.warn(`[${context}] Failed to persist generated image:`, message);
      rejected.push(message);
      failureKinds.push(classifyGeneratedImagePersistenceError(err));
    }
  }

  images.sort((a, b) => (b.width * b.height) - (a.width * a.height) || b.bytes - a.bytes);
  const selected = images.slice(0, cappedCount);
  return {
    images: selected.map(image => image.url),
    thumbnails: Object.fromEntries(selected.map(image => [image.url, image.thumbnailUrl])),
    dimensions: Object.fromEntries(selected.map(image => [image.url, { width: image.width, height: image.height }])),
    rejected,
    failureKinds,
  };
}

function capPersistedImagesToRequestedCount<T extends { images: string[]; thumbnails: Record<string, string>; dimensions: Record<string, { width: number; height: number }> }>(
  result: T,
  requestedCount: number,
) {
  const cappedCount = Math.max(1, Math.floor(Number(requestedCount) || 1));
  if (result.images.length <= cappedCount) return result;
  const images = result.images.slice(0, cappedCount);
  return {
    ...result,
    images,
    thumbnails: Object.fromEntries(images.map(url => [url, result.thumbnails[url] || url])),
    dimensions: Object.fromEntries(
      images
        .map(url => [url, result.dimensions[url]])
        .filter((entry): entry is [string, { width: number; height: number }] => Boolean(entry[1])),
    ),
  };
}

function imageResponsePayload(
  result: { images: string[]; thumbnails: Record<string, string>; dimensions: Record<string, { width: number; height: number }> },
  requestedCount = result.images.length,
) {
  const capped = capPersistedImagesToRequestedCount(result, requestedCount);
  return {
    images: capped.images,
    thumbnails: capped.thumbnails,
    thumbnailUrls: capped.images.map(url => capped.thumbnails[url] || url),
    dimensions: capped.dimensions,
  };
}

async function fetchCustomImageGeneration(
  endpoint: string,
  apiKey: string,
  requestBody: Record<string, unknown>,
  onProgress?: (progress: Record<string, unknown>) => void | Promise<void>,
): Promise<{ ok: true; images: string[] } | { ok: false; response: Response; errorText: string }> {
  const response = await fetchWithRetry(
    endpoint,
    { method: 'POST', headers: buildCustomApiHeaders(apiKey), body: JSON.stringify(requestBody) },
    GENERATION_TIMEOUT,
    1,
  );

  if (!response.ok) {
    const errorText = await response.text();
    if (requestBody.stream !== false && response.status === 524) {
      return {
        ok: false,
        response,
        errorText: syncFallbackConfirmationError(
          '上游流式生图没有持续返回数据，最终被 Cloudflare 判定超时。请确认是否重新发起同步生图请求；同步请求可能耗时更久，且仍受上游网关超时限制。',
        ),
      };
    }
    return { ok: false, response, errorText };
  }

  const data = await parseCustomApiJsonWithProgress(response, onProgress);
  return { ok: true, images: extractImagesFromGenerationsResponse(data as Record<string, unknown>) };
}

async function requestQualifiedCustomImages(
  endpoint: string,
  apiKey: string,
  requestBody: Record<string, unknown>,
  targetCount: number,
  targetSize: TargetImageSize | null,
  outputFormat: ImageOutputFormat,
  imageQuality: ImageQuality,
  onProgress?: (progress: Record<string, unknown>) => void | Promise<void>,
  options: { autoRetryWithoutStream?: boolean } = {},
): Promise<PersistQualifiedImageUrlsResult & { upstreamError?: { status: number; text: string } }> {
  const accepted: string[] = [];
  const thumbnails: Record<string, string> = {};
  const dimensions: Record<string, { width: number; height: number }> = {};
  const rejected: string[] = [];
  const failureKinds: GeneratedImagePersistenceFailureKind[] = [];
  const maxAttempts = 1;

  for (let attempt = 1; attempt <= maxAttempts && accepted.length < targetCount; attempt += 1) {
    const remaining = targetCount - accepted.length;
    const requestCount = attempt === 1
      ? Math.max(remaining, Number(requestBody.n) || 1)
      : 1;
    const attemptBody = { ...requestBody, n: requestCount };
    let response = await fetchCustomImageGeneration(
      endpoint,
      apiKey,
      attemptBody,
      onProgress,
    );
    if (
      !response.ok
      && options.autoRetryWithoutStream
      && shouldRetryImageRequestWithoutStream(attemptBody, response.errorText)
    ) {
      console.warn('[Custom API Image] Stream request timed out; retrying once without stream:', endpoint);
      response = await fetchCustomImageGeneration(
        endpoint,
        apiKey,
        buildSynchronousImageRequestBody(attemptBody),
        onProgress,
      );
    }

    if (!response.ok) {
      return {
        images: accepted,
        thumbnails,
        dimensions,
        rejected,
        failureKinds,
        upstreamError: { status: response.response.status, text: response.errorText },
      };
    }

    if (response.images.length === 0) {
      rejected.push('响应中无图片数据');
      continue;
    }

    const persisted = await persistQualifiedImageUrls(
      response.images,
      'generated/images',
      targetSize,
      `Custom API Image attempt ${attempt}`,
      targetCount - accepted.length,
      outputFormat,
      imageQuality,
    );
    accepted.push(...persisted.images);
    Object.assign(thumbnails, persisted.thumbnails);
    Object.assign(dimensions, persisted.dimensions);
    rejected.push(...persisted.rejected);
    failureKinds.push(...persisted.failureKinds);
  }

  const images = accepted.slice(0, targetCount);
  return {
    images,
    thumbnails: Object.fromEntries(images.map(url => [url, thumbnails[url] || url])),
    dimensions: Object.fromEntries(images.map(url => [url, dimensions[url]]).filter((entry): entry is [string, { width: number; height: number }] => Boolean(entry[1]))),
    rejected,
    failureKinds,
  };
}

function lowResolutionError(targetSize: TargetImageSize | null, rejected: string[]): string {
  const target = targetSize ? `要求 ${formatTargetSize(targetSize)}` : '要求的分辨率';
  const actual = rejected.length > 0 ? `，实际返回：${rejected.join('；')}` : '';
  return `上游返回图片分辨率不符合${target}${actual}`;
}

function hasGeneratedImagePersistenceFailure(result: { failureKinds?: GeneratedImagePersistenceFailureKind[] }): boolean {
  return !!result.failureKinds?.some(kind => kind === 'download' || kind === 'storage' || kind === 'invalid_image');
}

function generatedImagePersistenceError(result: { rejected: string[] }): string {
  const detail = result.rejected.length > 0 ? `，失败原因：${result.rejected.join('；')}` : '';
  return `上游已返回生成结果，但平台下载或保存结果图片失败，请稍后重试${detail}`;
}

function imageResultFailureError(
  targetSize: TargetImageSize | null,
  result: { rejected: string[]; failureKinds?: GeneratedImagePersistenceFailureKind[] },
): string {
  if (hasGeneratedImagePersistenceFailure(result)) {
    return generatedImagePersistenceError(result);
  }
  return lowResolutionError(targetSize, result.rejected);
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

/**
 * Upload a base64 data URL to S3 storage and return a presigned URL.
 */
async function uploadDataUrlAndGetPublicUrl(dataUrl: string): Promise<string | null> {
  try {
    const match = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
    if (!match) return null;
    const [, mimeType, base64Data] = match;
    const ext = mimeType.split('/')[1] || 'png';
    const buffer = Buffer.from(base64Data, 'base64');
    const fileName = `img2img-ref/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const fileKey = await localStorage.uploadFileObjectOnly({
      fileContent: buffer,
      fileName,
      contentType: mimeType,
    });

    if (!fileKey) {
      console.error('[Upload Ref Image] uploadFile returned empty key');
      return null;
    }

    const presignedUrl = await getReferenceImagePublicUrlFromKey(fileKey);

    console.log('[Upload Ref Image] Success, key:', fileKey, 'url length:', presignedUrl?.length);
    return presignedUrl || null;
  } catch (err) {
    console.error('[Upload Ref Image Error]', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Extract image URLs/data from a chat completions response.
 */
function extractImagesFromChatResponse(data: Record<string, unknown>): string[] {
  const images: string[] = [];
  const choices = data.choices as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(choices)) {
    for (const choice of choices) {
      const message = choice.message as Record<string, unknown> | undefined;
      if (!message) continue;
      const content = message.content;

      if (typeof content === 'string') {
        if (content.startsWith('data:image/') || content.startsWith('http')) {
          images.push(content);
        }
        const mdMatch = content.match(/!\[.*?\]\((data:image\/[^)]+)\)/);
        if (mdMatch) images.push(mdMatch[1]);
        const urlMatch = content.match(/(https?:\/\/[^\s"']+\.(png|jpg|jpeg|webp)[^\s"']*)/i);
        if (urlMatch) images.push(urlMatch[1]);
      } else if (Array.isArray(content)) {
        for (const item of content as Array<Record<string, unknown>>) {
          if (item.type === 'image_url' && item.image_url) {
            const url = (item.image_url as Record<string, unknown>).url;
            if (typeof url === 'string') images.push(url);
          }
          if (item.type === 'image' && item.image) {
            const imgData = item.image as Record<string, unknown>;
            if (typeof imgData.url === 'string') images.push(imgData.url);
            if (typeof imgData.b64_json === 'string') {
              images.push(`data:image/png;base64,${imgData.b64_json}`);
            }
          }
          if (item.type === 'text' && typeof item.text === 'string') {
            const text = item.text as string;
            if (text.startsWith('data:image/')) images.push(text);
            if (text.startsWith('http') && /\.(png|jpg|jpeg|webp)/i.test(text)) images.push(text);
            const mdMatch = text.match(/!\[.*?\]\((data:image\/[^)]+)\)/);
            if (mdMatch) images.push(mdMatch[1]);
            const urlMatch = text.match(/(https?:\/\/[^\s"']+\.(png|jpg|jpeg|webp)[^\s"']*)/i);
            if (urlMatch) images.push(urlMatch[1]);
          }
        }
      }
    }
  }
  return images;
}

function objectKeysFromUnknown(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.keys(value);
}

/**
 * Extract images from images/generations or images/edits response format.
 */
function extractImagesFromGenerationsResponse(data: Record<string, unknown>): string[] {
  const images: string[] = [];
  const visit = (value: unknown, depth = 0) => {
    if (depth > 6 || !value) return;
    if (typeof value === 'string') {
      if (value.startsWith('data:image/') || /^https?:\/\/[^\s"'<>]+/i.test(value)) images.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (typeof value !== 'object') return;

    const object = value as Record<string, unknown>;
    if (typeof object.b64_json === 'string') images.push(`data:image/png;base64,${object.b64_json}`);
    if (typeof object.url === 'string') visit(object.url, depth + 1);
    if (typeof object.image_url === 'string') visit(object.image_url, depth + 1);
    if (typeof object.image === 'string') visit(object.image, depth + 1);
    if (typeof object.output === 'string') visit(object.output, depth + 1);
    if (typeof object.result === 'string') visit(object.result, depth + 1);
    for (const key of ['data', 'images', 'image_urls', 'output', 'result', 'results', 'message', 'content']) {
      if (key in object) visit(object[key], depth + 1);
    }
  };

  if (Array.isArray(data.data)) {
    for (const item of data.data as Array<Record<string, unknown>>) {
      if (typeof item === 'string') { images.push(item); continue; }
      if (item.b64_json && typeof item.b64_json === 'string') {
        images.push(`data:image/png;base64,${item.b64_json}`);
      }
      if (item.url && typeof item.url === 'string') images.push(item.url);
    }
  } else if (typeof data.url === 'string') {
    images.push(data.url);
  } else if (typeof data.image_url === 'string') {
    images.push(data.image_url);
  }
  visit(data);

  const streamEvents = data.__streamEvents;
  if (Array.isArray(streamEvents)) {
    for (const event of streamEvents) {
      if (!event || typeof event !== 'object' || Array.isArray(event)) continue;
      images.push(...extractImagesFromGenerationsResponse(event as Record<string, unknown>));
    }
  }

  return Array.from(new Set(images));
}

/** Track which strategy produced a result */
interface StrategyResult {
  success: boolean;
  images?: string[];
  error?: string;
  status?: number;
  strategyName: string;
}

/**
 * Try a single API request strategy and return the result.
 */
async function tryImageStrategy(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  strategyName: string,
  isChatFormat: boolean,
  onProgress?: (progress: Record<string, unknown>) => void | Promise<void>,
): Promise<StrategyResult> {
  console.log(`[Custom API img2img → ${strategyName}] URL:`, url,
    '| model:', body.model,
    '| body_keys:', Object.keys(body).join(','));

  try {
    const response = await fetchWithRetry(
      url,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      },
      GENERATION_TIMEOUT,
      0,
    );

    if (response.ok) {
      const data = await parseCustomApiJsonWithProgress(response, onProgress);
      let images = isChatFormat
        ? extractImagesFromChatResponse(data as Record<string, unknown>)
        : [];
      if (images.length === 0) {
        images = extractImagesFromGenerationsResponse(data as Record<string, unknown>);
      }

      if (images.length > 0) {
        console.log(`[Custom API img2img → ${strategyName} SUCCESS] Got`, images.length, 'images');
        return { success: true, images, strategyName };
      }

      console.warn(`[Custom API img2img → ${strategyName}] OK but no images extracted, keys:`, objectKeysFromUnknown(data));
      return { success: false, error: '响应中无图片数据', strategyName };
    }

    const errorText = await response.text();
    console.warn(`[Custom API img2img → ${strategyName} FAILED]`, response.status, errorText.slice(0, 200));
    const parsedError = body.stream !== false && response.status === 524
      ? syncFallbackConfirmationError('上游流式生图没有持续返回数据，最终被 Cloudflare 判定超时。请确认是否重新发起同步生图请求；同步请求可能耗时更久，且仍受上游网关超时限制。')
      : parseCustomApiError(response.status, errorText);
    return { success: false, error: parsedError, status: response.status, strategyName };
  } catch (err) {
    const msg = err instanceof Error ? err.message : '请求异常';
    console.warn(`[Custom API img2img → ${strategyName} ERROR]`, msg);
    return { success: false, error: msg, strategyName };
  }
}

/**
 * Try images/edits endpoint with multipart/form-data format.
 *
 * CRITICAL: This is the format Cherry Studio (Electron app) uses for img2img.
 * OpenAI's official /v1/images/edits endpoint uses multipart/form-data, NOT JSON.
 * API proxies like mozhevip.top route based on Content-Type:
 * - multipart/form-data → routed to img2img account pool → WORKS
 * - application/json → routed to wrong pool → 503 "No available compatible accounts"
 *
 * This is why the same API+Key works in Cherry Studio but not from our server.
 */
async function tryEditsWithFormData(
  url: string,
  apiKey: string,
  fields: Record<string, string>,
  referenceFiles: Array<{ buffer: Buffer; mimeType: string }>,
  onProgress?: (progress: Record<string, unknown>) => void | Promise<void>,
): Promise<StrategyResult> {
  const strategyName = '策略1: images/edits (FormData)';
  console.log(`[Custom API img2img → ${strategyName}] URL:`, url, '| model:', fields.model);

  try {
    // Build multipart/form-data manually (Node.js doesn't have native FormData that works with fetch)
    const boundary = `----FormBoundary${Date.now()}${Math.random().toString(36).slice(2)}`;
    const parts: Buffer[] = [];

    for (const [key, value] of Object.entries(fields)) {
      parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`
      ));
    }

    // Add reference image file fields. Repeated "image" fields are accepted by
    // many OpenAI-compatible edit endpoints and keep single-image endpoints working.
    for (let index = 0; index < referenceFiles.length; index += 1) {
      const reference = referenceFiles[index];
      const ext = reference.mimeType.split('/')[1] || 'png';
      const fileName = index === 0 ? `image.${ext}` : `image-${index + 1}.${ext}`;
      parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${fileName}"\r\nContent-Type: ${reference.mimeType}\r\n\r\n`
      ));
      parts.push(reference.buffer);
      parts.push(Buffer.from(`\r\n`));
    }

    // Close boundary
    parts.push(Buffer.from(`--${boundary}--\r\n`));

    const bodyBuffer = Buffer.concat(parts);

    const response = await fetchWithRetry(
      url,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        },
        body: bodyBuffer,
      },
      GENERATION_TIMEOUT,
      0,
    );

    if (response.ok) {
      const data = await parseCustomApiJsonWithProgress(response, onProgress);
      const images = extractImagesFromGenerationsResponse(data as Record<string, unknown>);
      if (images.length > 0) {
        console.log(`[Custom API img2img → ${strategyName} SUCCESS] Got`, images.length, 'images');
        return { success: true, images, strategyName };
      }
      console.warn(`[Custom API img2img → ${strategyName}] OK but no images, keys:`, objectKeysFromUnknown(data));
      return { success: false, error: '响应中无图片数据', strategyName };
    }

    const errorText = await response.text();
    console.warn(`[Custom API img2img → ${strategyName} FAILED]`, response.status, errorText.slice(0, 200));
    const parsedError = fields.stream !== 'false' && response.status === 524
      ? syncFallbackConfirmationError('上游流式生图没有持续返回数据，最终被 Cloudflare 判定超时。请确认是否重新发起同步生图请求；同步请求可能耗时更久，且仍受上游网关超时限制。')
      : parseCustomApiError(response.status, errorText);
    return { success: false, error: parsedError, status: response.status, strategyName };
  } catch (err) {
    const msg = err instanceof Error ? err.message : '请求异常';
    console.warn(`[Custom API img2img → ${strategyName} ERROR]`, msg);
    return { success: false, error: msg, strategyName };
  }
}

/**
 * Image-to-image via custom API with multi-strategy approach.
 * Tries 3 different endpoint formats in order:
 * 1. /v1/chat/completions with image_url (Cherry Studio / OpenAI multimodal style)
 * 2. /v1/images/edits with image (Official OpenAI image edit endpoint)
 * 3. /v1/images/generations with init_image (Reference code / Stable Diffusion style)
 */
async function customApiImageToImage(
  customApiConfig: CustomApiConfig,
  imageApiTemplate: ImageApiTemplate,
  prompt: string,
  negativePrompt: string | undefined,
  image: string,
  strength: number | undefined,
  requestedSize: string | undefined,
  count: number,
  outputFormat: 'png' | 'jpeg' | 'webp',
  imageQuality: 'auto' | 'high' | 'medium' | 'low',
  aspectRatio?: string,
  resolution?: string,
  quality?: string,
  guidanceScale?: number,
  style?: unknown,
  user?: unknown,
  stream?: boolean,
  allReferenceImages?: string[],
  onProgress?: (progress: Record<string, unknown>) => void | Promise<void>,
): Promise<NextResponse> {
  const endpoint = customApiConfig.apiUrl;
  if (!endpoint) {
    return NextResponse.json({ error: '自定义API未配置请求地址' }, { status: 400 });
  }
  if (!customApiConfig.modelName) {
    return NextResponse.json({ error: '自定义API未配置模型名称，请在设置中填写模型名称（如 gpt-image-2）' }, { status: 400 });
  }

  const referenceInputs = allReferenceImages?.length ? allReferenceImages : [image];
  const resolvedReferences = await Promise.all(referenceInputs.map(resolveReferenceImageForFallback));
  const primaryReference = resolvedReferences[0];
  const referenceFiles = resolvedReferences
    .filter((item): item is ResolvedFallbackReference & { imageBuffer: Buffer } => Buffer.isBuffer(item.imageBuffer))
    .map(item => ({ buffer: item.imageBuffer, mimeType: item.imageMimeType }));

  if (referenceFiles[0]) {
    console.log('[Custom API img2img] Using original reference image without platform compression:', referenceFiles[0].buffer.length, 'bytes');
  }
  console.log('[Custom API img2img] Reference images prepared:', JSON.stringify({
    inputCount: referenceInputs.length,
    urlCount: resolvedReferences.filter(item => item.imageUrl).length,
    formDataFileCount: referenceFiles.length,
    urlHosts: Array.from(new Set(resolvedReferences.map(item => getReferenceUrlHostForLog(item.imageUrl)).filter(Boolean))),
  }));

  // Build prompt text with optional negative prompt and strength hints
  let promptText = prompt;
  if (negativePrompt) {
    promptText += `\n\n负面提示词（排除以下元素）: ${negativePrompt}`;
  }
  if (strength !== undefined && strength !== 0.5) {
    promptText += `\n\n[重绘幅度: ${strength.toFixed(2)}，${strength < 0.5 ? '尽量保留参考图特征' : '更贴近提示词描述'}]`;
  }
  // Augment prompt with aspect ratio hint
  if (aspectRatio) {
    const hint = getAspectRatioPromptHint(aspectRatio);
    if (hint) promptText += `\n\n[${hint}]`;
  }

  const denoisingStrength = strength ?? 0.5;
  const headers = buildCustomApiHeaders(customApiConfig.apiKey);

  const templatedRequest = imageApiTemplate.buildImageToImageRequest({
    apiUrl: endpoint,
    modelName: customApiConfig.modelName,
    prompt: promptText,
    negativePrompt,
    aspectRatio,
    size: requestedSize,
    count,
    outputFormat,
    imageQuality,
    guidanceScale,
    style,
    user,
    stream,
    imageUrl: primaryReference?.imageUrl || image,
    imageUrls: resolvedReferences.map(item => item.imageUrl).filter(Boolean),
    base64Image: primaryReference?.rawBase64 || image,
    base64Images: resolvedReferences.map(item => item.rawBase64).filter(Boolean),
    strength: denoisingStrength,
  });
  const targetSize = resolveTargetImageSize(
    templatedRequest.requestSize,
    aspectRatio,
    resolution,
    quality,
  );
  console.log('[Custom API img2img] Request template:', imageApiTemplate.id,
    '| size:', templatedRequest.logFields.size,
    '| n:', templatedRequest.logFields.n,
    '| output_format:', templatedRequest.logFields.output_format,
    '| quality:', templatedRequest.logFields.quality,
    '| aspect_ratio:', templatedRequest.logFields.aspect_ratio,
    '| stream:', templatedRequest.logFields.stream,
    '| strength:', templatedRequest.logFields.strength);

  const useGenerationJsonOnly = templatedRequest.strategy === 'generation-json-only';

  // --- Strategy 1: /v1/images/edits with multipart/form-data ---
  // This is THE format Cherry Studio uses! OpenAI's official endpoint.
  // API proxies route multipart/form-data to the correct img2img account pool.
  let result1: StrategyResult | null = null;
  if (!useGenerationJsonOnly && referenceFiles.length > 0) {
    result1 = await tryEditsWithFormData(
      templatedRequest.editsFormData.endpoint,
      customApiConfig.apiKey,
      templatedRequest.editsFormData.fields,
      referenceFiles,
      onProgress,
    );
    if (result1.success && result1.images) {
      const persisted = await persistQualifiedImageUrls(result1.images, 'generated/images', targetSize, 'Custom API img2img strategy1', count, outputFormat, imageQuality);
      if (persisted.images.length > 0) return NextResponse.json(imageResponsePayload(persisted, count));
      result1 = { ...result1, success: false, error: imageResultFailureError(targetSize, persisted) };
    }
  }

  // --- Strategy 2: chat/completions with image_url (multimodal style) ---
  let result2: StrategyResult | null = null;
  if (!useGenerationJsonOnly) {
    result2 = await tryImageStrategy(
      templatedRequest.chatJson.endpoint,
      headers,
      templatedRequest.chatJson.body,
      '策略2: chat/completions',
      templatedRequest.chatJson.isChatFormat,
      onProgress,
    );
    if (result2.success && result2.images) {
      const persisted = await persistQualifiedImageUrls(result2.images, 'generated/images', targetSize, 'Custom API img2img strategy2', count, outputFormat, imageQuality);
      if (persisted.images.length > 0) return NextResponse.json(imageResponsePayload(persisted, count));
      result2.success = false;
      result2.error = imageResultFailureError(targetSize, persisted);
    }
  }

  // --- Strategy 3: /v1/images/generations with init_image (Reference code / SD style) ---
  const result3 = await tryImageStrategy(
    templatedRequest.generationJson.endpoint,
    headers,
    templatedRequest.generationJson.body,
    useGenerationJsonOnly ? '策略1: images/generations' : '策略3: images/generations+init_image',
    templatedRequest.generationJson.isChatFormat,
    onProgress,
  );
  if (result3.success && result3.images) {
    const persisted = await persistQualifiedImageUrls(result3.images, 'generated/images', targetSize, 'Custom API img2img strategy3', count, outputFormat, imageQuality);
    if (persisted.images.length > 0) return NextResponse.json(imageResponsePayload(persisted, count));
    result3.success = false;
    result3.error = imageResultFailureError(targetSize, persisted);
  }

  const upstreamError = result1?.error || result2?.error || result3.error;
  const upstreamStatus = result1?.status || result2?.status || result3.status || 502;
  return NextResponse.json(
    {
      error: upstreamError || '图生图失败',
    },
    { status: upstreamStatus >= 500 ? 502 : upstreamStatus }
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      prompt,
      negativePrompt,
      model = 'doubao-seedream-5-0-260128',
      quality = '2K',
      size,
      aspectRatio,
      resolution,
      count,
      outputFormat,
      imageQuality,
      stylePrompt,
      style,
      user,
      guidanceScale = 7,
      stream,
      image,
      images: requestImages,
      extraImages,
      referenceImageAnnotations,
      strength,
      customApiConfig,
    } = body as {
      prompt?: string;
      negativePrompt?: string;
      model?: string;
      quality?: string;
      size?: string;
      aspectRatio?: string;
      resolution?: string;
      count?: number | string;
      outputFormat?: string;
      imageQuality?: string;
      stylePrompt?: string;
      style?: string;
      user?: string;
      guidanceScale?: number;
      stream?: boolean;
      image?: string;
      images?: unknown;
      extraImages?: string[];
      referenceImageAnnotations?: unknown;
      strength?: number;
      customApiConfig?: CustomApiConfig;
    };

    if (!prompt) {
      return NextResponse.json({ error: '请提供创作描述' }, { status: 400 });
    }

    if (prompt.length < 2) {
      return NextResponse.json({ error: '创作描述过短，请输入更详细的描述' }, { status: 400 });
    }

    const referenceImages = normalizeReferenceImages(image, requestImages, extraImages);
    const resolvedAutoParams = resolveAutoImageRequestParams({
      prompt,
      aspectRatio,
      resolution,
      count,
      hasReferenceImage: referenceImages.length > 0,
    });
    if (!resolvedAutoParams.ok) {
      return NextResponse.json({ error: resolvedAutoParams.message }, { status: 400 });
    }
    const resolvedOutputFormat = normalizeImageOutputFormat(outputFormat);
    const resolvedImageQuality = normalizeImageQuality(imageQuality);
    const promptWithReferenceImages = buildReferenceImagePrompt(prompt, referenceImages.length, referenceImageAnnotations);
    const layoutCompositionSkill = await applyLayoutCompositionSkillToPrompt({
      prompt: promptWithReferenceImages,
      aspectRatio: resolvedAutoParams.aspectRatio,
      resolution: resolvedAutoParams.resolution,
      hasReferenceImage: referenceImages.length > 0,
    });
    const promptWithCompositionSkill = layoutCompositionSkill.prompt;
    const promptForGeneration = mergeStylePrompt(promptWithCompositionSkill, stylePrompt);
    const requestedCustomSize = size && size !== 'auto'
      ? size
      : resolveCustomApiImageSize(resolvedAutoParams.aspectRatio, resolvedAutoParams.resolution);
    const sdkResolvedSize = size && size !== 'auto'
      ? size
      : resolveImageSize(resolvedAutoParams.aspectRatio, resolvedAutoParams.resolution);

    const routeAccess = await enforceGenerationRouteAccess(request, customApiConfig);
    if (routeAccess.response) return routeAccess.response;
    const trustedUserId = routeAccess.trustedUserId || routeAccess.authenticatedUserId;
    const generationJobId = routeAccess.generationJobId;
    const handleUpstreamProgress = (progress: Record<string, unknown>) => updateGenerationJobProgress(
      isUuid(generationJobId) ? generationJobId : null,
      progress,
    );
    const resolvedCustomApiConfig = customApiConfig?.systemApiId
      ? undefined
      : await resolveServerApiConfig(
        request,
        customApiConfig,
        isUuid(trustedUserId) ? trustedUserId : null,
      );
    const targetSize = resolveTargetImageSize(
      requestedCustomSize || sdkResolvedSize,
      resolvedAutoParams.aspectRatio,
      resolvedAutoParams.resolution,
      quality,
    );

    // Log all incoming parameters for debugging
    console.log('[Image Generation] Params:', JSON.stringify({
      model,
      size: requestedCustomSize || sdkResolvedSize,
      aspectRatio: resolvedAutoParams.aspectRatio,
      resolution: resolvedAutoParams.resolution,
      count: resolvedAutoParams.count,
      outputFormat: resolvedOutputFormat,
      imageQuality: resolvedImageQuality,
      guidanceScale,
      hasCustomApi: !!resolvedCustomApiConfig,
      customApiUrl: resolvedCustomApiConfig?.apiUrl,
      customApiModel: resolvedCustomApiConfig?.modelName,
      hasImage: referenceImages.length > 0,
      strength,
      promptLength: prompt.length,
      compositionSkill: layoutCompositionSkill.enabled ? layoutCompositionSkill.layoutId : undefined,
      stream: stream !== false,
    }));

    const runCustomApiGeneration = async (resolvedCustomApiConfig: CustomApiConfig): Promise<NextResponse> => {
      const resolvedApiKey = resolvedCustomApiConfig.apiKey;
      const imageApiTemplate = resolveImageApiTemplate(resolvedCustomApiConfig as CustomApiConfig);
      try {
        if (resolvedCustomApiConfig.manifestPath) {
          const manifestResult = await executeUserApiManifest({
            manifestPath: resolvedCustomApiConfig.manifestPath,
            apiUrl: resolvedCustomApiConfig.apiUrl,
            apiKey: resolvedApiKey,
            modelName: resolvedCustomApiConfig.modelName,
            jobId: generationJobId,
            prompt: promptForGeneration,
            params: {
              size: requestedCustomSize,
              quality: resolvedImageQuality,
              output_format: resolvedOutputFormat,
              moderation: 'auto',
              n: resolvedAutoParams.count,
              aspect_ratio: resolvedAutoParams.aspectRatio,
              resolution: resolvedAutoParams.resolution,
            },
            inputImages: referenceImages,
            preferEdit: referenceImages.length > 0,
            timeoutMs: GENERATION_TIMEOUT,
            onProgress: handleUpstreamProgress,
          });
          if (manifestResult) {
            if (manifestResult.images.length === 0) {
              return NextResponse.json({ error: '上游任务已完成，但响应中无图片数据' }, { status: 502 });
            }
            const persisted = await persistQualifiedImageUrls(
              manifestResult.images,
              'generated/images',
              targetSize,
              'User API Manifest Image',
              resolvedAutoParams.count,
              resolvedOutputFormat,
              resolvedImageQuality,
            );
            if (persisted.images.length === 0) {
              return NextResponse.json({ error: generatedImagePersistenceError(persisted) }, { status: 502 });
            }
            return NextResponse.json(imageResponsePayload(persisted, resolvedAutoParams.count));
          }
        }

        // Image-to-image: use multi-strategy approach
        if (referenceImages.length > 0) {
          return await customApiImageToImage(
            resolvedCustomApiConfig as CustomApiConfig,
            imageApiTemplate,
            promptForGeneration,
            negativePrompt,
            referenceImages[0],
            strength,
            requestedCustomSize,
            resolvedAutoParams.count,
            resolvedOutputFormat,
            resolvedImageQuality,
            resolvedAutoParams.aspectRatio,
            resolvedAutoParams.resolution,
            quality,
            guidanceScale,
            style,
            user,
            stream,
            referenceImages,
            handleUpstreamProgress,
          );
        }

        // Text-to-image: use images/generations format
        const endpoint = resolvedCustomApiConfig.apiUrl;
        if (!endpoint) {
          return NextResponse.json({ error: '自定义API未配置请求地址' }, { status: 400 });
        }
        if (!resolvedCustomApiConfig.modelName) {
          return NextResponse.json({ error: '自定义API未配置模型名称，请在设置中填写模型名称（如 gpt-image-2）' }, { status: 400 });
        }

        // Resolve the selected model's API template and let it build the upstream request.
        const ratioHint = getAspectRatioPromptHint(resolvedAutoParams.aspectRatio);
        const augmentedPrompt = ratioHint ? `${promptForGeneration}\n\n[${ratioHint}]` : promptForGeneration;
        const templatedRequest = imageApiTemplate.buildTextToImageRequest({
          apiUrl: endpoint,
          modelName: resolvedCustomApiConfig.modelName,
          prompt: augmentedPrompt,
          negativePrompt,
          aspectRatio: resolvedAutoParams.aspectRatio,
          size: requestedCustomSize,
          count: resolvedAutoParams.count,
          outputFormat: resolvedOutputFormat,
          imageQuality: resolvedImageQuality,
          guidanceScale,
          style,
          user,
          stream,
        });
        const n = templatedRequest.requestCount;
        const customApiSize = templatedRequest.requestSize;
        const customTargetSize = resolveTargetImageSize(
          customApiSize,
          resolvedAutoParams.aspectRatio,
          resolvedAutoParams.resolution,
          quality,
        );
        const requestBody = templatedRequest.body;
        console.log('[Custom API Image] Text-to-image, sending to:', templatedRequest.endpoint,
          '| model:', requestBody.model,
          '| template:', imageApiTemplate.id,
          '| size:', templatedRequest.logFields.size,
          '| n:', templatedRequest.logFields.n,
          '| output_format:', templatedRequest.logFields.output_format,
          '| quality:', templatedRequest.logFields.quality,
          '| aspect_ratio:', templatedRequest.logFields.aspect_ratio,
          '| stream:', templatedRequest.logFields.stream,
          '| guidance_scale:', templatedRequest.logFields.guidance_scale,
          '| prompt_length:', prompt.length,
          '| request_prompt_length:', String(requestBody.prompt || '').length);

        let customGenerationResult: Awaited<ReturnType<typeof requestQualifiedCustomImages>>;
        try {
          customGenerationResult = await requestQualifiedCustomImages(
            templatedRequest.endpoint,
            resolvedApiKey,
            requestBody,
            n,
            customTargetSize,
            resolvedOutputFormat,
            resolvedImageQuality,
            handleUpstreamProgress,
            { autoRetryWithoutStream: !!resolvedCustomApiConfig.systemApiId },
          );
        } catch (fetchError: unknown) {
          if (fetchError instanceof DOMException && fetchError.name === 'AbortError') {
            return NextResponse.json({ error: `自定义API请求超时（${GENERATION_TIMEOUT_SECONDS}秒）` }, { status: 504 });
          }
          const msg = fetchError instanceof Error ? fetchError.message : '请求失败';
          if (msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND') || msg.includes('fetch failed')) {
            return NextResponse.json({ error: `无法连接到自定义API: ${msg}。请检查 API 地址` }, { status: 502 });
          }
          return NextResponse.json({ error: `自定义API网络错误: ${msg}` }, { status: 502 });
        }

        if (customGenerationResult.upstreamError) {
          const { status, text } = customGenerationResult.upstreamError;
          console.error('[Custom API Image Error]', status, text.slice(0, 500));
          return NextResponse.json(
            { error: parseCustomApiError(status, text) },
            { status: status >= 500 ? 502 : status }
          );
        }

        if (customGenerationResult.images.length === 0) {
          return NextResponse.json({ error: imageResultFailureError(customTargetSize, customGenerationResult) }, { status: 502 });
        }
        console.log('[Custom API Image] Persisted', customGenerationResult.images.length, '/', n, 'qualified images',
          '| target:', customTargetSize ? formatTargetSize(customTargetSize) : 'none');
        return NextResponse.json(imageResponsePayload(customGenerationResult, n));
      } catch (customError: unknown) {
        const msg = customError instanceof Error ? customError.message : '自定义API请求异常';
        console.error('[Custom API Image Exception]', msg);
        return NextResponse.json({ error: `自定义API异常: ${msg}` }, { status: 502 });
      }
    };

    // ---- System default API polling mode ----
    if (customApiConfig?.systemApiId) {
      const candidates = await resolveSystemApiPollingCandidates(
        request,
        customApiConfig,
        isUuid(trustedUserId) ? trustedUserId : null,
      );
      let lastError = '';
      for (const candidate of candidates) {
        if (!candidate.apiKey) {
          lastError = `${candidate.provider || '系统 API'} 未配置密钥`;
          console.warn('[System API Polling] Skip candidate without API key:', candidate.provider, candidate.modelName, candidate.systemApiId);
          continue;
        }
        const response = await runCustomApiGeneration(candidate as CustomApiConfig);
        if (response.ok) {
          if (candidate.systemApiId !== customApiConfig.systemApiId) {
            console.log('[System API Polling] Fallback candidate succeeded:', candidate.provider, candidate.modelName, candidate.systemApiId);
          }
          return response;
        }
        try {
          const data = await response.clone().json().catch(() => ({}));
          lastError = typeof data.error === 'string' ? data.error : `HTTP ${response.status}`;
        } catch {
          lastError = `HTTP ${response.status}`;
        }
        console.warn('[System API Polling] Candidate failed:', candidate.provider, candidate.modelName, candidate.systemApiId, lastError);
      }
      console.error('[System API Polling] All candidates failed:', customApiConfig.modelName || model, lastError);
      return NextResponse.json({ error: getSystemPollingFailureMessage(lastError) }, { status: 503 });
    }

    // ---- Custom API mode ----
    if (resolvedCustomApiConfig && resolvedCustomApiConfig.apiKey) {
      return runCustomApiGeneration(resolvedCustomApiConfig as CustomApiConfig);
    }

    // ---- Default mode: use coze-coding-dev-sdk ----
    const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
    const config = new Config();
    const client = new ImageGenerationClient(config, customHeaders);

    let sdkSize: string;
    if (size && size !== 'auto') {
      sdkSize = size;
    } else if (resolvedAutoParams.aspectRatio && resolvedAutoParams.resolution) {
      // Resolve from aspect ratio + resolution
      const sizeMap: Record<string, Record<string, string>> = {
        '1:1': { '1080P': '1024x1024', '2K': '2048x2048', '4K': '4096x4096' },
        '16:9': { '1080P': '1920x1080', '2K': '2560x1440', '4K': '3840x2160' },
        '9:16': { '1080P': '1080x1920', '2K': '1440x2560', '4K': '2160x3840' },
        '4:3': { '1080P': '1440x1080', '2K': '2560x1920', '4K': '4096x3072' },
        '3:4': { '1080P': '1080x1440', '2K': '1920x2560', '4K': '3072x4096' },
      };
      sdkSize = sizeMap[resolvedAutoParams.aspectRatio]?.[resolvedAutoParams.resolution] || sdkResolvedSize || '1024x1024';
    } else {
      sdkSize = quality === '4K' ? '4K' : quality === '1K' ? '1K' : '2K';
    }

    const generateRequest: Record<string, unknown> = {
      prompt: promptForGeneration,
      model,
      size: sdkSize,
      output_format: resolvedOutputFormat,
      quality: resolvedImageQuality,
      watermark: false,
    };

    if (negativePrompt) {
      generateRequest.negativePrompt = negativePrompt;
    }

    const primarySdkReferenceImage = referenceImages[0];
    if (primarySdkReferenceImage) {
      if (primarySdkReferenceImage.startsWith('data:')) {
        const uploadedUrl = await uploadDataUrlAndGetPublicUrl(primarySdkReferenceImage);
        if (uploadedUrl) {
          generateRequest.image = uploadedUrl;
        } else {
          console.warn('[Image Gen] Failed to upload reference image, skipping');
        }
      } else {
        const storedReferenceKey = localStorage.getKeyFromPublicUrl(primarySdkReferenceImage);
        generateRequest.image = storedReferenceKey
          ? await getReferenceImagePublicUrlFromKey(storedReferenceKey)
          : toAbsolutePublicUrl(primarySdkReferenceImage);
      }
    }

    let response;
    try {
      const debugRequest = { ...generateRequest };
      if (typeof debugRequest.image === 'string' && debugRequest.image.length > 100) {
        debugRequest.image = `${debugRequest.image.substring(0, 60)}... (${debugRequest.image.length} chars)`;
      }
      console.log('[SDK Image Request]', JSON.stringify(debugRequest));
      response = await client.generate(generateRequest as unknown as Parameters<typeof client.generate>[0]);
    } catch (sdkError: unknown) {
      const sdkMessage = sdkError instanceof Error ? sdkError.message : '图片生成请求失败';
      let detail = '';
      try {
        const errObj = sdkError as { response?: { status?: number; data?: unknown; statusText?: string } };
        if (errObj.response) {
          const dataStr = errObj.response.data ? JSON.stringify(errObj.response.data) : '';
          detail = `status=${errObj.response.status} data=${dataStr.substring(0, 500)}`;
        }
      } catch { /* ignore */ }
      console.error('[Image Generation SDK Error]', sdkMessage, detail);
      if (referenceImages.length > 0) {
        return NextResponse.json({
          error: '图生图生成失败: 内置模型图生图功能暂不可用。建议使用自定义API重试。',
        }, { status: 503 });
      }
      return NextResponse.json({ error: `图片生成服务暂时不可用: ${sdkMessage}` }, { status: 503 });
    }

    const helper = client.getResponseHelper(response);
    if (!helper.success) {
      const errorMsg = helper.errorMessages.length > 0 ? helper.errorMessages.join('; ') : '图片生成失败';
      return NextResponse.json({ error: errorMsg }, { status: 500 });
    }

    const images = helper.imageUrls;
    if (images.length === 0) {
      return NextResponse.json({ error: '图片生成失败，请稍后重试' }, { status: 500 });
    }

    const persistedImages = await persistQualifiedImageUrls(images, 'generated/images', targetSize, 'SDK Image', resolvedAutoParams.count, resolvedOutputFormat, resolvedImageQuality);
    if (persistedImages.images.length === 0) {
      return NextResponse.json({ error: imageResultFailureError(targetSize, persistedImages) }, { status: 502 });
    }
    return NextResponse.json(imageResponsePayload(persistedImages, resolvedAutoParams.count));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '图片生成失败';
    console.error('[Image Generation Error]', message, error instanceof Error ? error.stack : '');
    return NextResponse.json({ error: `生成失败: ${message}` }, { status: 500 });
  }
}
