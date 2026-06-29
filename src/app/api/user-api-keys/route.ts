import { NextRequest, NextResponse } from 'next/server';
import { getDbClient } from '@/storage/database/local-db';
import { decryptSecret, encryptSecret, previewSecret } from '@/lib/server-crypto';
import { getAuthenticatedUserId } from '@/lib/session-auth';
import { readManifestCapabilities } from '@/lib/user-api-manifest';

function normalizeType(value: unknown): 'image' | 'video' | 'text' {
  return value === 'video' || value === 'text' ? value : 'image';
}

function mapKey(row: Record<string, unknown>) {
  const apiKey = decryptSecret(row.api_key_encrypted as string);
  return {
    id: row.id,
    provider: row.provider || '',
    supplierName: row.supplier_name || row.provider || '',
    apiUrl: row.api_url || '',
    modelName: row.model_name || '',
    note: row.note || '',
    manifestPath: row.manifest_path || '',
    capabilities: readManifestCapabilities(row.manifest_path as string | null | undefined),
    apiKey: '',
    apiKeyPreview: row.api_key_preview || previewSecret(apiKey),
    type: normalizeType(row.type),
    isActive: row.is_active !== false,
    createdAt: row.created_at,
  };
}

export async function GET(request: NextRequest) {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) return NextResponse.json({ error: '请先登录' }, { status: 401 });

  const client = await getDbClient();
  try {
    await client.query(`
      ALTER TABLE user_api_keys ADD COLUMN IF NOT EXISTS supplier_name VARCHAR(128);
      ALTER TABLE user_api_keys ADD COLUMN IF NOT EXISTS type VARCHAR(16) NOT NULL DEFAULT 'image';
      ALTER TABLE user_api_keys ADD COLUMN IF NOT EXISTS note TEXT;
      ALTER TABLE user_api_keys ADD COLUMN IF NOT EXISTS manifest_path TEXT;
    `);
    const result = await client.query(
      `SELECT id, provider, supplier_name, api_url, model_name, note, manifest_path, api_key_encrypted, api_key_preview, type, is_active, created_at
       FROM user_api_keys
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId],
    );
    return NextResponse.json({ keys: result.rows.map(mapKey) });
  } finally {
    client.release();
  }
}

export async function POST(request: NextRequest) {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  const body = await request.json();
  const keys = Array.isArray(body.keys) ? body.keys : [body];

  const client = await getDbClient();
  try {
    await client.query('BEGIN');
    await client.query(`
      ALTER TABLE user_api_keys ADD COLUMN IF NOT EXISTS supplier_name VARCHAR(128);
      ALTER TABLE user_api_keys ADD COLUMN IF NOT EXISTS type VARCHAR(16) NOT NULL DEFAULT 'image';
      ALTER TABLE user_api_keys ADD COLUMN IF NOT EXISTS note TEXT;
      ALTER TABLE user_api_keys ADD COLUMN IF NOT EXISTS manifest_path TEXT;
    `);
    const saved = [];
    for (const item of keys) {
      const apiKey = String(item.apiKey || '').trim();
      const id = typeof item.id === 'string' && /^[0-9a-fA-F-]{36}$/.test(item.id) ? item.id : undefined;
      if (!apiKey && !id) continue;
      const values = [
        userId,
        String(item.provider || '').trim(),
        String(item.supplierName || item.provider || '').trim(),
        String(item.apiUrl || '').trim(),
        String(item.modelName || '').trim(),
        String(item.note || '').trim(),
        apiKey ? encryptSecret(apiKey) : null,
        apiKey ? previewSecret(apiKey) : null,
        normalizeType(item.type),
        item.isActive !== false,
      ];
      const result = await client.query(
        id
          ? `UPDATE user_api_keys
             SET provider = $2,
                 supplier_name = $3,
                 api_url = $4,
                 model_name = $5,
                 note = $6,
                 manifest_path = manifest_path,
                 api_key_encrypted = COALESCE($7, api_key_encrypted),
                 api_key_preview = COALESCE($8, api_key_preview),
                 type = $9,
                 is_active = $10,
                 updated_at = NOW()
             WHERE id = $11 AND user_id = $1
             RETURNING *`
          : `INSERT INTO user_api_keys (user_id, provider, supplier_name, api_url, model_name, note, manifest_path, api_key_encrypted, api_key_preview, type, is_active, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, '', COALESCE($7, ''), COALESCE($8, ''), $9, $10, NOW(), NOW())
             RETURNING *`,
        id ? [...values, id] : values,
      );
      saved.push(mapKey(result.rows[0]));
    }
    await client.query('COMMIT');
    return NextResponse.json({ keys: saved });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function PUT(request: NextRequest) {
  return POST(request);
}

export async function DELETE(request: NextRequest) {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  const id = request.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: '缺少 ID' }, { status: 400 });
  const client = await getDbClient();
  try {
    await client.query('DELETE FROM user_api_keys WHERE id = $1 AND user_id = $2', [id, userId]);
    return NextResponse.json({ success: true });
  } finally {
    client.release();
  }
}
