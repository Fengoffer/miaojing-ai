import crypto from 'node:crypto';
import path from 'node:path';
import type { NextRequest } from 'next/server';
import { getAuthenticatedUser, verifySessionToken, type AuthenticatedUser } from '@/lib/session-auth';
import { getDbClient } from '@/storage/database/local-db';

export type MediaWatermarkAccessContext = {
  role: string;
  membershipTier: string;
  watermarkDisabled: boolean;
} | null;

const WATERMARKABLE_PREFIXES = [
  'generated/images/',
  'generated/videos/',
  'gallery/images/',
  'gallery/videos/',
  'imported/works/results/',
  'imported/works/thumbnails/',
  'thumbnails/generated/',
  'thumbnails/gallery/',
  'thumbnails/works/',
];

const EXCLUDED_PREFIXES = [
  'watermarked/',
  'site-assets/',
  'avatars/',
  'user-api-manifests/',
  'system-api-manifests/',
  'reverse-prompt/reference-images/',
];

const WATERMARK_IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);
const WATERMARK_VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'webm']);
const PRIVILEGED_ROLES = new Set(['admin', 'enterprise_admin']);

export function normalizeStorageKeyForWatermark(key: string): string {
  return path.posix.normalize(key.replace(/\\/g, '/')).replace(/^\/+/, '');
}

export function isWatermarkableStorageKey(key: string): boolean {
  const normalized = normalizeStorageKeyForWatermark(key);
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized.includes('/../')) return false;
  if (EXCLUDED_PREFIXES.some(prefix => normalized.startsWith(prefix))) return false;
  return WATERMARKABLE_PREFIXES.some(prefix => normalized.startsWith(prefix));
}

export function isWatermarkableContentType(contentType: string): boolean {
  return contentType.startsWith('image/') || contentType.startsWith('video/');
}

export function canAccessOriginalMedia(context: MediaWatermarkAccessContext): boolean {
  if (!context) return false;
  const role = context.role || 'user';
  if (PRIVILEGED_ROLES.has(role)) return true;
  return context.watermarkDisabled === true;
}

export function shouldWatermarkStorageResponse(
  key: string,
  contentType: string,
  context: MediaWatermarkAccessContext,
): boolean {
  void context;
  return isWatermarkableStorageKey(key) && isWatermarkableContentType(contentType);
}

export function shouldWatermarkDownloadResponse(
  key: string,
  contentType: string,
  context: MediaWatermarkAccessContext,
): boolean {
  return isWatermarkableStorageKey(key) && isWatermarkableContentType(contentType) && !canAccessOriginalMedia(context);
}

export function getWatermarkedStorageKey(key: string, contentType: string): string {
  const normalized = normalizeStorageKeyForWatermark(key);
  const digest = crypto.createHash('sha256').update(`${normalized}:${contentType}:miaojing-watermark-v1`).digest('hex');
  const isVideo = contentType.startsWith('video/') || isVideoStorageKey(normalized);
  const ext = isVideo ? getVideoOutputExtension(normalized, contentType) : getImageOutputExtension(normalized, contentType);
  return `watermarked/${isVideo ? 'videos' : 'images'}/${digest}.${ext}`;
}

export function getMediaKindFromContentType(key: string, contentType: string): 'image' | 'video' | null {
  if (contentType.startsWith('image/')) return 'image';
  if (contentType.startsWith('video/')) return 'video';
  const ext = getExtension(key);
  if (WATERMARK_IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (WATERMARK_VIDEO_EXTENSIONS.has(ext)) return 'video';
  return null;
}

export async function resolveMediaWatermarkAccess(request: NextRequest): Promise<MediaWatermarkAccessContext> {
  const tokenUser = await getRequestUser(request);
  if (!tokenUser) return null;

  const client = await getDbClient();
  try {
    const result = await client.query(
      `SELECT role, membership_tier, COALESCE(watermark_disabled, false) AS watermark_disabled
         FROM profiles
        WHERE id = $1
          AND is_active = true
        LIMIT 1`,
      [tokenUser.userId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      role: row.role || tokenUser.role || 'user',
      membershipTier: row.membership_tier || 'free',
      watermarkDisabled: row.watermark_disabled === true,
    };
  } catch (error) {
    if (error && typeof error === 'object' && (error as { code?: string }).code === '42703') {
      return {
        role: tokenUser.role || 'user',
        membershipTier: 'free',
        watermarkDisabled: false,
      };
    }
    throw error;
  } finally {
    client.release();
  }
}

async function getRequestUser(request: NextRequest): Promise<AuthenticatedUser | null> {
  const headerUser = await getAuthenticatedUser(request);
  if (headerUser) return headerUser;

  const queryToken = request.nextUrl.searchParams.get('downloadToken') || '';
  return queryToken ? verifySessionToken(queryToken) : null;
}

function isVideoStorageKey(key: string): boolean {
  return WATERMARK_VIDEO_EXTENSIONS.has(getExtension(key));
}

function getImageOutputExtension(key: string, contentType: string): string {
  if (contentType === 'image/jpeg') return 'jpg';
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/webp') return 'webp';
  const ext = getExtension(key);
  return WATERMARK_IMAGE_EXTENSIONS.has(ext) ? (ext === 'jpeg' ? 'jpg' : ext) : 'png';
}

function getVideoOutputExtension(key: string, contentType: string): string {
  if (contentType === 'video/webm') return 'webm';
  if (contentType === 'video/quicktime') return 'mov';
  const ext = getExtension(key);
  return WATERMARK_VIDEO_EXTENSIONS.has(ext) ? ext : 'mp4';
}

function getExtension(key: string): string {
  return key.split('?')[0].split('#')[0].split('.').pop()?.toLowerCase() || '';
}
