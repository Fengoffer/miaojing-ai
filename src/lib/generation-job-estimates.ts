import type { PoolClient } from 'pg';
import type { GenerationJobType } from '@/lib/generation-job-runner';
import { ensureSystemApiSchema, isUuid } from '@/lib/server-api-config';

export type GenerationEtaSource = 'history' | 'default';

export interface GenerationJobIdentity {
  provider: string;
  modelName: string;
  apiUrl: string;
}

export interface GenerationJobEstimate {
  estimateSeconds: number;
  source: GenerationEtaSource;
  sampleCount: number;
  windowDays: number | null;
}

const DEFAULT_ESTIMATES: Record<GenerationJobType, number> = {
  image: 90,
  video: 300,
  'reverse-prompt': 60,
};

const ESTIMATE_LIMITS: Record<GenerationJobType, { min: number; max: number }> = {
  image: { min: 20, max: 900 },
  video: { min: 60, max: 1800 },
  'reverse-prompt': { min: 10, max: 300 },
};

const REVERSE_PROMPT_SYSTEM_MODEL = 'gpt-5.5';

let generationJobSchemaReady = false;
let generationJobSchemaWarned = false;

function safeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function clampEstimate(type: GenerationJobType, seconds: number): number {
  const limits = ESTIMATE_LIMITS[type];
  const fallback = DEFAULT_ESTIMATES[type];
  if (!Number.isFinite(seconds) || seconds <= 0) return fallback;
  return Math.min(limits.max, Math.max(limits.min, Math.ceil(seconds)));
}

function getPayloadConfig(payload: Record<string, unknown>) {
  const config = payload.customApiConfig;
  return config && typeof config === 'object' && !Array.isArray(config)
    ? config as Record<string, unknown>
    : {};
}

export async function ensureGenerationJobRuntimeSchema(client: PoolClient): Promise<void> {
  if (generationJobSchemaReady) return;
  try {
    await client.query(`
      ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS user_id UUID;
      ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS provider VARCHAR(128);
      ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS model_name VARCHAR(255);
      ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS api_url TEXT;
      ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS progress JSONB NOT NULL DEFAULT '{}'::jsonb;
      CREATE INDEX IF NOT EXISTS generation_jobs_user_created_idx ON generation_jobs (user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS generation_jobs_provider_model_created_idx ON generation_jobs (type, provider, model_name, created_at DESC);
    `);
    generationJobSchemaReady = true;
  } catch (error) {
    if (error && typeof error === 'object' && (error as { code?: string }).code === '42501') {
      if (!generationJobSchemaWarned) {
        console.warn('[generation-job-schema] skipped optional schema check because the database user is not the table owner');
        generationJobSchemaWarned = true;
      }
      generationJobSchemaReady = true;
      return;
    }
    throw error;
  }
}

export async function resolveGenerationJobIdentity(
  client: PoolClient,
  userId: string,
  type: GenerationJobType,
  payload: Record<string, unknown>,
): Promise<GenerationJobIdentity> {
  const config = getPayloadConfig(payload);
  const fallback: GenerationJobIdentity = {
    provider: safeString(config.provider) || safeString(payload.provider) || '默认供应商',
    modelName: safeString(config.modelName) || safeString(payload.modelName) || safeString(payload.model),
    apiUrl: safeString(config.apiUrl) || safeString(payload.apiUrl),
  };

  if (type === 'reverse-prompt') {
    await ensureSystemApiSchema(client);
    const result = await client.query(
      `SELECT provider, name, api_url, model_name
       FROM system_api_configs
       WHERE LOWER(model_name) = LOWER($1)
         AND type = 'text'
         AND is_default = true
         AND is_active = true
       ORDER BY sort_order ASC, created_at ASC
       LIMIT 1`,
      [REVERSE_PROMPT_SYSTEM_MODEL],
    );
    const row = result.rows[0];
    if (row) {
      return {
        provider: safeString(row.provider) || safeString(row.name) || '系统供应商',
        modelName: safeString(row.model_name) || REVERSE_PROMPT_SYSTEM_MODEL,
        apiUrl: safeString(row.api_url),
      };
    }
    return {
      provider: fallback.provider,
      modelName: REVERSE_PROMPT_SYSTEM_MODEL,
      apiUrl: fallback.apiUrl,
    };
  }

  const customApiKeyId = safeString(config.customApiKeyId);
  if (isUuid(customApiKeyId) && isUuid(userId)) {
    const result = await client.query(
      `SELECT provider, supplier_name, api_url, model_name
       FROM user_api_keys
       WHERE id = $1 AND user_id = $2
       LIMIT 1`,
      [customApiKeyId, userId],
    );
    const row = result.rows[0];
    if (row) {
      return {
        provider: safeString(row.supplier_name) || safeString(row.provider) || fallback.provider || '自定义供应商',
        modelName: safeString(row.model_name) || fallback.modelName,
        apiUrl: safeString(row.api_url) || fallback.apiUrl,
      };
    }
  }

  const systemApiId = safeString(config.systemApiId);
  if (isUuid(systemApiId)) {
    await ensureSystemApiSchema(client);
    const result = await client.query(
      `SELECT provider, name, api_url, model_name
       FROM system_api_configs
       WHERE id = $1
       LIMIT 1`,
      [systemApiId],
    );
    const row = result.rows[0];
    if (row) {
      return {
        provider: safeString(row.provider) || safeString(row.name) || fallback.provider || '系统供应商',
        modelName: safeString(row.model_name) || fallback.modelName,
        apiUrl: safeString(row.api_url) || fallback.apiUrl,
      };
    }
  }

  return fallback;
}

export async function getGenerationJobEstimate(
  client: PoolClient,
  type: GenerationJobType,
  provider: string,
  modelName: string,
): Promise<GenerationJobEstimate> {
  const normalizedProvider = provider.trim();
  const normalizedModel = modelName.trim();
  const windows = [1, 3, 7];

  for (const windowDays of windows) {
    const result = await client.query(
      `SELECT
         AVG(EXTRACT(EPOCH FROM (finished_at - started_at))) AS avg_seconds,
         COUNT(*)::int AS sample_count
       FROM generation_jobs
       WHERE status = 'succeeded'
         AND type = $1
         AND LOWER(COALESCE(provider, '')) = LOWER($2)
         AND LOWER(COALESCE(model_name, '')) = LOWER($3)
         AND started_at IS NOT NULL
         AND finished_at IS NOT NULL
         AND finished_at > started_at
         AND created_at >= NOW() - ($4::int * INTERVAL '1 day')`,
      [type, normalizedProvider, normalizedModel, windowDays],
    );
    const row = result.rows[0];
    const sampleCount = Number(row?.sample_count || 0);
    const avgSeconds = Number(row?.avg_seconds || 0);
    if (sampleCount > 0 && avgSeconds > 0) {
      return {
        estimateSeconds: clampEstimate(type, avgSeconds),
        source: 'history',
        sampleCount,
        windowDays,
      };
    }
  }

  return {
    estimateSeconds: DEFAULT_ESTIMATES[type],
    source: 'default',
    sampleCount: 0,
    windowDays: null,
  };
}

export function buildInitialGenerationProgress(estimate: GenerationJobEstimate) {
  return {
    source: estimate.source,
    estimateSeconds: estimate.estimateSeconds,
    sampleCount: estimate.sampleCount,
    windowDays: estimate.windowDays,
    percent: 0,
    message: estimate.source === 'history'
      ? '已根据同供应商同模型历史耗时估算'
      : '暂无历史样本，使用默认预计耗时',
    updatedAt: new Date().toISOString(),
  };
}

export async function updateGenerationJobProgress(
  jobId: string | null | undefined,
  progress: Record<string, unknown>,
): Promise<void> {
  if (!jobId || !isUuid(jobId)) return;
  const { getDbClient } = await import('@/storage/database/local-db');
  const client = await getDbClient();
  try {
    await ensureGenerationJobRuntimeSchema(client);
    await client.query(
      `UPDATE generation_jobs
       SET progress = COALESCE(progress, '{}'::jsonb) || $2::jsonb,
           updated_at = NOW()
       WHERE id = $1`,
      [
        jobId,
        JSON.stringify({
          ...progress,
          source: 'upstream',
          updatedAt: new Date().toISOString(),
        }),
      ],
    );
  } catch (error) {
    console.error('[generation-progress] update failed:', error);
  } finally {
    client.release();
  }
}
