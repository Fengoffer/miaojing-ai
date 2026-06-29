import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getDbClient } from '@/storage/database/local-db';

function mapProvider(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    name: String(row.name || ''),
    defaultApiUrl: String(row.default_api_url || ''),
    defaultModel: String(row.default_model || ''),
    type: String(row.type || 'image'),
    website: (row.website as string | null) || null,
    isActive: row.is_active !== false,
    sortOrder: Number(row.sort_order || 0),
  };
}

async function readBody(request: NextRequest) {
  return request.json().catch(() => ({}));
}

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const client = await getDbClient();
  try {
    const result = await client.query(
      `SELECT id, name, default_api_url, default_model, type, website, is_active, sort_order
       FROM api_providers
       ORDER BY sort_order ASC, name ASC`
    );
    return NextResponse.json({ providers: result.rows.map(mapProvider) });
  } finally {
    client.release();
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const body = await readBody(request);
  if (!body.name?.trim()) {
    return NextResponse.json({ error: '请填写供应商名称' }, { status: 400 });
  }

  const client = await getDbClient();
  try {
    const result = await client.query(
      `INSERT INTO api_providers (name, default_api_url, default_model, type, website, is_active, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, name, default_api_url, default_model, type, website, is_active, sort_order`,
      [
        body.name.trim(),
        body.defaultApiUrl?.trim() || '',
        body.defaultModel?.trim() || '',
        body.type || 'image',
        body.website?.trim() || null,
        body.isActive !== false,
        Number(body.sortOrder || 0),
      ]
    );
    return NextResponse.json({ provider: mapProvider(result.rows[0]) });
  } finally {
    client.release();
  }
}

export async function PUT(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const body = await readBody(request);
  if (!body.id || !body.name?.trim()) {
    return NextResponse.json({ error: '缺少供应商 ID 或名称' }, { status: 400 });
  }

  const client = await getDbClient();
  try {
    const result = await client.query(
      `UPDATE api_providers
       SET name = $2, default_api_url = $3, default_model = $4, type = $5, website = $6,
           is_active = $7, sort_order = $8, updated_at = NOW()
       WHERE id = $1
       RETURNING id, name, default_api_url, default_model, type, website, is_active, sort_order`,
      [
        body.id,
        body.name.trim(),
        body.defaultApiUrl?.trim() || '',
        body.defaultModel?.trim() || '',
        body.type || 'image',
        body.website?.trim() || null,
        body.isActive !== false,
        Number(body.sortOrder || 0),
      ]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: '供应商不存在' }, { status: 404 });
    }

    return NextResponse.json({ provider: mapProvider(result.rows[0]) });
  } finally {
    client.release();
  }
}

export async function DELETE(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const body = await readBody(request);
  const id = body.id || request.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: '缺少供应商 ID' }, { status: 400 });

  const client = await getDbClient();
  try {
    await client.query('DELETE FROM api_providers WHERE id = $1', [id]);
    return NextResponse.json({ success: true });
  } finally {
    client.release();
  }
}
