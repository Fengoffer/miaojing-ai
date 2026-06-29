import crypto from 'crypto';
import { localStorage } from '@/lib/local-storage';

export const ADMIN_EMAIL_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

const IMAGE_EXTENSIONS_BY_TYPE: Record<string, string> = {
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const ALLOWED_IMAGE_TYPES = new Set(Object.keys(IMAGE_EXTENSIONS_BY_TYPE));

export type AdminEmailImageFileLike = {
  name?: string;
  type?: string;
  size?: number;
};

export function getAdminEmailImageValidationError(file: AdminEmailImageFileLike | null | undefined): string | null {
  if (!file) return '请选择要上传的图片';
  const size = Number(file.size || 0);
  const contentType = String(file.type || '').toLowerCase();
  if (!Number.isFinite(size) || size <= 0) return '图片文件为空';
  if (size > ADMIN_EMAIL_IMAGE_MAX_BYTES) return '图片大小不能超过 8MB';
  if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
    return '仅支持 PNG、JPG、WebP 或 GIF 图片';
  }
  return null;
}

export function buildAdminEmailImageStorageKey(input: {
  id?: string;
  contentType: string;
  now?: Date;
}): string {
  const now = input.now || new Date();
  const year = String(now.getUTCFullYear()).padStart(4, '0');
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const ext = IMAGE_EXTENSIONS_BY_TYPE[input.contentType.toLowerCase()] || 'png';
  const id = (input.id || crypto.randomUUID()).replace(/[^0-9a-zA-Z-]/g, '');
  return `email/admin/${year}/${month}/${id}.${ext}`;
}

export function getAdminEmailImagePublicUrl(key: string, publicBaseUrl = ''): string {
  const path = `/api/local-storage/${key.replace(/^\/+/, '')}`;
  const baseUrl = publicBaseUrl.trim().replace(/\/+$/, '');
  if (!baseUrl) return path;
  return `${baseUrl}${path}`;
}

export function resolveAdminEmailImagePublicBaseUrl(input: {
  requestBaseUrl?: string;
  envBaseUrl?: string;
  settingsBaseUrl?: string;
}): string {
  const requestBaseUrl = String(input.requestBaseUrl || '').trim().replace(/\/+$/, '');
  const envBaseUrl = String(input.envBaseUrl || '').trim().replace(/\/+$/, '');
  const settingsBaseUrl = String(input.settingsBaseUrl || '').trim().replace(/\/+$/, '');
  if (requestBaseUrl && !/https?:\/\/(?:127\.0\.0\.1|localhost|0\.0\.0\.0)(?::|\/|$)/i.test(requestBaseUrl)) {
    return requestBaseUrl;
  }
  return envBaseUrl || settingsBaseUrl || requestBaseUrl;
}

export async function saveAdminEmailImageUpload(file: File, options: { publicBaseUrl?: string } = {}): Promise<{
  key: string;
  url: string;
  contentType: string;
  size: number;
}> {
  const validationError = getAdminEmailImageValidationError(file);
  if (validationError) throw new Error(validationError);

  const contentType = file.type.toLowerCase();
  const key = buildAdminEmailImageStorageKey({ contentType });
  const savedKey = await localStorage.uploadFile({
    fileContent: Buffer.from(await file.arrayBuffer()),
    fileName: key,
    contentType,
  });

  return {
    key: savedKey,
    url: getAdminEmailImagePublicUrl(savedKey, options.publicBaseUrl),
    contentType,
    size: file.size,
  };
}
