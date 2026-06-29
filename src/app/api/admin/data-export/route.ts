import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getDbClient } from '@/storage/database/local-db';
import { localStorage } from '@/lib/local-storage';
import crypto from 'crypto';

type ExportMediaEntry = {
  contentType: string;
  encoding: 'base64';
  data: string;
  size: number;
  sha256: string;
};

const MAX_EXPORT_MEDIA_BYTES = 800 * 1024 * 1024;
const MAX_EXPORT_SINGLE_MEDIA_BYTES = 100 * 1024 * 1024;

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const client = await getDbClient();
    try {
      const data: Record<string, unknown[]> = {};

      const tables = [
        'profiles',
        'works',
        'credit_transactions',
        'invitation_referrals',
        'redeem_codes',
        'orders',
        'user_api_keys',
        'system_api_configs',
        'api_providers',
        'model_recommendations',
        'payment_methods',
        'image_style_presets',
        'work_likes',
        'announcements',
        'generation_jobs',
        'platform_logs',
      ];

      for (const table of tables) {
        try {
          const result = await client.query(`SELECT * FROM ${table} ORDER BY created_at ASC`);
          data[table] = result.rows || [];
        } catch {
          data[table] = [];
        }
      }

      try {
        const result = await client.query('SELECT * FROM site_config');
        data.site_config = result.rows || [];
      } catch { data.site_config = []; }

      try {
        const result = await client.query('SELECT * FROM site_stats');
        data.site_stats = result.rows || [];
      } catch { data.site_stats = []; }

      try {
        const result = await client.query('SELECT id, email, created_at, raw_user_meta_data, password_hash FROM auth.users');
        data.auth_users = result.rows || [];
      } catch { data.auth_users = []; }

      const mediaExport = await collectExportMedia(data);

      const exportData = {
        _meta: {
          version: '1.1',
          platform: 'miaojing',
          exported_at: new Date().toISOString(),
          tables: Object.keys(data),
          counts: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length])),
          media_files: Object.keys(mediaExport.media).length,
          media_bytes: mediaExport.bytes,
          media_missing: mediaExport.missing,
          media_skipped: mediaExport.skipped,
        },
        data,
        _media: mediaExport.media,
      };

      return NextResponse.json(exportData);
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[data-export] Error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : '导出失败' }, { status: 500 });
  }
}

async function collectExportMedia(data: Record<string, unknown[]>): Promise<{
  media: Record<string, ExportMediaEntry>;
  bytes: number;
  missing: string[];
  skipped: string[];
}> {
  const urls = new Set<string>();
  for (const row of data.works || []) {
    collectExportableMediaUrls(row, urls);
  }
  for (const row of data.site_config || []) {
    collectExportableMediaUrls(row, urls);
  }
  for (const row of data.generation_jobs || []) {
    collectExportableMediaUrls(row, urls);
  }

  const media: Record<string, ExportMediaEntry> = {};
  const missing: string[] = [];
  const skipped: string[] = [];
  let bytes = 0;

  for (const url of urls) {
    const payload = await readExportMedia(url);
    if (!payload) {
      missing.push(url);
      continue;
    }
    const { buffer, contentType } = payload;
    if (buffer.byteLength > MAX_EXPORT_SINGLE_MEDIA_BYTES) {
      skipped.push(url);
      continue;
    }
    if (bytes + buffer.byteLength > MAX_EXPORT_MEDIA_BYTES) {
      skipped.push(url);
      continue;
    }
    bytes += buffer.byteLength;
    media[url] = {
      contentType,
      encoding: 'base64',
      data: buffer.toString('base64'),
      size: buffer.byteLength,
      sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    };
  }

  return { media, bytes, missing, skipped };
}

async function readExportMedia(url: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  const key = localStorage.getKeyFromPublicUrl(url);
  if (key && await localStorage.fileExistsAsync(key)) {
    return { buffer: await localStorage.readFileAsync(key), contentType: getContentTypeFromKey(key) };
  }

  if (!/^https?:\/\//i.test(url)) return null;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) return null;

    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_EXPORT_SINGLE_MEDIA_BYTES) return null;

    const contentType = response.headers.get('content-type') || getContentTypeFromUrl(url);
    if (!isSupportedMediaType(contentType)) return null;

    const buffer = Buffer.from(await response.arrayBuffer());
    return { buffer, contentType };
  } catch {
    return null;
  }
}

function collectExportableMediaUrls(value: unknown, output: Set<string>): void {
  if (typeof value === 'string') {
    if (localStorage.getKeyFromPublicUrl(value) || /^https?:\/\//i.test(value)) output.add(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(item => collectExportableMediaUrls(item, output));
    return;
  }
  if (value && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach(item => collectExportableMediaUrls(item, output));
  }
}

function isSupportedMediaType(contentType: string): boolean {
  return /^(image|video)\//i.test(contentType.split(';')[0] || '');
}

function getContentTypeFromUrl(url: string): string {
  const path = url.split('?')[0] || '';
  return getContentTypeFromKey(path);
}

function getContentTypeFromKey(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'mp4') return 'video/mp4';
  if (ext === 'webm') return 'video/webm';
  return 'application/octet-stream';
}
