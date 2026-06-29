import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getDbClient } from '@/storage/database/local-db';

function mapRecommendation(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    modelName: String(row.model_name || ''),
    displayName: String(row.display_name || row.model_name || ''),
    type: String(row.type || 'image'),
    providerId: (row.provider_id as string | null) || null,
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
      `SELECT id, model_name, display_name, type, provider_id, is_active, sort_order
       FROM model_recommendations
       ORDER BY type ASC, sort_order ASC, model_name ASC`
    );
    return NextResponse.json({ recommendations: result.rows.map(mapRecommendation) });
  } finally {
    client.release();
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const body = await readBody(request);
  if (!body.modelName?.trim()) {
    return NextResponse.json({ error: '请填写模型名称' }, { status: 400 });
  }

  const client = await getDbClient();
  try {
    const result = await client.query(
      `INSERT INTO model_recommendations (model_name, display_name, type, provider_id, is_active, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, model_name, display_name, type, provider_id, is_active, sort_order`,
      [
        body.modelName.trim(),
        body.displayName?.trim() || body.modelName.trim(),
        body.type || 'image',
        body.providerId || null,
        body.isActive !== false,
        Number(body.sortOrder || 0),
      ]
    );
    return NextResponse.json({ recommendation: mapRecommendation(result.rows[0]) });
  } finally {
    client.release();
  }
}

export async function PUT(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const body = await readBody(request);
  if (!body.id || !body.modelName?.trim()) {
    return NextResponse.json({ error: '缺少推荐项 ID 或模型名称' }, { status: 400 });
  }

  const client = await getDbClient();
  try {
    const result = await client.query(
      `UPDATE model_recommendations
       SET model_name = $2, display_name = $3, type = $4, provider_id = $5,
           is_active = $6, sort_order = $7, updated_at = NOW()
       WHERE id = $1
       RETURNING id, model_name, display_name, type, provider_id, is_active, sort_order`,
      [
        body.id,
        body.modelName.trim(),
        body.displayName?.trim() || body.modelName.trim(),
        body.type || 'image',
        body.providerId || null,
        body.isActive !== false,
        Number(body.sortOrder || 0),
      ]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: '推荐模型不存在' }, { status: 404 });
    }

    return NextResponse.json({ recommendation: mapRecommendation(result.rows[0]) });
  } finally {
    client.release();
  }
}

export async function DELETE(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const body = await readBody(request);
  const id = body.id || request.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: '缺少推荐项 ID' }, { status: 400 });

  const client = await getDbClient();
  try {
    await client.query('DELETE FROM model_recommendations WHERE id = $1', [id]);
    return NextResponse.json({ success: true });
  } finally {
    client.release();
  }
}
