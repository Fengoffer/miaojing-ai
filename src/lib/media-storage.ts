import crypto from 'crypto';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import { createRequire } from 'module';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import { localStorage } from '@/lib/local-storage';
import { fetchPublicHttpUrl, fetchPublicHttpUrlWithRetry } from '@/lib/remote-fetch';

const THUMBNAIL_MAX_EDGE = Number(process.env.IMAGE_THUMBNAIL_MAX_EDGE || 1280);
const THUMBNAIL_WEBP_QUALITY = Number(process.env.IMAGE_THUMBNAIL_WEBP_QUALITY || 86);
const THUMBNAIL_PROFILE = `m${THUMBNAIL_MAX_EDGE}q${THUMBNAIL_WEBP_QUALITY}`;
const VIDEO_FRAME_THUMBNAIL_PROFILE = `video-frame-${THUMBNAIL_PROFILE}-v1`;
const VIDEO_FALLBACK_THUMBNAIL_PROFILE = 'video-fallback-svg-v2';
const VIDEO_THUMBNAIL_TIMEOUT_MS = Number(process.env.VIDEO_THUMBNAIL_TIMEOUT_MS || 45_000);
const VIDEO_THUMBNAIL_MAX_INPUT_BYTES = Number(process.env.VIDEO_THUMBNAIL_MAX_INPUT_BYTES || 512 * 1024 * 1024);
const VIDEO_THUMBNAIL_MAX_OUTPUT_BYTES = Number(process.env.VIDEO_THUMBNAIL_MAX_OUTPUT_BYTES || 25 * 1024 * 1024);
const VIDEO_THUMBNAIL_INPUT_ATTEMPTS = Number(process.env.VIDEO_THUMBNAIL_INPUT_ATTEMPTS || 3);
const IMAGE_FETCH_TIMEOUT_MS = Number(process.env.IMAGE_FETCH_TIMEOUT_MS || 90_000);

export type PersistedImageMedia = {
  url: string;
  thumbnailUrl: string;
  width: number;
  height: number;
  bytes: number;
};

type ImageBufferSource = {
  buffer: Buffer;
  mimeType: string;
  ext: string;
};

export type ImageOutputFormat = 'png' | 'jpeg' | 'webp';
export type ImageOutputQuality = 'auto' | 'high' | 'medium' | 'low';

type VideoThumbnailInput = {
  input: string;
  cleanup?: () => Promise<void>;
};

export function parseImageDataUrl(dataUrl: string): ImageBufferSource | null {
  const match = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
  if (!match) return null;
  const mimeType = match[1].split(';')[0] || 'image/png';
  return {
    buffer: Buffer.from(match[2], 'base64'),
    mimeType,
    ext: getImageExtension(mimeType, dataUrl),
  };
}

export function getImageExtension(mimeType: string, url = ''): string {
  const normalizedMime = mimeType.split(';')[0]?.trim().toLowerCase();
  if (normalizedMime === 'image/jpeg' || normalizedMime === 'image/jpg') return 'jpg';
  if (normalizedMime === 'image/png') return 'png';
  if (normalizedMime === 'image/webp') return 'webp';
  if (normalizedMime === 'image/gif') return 'gif';
  const urlExt = path.extname(url.split('?')[0] || '').replace('.', '').toLowerCase();
  return /^(jpe?g|png|webp|gif)$/i.test(urlExt) ? urlExt : 'png';
}

export async function readImageBufferFromUrl(url: string): Promise<ImageBufferSource | null> {
  if (url.startsWith('data:')) return parseImageDataUrl(url);

  const existingKey = localStorage.getKeyFromPublicUrl(url);
  if (existingKey && localStorage.localFileExistsOnly(existingKey)) {
    const buffer = await localStorage.readFileAsync(existingKey);
    return {
      buffer,
      mimeType: getImageMimeType(existingKey),
      ext: path.extname(existingKey).replace('.', '') || 'png',
    };
  }
  const objectReadUrl = existingKey ? localStorage.generateObjectReadUrl(existingKey, 300) : null;
  if (existingKey && objectReadUrl) {
    const response = await fetchPublicHttpUrl(objectReadUrl, { signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`下载图片失败: ${response.status}`);
    const mimeType = response.headers.get('content-type')?.split(';')[0] || getImageMimeType(existingKey);
    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      mimeType,
      ext: getImageExtension(mimeType, existingKey),
    };
  }
  if (existingKey && await localStorage.fileExistsAsync(existingKey)) {
    const buffer = await localStorage.readFileAsync(existingKey);
    return {
      buffer,
      mimeType: getImageMimeType(existingKey),
      ext: path.extname(existingKey).replace('.', '') || 'png',
    };
  }

  if (!url.startsWith('http')) return null;
  const response = await fetchPublicHttpUrlWithRetry(url, {}, {
    attempts: 3,
    retryDelayMs: 500,
    timeoutMs: IMAGE_FETCH_TIMEOUT_MS,
  });
  if (!response.ok) throw new Error(`下载图片失败: ${response.status}`);
  const mimeType = response.headers.get('content-type')?.split(';')[0] || 'image/png';
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    mimeType,
    ext: getImageExtension(mimeType, url),
  };
}

function imageFormatQuality(format: ImageOutputFormat, quality?: ImageOutputQuality): number {
  if (format === 'png') return 100;
  if (quality === 'low') return format === 'webp' ? 72 : 78;
  if (quality === 'medium' || quality === 'auto') return format === 'webp' ? 84 : 86;
  return format === 'webp' ? 92 : 94;
}

export async function normalizeImageBufferForOutputFormat(
  source: ImageBufferSource,
  outputFormat?: ImageOutputFormat,
  quality?: ImageOutputQuality,
): Promise<ImageBufferSource> {
  if (!outputFormat) return source;

  if (outputFormat === 'png') {
    if (source.mimeType === 'image/png' && source.ext === 'png') return source;
    const buffer = await sharp(source.buffer, { failOn: 'none' }).rotate().png().toBuffer();
    return { buffer, mimeType: 'image/png', ext: 'png' };
  }

  if (outputFormat === 'jpeg') {
    if ((source.mimeType === 'image/jpeg' || source.mimeType === 'image/jpg') && /jpe?g/i.test(source.ext)) return source;
    const buffer = await sharp(source.buffer, { failOn: 'none' })
      .rotate()
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: imageFormatQuality('jpeg', quality), mozjpeg: true })
      .toBuffer();
    return { buffer, mimeType: 'image/jpeg', ext: 'jpg' };
  }

  if (source.mimeType === 'image/webp' && source.ext === 'webp') return source;
  const buffer = await sharp(source.buffer, { failOn: 'none' })
    .rotate()
    .webp({ quality: imageFormatQuality('webp', quality), effort: 5, smartSubsample: true })
    .toBuffer();
  return { buffer, mimeType: 'image/webp', ext: 'webp' };
}

export async function persistOriginalImageWithThumbnail(input: {
  buffer: Buffer;
  mimeType: string;
  ext: string;
  originalPrefix: string;
  thumbnailPrefix?: string;
}): Promise<PersistedImageMedia> {
  const metadata = await sharp(input.buffer, { failOn: 'none' }).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error('无法读取生成图片尺寸');
  }

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const originalKey = await localStorage.uploadFileObjectOnly({
    fileContent: input.buffer,
    fileName: `${input.originalPrefix}/${suffix}.${input.ext || 'png'}`,
    contentType: input.mimeType,
  });
  const thumbnailUrl = await createLocalImageThumbnail({
    buffer: input.buffer,
    sourceKey: originalKey,
    thumbnailPrefix: input.thumbnailPrefix || 'thumbnails/images',
  });
  const url = await localStorage.generatePresignedUrl({ key: originalKey, expireTime: 2592000 });

  return {
    url,
    thumbnailUrl,
    width: metadata.width,
    height: metadata.height,
    bytes: input.buffer.length,
  };
}

export async function ensureLocalImageThumbnail(url: string, thumbnailPrefix = 'thumbnails/images'): Promise<string | null> {
  if (!url || url.startsWith('data:') || url.startsWith('[')) return null;
  const source = await readImageBufferFromUrl(url);
  if (!source) return null;
  const existingKey = localStorage.getKeyFromPublicUrl(url) || url;
  return createLocalImageThumbnail({
    buffer: source.buffer,
    sourceKey: existingKey,
    thumbnailPrefix,
  });
}

export function isCurrentLocalImageThumbnail(url: unknown): boolean {
  return typeof url === 'string'
    && url.includes('/api/local-storage/thumbnails/')
    && url.includes(`-${THUMBNAIL_PROFILE}.webp`);
}

export async function ensureLocalVideoThumbnail(
  url: string,
  thumbnailPrefix = 'thumbnails/videos',
  label = 'Video',
): Promise<string | null> {
  if (!url || url.startsWith('data:') || url.startsWith('[')) return null;
  const sourceKey = localStorage.getKeyFromPublicUrl(url) || url;
  const hash = crypto.createHash('sha256')
    .update(sourceKey)
    .digest('hex')
    .slice(0, 32);
  const frameKey = `${thumbnailPrefix}/${hash}-${VIDEO_FRAME_THUMBNAIL_PROFILE}.webp`;
  if (localStorage.localFileExistsOnly(frameKey)) {
    return localStorage.generatePresignedUrl({ key: frameKey, expireTime: 2592000 });
  }

  try {
    const thumbnail = await extractVideoFrameThumbnail(url, sourceKey);
    if (thumbnail) {
      const savedFrameKey = await localStorage.uploadFileLocalOnly({
        fileContent: thumbnail,
        fileName: frameKey,
        contentType: 'image/webp',
      });
      return localStorage.generatePresignedUrl({ key: savedFrameKey, expireTime: 2592000 });
    }
  } catch (error) {
    console.warn('[media-storage] video frame thumbnail generation failed:', error instanceof Error ? error.message : error);
  }

  const fallbackKey = `${thumbnailPrefix}/${hash}-${VIDEO_FALLBACK_THUMBNAIL_PROFILE}.svg`;
  if (localStorage.localFileExistsOnly(fallbackKey)) {
    return localStorage.generatePresignedUrl({ key: fallbackKey, expireTime: 2592000 });
  }
  const svg = buildVideoThumbnailSvg(label);
  const savedKey = await localStorage.uploadFileLocalOnly({
    fileContent: Buffer.from(svg, 'utf8'),
    fileName: fallbackKey,
    contentType: 'image/svg+xml',
  });
  return localStorage.generatePresignedUrl({ key: savedKey, expireTime: 2592000 });
}

export function isCurrentLocalVideoThumbnail(url: unknown): boolean {
  return typeof url === 'string'
    && url.includes('/api/local-storage/thumbnails/')
    && url.includes(`-${VIDEO_FRAME_THUMBNAIL_PROFILE}.webp`);
}

export async function createLocalImageThumbnail(input: {
  buffer: Buffer;
  sourceKey: string;
  thumbnailPrefix: string;
}): Promise<string> {
  const hash = crypto.createHash('sha256')
    .update(input.sourceKey)
    .update(input.buffer.subarray(0, Math.min(input.buffer.length, 1024 * 1024)))
    .digest('hex')
    .slice(0, 32);
  const key = `${input.thumbnailPrefix}/${hash}-${THUMBNAIL_PROFILE}.webp`;
  if (localStorage.localFileExistsOnly(key)) {
    return localStorage.generatePresignedUrl({ key, expireTime: 2592000 });
  }

  const thumbnail = await sharp(input.buffer, { failOn: 'none' })
    .rotate()
    .resize({
      width: THUMBNAIL_MAX_EDGE,
      height: THUMBNAIL_MAX_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
      kernel: sharp.kernel.lanczos3,
    })
    .sharpen({ sigma: 0.45, m1: 0.6, m2: 1.5 })
    .webp({
      quality: Math.max(85, Math.min(100, THUMBNAIL_WEBP_QUALITY)),
      effort: 5,
      smartSubsample: true,
    })
    .toBuffer();

  const savedKey = await localStorage.uploadFileLocalOnly({
    fileContent: thumbnail,
    fileName: key,
    contentType: 'image/webp',
  });
  return localStorage.generatePresignedUrl({ key: savedKey, expireTime: 2592000 });
}

function getImageMimeType(key: string): string {
  const ext = path.extname(key).replace('.', '').toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return 'image/png';
}

async function extractVideoFrameThumbnail(url: string, sourceKey: string): Promise<Buffer | null> {
  const ffmpegPath = getFfmpegPath();
  if (!ffmpegPath) {
    throw new Error('ffmpeg-static binary is not available');
  }

  const source = await resolveVideoThumbnailInput(url, sourceKey);
  if (!source) return null;
  try {
    let lastError: unknown;
    for (const seekTime of ['1', '0.2', '0']) {
      try {
        const frame = await runFfmpegFrameExtract(ffmpegPath, source.input, seekTime);
        return sharp(frame, { failOn: 'none' })
          .resize({
            width: THUMBNAIL_MAX_EDGE,
            height: THUMBNAIL_MAX_EDGE,
            fit: 'inside',
            withoutEnlargement: true,
            kernel: sharp.kernel.lanczos3,
          })
          .sharpen({ sigma: 0.35, m1: 0.5, m2: 1.2 })
          .webp({
            quality: Math.max(85, Math.min(100, THUMBNAIL_WEBP_QUALITY)),
            effort: 5,
            smartSubsample: true,
          })
          .toBuffer();
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('ffmpeg did not return a video frame');
  } finally {
    await source.cleanup?.().catch((error) => {
      console.warn('[media-storage] temporary video thumbnail input cleanup failed:', error instanceof Error ? error.message : error);
    });
  }
}

async function resolveVideoThumbnailInput(url: string, sourceKey: string): Promise<VideoThumbnailInput | null> {
  const existingKey = localStorage.getKeyFromPublicUrl(url);
  if (existingKey && localStorage.localFileExistsOnly(existingKey)) {
    return { input: localStorage.getFilePath(existingKey) };
  }

  if (existingKey) {
    try {
      return await writeStoredTemporaryVideoInput(existingKey, sourceKey);
    } catch (error) {
      const objectReadUrl = localStorage.generateObjectReadUrl(existingKey, 300);
      if (!objectReadUrl) throw error;
      try {
        return await fetchTemporaryVideoInput(objectReadUrl, sourceKey);
      } catch {
        throw error;
      }
    }
  }

  if (!url.startsWith('http')) return null;
  return fetchTemporaryVideoInput(url, url);
}

async function writeStoredTemporaryVideoInput(existingKey: string, sourceKey: string): Promise<VideoThumbnailInput> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= VIDEO_THUMBNAIL_INPUT_ATTEMPTS; attempt += 1) {
    try {
      const storedFile = await localStorage.openFileStreamAsync(existingKey);
      return await writeTemporaryVideoInputFromStream(storedFile.body, getVideoExtension(sourceKey), storedFile.contentLength);
    } catch (error) {
      lastError = error;
      if (attempt < VIDEO_THUMBNAIL_INPUT_ATTEMPTS) {
        await delay(350 * attempt);
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Failed to read stored video input');
}

async function fetchTemporaryVideoInput(url: string, sourceKey: string): Promise<VideoThumbnailInput> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= VIDEO_THUMBNAIL_INPUT_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchPublicHttpUrlWithRetry(
        url,
        { headers: { Accept: 'video/mp4,video/webm,video/quicktime,video/*,*/*;q=0.8' } },
        { attempts: 2, retryDelayMs: 500, timeoutMs: 45_000 },
      );
      if (!response.ok) throw new Error(`Failed to fetch video for thumbnail: ${response.status}`);
      return await writeTemporaryVideoInputFromStream(response.body, getVideoExtension(sourceKey), Number(response.headers.get('content-length')) || undefined);
    } catch (error) {
      lastError = error;
      if (attempt < VIDEO_THUMBNAIL_INPUT_ATTEMPTS) {
        await delay(350 * attempt);
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Failed to fetch video input');
}

async function writeTemporaryVideoInputFromStream(
  stream: ReadableStream<Uint8Array> | null,
  ext: string,
  contentLength?: number,
): Promise<VideoThumbnailInput> {
  if (contentLength && contentLength > VIDEO_THUMBNAIL_MAX_INPUT_BYTES) {
    throw new Error(`Video input exceeds thumbnail extraction limit: ${contentLength} bytes`);
  }
  if (!stream) {
    throw new Error('Video input stream is not available');
  }

  const filePath = getTemporaryVideoInputPath(ext);
  const handle = await fs.open(filePath, 'w');
  let written = 0;
  try {
    const reader = stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      written += value.byteLength;
      if (written > VIDEO_THUMBNAIL_MAX_INPUT_BYTES) {
        throw new Error(`Video input exceeds thumbnail extraction limit: ${written} bytes`);
      }
      await handle.write(Buffer.from(value));
    }
  } catch (error) {
    await fs.rm(filePath, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    await handle.close();
  }

  if (written === 0) {
    await fs.rm(filePath, { force: true }).catch(() => undefined);
    throw new Error('Video input stream is empty');
  }

  return {
    input: filePath,
    cleanup: () => fs.rm(filePath, { force: true }),
  };
}

function getTemporaryVideoInputPath(ext: string): string {
  return path.join(
    os.tmpdir(),
    `miaojing-video-thumbnail-${crypto.randomUUID()}.${ext || 'mp4'}`,
  );
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getFfmpegPath(): string | null {
  const envPath = process.env.FFMPEG_PATH?.trim();
  const envCandidate = getExistingFfmpegPath(envPath);
  if (envCandidate) return envCandidate;
  try {
    const cwdRequire = createRequire(path.join(process.cwd(), 'package.json'));
    const cwdCandidate = getExistingFfmpegPath(cwdRequire('ffmpeg-static'));
    if (cwdCandidate) return cwdCandidate;
  } catch {
    // Fall through to PATH-based candidates.
  }
  return process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
}

function getExistingFfmpegPath(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const candidate = value.trim();
  return existsSync(candidate) ? candidate : null;
}

export function resolveRuntimeFfmpegPathForTest(): string | null {
  if (process.env.NODE_ENV === 'production') {
    return null;
  }
  return getFfmpegPath();
}

function runFfmpegFrameExtract(ffmpegPath: string, input: string, seekTime: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-ss',
      seekTime,
      '-i',
      input,
      '-map',
      '0:v:0',
      '-frames:v',
      '1',
      '-an',
      '-sn',
      '-dn',
      '-f',
      'image2pipe',
      '-vcodec',
      'png',
      'pipe:1',
    ], { windowsHide: true });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let settled = false;

    const finish = (error?: Error, value?: Buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value || Buffer.alloc(0));
    };

    const timer = setTimeout(() => {
      child.kill();
      finish(new Error(`ffmpeg video thumbnail timed out after ${VIDEO_THUMBNAIL_TIMEOUT_MS}ms`));
    }, VIDEO_THUMBNAIL_TIMEOUT_MS);

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > VIDEO_THUMBNAIL_MAX_OUTPUT_BYTES) {
        child.kill();
        finish(new Error('ffmpeg video thumbnail output exceeded limit'));
        return;
      }
      stdoutChunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });
    child.on('error', (error) => finish(error));
    child.on('close', (code) => {
      if (settled) return;
      const frame = Buffer.concat(stdoutChunks);
      if (code === 0 && frame.length > 0) {
        finish(undefined, frame);
        return;
      }
      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
      finish(new Error(stderr || `ffmpeg exited with code ${code ?? 'unknown'}`));
    });
  });
}

function getVideoExtension(value: string): string {
  const ext = path.extname(value.split('?')[0] || '').replace('.', '').toLowerCase();
  return /^(mp4|webm|mov|m4v|avi)$/i.test(ext) ? ext : 'mp4';
}

function buildVideoThumbnailSvg(label: string): string {
  const safeLabel = escapeXml(label.trim().slice(0, 56) || 'Video');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#111827"/>
      <stop offset="48%" stop-color="#334155"/>
      <stop offset="100%" stop-color="#f59e0b"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="44%" r="45%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1280" height="720" fill="url(#bg)"/>
  <rect width="1280" height="720" fill="url(#glow)"/>
  <circle cx="640" cy="330" r="96" fill="#ffffff" fill-opacity="0.90"/>
  <path d="M612 278 L612 382 L700 330 Z" fill="#111827"/>
  <text x="640" y="516" text-anchor="middle" font-family="Arial, sans-serif" font-size="42" font-weight="700" fill="#ffffff">${safeLabel}</text>
  <text x="640" y="568" text-anchor="middle" font-family="Arial, sans-serif" font-size="24" fill="#ffffff" opacity="0.72">MiaoJing Video</text>
</svg>`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
