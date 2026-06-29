import { localStorage } from '@/lib/local-storage';
import {
  ensureLocalImageThumbnail,
  ensureLocalVideoThumbnail,
} from '@/lib/media-storage';

type GalleryPublishType = 'image' | 'video' | string;

type GalleryPublishMediaInput = {
  type: GalleryPublishType;
  resultUrl: string;
  thumbnailUrl?: string | null;
  prompt?: string | null;
};

export type GalleryPublishMediaResult = {
  resultUrl: string;
  thumbnailUrl: string | null;
};

export type GalleryPublishMediaDeps = {
  copyPublicUrlToFolder: (
    url: string,
    folder: string,
    options: { storageTarget?: 'default' | 'local' | 'object' },
  ) => Promise<string>;
  uploadFileObjectOnly: (input: { fileContent: Buffer; fileName: string; contentType: string }) => Promise<string>;
  generatePresignedUrl: (input: { key: string; expireTime: number }) => Promise<string>;
  ensureLocalImageThumbnail: (url: string, thumbnailPrefix: string) => Promise<string | null>;
  ensureLocalVideoThumbnail: (url: string, thumbnailPrefix: string, label?: string) => Promise<string | null>;
};

const defaultDeps: GalleryPublishMediaDeps = {
  copyPublicUrlToFolder: (url, folder, options) => localStorage.copyPublicUrlToFolder(url, folder, options),
  uploadFileObjectOnly: input => localStorage.uploadFileObjectOnly(input),
  generatePresignedUrl: input => localStorage.generatePresignedUrl(input),
  ensureLocalImageThumbnail,
  ensureLocalVideoThumbnail,
};

function isStableLocalStorageUrl(url: string): boolean {
  return url.startsWith('/api/local-storage/');
}

function normalizeReferenceUrl(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function getExtensionFromContentType(contentType: string): string {
  if (contentType === 'image/jpeg') return 'jpg';
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/webp') return 'webp';
  if (contentType === 'image/gif') return 'gif';
  return 'bin';
}

function parseDataUrlImage(url: string): { buffer: Buffer; contentType: string; extension: string } | null {
  const match = url.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return null;
  const contentType = match[1].toLowerCase();
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length === 0) return null;
  return {
    buffer,
    contentType,
    extension: getExtensionFromContentType(contentType),
  };
}

async function resolveGalleryReferenceImage(
  url: string,
  index: number,
  deps: GalleryPublishMediaDeps,
): Promise<string | null> {
  const normalized = normalizeReferenceUrl(url);
  if (!normalized || normalized.startsWith('[')) return null;
  if (isStableLocalStorageUrl(normalized)) return normalized;

  const dataImage = parseDataUrlImage(normalized);
  if (dataImage) {
    const key = await deps.uploadFileObjectOnly({
      fileContent: dataImage.buffer,
      fileName: `gallery/references/${Date.now()}-${index + 1}-${Math.random().toString(36).slice(2, 8)}.${dataImage.extension}`,
      contentType: dataImage.contentType,
    });
    return deps.generatePresignedUrl({ key, expireTime: 2592000 });
  }

  if (/^https?:\/\//i.test(normalized)) {
    return deps.copyPublicUrlToFolder(normalized, 'gallery/references', { storageTarget: 'object' });
  }

  return null;
}

export async function resolveGalleryReferenceImages(
  urls: unknown[],
  deps: GalleryPublishMediaDeps = defaultDeps,
): Promise<string[]> {
  const resolved: string[] = [];
  const seen = new Set<string>();
  for (const [index, value] of urls.entries()) {
    const url = normalizeReferenceUrl(value);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const galleryUrl = await resolveGalleryReferenceImage(url, index, deps);
    if (galleryUrl && !resolved.includes(galleryUrl)) resolved.push(galleryUrl);
  }
  return resolved;
}

export async function resolveGalleryPublishMedia(
  input: GalleryPublishMediaInput,
  deps: GalleryPublishMediaDeps = defaultDeps,
): Promise<GalleryPublishMediaResult> {
  let galleryResultUrl = input.resultUrl;
  let galleryThumbnailUrl = input.thumbnailUrl || null;

  if (input.type === 'video') {
    if (!isStableLocalStorageUrl(input.resultUrl)) {
      galleryResultUrl = await deps.copyPublicUrlToFolder(input.resultUrl, 'gallery/videos', { storageTarget: 'object' });
    }
    const generatedVideoThumbnailUrl = await deps.ensureLocalVideoThumbnail(
      galleryResultUrl,
      'thumbnails/gallery/videos',
      String(input.prompt || 'Video'),
    );
    let copiedVideoThumbnailUrl: string | null = null;
    if (!generatedVideoThumbnailUrl && input.thumbnailUrl) {
      copiedVideoThumbnailUrl = await deps.copyPublicUrlToFolder(input.thumbnailUrl, 'gallery/thumbnails', { storageTarget: 'local' });
    }
    return {
      resultUrl: galleryResultUrl,
      thumbnailUrl: generatedVideoThumbnailUrl || copiedVideoThumbnailUrl || galleryThumbnailUrl,
    };
  }

  if (!isStableLocalStorageUrl(input.resultUrl)) {
    galleryResultUrl = await deps.copyPublicUrlToFolder(input.resultUrl, 'gallery/images', { storageTarget: 'object' });
    galleryThumbnailUrl = await deps.ensureLocalImageThumbnail(galleryResultUrl, 'thumbnails/gallery')
      || galleryThumbnailUrl;
  }

  return {
    resultUrl: galleryResultUrl,
    thumbnailUrl: galleryThumbnailUrl,
  };
}
