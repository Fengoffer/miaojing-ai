import { getDbClient } from '../storage/database/local-db';
import {
  runGenerationPayload,
  type GenerationJobType,
} from './generation-job-runner';
import { ensureGenerationJobRuntimeSchema } from '@/lib/generation-job-estimates';
import { writePlatformLog } from '@/lib/platform-logs';
import {
  chargeGenerationCredits,
  refundGenerationCredits,
  type GenerationCreditCharge,
} from '@/lib/generation-credit-service';
import { saveCreationHistoryRecords } from '@/lib/creation-history-service';
import {
  buildModelCallMetadataFromPayload,
  countModelCallResults,
  createModelCallRecord,
  getModelCallConfigRefs,
  inferGenerationModelCallOperation,
  markModelCallRecordsForJobs,
  updateModelCallRecordByJob,
} from '@/lib/model-call-records';

const POLL_INTERVAL_MS = Number(process.env.GENERATION_WORKER_INTERVAL_MS || 5000);
const STALE_RUNNING_MINUTES = Number(process.env.GENERATION_JOB_TIMEOUT_MINUTES || 30);

let processing = false;

function safeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function safePublicUrl(value: unknown): string | undefined {
  const text = safeString(value);
  if (!text || text.startsWith('data:') || text.startsWith('[')) return undefined;
  return text;
}

function safeReferenceInput(value: unknown): string | undefined {
  const text = safeString(value);
  if (!text || text.startsWith('[')) return undefined;
  return text;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function getPayloadConfig(payload: Record<string, unknown>) {
  return asRecord(payload.customApiConfig);
}

function getModelName(payload: Record<string, unknown>): string {
  const config = getPayloadConfig(payload);
  return safeString(config.modelName) || safeString(payload.modelName) || safeString(payload.model);
}

function getSafeReferenceImages(payload: Record<string, unknown>): string[] {
  const references = [
    safePublicUrl(payload.image),
    ...(Array.isArray(payload.images) ? payload.images.map(safePublicUrl) : []),
    ...(Array.isArray(payload.extraImages) ? payload.extraImages.map(safePublicUrl) : []),
  ].filter((value): value is string => Boolean(value));
  return Array.from(new Set(references));
}

function getReferenceInputs(payload: Record<string, unknown>): string[] {
  const references = [
    safeReferenceInput(payload.image),
    ...(Array.isArray(payload.images) ? payload.images.map(safeReferenceInput) : []),
    ...(Array.isArray(payload.extraImages) ? payload.extraImages.map(safeReferenceInput) : []),
  ].filter((value): value is string => Boolean(value));
  return Array.from(new Set(references));
}

function countReferenceInputs(payload: Record<string, unknown>): number {
  if (typeof payload.image === 'string' && payload.image.trim()) return 1;
  if (Array.isArray(payload.images)) return payload.images.length;
  if (Array.isArray(payload.extraImages)) return payload.extraImages.length;
  return 0;
}

function sanitizeHistoryParams(payload: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const rest = { ...payload };
  delete rest.image;
  delete rest.images;
  delete rest.extraImages;
  delete rest.customApiConfig;
  const config = getPayloadConfig(payload);
  const references = getReferenceInputs(payload);
  return {
    ...rest,
    ...extra,
    model: getModelName(payload),
    modelLabel: safeString(config.modelName) || safeString(payload.modelLabel) || getModelName(payload),
    isCustomModel: Boolean(config.customApiKeyId || config.systemApiId),
    referenceImage: references[0],
    referenceImages: references.length > 0 ? references : undefined,
    refImageCount: references.length || countReferenceInputs(payload),
  };
}

function buildImageHistoryRecords(
  payload: Record<string, unknown>,
  result: Record<string, unknown>,
) {
  const images = Array.isArray(result.images) ? result.images.filter((url): url is string => typeof url === 'string' && url.trim().length > 0) : [];
  const thumbnails = asRecord(result.thumbnails);
  const thumbnailUrls = Array.isArray(result.thumbnailUrls) ? result.thumbnailUrls : [];
  const dimensions = asRecord(result.dimensions);
  const references = getSafeReferenceImages(payload);
  const creditsCost = Math.max(0, Number(result.creditsCost || 0));
  const creditsPerItem = creditsCost > 0 ? Math.ceil(creditsCost / Math.max(1, images.length)) : 0;
  const params = sanitizeHistoryParams(payload, {
    creationMode: references.length > 0 || Boolean(payload.image) || Boolean(payload.images) || Boolean(payload.extraImages) ? 'img2img' : 'text2img',
  });

  return images.map((url, index) => {
    const size = asRecord(dimensions[url]);
    return {
      type: 'image',
      url,
      thumbnailUrl: safeString(thumbnails[url]) || safeString(thumbnailUrls[index]) || undefined,
      width: Number(size.width) || undefined,
      height: Number(size.height) || undefined,
      prompt: safeString(payload.prompt),
      negativePrompt: safeString(payload.negativePrompt) || undefined,
      model: getModelName(payload),
      modelLabel: safeString(params.modelLabel) || getModelName(payload),
      isCustomModel: Boolean(params.isCustomModel),
      referenceImage: references[0],
      referenceImages: references.length > 0 ? references : undefined,
      params,
      creditsCost: creditsPerItem,
    };
  });
}

function buildVideoHistoryRecords(
  payload: Record<string, unknown>,
  result: Record<string, unknown>,
) {
  const videos = Array.isArray(result.videos) ? result.videos.filter((url): url is string => typeof url === 'string' && url.trim().length > 0) : [];
  const references = getSafeReferenceImages(payload);
  const creditsCost = Math.max(0, Number(result.creditsCost || 0));
  const creditsPerItem = creditsCost > 0 ? Math.ceil(creditsCost / Math.max(1, videos.length)) : 0;
  const params = sanitizeHistoryParams(payload, {
    creationMode: references.length > 0 || Boolean(payload.image) || Boolean(payload.images) || Boolean(payload.extraImages) ? 'img2video' : 'text2video',
  });

  return videos.map(url => ({
    type: 'video',
    url,
    prompt: safeString(payload.prompt),
    negativePrompt: safeString(payload.negativePrompt) || undefined,
    model: getModelName(payload),
    modelLabel: safeString(params.modelLabel) || getModelName(payload),
    isCustomModel: Boolean(params.isCustomModel),
    referenceImage: references[0],
    referenceImages: references.length > 0 ? references : undefined,
    params,
    creditsCost: creditsPerItem,
  }));
}

function buildReversePromptHistoryRecord(
  jobId: string,
  payload: Record<string, unknown>,
  result: Record<string, unknown>,
) {
  const outputMode = safeString(payload.outputMode) || 'structured';
  const generalPrompt = safeString(result.generalPrompt);
  const structuredPrompt = safeString(result.structuredPrompt);
  const negativePrompt = safeString(result.negativePrompt);
  const prompt = outputMode === 'general'
    ? generalPrompt || structuredPrompt
    : structuredPrompt || generalPrompt;
  const referenceImage = safePublicUrl(result.referenceImage) || safePublicUrl(payload.image);
  const params = sanitizeHistoryParams(payload, {
    creationMode: 'reverse-prompt',
    outputMode,
    language: safeString(payload.language) || 'zh',
    generalPrompt,
    structuredPrompt,
    structuredSections: asRecord(result.structuredSections),
    sourceImagePersisted: Boolean(referenceImage),
  });

  return {
    type: 'reverse-prompt',
    url: `[reverse-prompt:${jobId}]`,
    prompt,
    negativePrompt: negativePrompt || undefined,
    model: getModelName(payload),
    modelLabel: getModelName(payload) || 'Multimodal model',
    isCustomModel: true,
    referenceImage,
    params,
  };
}

function buildGenerationHistoryRecords(
  jobId: string,
  type: GenerationJobType,
  payload: Record<string, unknown>,
  result: Record<string, unknown>,
) {
  if (type === 'image') return buildImageHistoryRecords(payload, result);
  if (type === 'video') return buildVideoHistoryRecords(payload, result);
  return [buildReversePromptHistoryRecord(jobId, payload, result)].filter(record => Boolean(record.prompt));
}

async function persistGenerationHistoryRecord(input: {
  jobId: string;
  userId: string | null;
  type: GenerationJobType;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
}) {
  if (!input.userId) return;
  const records = buildGenerationHistoryRecords(input.jobId, input.type, input.payload, input.result);
  if (records.length === 0) return;
  await saveCreationHistoryRecords(input.userId, records);
}

async function updateJob(
  jobId: string,
  fields: {
    status: 'succeeded' | 'failed';
    result?: unknown;
    error?: string | null;
    creditsCost?: number | null;
    resultCount?: number | null;
    metadata?: Record<string, unknown>;
  },
) {
  const client = await getDbClient();
  try {
    await ensureGenerationJobRuntimeSchema(client);
    const result = await client.query(
      `UPDATE generation_jobs
       SET status = $1,
           result = COALESCE($2::jsonb, result),
           error = $3,
           payload = '{}'::jsonb,
           progress = COALESCE(progress, '{}'::jsonb) || $5::jsonb,
           finished_at = NOW(),
           updated_at = NOW()
       WHERE id = $4
         AND status = 'running'`,
      [
        fields.status,
        fields.result === undefined ? null : JSON.stringify(fields.result),
        fields.error ?? null,
        jobId,
        JSON.stringify({
          percent: fields.status === 'succeeded' ? 100 : undefined,
          message: fields.status === 'succeeded' ? '生成结果已返回，正在准备展示' : '生成任务失败',
          resultReady: fields.status === 'succeeded',
          updatedAt: new Date().toISOString(),
        }),
      ],
    );
    if ((result.rowCount || 0) > 0) {
      await updateModelCallRecordByJob(client, jobId, {
        status: fields.status,
        error: fields.error ?? null,
        creditsCost: fields.creditsCost ?? null,
        resultCount: fields.resultCount ?? null,
        metadata: fields.metadata,
      });
    }
  } finally {
    client.release();
  }
}

async function appendJobProgress(
  jobId: string,
  progress: Record<string, unknown>,
) {
  const client = await getDbClient();
  try {
    await ensureGenerationJobRuntimeSchema(client);
    await client.query(
      `UPDATE generation_jobs
       SET progress = COALESCE(progress, '{}'::jsonb) || $2::jsonb,
           updated_at = NOW()
       WHERE id = $1`,
      [jobId, JSON.stringify({
        ...progress,
        updatedAt: new Date().toISOString(),
      })],
    );
  } finally {
    client.release();
  }
}

async function isJobStillRunning(jobId: string): Promise<boolean> {
  const client = await getDbClient();
  try {
    await ensureGenerationJobRuntimeSchema(client);
    const result = await client.query(
      `SELECT status
       FROM generation_jobs
       WHERE id = $1
       LIMIT 1`,
      [jobId],
    );
    return result.rows[0]?.status === 'running';
  } finally {
    client.release();
  }
}

export async function markStaleRunningJobs() {
  const client = await getDbClient();
  try {
    await ensureGenerationJobRuntimeSchema(client);
    const result = await client.query<{ id: string }>(
      `UPDATE generation_jobs
       SET status = 'failed',
           error = '任务执行超时或被服务重启中断',
           payload = '{}'::jsonb,
           finished_at = NOW(),
           updated_at = NOW()
       WHERE status = 'running'
         AND updated_at < NOW() - ($1::int * INTERVAL '1 minute')
       RETURNING id`,
      [STALE_RUNNING_MINUTES],
    );
    if (result.rows.length > 0) {
      await markModelCallRecordsForJobs(
        client,
        result.rows.map(row => String(row.id)),
        {
          status: 'failed',
          error: '任务执行超时或被服务重启中断',
          metadata: { stale: true, timeoutMinutes: STALE_RUNNING_MINUTES, source: 'generation-worker' },
        },
      );
    }
    return result.rowCount || 0;
  } finally {
    client.release();
  }
}

async function claimNextJob() {
  const client = await getDbClient();
  try {
    await ensureGenerationJobRuntimeSchema(client);
    await client.query('BEGIN');
    const result = await client.query<{
      id: string;
      type: GenerationJobType;
      payload: Record<string, unknown>;
      user_id: string | null;
      provider: string | null;
      model_name: string | null;
      api_url: string | null;
    }>(
      `WITH next_job AS (
         SELECT id
         FROM generation_jobs
         WHERE status = 'queued'
         ORDER BY created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE generation_jobs AS j
       SET status = 'running',
           started_at = COALESCE(j.started_at, NOW()),
           progress = COALESCE(j.progress, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
             'message', '生成任务已开始执行',
             'updatedAt', NOW(),
             'clientRequestId', NULLIF(j.payload->>'clientRequestId', '')
           )),
           updated_at = NOW()
       FROM next_job
       WHERE j.id = next_job.id
       RETURNING j.id, j.type, j.payload, j.user_id, j.provider, j.model_name, j.api_url`,
    );
    await client.query('COMMIT');
    return result.rows[0] || null;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

async function ensureRunningModelCallRecord(job: {
  id: string;
  type: GenerationJobType;
  payload: Record<string, unknown>;
  user_id: string | null;
  provider: string | null;
  model_name: string | null;
  api_url: string | null;
}) {
  const client = await getDbClient();
  try {
    await ensureGenerationJobRuntimeSchema(client);
    const updated = await updateModelCallRecordByJob(client, job.id, {
      status: 'running',
      metadata: { claimedAt: new Date().toISOString() },
    });
    if (updated > 0) return;
    const refs = getModelCallConfigRefs(job.payload || {});
    await createModelCallRecord(client, {
      userId: job.user_id,
      source: 'generation-job',
      operation: inferGenerationModelCallOperation(job.type, job.payload || {}),
      generationJobId: job.id,
      type: job.type,
      provider: job.provider,
      modelName: job.model_name,
      apiUrl: job.api_url,
      systemApiId: refs.systemApiId,
      customApiKeyId: refs.customApiKeyId,
      status: 'running',
      metadata: buildModelCallMetadataFromPayload(job.type, job.payload || {}, {
        recoveredFromWorker: true,
      }),
    });
  } finally {
    client.release();
  }
}

async function settleJobCredits(input: {
  userId: string | null;
  type: 'image' | 'video';
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
}) {
  const client = await getDbClient();
  try {
    await ensureGenerationJobRuntimeSchema(client);
    await client.query('BEGIN');
    const charge = await chargeGenerationCredits(client, input);
    await client.query('COMMIT');
    return charge;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function refundSettledGenerationCredits(input: {
  userId: string | null;
  charge: GenerationCreditCharge | null;
  reason: string;
}) {
  if (!input.charge) return null;
  const client = await getDbClient();
  try {
    await ensureGenerationJobRuntimeSchema(client);
    await client.query('BEGIN');
    const refund = await refundGenerationCredits(client, input);
    await client.query('COMMIT');
    return refund;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function processNextGenerationJob() {
  if (processing) return false;
  processing = true;
  try {
    await markStaleRunningJobs();
    const job = await claimNextJob();
    if (!job) return false;
    await ensureRunningModelCallRecord(job);

    let creditChargeResult: Awaited<ReturnType<typeof settleJobCredits>> = null;
    try {
      const result = await runGenerationPayload(job.type, job.payload || {}, {
        userId: job.user_id,
        jobId: job.id,
      }) as Record<string, unknown>;
      if (!await isJobStillRunning(job.id)) {
        console.info('[generation-worker] skip cancelled job result:', job.id);
        return true;
      }
      if (job.type === 'image' || job.type === 'video') {
        const creditCharge = await settleJobCredits({
          userId: job.user_id,
          type: job.type,
          payload: job.payload || {},
          result,
        });
        creditChargeResult = creditCharge;
      }
      if (!await isJobStillRunning(job.id)) {
        if (creditChargeResult) {
          try {
            await refundSettledGenerationCredits({
              userId: job.user_id,
              charge: creditChargeResult,
              reason: '生成任务已取消，自动退回积分',
            });
          } catch (refundError) {
            console.error('[generation-worker] credit refund failed after cancellation:', refundError);
          }
        }
        console.info('[generation-worker] skip cancelled job persistence:', job.id);
        return true;
      }
      const finalResult = creditChargeResult
        ? {
            ...result,
            creditsCost: creditChargeResult.creditsCost,
            creditsBalance: creditChargeResult.balanceAfter,
            creditDescription: creditChargeResult.description,
          }
        : result;
      await updateJob(job.id, {
        status: 'succeeded',
        result: finalResult,
        error: null,
        creditsCost: creditChargeResult?.creditsCost || 0,
        resultCount: countModelCallResults(job.type, finalResult),
        metadata: {
          creditsBalance: creditChargeResult?.balanceAfter,
          creditDescription: creditChargeResult?.description,
        },
      });
      try {
        await persistGenerationHistoryRecord({
          jobId: job.id,
          userId: job.user_id,
          type: job.type,
          payload: job.payload || {},
          result: finalResult,
        });
      } catch (historyError) {
        const message = historyError instanceof Error ? historyError.message : 'creation history persistence failed';
        console.error('[generation-worker] creation history persistence failed:', message);
        await appendJobProgress(job.id, {
          historyPersistenceStatus: 'failed',
          historyPersistenceError: message,
        });
        void writePlatformLog({
          type: 'generation',
          level: 'error',
          action: 'generation_history_persistence_failed',
          message,
          userId: job.user_id,
          targetType: 'generation_job',
          targetId: job.id,
          metadata: { type: job.type },
        });
      }
      void writePlatformLog({
        type: 'generation',
        level: 'info',
        action: 'generation_job_succeeded',
        message: `生成任务执行成功`,
        userId: job.user_id,
        targetType: 'generation_job',
        targetId: job.id,
        metadata: { type: job.type },
      });
    } catch (err) {
      if (!await isJobStillRunning(job.id)) {
        console.info('[generation-worker] skip cancelled job failure update:', job.id);
        return true;
      }
      let creditRefunded = false;
      if (creditChargeResult) {
        try {
          const refund = await refundSettledGenerationCredits({
            userId: job.user_id,
            charge: creditChargeResult,
            reason: '生成历史写入失败，自动退回积分',
          });
          if (refund) {
            creditChargeResult = {
              ...creditChargeResult,
              balanceAfter: refund.balanceAfter,
            };
            creditRefunded = true;
          }
        } catch (refundError) {
          console.error('[generation-worker] credit refund failed after job failure:', refundError);
        }
      }
      await updateJob(job.id, {
        status: 'failed',
        error: err instanceof Error ? err.message : 'Generation job failed',
        resultCount: 0,
        creditsCost: creditRefunded ? 0 : null,
        metadata: {
          failedAt: new Date().toISOString(),
          refundedCredits: creditRefunded ? creditChargeResult?.creditsCost || 0 : 0,
          creditsBalance: creditChargeResult?.balanceAfter,
        },
      });
      void writePlatformLog({
        type: 'generation',
        level: 'error',
        action: 'generation_job_failed',
        message: '生成任务执行失败',
        userId: job.user_id,
        targetType: 'generation_job',
        targetId: job.id,
        metadata: {
          type: job.type,
          error: err instanceof Error ? err.message : 'Generation job failed',
        },
      });
    }

    return true;
  } catch (err) {
    console.error('[generation-worker] processing failed:', err);
    return false;
  } finally {
    processing = false;
  }
}

export function startGenerationJobWorker() {
  if (process.env.GENERATION_WORKER_DISABLED === '1') return;

  const state = globalThis as typeof globalThis & {
    __miaojingGenerationWorkerStarted?: boolean;
  };
  if (state.__miaojingGenerationWorkerStarted) return;
  state.__miaojingGenerationWorkerStarted = true;

  const tick = () => {
    void processNextGenerationJob();
  };
  const timer = setInterval(tick, POLL_INTERVAL_MS);
  timer.unref?.();

  const startupTimer = setTimeout(tick, 1000);
  startupTimer.unref?.();

  console.log(
    `[generation-worker] started interval=${POLL_INTERVAL_MS}ms timeout=${STALE_RUNNING_MINUTES}m`,
  );
}
