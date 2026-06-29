import { NextRequest, NextResponse } from 'next/server';
import { getDbClient } from '@/storage/database/local-db';
import { requireAdmin } from '@/lib/admin-auth';

function toPublicAnnouncement(row: Record<string, unknown>) {
  const startsAt = row.starts_at ?? row.start_date ?? null;
  const expiresAt = row.expires_at ?? row.end_date ?? null;
  const isActive = row.is_active ?? row.enabled ?? true;

  return {
    ...row,
    enabled: isActive !== false,
    start_date: startsAt,
    end_date: expiresAt,
    is_active: isActive !== false,
    starts_at: startsAt,
    expires_at: expiresAt,
  };
}

export async function GET() {
  try {
    const client = await getDbClient();
    try {
      const result = await client.query('SELECT * FROM announcements ORDER BY created_at DESC');
      return NextResponse.json((result.rows || []).map(toPublicAnnouncement));
    } finally {
      client.release();
    }
  } catch {
    return NextResponse.json([]);
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { title, content, startDate, endDate, enabled } = body;

    if (!title || !content || !startDate || !endDate) {
      return NextResponse.json({ error: '请填写完整公告信息' }, { status: 400 });
    }

    const client = await getDbClient();
    try {
      const id = crypto.randomUUID();
      await client.query(
        'INSERT INTO announcements (id, title, content, is_active, starts_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6)',
        [id, title, content, enabled !== false, new Date(startDate).toISOString(), new Date(endDate).toISOString()]
      );
      return NextResponse.json({ id, success: true });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[announcements] POST error:', err);
    return NextResponse.json({ error: '创建公告失败' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { id, title, content, startDate, endDate, enabled } = body;

    if (!id) {
      return NextResponse.json({ error: '缺少公告ID' }, { status: 400 });
    }

    const client = await getDbClient();
    try {
      const updates: string[] = [];
      const params: unknown[] = [];
      let paramIdx = 1;

      if (title !== undefined) { updates.push(`title = $${paramIdx++}`); params.push(title); }
      if (content !== undefined) { updates.push(`content = $${paramIdx++}`); params.push(content); }
      if (startDate !== undefined) { updates.push(`starts_at = $${paramIdx++}`); params.push(new Date(startDate).toISOString()); }
      if (endDate !== undefined) { updates.push(`expires_at = $${paramIdx++}`); params.push(new Date(endDate).toISOString()); }
      if (enabled !== undefined) { updates.push(`is_active = $${paramIdx++}`); params.push(enabled); }
      updates.push(`updated_at = NOW()`);

      params.push(id);
      await client.query(`UPDATE announcements SET ${updates.join(', ')} WHERE id = $${paramIdx}`, params);
      return NextResponse.json({ success: true });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[announcements] PUT error:', err);
    return NextResponse.json({ error: '更新公告失败' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: '缺少公告ID' }, { status: 400 });
    }

    const client = await getDbClient();
    try {
      await client.query('DELETE FROM announcements WHERE id = $1', [id]);
      return NextResponse.json({ success: true });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[announcements] DELETE error:', err);
    return NextResponse.json({ error: '删除公告失败' }, { status: 500 });
  }
}
