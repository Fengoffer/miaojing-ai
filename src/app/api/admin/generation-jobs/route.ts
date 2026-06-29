import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getDbClient } from '@/storage/database/local-db';
import { markStaleRunningJobs } from '@/lib/generation-job-worker';
import { ensureGenerationJobRuntimeSchema } from '@/lib/generation-job-estimates';
import { writePlatformLog } from '@/lib/platform-logs';

const STATUSES = new Set(['queued', 'running', 'succeeded', 'failed', 'cancelled']);
const CLEANUP_STATUSES = new Set(['failed', 'succeeded', 'cancelled']);

function intParam(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  await markStaleRunningJobs();

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') || '';
  const userSearch = (searchParams.get('user') || searchParams.get('userSearch') || '').trim();
  const page = intParam(searchParams.get('page'), 1, 1, 100000);
  const pageSize = intParam(searchParams.get('pageSize'), 20, 1, 100);
  const offset = (page - 1) * pageSize;

  if (status && !STATUSES.has(status)) {
    return NextResponse.json({ error: '任务状态无效' }, { status: 400 });
  }

  const client = await getDbClient();
  try {
    await ensureGenerationJobRuntimeSchema(client);
    const whereClauses: string[] = [];
    const params: unknown[] = [];
    if (status) {
      params.push(status);
      whereClauses.push(`j.status = $${params.length}`);
    }
    if (userSearch) {
      params.push(`%${userSearch.toLowerCase()}%`);
      whereClauses.push(`(
        j.user_id::text LIKE $${params.length}
        OR LOWER(COALESCE(p.email, '')) LIKE $${params.length}
        OR LOWER(COALESCE(p.display_nickname, '')) LIKE $${params.length}
        OR LOWER(COALESCE(p.nickname, '')) LIKE $${params.length}
      )`);
    }
    const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const countResult = await client.query(
      `SELECT COUNT(*)::int AS total
       FROM generation_jobs j
       LEFT JOIN profiles p ON p.id = j.user_id
       ${whereSql}`,
      params,
    );
    const rowsResult = await client.query(
      `SELECT j.id, j.user_id, p.email AS user_email, COALESCE(NULLIF(p.display_nickname, ''), p.nickname) AS user_nickname,
              j.type, j.status, j.error, j.created_at, j.started_at, j.finished_at, j.updated_at
       FROM generation_jobs j
       LEFT JOIN profiles p ON p.id = j.user_id
       ${whereSql}
       ORDER BY j.created_at DESC
       LIMIT $${params.length + 1}
       OFFSET $${params.length + 2}`,
      [...params, pageSize, offset],
    );

    const total = countResult.rows[0]?.total || 0;
    return NextResponse.json({
      jobs: rowsResult.rows,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    });
  } finally {
    client.release();
  }
}

export async function DELETE(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') || 'failed';
  const olderThanDays = intParam(searchParams.get('olderThanDays'), 7, 0, 3650);

  if (!CLEANUP_STATUSES.has(status)) {
    return NextResponse.json(
      { error: '只允许清理失败、已完成或已取消任务' },
      { status: 400 },
    );
  }

  const client = await getDbClient();
  try {
    const result = await client.query(
      `DELETE FROM generation_jobs
       WHERE status = $1
         AND updated_at < NOW() - ($2::int * INTERVAL '1 day')`,
      [status, olderThanDays],
    );
    void writePlatformLog({
      type: 'admin',
      level: 'warning',
      action: 'generation_jobs_cleanup',
      message: `管理员清理了${status === 'failed' ? '失败' : status === 'cancelled' ? '已取消' : '已完成'}生成任务`,
      targetType: 'generation_jobs',
      metadata: { status, olderThanDays, deleted: result.rowCount || 0 },
      request,
    });
    return NextResponse.json({
      success: true,
      deleted: result.rowCount || 0,
    });
  } finally {
    client.release();
  }
}
