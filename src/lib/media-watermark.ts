import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import sharp from 'sharp';
import { localStorage } from '@/lib/local-storage';
import {
  getMediaKindFromContentType,
  getWatermarkedStorageKey,
} from '@/lib/media-watermark-policy';

const WATERMARK_LOGO_PATH = path.join(process.cwd(), 'public', 'watermark', 'miaojing-watermark-logo.png');
const WATERMARK_TEXT = 'MIAOJING AI';
const WATERMARK_OPACITY = 0.5;
const inflightWatermarkJobs = new Map<string, Promise<{
  key: string;
  buffer: Buffer;
  contentType: string;
}>>();

export async function serveWatermarkedStorageFile(key: string, contentType: string): Promise<{
  key: string;
  buffer: Buffer;
  contentType: string;
}> {
  return createWatermarkedFile(key, contentType);
}

export async function serveWatermarkedDownloadFile(key: string, contentType: string): Promise<{
  key: string;
  buffer: Buffer;
  contentType: string;
}> {
  return createWatermarkedFile(key, contentType);
}

export async function applyImageWatermark(input: Buffer, options: { key: string; contentType: string }): Promise<Buffer> {
  const metadata = await sharp(input).metadata();
  const width = metadata.width || 1024;
  const height = metadata.height || 1024;
  const overlay = await createImageWatermarkOverlay(width, height);
  const composite = sharp(input, { animated: false }).composite([{ input: overlay, gravity: 'southeast' }]);

  if (options.contentType === 'image/jpeg') {
    return composite.jpeg({ quality: 92, mozjpeg: true }).toBuffer();
  }
  if (options.contentType === 'image/webp') {
    return composite.webp({ quality: 92 }).toBuffer();
  }
  return composite.png().toBuffer();
}

async function createWatermarkedFile(key: string, contentType: string): Promise<{
  key: string;
  buffer: Buffer;
  contentType: string;
}> {
  const outputKey = getWatermarkedStorageKey(key, contentType);
  if (await localStorage.fileExistsAsync(outputKey)) {
    return {
      key: outputKey,
      buffer: await localStorage.readFileAsync(outputKey),
      contentType,
    };
  }
  const inflight = inflightWatermarkJobs.get(outputKey);
  if (inflight) return inflight;

  const job = createWatermarkedFileUncached(key, contentType, outputKey);
  inflightWatermarkJobs.set(outputKey, job);
  try {
    return await job;
  } finally {
    inflightWatermarkJobs.delete(outputKey);
  }
}

async function createWatermarkedFileUncached(key: string, contentType: string, outputKey: string): Promise<{
  key: string;
  buffer: Buffer;
  contentType: string;
}> {
  const kind = getMediaKindFromContentType(key, contentType);
  if (kind === 'image') {
    const input = await localStorage.readFileAsync(key);
    const output = await applyImageWatermark(input, { key, contentType });
    const outputContentType = getOutputContentType(outputKey, contentType);
    await localStorage.uploadFileLocalOnly({
      fileContent: output,
      fileName: outputKey,
      contentType: outputContentType,
    });
    return { key: outputKey, buffer: output, contentType: outputContentType };
  }

  if (kind === 'video') {
    const output = await applyVideoWatermark(key, outputKey, contentType);
    return { key: outputKey, buffer: output, contentType: getOutputContentType(outputKey, contentType) };
  }

  throw new Error('Unsupported watermark media type');
}

async function createImageWatermarkOverlay(width: number, height: number): Promise<Buffer> {
  const scale = Math.max(0.65, Math.min(1.45, Math.min(width, height) / 900));
  const logoSize = Math.max(30, Math.round(Math.min(width, height) * 0.06));
  const fontSize = Math.max(16, Math.round(logoSize * 0.48));
  const gap = Math.max(8, Math.round(logoSize * 0.22));
  const horizontalPadding = Math.max(14, Math.round(16 * scale));
  const verticalPadding = Math.max(10, Math.round(10 * scale));
  const estimatedTextWidth = Math.round(WATERMARK_TEXT.length * fontSize * 0.64);
  const overlayWidth = logoSize + gap + estimatedTextWidth + horizontalPadding * 2;
  const overlayHeight = Math.max(logoSize, fontSize * 1.35) + verticalPadding * 2;
  const textY = Math.round((overlayHeight + fontSize * 0.72) / 2);
  const logoTop = Math.round((overlayHeight - logoSize) / 2);
  const logoLeft = horizontalPadding;
  const textX = logoLeft + logoSize + gap;
  const resizedLogo = await sharp(WATERMARK_LOGO_PATH)
    .resize(logoSize, logoSize, { fit: 'inside' })
    .png()
    .toBuffer();
  const textSvg = Buffer.from(`
    <svg width="${overlayWidth}" height="${overlayHeight}" xmlns="http://www.w3.org/2000/svg">
      <style>
        text {
          font-family: Inter, Arial, Helvetica, sans-serif;
          font-size: ${fontSize}px;
          font-weight: 700;
          letter-spacing: 0;
        }
      </style>
      <text x="${textX}" y="${textY}" fill="#fff">${WATERMARK_TEXT}</text>
      <text x="${textX + 1}" y="${textY + 1}" fill="#000" opacity="0.26">${WATERMARK_TEXT}</text>
    </svg>
  `);

  const overlay = await sharp({
    create: {
      width: overlayWidth,
      height: overlayHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      { input: resizedLogo, left: logoLeft, top: logoTop },
      { input: textSvg, left: 0, top: 0 },
    ])
    .ensureAlpha()
    .modulate({ brightness: 1 })
    .png()
    .toBuffer();
  return applyPngOpacity(overlay, overlayWidth, overlayHeight, WATERMARK_OPACITY);
}

async function applyPngOpacity(buffer: Buffer, width: number, height: number, opacity: number): Promise<Buffer> {
  const rgba = await sharp(buffer).ensureAlpha().raw().toBuffer();
  for (let index = 3; index < rgba.length; index += 4) {
    rgba[index] = Math.round(rgba[index] * opacity);
  }
  return sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

async function applyVideoWatermark(inputKey: string, outputKey: string, contentType: string): Promise<Buffer> {
  const ffmpegPath = getFfmpegPath();
  if (!ffmpegPath) throw new Error('ffmpeg-static is not available for video watermarking');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'miaojing-watermark-'));
  const inputPath = path.join(tempDir, `input.${getVideoExtension(inputKey, contentType)}`);
  const overlayPath = path.join(tempDir, 'watermark.png');
  const outputPath = path.join(tempDir, `output.${getVideoExtension(outputKey, contentType)}`);

  try {
    await fs.promises.writeFile(inputPath, await localStorage.readFileAsync(inputKey));
    await fs.promises.writeFile(overlayPath, await createVideoWatermarkOverlay());
    await runFfmpeg(ffmpegPath, [
      '-y',
      '-i',
      inputPath,
      '-i',
      overlayPath,
      '-filter_complex',
      'overlay=W-w-36:H-h-36',
      '-c:v',
      contentType === 'video/webm' ? 'libvpx-vp9' : 'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '23',
      '-c:a',
      'copy',
      '-movflags',
      '+faststart',
      outputPath,
    ]);
    const output = await fs.promises.readFile(outputPath);
    await localStorage.uploadFileLocalOnly({
      fileContent: output,
      fileName: outputKey,
      contentType,
    });
    return output;
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function createVideoWatermarkOverlay(): Promise<Buffer> {
  const logoSize = 54;
  const fontSize = 26;
  const gap = 12;
  const paddingX = 18;
  const paddingY = 12;
  const width = 244;
  const height = 78;
  const logo = await sharp(WATERMARK_LOGO_PATH).resize(logoSize, logoSize, { fit: 'inside' }).png().toBuffer();
  const textSvg = Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <style>
        text {
          font-family: Inter, Arial, Helvetica, sans-serif;
          font-size: ${fontSize}px;
          font-weight: 700;
          letter-spacing: 0;
        }
      </style>
      <text x="${paddingX + logoSize + gap}" y="48" fill="#fff">${WATERMARK_TEXT}</text>
      <text x="${paddingX + logoSize + gap + 1}" y="49" fill="#000" opacity="0.28">${WATERMARK_TEXT}</text>
    </svg>
  `);

  const overlay = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      { input: logo, left: paddingX, top: paddingY },
      { input: textSvg, left: 0, top: 0 },
    ])
    .png()
    .toBuffer();
  return applyPngOpacity(overlay, width, height, WATERMARK_OPACITY);
}

function runFfmpeg(ffmpegPath: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    const stderr: Buffer[] = [];
    child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)));
    child.once('error', reject);
    child.once('close', code => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(Buffer.concat(stderr).toString('utf8').trim() || `ffmpeg exited with code ${code}`));
    });
  });
}

function getFfmpegPath(): string | null {
  try {
    const requireFromCwd = createRequire(path.join(process.cwd(), 'package.json'));
    const ffmpegPath = requireFromCwd('ffmpeg-static');
    return typeof ffmpegPath === 'string' && fs.existsSync(ffmpegPath) ? ffmpegPath : null;
  } catch {
    return null;
  }
}

function getVideoExtension(key: string, contentType: string): string {
  if (contentType === 'video/webm') return 'webm';
  if (contentType === 'video/quicktime') return 'mov';
  const ext = key.split('?')[0].split('#')[0].split('.').pop()?.toLowerCase();
  return ext === 'webm' || ext === 'mov' || ext === 'mp4' ? ext : 'mp4';
}

function getOutputContentType(key: string, fallback: string): string {
  const ext = key.split('?')[0].split('#')[0].split('.').pop()?.toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'mp4') return 'video/mp4';
  if (ext === 'webm') return 'video/webm';
  if (ext === 'mov') return 'video/quicktime';
  return fallback;
}
