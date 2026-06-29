import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getDbClient } from '@/storage/database/local-db';
import { ensureModelCallRecordSchema } from '@/lib/model-call-records';

const STATUSES = new Set(['queued', 'running', 'succeeded', 'failed', 'cancelled']);
const TYPES = new Set(['image', 'video', 'text', 'reverse-prompt']);
const SOURCES = new Set(['generation-job', 'suggest-prompt']);

function intParam(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function safeDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function maskApiUrl(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return '';
  try {
    const url = new URL(text);
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return text.split('?')[0]?.split('#')[0] || '';
  }
}

function buildWhere(searchParams: URLSearchParams) {
  const clauses: string[] = [];
  const params: unknown[] = [];

  const status = searchParams.get('status') || '';
  if (status && status !== 'all') {
    if (!STATUSES.has(status)) throw new Error('调用状态无效');
    params.push(status);
    clauses.push(`r.status = $${params.length}`);
  }

  const type = searchParams.get('type') || '';
  if (type && type !== 'all') {
    if (!TYPES.has(type)) throw new Error('调用类型无效');
    params.push(type);
    clauses.push(`r.type = $${params.length}`);
  }

  const source = searchParams.get('source') || '';
  if (source && source !== 'all') {
    if (!SOURCES.has(source)) throw new Error('调用来源无效');
    params.push(source);
    clauses.push(`r.source = $${params.length}`);
  }

  const operation = (searchParams.get('operation') || '').trim();
  if (operation && operation !== 'all') {
    params.push(operation);
    clauses.push(`r.operation = $${params.length}`);
  }

  const userSearch = (searchParams.get('user') || searchParams.get('userSearch') || '').trim();
  if (userSearch) {
    params.push(`%${userSearch.toLowerCase()}%`);
    clauses.push(`(
      r.user_id::text LIKE $${params.length}
      OR LOWER(COALESCE(p.email, '')) LIKE $${params.length}
      OR LOWER(COALESCE(p.display_nickname, '')) LIKE $${params.length}
      OR LOWER(COALESCE(p.nickname, '')) LIKE $${params.length}
    )`);
  }

  const modelSearch = (searchParams.get('model') || searchParams.get('keyword') || '').trim();
  if (modelSearch) {
    params.push(`%${modelSearch.toLowerCase()}%`);
    clauses.push(`(
      LOWER(COALESCE(r.provider, '')) LIKE $${params.length}
      OR LOWER(COALESCE(r.model_name, '')) LIKE $${params.length}
      OR LOWER(COALESCE(r.operation, '')) LIKE $${params.length}
      OR LOWER(COALESCE(r.api_url, '')) LIKE $${params.length}
    )`);
  }

  const startTime = safeDate(searchParams.get('startTime'));
  if (startTime) {
    params.push(startTime);
    clauses.push(`r.created_at >= $${params.length}::timestamptz`);
  }

  const endTime = safeDate(searchParams.get('endTime'));
  if (endTime) {
    params.push(endTime);
    clauses.push(`r.created_at <= $${params.length}::timestamptz`);
  }

  return {
    whereSql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
}

function mapRecord(row: Record<string, unknown>) {
  return {
    ...row,
    api_url: maskApiUrl(row.api_url),
    credits_cost: Number(row.credits_cost || 0),
    result_count: Number(row.result_count || 0),
    duration_ms: Number(row.duration_ms || 0),
  };
}

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const page = intParam(searchParams.get('page'), 1, 1, 100000);
  const pageSize = intParam(searchParams.get('pageSize'), 20, 1, 100);
  const offset = (page - 1) * pageSize;

  let filters: { whereSql: string; params: unknown[] };
  try {
    filters = buildWhere(searchParams);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '筛选参数无效' },
      { status: 400 },
    );
  }

  const client = await getDbClient();
  try {
    await ensureModelCallRecordSchema(client);
    const { whereSql, params } = filters;

    const countResult = await client.query(
      `SELECT COUNT(*)::int AS total
       FROM model_call_records r
       LEFT JOIN profiles p ON p.id = r.user_id
       ${whereSql}`,
      params,
    );

    const summaryResult = await client.query(
      `SELECT
         COUNT(*)::int AS total_calls,
         COUNT(*) FILTER (WHERE r.status = 'succeeded')::int AS succeeded_calls,
         COUNT(*) FILTER (WHERE r.status = 'failed')::int AS failed_calls,
         COUNT(*) FILTER (WHERE r.status = 'cancelled')::int AS cancelled_calls,
         COALESCE(SUM(r.credits_cost), 0)::int AS total_credits_cost,
         COALESCE(SUM(r.credits_cost) FILTER (WHERE r.created_at >= NOW() - INTERVAL '7 days'), 0)::int AS credits_cost_7d,
         COALESCE(SUM(r.result_count), 0)::int AS total_results,
         COALESCE(AVG(NULLIF(r.duration_ms, 0)), 0)::int AS avg_duration_ms
       FROM model_call_records r
       LEFT JOIN profiles p ON p.id = r.user_id
       ${whereSql}`,
      params,
    );

    const rowsResult = await client.query(
      `SELECT r.id, r.user_id, p.email AS user_email,
              COALESCE(NULLIF(p.display_nickname, ''), p.nickname) AS user_nickname,
              r.source, r.operation, r.generation_job_id, r.type, r.provider, r.model_name, r.api_url,
              r.system_api_id, r.custom_api_key_id, r.status, r.credits_cost, r.result_count,
              r.duration_ms, r.error, r.metadata, r.created_at, r.started_at, r.finished_at, r.updated_at
       FROM model_call_records r
       LEFT JOIN profiles p ON p.id = r.user_id
       ${whereSql}
       ORDER BY r.created_at DESC
       LIMIT $${params.length + 1}
       OFFSET $${params.length + 2}`,
      [...params, pageSize, offset],
    );

    const topModelsResult = await client.query(
      `SELECT r.type, r.provider, r.model_name,
              COUNT(*)::int AS calls,
              COUNT(*) FILTER (WHERE r.status = 'succeeded')::int AS succeeded,
              COUNT(*) FILTER (WHERE r.status = 'failed')::int AS failed,
              COALESCE(SUM(r.credits_cost), 0)::int AS credits_cost,
              COALESCE(SUM(r.result_count), 0)::int AS result_count,
              COALESCE(AVG(NULLIF(r.duration_ms, 0)), 0)::int AS avg_duration_ms
       FROM model_call_records r
       LEFT JOIN profiles p ON p.id = r.user_id
       ${whereSql}
       GROUP BY r.type, r.provider, r.model_name
       ORDER BY calls DESC, credits_cost DESC, r.provider ASC, r.model_name ASC
       LIMIT 10`,
      params,
    );

    const total = countResult.rows[0]?.total || 0;
    return NextResponse.json({
      records: rowsResult.rows.map(mapRecord),
      summary: summaryResult.rows[0] || {},
      topModels: topModelsResult.rows.map(row => ({
        ...row,
        calls: Number(row.calls || 0),
        succeeded: Number(row.succeeded || 0),
        failed: Number(row.failed || 0),
        credits_cost: Number(row.credits_cost || 0),
        result_count: Number(row.result_count || 0),
        avg_duration_ms: Number(row.avg_duration_ms || 0),
      })),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    });
  } finally {
    client.release();
  }
}
