import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { toAdminGalleryPromptWork, type AdminGalleryPromptWorkRow } from '@/lib/admin-gallery-prompt-service';
import {
  buildAdminGalleryWorksPaginationMeta,
  parseAdminGalleryWorksPagination,
} from '@/lib/admin-gallery-works-pagination';
import { getDbClient } from '@/storage/database/local-db';

export const runtime = 'nodejs';

const WORK_TYPES = new Set(['text2img', 'img2img', 'text2video', 'img2video']);

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') || searchParams.get('search') || '').trim().toLowerCase();
  const type = searchParams.get('type') || 'all';
  const sort = searchParams.get('sort') || 'newest';
  const pagination = parseAdminGalleryWorksPagination(searchParams);

  const where: string[] = [
    'w.is_public = true',
    "w.status = 'completed'",
    "COALESCE(w.result_url, '') <> ''",
  ];
  const params: unknown[] = [];

  if (type === 'image') {
    params.push('text2img', 'img2img');
    where.push(`w.type IN ($${params.length - 1}, $${params.length})`);
  } else if (type === 'video') {
    params.push('text2video', 'img2video');
    where.push(`w.type IN ($${params.length - 1}, $${params.length})`);
  } else if (WORK_TYPES.has(type)) {
    params.push(type);
    where.push(`w.type = $${params.length}`);
  } else if (type !== 'all') {
    return NextResponse.json({ error: '作品类型无效' }, { status: 400 });
  }

  if (q) {
    params.push(`%${q}%`);
    where.push(`(
      LOWER(w.id::text) LIKE $${params.length}
      OR LOWER(COALESCE(w.title, '')) LIKE $${params.length}
      OR LOWER(COALESCE(w.prompt, '')) LIKE $${params.length}
      OR LOWER(COALESCE(w.negative_prompt, '')) LIKE $${params.length}
      OR LOWER(COALESCE(p.email, '')) LIKE $${params.length}
      OR LOWER(COALESCE(p.display_nickname, p.nickname, '')) LIKE $${params.length}
      OR LOWER(COALESCE(p.nickname, '')) LIKE $${params.length}
    )`);
  }

  const whereSql = `WHERE ${where.join(' AND ')}`;
  const orderSql = sort === 'popular'
    ? 'ORDER BY w.likes_count DESC, w.created_at DESC'
    : 'ORDER BY w.created_at DESC';

  const client = await getDbClient();
  try {
    const countResult = await client.query(
      `SELECT COUNT(*)::int AS total
       FROM works w
       LEFT JOIN profiles p ON p.id = w.user_id
       ${whereSql}`,
      params,
    );
    const result = await client.query(
      `SELECT w.id, w.user_id, w.type, w.title, w.prompt, w.negative_prompt,
              w.result_url, w.thumbnail_url, w.likes_count, w.is_public, w.status, w.created_at,
              p.email AS author_email,
              p.nickname AS author_nickname,
              p.display_nickname AS author_display_nickname,
              p.avatar_url AS author_avatar_url
       FROM works w
       LEFT JOIN profiles p ON p.id = w.user_id
       ${whereSql}
       ${orderSql}
       LIMIT $${params.length + 1}
       OFFSET $${params.length + 2}`,
      [...params, pagination.limit, pagination.offset],
    );

    const works = (result.rows as AdminGalleryPromptWorkRow[]).map(row => toAdminGalleryPromptWork(row));
    const total = Number(countResult.rows[0]?.total || 0);
    return NextResponse.json({
      works,
      ...buildAdminGalleryWorksPaginationMeta({
        total,
        page: pagination.page,
        pageSize: pagination.pageSize,
        resultCount: works.length,
        offset: pagination.offset,
      }),
    });
  } catch (error) {
    console.error('[admin/gallery/works] GET error:', error);
    return NextResponse.json({ error: '加载画廊作品失败' }, { status: 500 });
  } finally {
    client.release();
  }
}
