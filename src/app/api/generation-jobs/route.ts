import { NextRequest, NextResponse } from 'next/server';
import { getDbClient } from '@/storage/database/local-db';
import {
  markStaleRunningJobs,
  processNextGenerationJob,
} from '@/lib/generation-job-worker';
import { getAuthenticatedUserId } from '@/lib/session-auth';
import type { GenerationJobType } from '@/lib/generation-job-runner';
import {
  buildInitialGenerationProgress,
  ensureGenerationJobRuntimeSchema,
  getGenerationJobEstimate,
  resolveGenerationJobIdentity,
} from '@/lib/generation-job-estimates';
import { writePlatformLog } from '@/lib/platform-logs';
import { incrementImageStylePresetUsage } from '@/lib/style-preset-store';
import { ensureGenerationCreditsAvailable } from '@/lib/generation-credit-service';
import {
  buildModelCallMetadataFromPayload,
  createModelCallRecord,
  getModelCallConfigRefs,
  inferGenerationModelCallOperation,
} from '@/lib/model-call-records';
import {
  ensureSystemApiSchema,
  isUuid,
} from '@/lib/server-api-config';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

const ACTIVE_JOB_STATUSES = new Set(['queued', 'running']);
const CLIENT_REQUEST_JOB_STATUSES = new Set(['queued', 'running', 'succeeded', 'failed', 'cancelled']);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function safeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function getPayloadClientRequestId(payload: Record<string, unknown>): string {
  return safeString(payload.clientRequestId);
}

function sanitizeQueuedCustomApiConfig(value: unknown): Record<string, unknown> | undefined {
  const config = asRecord(value);
  const next: Record<string, unknown> = {};
  const customApiKeyId = safeString(config.customApiKeyId);
  const systemApiId = safeString(config.systemApiId);
  const modelName = safeString(config.modelName);

  if (isUuid(customApiKeyId)) next.customApiKeyId = customApiKeyId;
  if (isUuid(systemApiId)) next.systemApiId = systemApiId;
  if (modelName) next.modelName = modelName;

  return Object.keys(next).length > 0 ? next : undefined;
}

function sanitizeQueuedGenerationPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const next = { ...payload };
  const customApiConfig = sanitizeQueuedCustomApiConfig(next.customApiConfig);
  if (customApiConfig) {
    next.customApiConfig = customApiConfig;
  } else {
    delete next.customApiConfig;
  }
  return next;
}

function parseStatusFilter(
  value: string | null,
  allowedStatuses = ACTIVE_JOB_STATUSES,
  defaultStatuses = ['queued', 'running'],
): string[] {
  if (!value) return defaultStatuses;
  const statuses = value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
    .filter(item => allowedStatuses.has(item));
  return statuses.length > 0 ? statuses : defaultStatuses;
}

function parseClientRequestIdFilter(value: string | null): string {
  const clientRequestId = safeString(value);
  return clientRequestId.length <= 200 ? clientRequestId : '';
}

function parseTypeFilter(value: string | null): GenerationJobType[] {
  if (!value) return [];
  return value
    .split(',')
    .map(item => item.trim())
    .filter((item): item is GenerationJobType => item === 'image' || item === 'video' || item === 'reverse-prompt');
}

export async function GET(request: NextRequest) {
  try {
    void markStaleRunningJobs();
    const userId = await getAuthenticatedUserId(request);
    if (!userId) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 });
    }

    const clientRequestId = parseClientRequestIdFilter(request.nextUrl.searchParams.get('clientRequestId'));
    const statuses = parseStatusFilter(
      request.nextUrl.searchParams.get('status'),
      clientRequestId ? CLIENT_REQUEST_JOB_STATUSES : ACTIVE_JOB_STATUSES,
      clientRequestId ? Array.from(CLIENT_REQUEST_JOB_STATUSES) : ['queued', 'running'],
    );
    const types = parseTypeFilter(request.nextUrl.searchParams.get('type'));
    const limitParam = Number(request.nextUrl.searchParams.get('limit') || 30);
    const limit = Number.isFinite(limitParam) ? Math.min(100, Math.max(1, Math.floor(limitParam))) : 30;
    const client = await getDbClient();
    try {
      await ensureGenerationJobRuntimeSchema(client);
      const params: unknown[] = [userId, statuses];
      let typeClause = '';
      if (types.length > 0) {
        params.push(types);
        typeClause = `AND type = ANY($${params.length}::text[])`;
      }
      let clientRequestIdClause = '';
      if (clientRequestId) {
        params.push(clientRequestId);
        clientRequestIdClause = `AND (
             payload->>'clientRequestId' = $${params.length}
             OR progress->>'clientRequestId' = $${params.length}
           )`;
      }
      params.push(limit);
      const limitParamIndex = params.length;
      const result = await client.query(
        `SELECT id, type, status, result, error, payload, provider, model_name, api_url, progress,
                created_at, started_at, finished_at, updated_at,
                CASE
                  WHEN started_at IS NOT NULL
                  THEN FLOOR(EXTRACT(EPOCH FROM (COALESCE(finished_at, NOW()) - started_at)))::int
                  ELSE 0
                END AS elapsed_seconds
         FROM generation_jobs
         WHERE user_id = $1
           AND status = ANY($2::text[])
           ${typeClause}
           ${clientRequestIdClause}
         ORDER BY created_at DESC
         LIMIT $${limitParamIndex}`,
        params,
      );
      const jobs = result.rows.map(row => {
        const payload = asRecord(row.payload);
        const progress = asRecord(row.progress);
        const clientRequestId = getPayloadClientRequestId(payload) || safeString(progress.clientRequestId);
        const estimateSeconds = Number(progress.estimateSeconds || progress.etaSeconds || 0)
          || (row.type === 'video' ? 300 : row.type === 'reverse-prompt' ? 60 : 90);
        return {
          ...row,
          payload: clientRequestId ? { ...payload, clientRequestId } : payload,
          jobId: row.id,
          estimateSeconds,
          eta: {
            estimateSeconds,
            source: typeof progress.source === 'string' ? progress.source : 'default',
            sampleCount: Number(progress.sampleCount || 0),
            windowDays: progress.windowDays ?? null,
          },
        };
      });
      return NextResponse.json({ jobs });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[generation-jobs] GET error:', err);
    return NextResponse.json({ error: '查询生成任务失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    void markStaleRunningJobs();
    const body = await request.json();
    const type = body.type as GenerationJobType;
    let payload = body.payload as Record<string, unknown>;
    const userId = await getAuthenticatedUserId(request);

    if (!userId) {
      return NextResponse.json({ error: '请先登录后再创建生成任务' }, { status: 401 });
    }

    if (type !== 'image' && type !== 'video' && type !== 'reverse-prompt') {
      return NextResponse.json({ error: '不支持的任务类型' }, { status: 400 });
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return NextResponse.json({ error: '缺少任务参数' }, { status: 400 });
    }
    payload = sanitizeQueuedGenerationPayload(payload);

    const client = await getDbClient();
    let jobId = '';
    let estimateSeconds = type === 'video' ? 300 : 90;
    let etaSource = 'default';
    let etaSampleCount = 0;
    let etaWindowDays: number | null = null;
    let jobIdentity = { provider: '', modelName: '', apiUrl: '' };
    let transactionStarted = false;
    try {
      await ensureGenerationJobRuntimeSchema(client);
      await client.query('BEGIN');
      transactionStarted = true;
      const identity = await resolveGenerationJobIdentity(client, userId, type, payload);
      jobIdentity = identity;
      try {
        if (type === 'image' || type === 'video') {
          await ensureGenerationCreditsAvailable(client, userId, { type, payload });
        }
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        transactionStarted = false;
        const message = error instanceof Error ? error.message : '积分不足';
        return NextResponse.json({ error: message }, { status: 402 });
      }
      const estimate = await getGenerationJobEstimate(client, type, identity.provider, identity.modelName);
      estimateSeconds = estimate.estimateSeconds;
      etaSource = estimate.source;
      etaSampleCount = estimate.sampleCount;
      etaWindowDays = estimate.windowDays;
      const payloadJson = JSON.stringify(payload);
      const clientRequestId = getPayloadClientRequestId(payload);
      const existing = clientRequestId
        ? await client.query(
            `SELECT id, status, progress
             FROM generation_jobs
             WHERE user_id = $1
               AND type = $2
               AND status IN ('queued', 'running')
               AND (
                 payload->>'clientRequestId' = $3
                 OR progress->>'clientRequestId' = $3
               )
             ORDER BY created_at DESC
             LIMIT 1`,
            [userId, type, clientRequestId],
          )
        : await client.query(
            `SELECT id, status, progress
             FROM generation_jobs
             WHERE user_id = $1
               AND type = $2
               AND status IN ('queued', 'running')
               AND payload = $3::jsonb
             ORDER BY created_at DESC
             LIMIT 1`,
            [userId, type, payloadJson],
          );
      if (existing.rows.length > 0) {
        const row = existing.rows[0];
        let progress = row.progress || {};
        if (clientRequestId) {
          const progressResult = await client.query(
            `UPDATE generation_jobs
             SET progress = COALESCE(progress, '{}'::jsonb) || $2::jsonb,
                 updated_at = NOW()
             WHERE id = $1
               AND status IN ('queued', 'running')
             RETURNING progress`,
            [row.id, JSON.stringify({ clientRequestId })],
          );
          progress = progressResult.rows[0]?.progress || progress;
        }
        const configRefs = getModelCallConfigRefs(payload);
        await createModelCallRecord(client, {
          userId,
          source: 'generation-job',
          operation: inferGenerationModelCallOperation(type, payload),
          generationJobId: row.id,
          type,
          provider: identity.provider,
          modelName: identity.modelName,
          apiUrl: identity.apiUrl,
          systemApiId: configRefs.systemApiId,
          customApiKeyId: configRefs.customApiKeyId,
          status: row.status === 'running' ? 'running' : 'queued',
          metadata: buildModelCallMetadataFromPayload(type, payload, { deduplicated: true }),
        });
        await client.query('COMMIT');
        transactionStarted = false;
        return NextResponse.json({
          jobId: row.id,
          status: row.status,
          estimateSeconds,
          progress,
          eta: {
            estimateSeconds,
            source: etaSource,
            sampleCount: etaSampleCount,
            windowDays: etaWindowDays,
          },
          deduplicated: true,
        }, { status: 202 });
      }
      const result = await client.query(
        `INSERT INTO generation_jobs (type, status, payload, user_id, provider, model_name, api_url, progress)
         VALUES ($1, 'queued', $2::jsonb, $3, $4, $5, $6, $7::jsonb)
         RETURNING id`,
        [
          type,
          payloadJson,
          userId,
          identity.provider,
          identity.modelName,
          identity.apiUrl,
          JSON.stringify({
            ...buildInitialGenerationProgress(estimate),
            ...(clientRequestId ? { clientRequestId } : {}),
          }),
        ],
      );
      jobId = result.rows[0].id as string;
      const configRefs = getModelCallConfigRefs(payload);
      await createModelCallRecord(client, {
        userId,
        source: 'generation-job',
        operation: inferGenerationModelCallOperation(type, payload),
        generationJobId: jobId,
        type,
        provider: identity.provider,
        modelName: identity.modelName,
        apiUrl: identity.apiUrl,
        systemApiId: configRefs.systemApiId,
        customApiKeyId: configRefs.customApiKeyId,
        status: 'queued',
        metadata: buildModelCallMetadataFromPayload(type, payload),
      });
      await client.query('COMMIT');
      transactionStarted = false;
      if (type === 'image' && typeof payload.styleLabel === 'string') {
        await incrementImageStylePresetUsage(client, payload.styleLabel).catch(error => {
          console.warn('[generation-jobs] style preset usage update failed:', error);
        });
      }
    } catch (error) {
      if (transactionStarted) {
        await client.query('ROLLBACK').catch(() => undefined);
      }
      throw error;
    } finally {
      client.release();
    }

    void processNextGenerationJob();
    void writePlatformLog({
      type: 'generation',
      level: 'info',
      action: 'generation_job_created',
      message: `用户创建${type === 'image' ? '图片' : type === 'video' ? '视频' : '反推提示词'}生成任务`,
      userId,
      targetType: 'generation_job',
      targetId: jobId,
      metadata: {
        type,
        provider: jobIdentity.provider,
        modelName: jobIdentity.modelName,
        estimateSeconds,
        etaSource,
        etaSampleCount,
      },
      request,
    });
    return NextResponse.json({
      jobId,
      status: 'queued',
      estimateSeconds,
      eta: {
        estimateSeconds,
        source: etaSource,
        sampleCount: etaSampleCount,
        windowDays: etaWindowDays,
      },
    }, { status: 202 });
  } catch (err) {
    console.error('[generation-jobs] POST error:', err);
    return NextResponse.json({ error: '创建生成任务失败' }, { status: 500 });
  }
}
