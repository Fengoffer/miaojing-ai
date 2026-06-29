import path from 'path';
import { localStorage } from '@/lib/local-storage';
import { createLocalImageThumbnail, parseImageDataUrl, readImageBufferFromUrl } from '@/lib/media-storage';

export type PersistedReferenceImage = {
  url: string;
  thumbnailUrl: string | null;
};

function normalizeReferenceUrl(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isPersistableReferenceUrl(url: string): boolean {
  return Boolean(url) && !url.startsWith('[');
}

function contentExtension(mimeType: string, fallbackUrl = ''): string {
  const normalized = mimeType.split(';')[0]?.toLowerCase();
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return 'jpg';
  if (normalized === 'image/png') return 'png';
  if (normalized === 'image/webp') return 'webp';
  if (normalized === 'image/gif') return 'gif';
  const ext = path.extname(fallbackUrl.split('?')[0] || '').replace('.', '').toLowerCase();
  return /^(jpe?g|png|webp|gif)$/i.test(ext) ? (ext === 'jpeg' ? 'jpg' : ext) : 'jpg';
}

async function persistReferenceUrl(url: string, index: number): Promise<PersistedReferenceImage | null> {
  const normalized = normalizeReferenceUrl(url);
  if (!isPersistableReferenceUrl(normalized)) return null;

  const existingKey = localStorage.getKeyFromPublicUrl(normalized);
  if (existingKey) {
    const thumbnailUrl = await createLocalImageThumbnail({
      buffer: await localStorage.readFileAsync(existingKey),
      sourceKey: existingKey,
      thumbnailPrefix: 'thumbnails/works/references',
    }).catch(() => null);
    return { url: normalized, thumbnailUrl };
  }

  const dataImage = parseImageDataUrl(normalized);
  if (dataImage) {
    const suffix = `${Date.now()}-${index + 1}-${Math.random().toString(36).slice(2, 8)}`;
    const key = await localStorage.uploadFileObjectOnly({
      fileContent: dataImage.buffer,
      fileName: `works/references/${suffix}.${dataImage.ext || contentExtension(dataImage.mimeType)}`,
      contentType: dataImage.mimeType,
    });
    const url = await localStorage.generatePresignedUrl({ key, expireTime: 2592000 });
    const thumbnailUrl = await createLocalImageThumbnail({
      buffer: dataImage.buffer,
      sourceKey: key,
      thumbnailPrefix: 'thumbnails/works/references',
    }).catch(() => null);
    return { url, thumbnailUrl };
  }

  if (/^https?:\/\//i.test(normalized)) {
    const source = await readImageBufferFromUrl(normalized);
    if (!source) return { url: normalized, thumbnailUrl: null };
    const suffix = `${Date.now()}-${index + 1}-${Math.random().toString(36).slice(2, 8)}`;
    const key = await localStorage.uploadFileObjectOnly({
      fileContent: source.buffer,
      fileName: `works/references/${suffix}.${source.ext || contentExtension(source.mimeType, normalized)}`,
      contentType: source.mimeType,
    });
    const url = await localStorage.generatePresignedUrl({ key, expireTime: 2592000 });
    const thumbnailUrl = await createLocalImageThumbnail({
      buffer: source.buffer,
      sourceKey: key,
      thumbnailPrefix: 'thumbnails/works/references',
    }).catch(() => null);
    return { url, thumbnailUrl };
  }

  return null;
}

export async function persistReferenceImages(urls: unknown[]): Promise<PersistedReferenceImage[]> {
  const persisted: PersistedReferenceImage[] = [];
  const seen = new Set<string>();
  for (const [index, value] of urls.entries()) {
    const url = normalizeReferenceUrl(value);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    try {
      const reference = await persistReferenceUrl(url, index);
      if (reference && !persisted.some(item => item.url === reference.url)) {
        persisted.push(reference);
      }
    } catch (error) {
      console.warn('[reference-image-storage] persist reference image failed:', error instanceof Error ? error.message : error);
    }
  }
  return persisted;
}

export function getReferenceImageInputs(record: {
  referenceImage?: unknown;
  referenceImages?: unknown;
  params?: Record<string, unknown>;
}): string[] {
  const params = record.params || {};
  const values = [
    record.referenceImage,
    ...(Array.isArray(record.referenceImages) ? record.referenceImages : []),
    params.referenceImage,
    ...(Array.isArray(params.referenceImages) ? params.referenceImages : []),
    params.image,
    ...(Array.isArray(params.images) ? params.images : []),
    ...(Array.isArray(params.extraImages) ? params.extraImages : []),
    params.sourceImage,
    params.source_image,
    params.inputImage,
    params.input_image,
  ];
  return values
    .map(normalizeReferenceUrl)
    .filter(url => isPersistableReferenceUrl(url));
}

export function getReferenceThumbnailInputs(params: Record<string, unknown>): string[] {
  return Array.isArray(params.referenceImageThumbnails)
    ? params.referenceImageThumbnails.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

export default {
  getReferenceImageInputs,
  getReferenceThumbnailInputs,
  persistReferenceImages,
};
