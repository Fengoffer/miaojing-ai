export const MAX_PUBLIC_GALLERY_AVATAR_URL_LENGTH = 2048;

export interface PublicGalleryWork {
  id: unknown;
  type: unknown;
  title: unknown;
  prompt: unknown;
  negativePrompt: unknown;
  url: unknown;
  thumbnailUrl: unknown;
  width: unknown;
  height: unknown;
  duration: unknown;
  likes: unknown;
  creditsCost: unknown;
  params: Record<string, unknown>;
  referenceImage?: string;
  referenceImages: string[];
  referenceImageThumbnails: string[];
  publisherId: unknown;
  publisherNickname: string;
  publisherAvatarUrl: string | null;
  publishedAt: unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function getPublicGalleryAvatarUrl(value: unknown): string | null {
  const avatarUrl = normalizeString(value);
  if (!avatarUrl) return null;
  if (avatarUrl.startsWith('data:')) return null;
  if (avatarUrl.length > MAX_PUBLIC_GALLERY_AVATAR_URL_LENGTH) return null;
  return avatarUrl;
}

export function getGalleryReferenceImages(params: Record<string, unknown>) {
  const referenceImages = Array.isArray(params.referenceImages)
    ? params.referenceImages
      .map(normalizeString)
      .filter((item): item is string => item.length > 0)
    : [];
  const referenceImage = normalizeString(params.referenceImage) || referenceImages[0];
  return { referenceImage, referenceImages };
}

export function getGalleryReferenceImageThumbnails(params: Record<string, unknown>) {
  return Array.isArray(params.referenceImageThumbnails)
    ? params.referenceImageThumbnails
      .map(normalizeString)
      .filter((item): item is string => item.length > 0 && !item.startsWith('data:') && !item.startsWith('['))
    : [];
}

export function toPublicGalleryWork(row: Record<string, unknown>): PublicGalleryWork {
  const workParams = asRecord(row.params);
  const references = getGalleryReferenceImages(workParams);
  const referenceImageThumbnails = getGalleryReferenceImageThumbnails(workParams);
  const emailPrefix = normalizeString(row.email).split('@')[0];

  return {
    id: row.id,
    type: row.type,
    title: row.title,
    prompt: row.prompt,
    negativePrompt: row.negative_prompt,
    url: row.result_url,
    thumbnailUrl: row.thumbnail_url,
    width: row.width,
    height: row.height,
    duration: row.duration,
    likes: row.likes_count || 0,
    creditsCost: row.credits_cost || 0,
    params: workParams,
    referenceImage: references.referenceImage,
    referenceImages: references.referenceImages,
    referenceImageThumbnails,
    publisherId: row.user_id,
    publisherNickname: normalizeString(row.display_nickname) || normalizeString(row.nickname) || emailPrefix || '匿名用户',
    publisherAvatarUrl: getPublicGalleryAvatarUrl(row.avatar_url),
    publishedAt: row.created_at,
  };
}
