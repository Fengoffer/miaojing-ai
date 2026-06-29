import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/session-auth';
import {
  cleanupExpiredPlatformLogs,
  ensurePlatformLogSchema,
  getPlatformLogRetentionDays,
  setPlatformLogRetentionDays,
  writePlatformLog,
} from '@/lib/platform-logs';
import { getDbClient } from '@/storage/database/local-db';

const LOG_TYPES = new Set(['auth', 'generation', 'admin', 'database', 'storage', 'security', 'system']);
const LOG_LEVELS = new Set(['info', 'warning', 'error']);

function intParam(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function dateParam(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function GET(request: NextRequest) {
  const user = await requireAdminUser(request);
  if (user instanceof NextResponse) return user;

  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') || '';
  const level = searchParams.get('level') || '';
  const userSearch = (searchParams.get('user') || '').trim();
  const keyword = (searchParams.get('keyword') || '').trim();
  const startTime = dateParam(searchParams.get('startTime'));
  const endTime = dateParam(searchParams.get('endTime'));
  const page = intParam(searchParams.get('page'), 1, 1, 100000);
  const pageSize = intParam(searchParams.get('pageSize'), 20, 1, 100);
  const offset = (page - 1) * pageSize;

  if (type && !LOG_TYPES.has(type)) {
    return NextResponse.json({ error: '日志类型无效' }, { status: 400 });
  }
  if (level && !LOG_LEVELS.has(level)) {
    return NextResponse.json({ error: '日志级别无效' }, { status: 400 });
  }

  const client = await getDbClient();
  try {
    await ensurePlatformLogSchema(client);
    await cleanupExpiredPlatformLogs(client);

    const whereClauses: string[] = [];
    const params: unknown[] = [];
    if (type) {
      params.push(type);
      whereClauses.push(`type = $${params.length}`);
    }
    if (level) {
      params.push(level);
      whereClauses.push(`level = $${params.length}`);
    }
    if (userSearch) {
      params.push(`%${userSearch.toLowerCase()}%`);
      whereClauses.push(`(
        user_id::text ILIKE $${params.length}
        OR LOWER(COALESCE(user_name, '')) LIKE $${params.length}
        OR LOWER(COALESCE(user_email, '')) LIKE $${params.length}
      )`);
    }
    if (keyword) {
      params.push(`%${keyword.toLowerCase()}%`);
      whereClauses.push(`(
        LOWER(action) LIKE $${params.length}
        OR LOWER(message) LIKE $${params.length}
        OR LOWER(COALESCE(target_type, '')) LIKE $${params.length}
        OR LOWER(COALESCE(target_id, '')) LIKE $${params.length}
        OR LOWER(metadata::text) LIKE $${params.length}
      )`);
    }
    if (startTime) {
      params.push(startTime.toISOString());
      whereClauses.push(`created_at >= $${params.length}::timestamptz`);
    }
    if (endTime) {
      params.push(endTime.toISOString());
      whereClauses.push(`created_at <= $${params.length}::timestamptz`);
    }

    const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const countResult = await client.query(
      `SELECT COUNT(*)::int AS total FROM platform_logs ${whereSql}`,
      params,
    );
    const rowsResult = await client.query(
      `SELECT id, type, level, action, message, user_id, user_name, user_email,
              target_type, target_id, ip_address, metadata, created_at
       FROM platform_logs
       ${whereSql}
       ORDER BY created_at DESC
       LIMIT $${params.length + 1}
       OFFSET $${params.length + 2}`,
      [...params, pageSize, offset],
    );
    const retentionDays = await getPlatformLogRetentionDays(client);
    const total = countResult.rows[0]?.total || 0;

    return NextResponse.json({
      logs: rowsResult.rows,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      settings: { retentionDays },
    });
  } catch (error) {
    console.error('[admin/logs] GET error:', error);
    return NextResponse.json({ error: '加载日志失败' }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function PUT(request: NextRequest) {
  const user = await requireAdminUser(request);
  if (user instanceof NextResponse) return user;

  const payload = await request.json().catch(() => ({}));
  const retentionDays = intParam(String(payload.retentionDays ?? ''), 30, 1, 90);
  const client = await getDbClient();
  try {
    const savedRetentionDays = await setPlatformLogRetentionDays(client, retentionDays);
    const deleted = await cleanupExpiredPlatformLogs(client);
    void writePlatformLog({
      type: 'admin',
      level: 'info',
      action: 'platform_log_retention_updated',
      message: `管理员将系统日志保存时间设置为 ${savedRetentionDays} 天`,
      userId: user.userId,
      targetType: 'platform_log_settings',
      metadata: { retentionDays: savedRetentionDays, deleted },
      request,
    });
    return NextResponse.json({
      success: true,
      settings: { retentionDays: savedRetentionDays },
      deleted,
    });
  } catch (error) {
    console.error('[admin/logs] PUT error:', error);
    return NextResponse.json({ error: '保存日志设置失败' }, { status: 500 });
  } finally {
    client.release();
  }
}
