import crypto from 'crypto';
import { isProductionRuntime } from '@/lib/runtime-env';

const PREFIX = 'mjenc:v1:';

function getSecret(): Buffer {
  if (isProductionRuntime()) {
    const productionSecret = process.env.DATA_ENCRYPTION_KEY || process.env.JWT_SECRET;
    if (!productionSecret) {
      throw new Error('DATA_ENCRYPTION_KEY or JWT_SECRET is required in production');
    }
    return crypto.createHash('sha256').update(productionSecret).digest();
  }
  const raw = process.env.DATA_ENCRYPTION_KEY || process.env.JWT_SECRET || process.env.ADMIN_DEFAULT_PASSWORD || 'miaojing-local-secret';
  return crypto.createHash('sha256').update(raw).digest();
}

export function encryptSecret(value: string): string {
  if (!value) return '';
  if (value.startsWith(PREFIX)) return value;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getSecret(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${Buffer.concat([iv, tag, encrypted]).toString('base64')}`;
}

export function decryptSecret(value: string | null | undefined): string {
  if (!value) return '';
  if (!value.startsWith(PREFIX)) return value;
  try {
    const raw = Buffer.from(value.slice(PREFIX.length), 'base64');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const encrypted = raw.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', getSecret(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

export function previewSecret(value: string): string {
  if (!value) return '****';
  return value.length > 4 ? `***${value.slice(-4)}` : '****';
}
