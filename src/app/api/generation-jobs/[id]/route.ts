import { NextRequest, NextResponse } from 'next/server';
import { getDbClient } from '@/storage/database/local-db';
import { getAuthenticatedUser } from '@/lib/session-auth';
import {
  buildInitialGenerationProgress,
  ensureGenerationJobRuntimeSchema,
  getGenerationJobEstimate,
} from '@/lib/generation-job-estimates';
import { markModelCallRecordsForJobs, updateModelCallRecordByJob } from '@/lib/model-call-records';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function safeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function getProgressClientRequestId(progress: Record<string, unknown>): string {
  return safeString(progress.clientRequestId);
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 });
    }

    const { id } = await context.params;
    if (!UUID_REGEX.test(id)) {
      return NextResponse.json({ error: '任务ID格式无效' }, { status: 400 });
    }

    const client = await getDbClient();
    try {
      await ensureGenerationJobRuntimeSchema(client);
      const staleResult = await client.query(
        `UPDATE generation_jobs
         SET status = 'failed',
             error = '任务执行超时或被服务重启中断',
             payload = '{}'::jsonb,
             finished_at = NOW(),
             updated_at = NOW()
         WHERE id = $1
           AND status = 'running'
           AND updated_at < NOW() - INTERVAL '30 minutes'
         RETURNING id`,
        [id],
      );
      if (staleResult.rows.length > 0) {
        await markModelCallRecordsForJobs(
          client,
          staleResult.rows.map(row => String(row.id)),
          {
            status: 'failed',
            error: '任务执行超时或被服务重启中断',
            metadata: { stale: true, source: 'generation-job-detail' },
          },
        );
      }

      const result = await client.query(
        `SELECT id, type, status, result, error, provider, model_name, api_url, progress,
                created_at, started_at, finished_at, updated_at,
                CASE
                  WHEN started_at IS NOT NULL
                  THEN FLOOR(EXTRACT(EPOCH FROM (COALESCE(finished_at, NOW()) - started_at)))::int
                  ELSE 0
                END AS elapsed_seconds
         FROM generation_jobs
         WHERE id = $1
           AND (user_id = $2 OR $3 = true)
         LIMIT 1`,
        [id, user.userId, user.role === 'admin' || user.role === 'enterprise_admin'],
      );

      if (result.rows.length === 0) {
        return NextResponse.json({ error: '任务不存在' }, { status: 404 });
      }

      const job = result.rows[0];
      const progress = asRecord(job.progress);
      const clientRequestId = getProgressClientRequestId(progress);
      const progressEstimate = Number(progress.estimateSeconds || progress.etaSeconds || 0);
      let estimateSeconds = Number.isFinite(progressEstimate) && progressEstimate > 0
        ? Math.ceil(progressEstimate)
        : 0;
      let etaSource = typeof progress.source === 'string' ? progress.source : 'default';
      let etaSampleCount = Number(progress.sampleCount || 0);
      let etaWindowDays = progress.windowDays ?? null;

      if (estimateSeconds <= 0 && (job.status === 'queued' || job.status === 'running')) {
        const estimate = await getGenerationJobEstimate(
          client,
          job.type,
          String(job.provider || ''),
          String(job.model_name || ''),
        );
        estimateSeconds = estimate.estimateSeconds;
        etaSource = estimate.source;
        etaSampleCount = estimate.sampleCount;
        etaWindowDays = estimate.windowDays;
        await client.query(
          `UPDATE generation_jobs
           SET progress = COALESCE(progress, '{}'::jsonb) || $2::jsonb,
               updated_at = NOW()
           WHERE id = $1`,
          [id, JSON.stringify(buildInitialGenerationProgress(estimate))],
        );
      }

      return NextResponse.json({
        ...job,
        jobId: job.id,
        ...(clientRequestId ? { payload: { clientRequestId } } : {}),
        estimateSeconds,
        eta: {
          estimateSeconds,
          source: etaSource,
          sampleCount: etaSampleCount,
          windowDays: etaWindowDays,
        },
      });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[generation-jobs] GET error:', err);
    return NextResponse.json({ error: '查询生成任务失败' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 });
    }

    const { id } = await context.params;
    if (!UUID_REGEX.test(id)) {
      return NextResponse.json({ error: '任务ID格式无效' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    if (body.action && body.action !== 'cancel') {
      return NextResponse.json({ error: '不支持的任务操作' }, { status: 400 });
    }

    const client = await getDbClient();
    try {
      await ensureGenerationJobRuntimeSchema(client);
      const result = await client.query(
        `UPDATE generation_jobs
         SET status = 'cancelled',
             error = '用户已取消任务',
             payload = '{}'::jsonb,
             progress = COALESCE(progress, '{}'::jsonb) || $4::jsonb,
             finished_at = NOW(),
             updated_at = NOW()
         WHERE id = $1
           AND (user_id = $2 OR $3 = true)
           AND status IN ('queued', 'running')
         RETURNING id, type, status, result, error, provider, model_name, api_url, progress,
                   created_at, started_at, finished_at, updated_at,
                   CASE
                     WHEN started_at IS NOT NULL
                     THEN FLOOR(EXTRACT(EPOCH FROM (COALESCE(finished_at, NOW()) - started_at)))::int
                     ELSE 0
                   END AS elapsed_seconds`,
        [
          id,
          user.userId,
          user.role === 'admin' || user.role === 'enterprise_admin',
          JSON.stringify({
            percent: 100,
            message: '任务已取消',
            cancelled: true,
            updatedAt: new Date().toISOString(),
          }),
        ],
      );

      if (result.rows.length === 0) {
        const existing = await client.query(
          `SELECT id, type, status, result, error, provider, model_name, api_url, progress,
                  created_at, started_at, finished_at, updated_at,
                  CASE
                    WHEN started_at IS NOT NULL
                    THEN FLOOR(EXTRACT(EPOCH FROM (COALESCE(finished_at, NOW()) - started_at)))::int
                    ELSE 0
                  END AS elapsed_seconds
           FROM generation_jobs
           WHERE id = $1
             AND (user_id = $2 OR $3 = true)
           LIMIT 1`,
          [id, user.userId, user.role === 'admin' || user.role === 'enterprise_admin'],
        );
        if (existing.rows.length === 0) {
          return NextResponse.json({ error: '任务不存在' }, { status: 404 });
        }
        const existingProgress = asRecord(existing.rows[0].progress);
        const existingClientRequestId = getProgressClientRequestId(existingProgress);
        return NextResponse.json({
          ...existing.rows[0],
          jobId: existing.rows[0].id,
          ...(existingClientRequestId ? { payload: { clientRequestId: existingClientRequestId } } : {}),
        });
      }

      await updateModelCallRecordByJob(client, id, {
        status: 'cancelled',
        error: '用户已取消任务',
        metadata: { cancelledBy: user.userId, source: 'generation-job-patch' },
      });

      const progress = asRecord(result.rows[0].progress);
      const clientRequestId = getProgressClientRequestId(progress);
      return NextResponse.json({
        ...result.rows[0],
        jobId: result.rows[0].id,
        ...(clientRequestId ? { payload: { clientRequestId } } : {}),
      });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[generation-jobs] PATCH error:', err);
    return NextResponse.json({ error: '取消生成任务失败' }, { status: 500 });
  }
}
