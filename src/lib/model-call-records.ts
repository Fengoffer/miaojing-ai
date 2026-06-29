import type { PoolClient } from 'pg';
import { getDbClient } from '@/storage/database/local-db';

type ModelCallStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

type ModelCallType = 'image' | 'video' | 'text' | 'reverse-prompt';

export interface ModelCallRecordInput {
  userId?: string | null;
  source: string;
  operation: string;
  generationJobId?: string | null;
  type: ModelCallType;
  provider?: string | null;
  modelName?: string | null;
  apiUrl?: string | null;
  systemApiId?: string | null;
  customApiKeyId?: string | null;
  status?: ModelCallStatus;
  creditsCost?: number | null;
  resultCount?: number | null;
  metadata?: Record<string, unknown>;
}

export interface ModelCallRecordUpdate {
  status?: ModelCallStatus;
  creditsCost?: number | null;
  resultCount?: number | null;
  error?: string | null;
  metadata?: Record<string, unknown>;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let schemaReady = false;
let schemaWarned = false;

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

function nullableUuid(value: unknown): string | null {
  return isUuid(value) ? value : null;
}

function safeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePositiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.max(0, Math.floor(parsed));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function isTerminalStatus(status: ModelCallStatus | undefined): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled';
}

export async function ensureModelCallRecordSchema(client: PoolClient): Promise<void> {
  if (schemaReady) return;
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS model_call_records (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID,
        source VARCHAR(64) NOT NULL DEFAULT '',
        operation VARCHAR(64) NOT NULL DEFAULT '',
        generation_job_id UUID REFERENCES generation_jobs(id) ON DELETE SET NULL,
        type VARCHAR(32) NOT NULL DEFAULT 'text',
        provider VARCHAR(128) NOT NULL DEFAULT '',
        model_name VARCHAR(255) NOT NULL DEFAULT '',
        api_url TEXT NOT NULL DEFAULT '',
        system_api_id UUID,
        custom_api_key_id UUID,
        status VARCHAR(16) NOT NULL DEFAULT 'queued',
        credits_cost INTEGER NOT NULL DEFAULT 0,
        result_count INTEGER NOT NULL DEFAULT 0,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        started_at TIMESTAMPTZ,
        finished_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE model_call_records
        ADD COLUMN IF NOT EXISTS user_id UUID,
        ADD COLUMN IF NOT EXISTS source VARCHAR(64) NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS operation VARCHAR(64) NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS generation_job_id UUID,
        ADD COLUMN IF NOT EXISTS type VARCHAR(32) NOT NULL DEFAULT 'text',
        ADD COLUMN IF NOT EXISTS provider VARCHAR(128) NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS model_name VARCHAR(255) NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS api_url TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS system_api_id UUID,
        ADD COLUMN IF NOT EXISTS custom_api_key_id UUID,
        ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'queued',
        ADD COLUMN IF NOT EXISTS credits_cost INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS result_count INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS duration_ms INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS error TEXT,
        ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
      CREATE UNIQUE INDEX IF NOT EXISTS model_call_records_generation_job_uidx
        ON model_call_records (generation_job_id)
        WHERE generation_job_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS model_call_records_created_idx ON model_call_records (created_at DESC);
      CREATE INDEX IF NOT EXISTS model_call_records_user_created_idx ON model_call_records (user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS model_call_records_status_created_idx ON model_call_records (status, created_at DESC);
      CREATE INDEX IF NOT EXISTS model_call_records_model_created_idx ON model_call_records (type, provider, model_name, created_at DESC);
      CREATE INDEX IF NOT EXISTS model_call_records_source_created_idx ON model_call_records (source, created_at DESC);
      CREATE INDEX IF NOT EXISTS model_call_records_system_api_idx ON model_call_records (system_api_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS model_call_records_custom_api_idx ON model_call_records (custom_api_key_id, created_at DESC);
    `);
    schemaReady = true;
  } catch (error) {
    if (error && typeof error === 'object' && (error as { code?: string }).code === '42501') {
      if (!schemaWarned) {
        console.warn('[model-call-records] skipped optional schema check because the database user is not the table owner');
        schemaWarned = true;
      }
      schemaReady = true;
      return;
    }
    throw error;
  }
}

export function getModelCallConfigRefs(payload: Record<string, unknown>): {
  systemApiId: string | null;
  customApiKeyId: string | null;
} {
  const config = asRecord(payload.customApiConfig);
  return {
    systemApiId: nullableUuid(config.systemApiId || payload.systemApiId),
    customApiKeyId: nullableUuid(config.customApiKeyId || payload.customApiKeyId),
  };
}

export function inferGenerationModelCallOperation(type: string, payload: Record<string, unknown>): string {
  if (type === 'reverse-prompt') return 'reverse-prompt';
  const hasReference = Boolean(
    safeString(payload.image)
    || (Array.isArray(payload.images) && payload.images.length > 0)
    || (Array.isArray(payload.extraImages) && payload.extraImages.length > 0),
  );
  if (type === 'image') return hasReference ? 'img2img' : 'text2img';
  if (type === 'video') return hasReference ? 'img2video' : 'text2video';
  return safeString(type) || 'generation';
}

export function buildModelCallMetadataFromPayload(
  type: string,
  payload: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const referenceCount = [
    safeString(payload.image),
    ...(Array.isArray(payload.images) ? payload.images.map(safeString) : []),
    ...(Array.isArray(payload.extraImages) ? payload.extraImages.map(safeString) : []),
  ].filter(Boolean).length;
  const metadata: Record<string, unknown> = {
    ...extra,
    requestedType: type,
    operation: inferGenerationModelCallOperation(type, payload),
    requestedCount: normalizePositiveInteger(payload.count),
    duration: normalizePositiveInteger(payload.duration),
    ratio: safeString(payload.ratio) || safeString(payload.aspectRatio) || undefined,
    resolution: safeString(payload.resolution) || safeString(payload.size) || undefined,
    outputFormat: safeString(payload.outputFormat) || safeString(payload.output_format) || undefined,
    quality: safeString(payload.quality) || undefined,
    styleLabel: safeString(payload.styleLabel) || undefined,
    hasReferenceImage: referenceCount > 0,
    referenceImageCount: referenceCount,
  };
  return Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== undefined && value !== null && value !== ''));
}

export function countModelCallResults(type: string, result: Record<string, unknown> | undefined): number {
  if (!result) return 0;
  if (type === 'image' && Array.isArray(result.images)) return result.images.length;
  if (type === 'video' && Array.isArray(result.videos)) return result.videos.length;
  if (type === 'reverse-prompt') {
    return safeString(result.generalPrompt) || safeString(result.structuredPrompt) ? 1 : 0;
  }
  if (type === 'text') return 1;
  return 0;
}

export async function createModelCallRecord(
  client: PoolClient,
  input: ModelCallRecordInput,
): Promise<string | null> {
  await ensureModelCallRecordSchema(client);
  const generationJobId = nullableUuid(input.generationJobId);
  if (generationJobId) {
    const existing = await client.query(
      'SELECT id FROM model_call_records WHERE generation_job_id = $1 LIMIT 1',
      [generationJobId],
    );
    if (existing.rows[0]?.id) return String(existing.rows[0].id);
  }

  const result = await client.query(
    `INSERT INTO model_call_records (
       user_id, source, operation, generation_job_id, type, provider, model_name, api_url,
       system_api_id, custom_api_key_id, status, credits_cost, result_count, metadata,
       started_at
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8,
       $9, $10, $11::varchar(16), $12, $13, $14::jsonb,
       CASE WHEN $11::varchar(16) = 'running' THEN NOW() ELSE NULL END
     )
     ON CONFLICT (generation_job_id) WHERE generation_job_id IS NOT NULL
     DO UPDATE SET
       updated_at = model_call_records.updated_at
     RETURNING id`,
    [
      nullableUuid(input.userId),
      safeString(input.source),
      safeString(input.operation),
      generationJobId,
      input.type,
      safeString(input.provider),
      safeString(input.modelName),
      safeString(input.apiUrl),
      nullableUuid(input.systemApiId),
      nullableUuid(input.customApiKeyId),
      input.status || 'queued',
      normalizePositiveInteger(input.creditsCost) || 0,
      normalizePositiveInteger(input.resultCount) || 0,
      JSON.stringify(input.metadata || {}),
    ],
  );
  return result.rows[0]?.id ? String(result.rows[0].id) : null;
}

export async function createModelCallRecordStandalone(input: ModelCallRecordInput): Promise<string | null> {
  const client = await getDbClient();
  try {
    return await createModelCallRecord(client, input);
  } finally {
    client.release();
  }
}

export async function updateModelCallRecordByJob(
  client: PoolClient,
  generationJobId: string,
  update: ModelCallRecordUpdate,
): Promise<number> {
  if (!isUuid(generationJobId)) return 0;
  await ensureModelCallRecordSchema(client);
  const terminal = isTerminalStatus(update.status);
  const result = await client.query(
    `UPDATE model_call_records
     SET status = COALESCE($2, status),
         credits_cost = CASE WHEN $3::int IS NULL THEN credits_cost ELSE $3::int END,
         result_count = CASE WHEN $4::int IS NULL THEN result_count ELSE $4::int END,
         error = CASE WHEN $5::boolean THEN $6 ELSE error END,
         metadata = COALESCE(metadata, '{}'::jsonb) || COALESCE($7::jsonb, '{}'::jsonb),
         started_at = CASE
           WHEN $8::boolean THEN COALESCE(started_at, NOW())
           ELSE started_at
         END,
         finished_at = CASE
           WHEN $9::boolean THEN COALESCE(finished_at, NOW())
           ELSE finished_at
         END,
         duration_ms = CASE
           WHEN $9::boolean
           THEN GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - COALESCE(started_at, created_at))) * 1000))::int
           ELSE duration_ms
         END,
         updated_at = NOW()
     WHERE generation_job_id = $1`,
    [
      generationJobId,
      update.status || null,
      normalizePositiveInteger(update.creditsCost),
      normalizePositiveInteger(update.resultCount),
      Object.prototype.hasOwnProperty.call(update, 'error'),
      update.error ?? null,
      JSON.stringify(update.metadata || {}),
      update.status === 'running',
      terminal,
    ],
  );
  return result.rowCount || 0;
}

export async function updateModelCallRecordById(
  recordId: string | null | undefined,
  update: ModelCallRecordUpdate,
): Promise<number> {
  if (!isUuid(recordId)) return 0;
  const client = await getDbClient();
  try {
    await ensureModelCallRecordSchema(client);
    const terminal = isTerminalStatus(update.status);
    const result = await client.query(
      `UPDATE model_call_records
       SET status = COALESCE($2, status),
           credits_cost = CASE WHEN $3::int IS NULL THEN credits_cost ELSE $3::int END,
           result_count = CASE WHEN $4::int IS NULL THEN result_count ELSE $4::int END,
           error = CASE WHEN $5::boolean THEN $6 ELSE error END,
           metadata = COALESCE(metadata, '{}'::jsonb) || COALESCE($7::jsonb, '{}'::jsonb),
           started_at = CASE
             WHEN $8::boolean THEN COALESCE(started_at, NOW())
             ELSE started_at
           END,
           finished_at = CASE
             WHEN $9::boolean THEN COALESCE(finished_at, NOW())
             ELSE finished_at
           END,
           duration_ms = CASE
             WHEN $9::boolean
             THEN GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - COALESCE(started_at, created_at))) * 1000))::int
             ELSE duration_ms
           END,
           updated_at = NOW()
       WHERE id = $1`,
      [
        recordId,
        update.status || null,
        normalizePositiveInteger(update.creditsCost),
        normalizePositiveInteger(update.resultCount),
        Object.prototype.hasOwnProperty.call(update, 'error'),
        update.error ?? null,
        JSON.stringify(update.metadata || {}),
        update.status === 'running',
        terminal,
      ],
    );
    return result.rowCount || 0;
  } finally {
    client.release();
  }
}

export async function markModelCallRecordsForJobs(
  client: PoolClient,
  generationJobIds: string[],
  update: Required<Pick<ModelCallRecordUpdate, 'status' | 'error'>> & Partial<ModelCallRecordUpdate>,
): Promise<number> {
  const ids = generationJobIds.filter(isUuid);
  if (ids.length === 0) return 0;
  await ensureModelCallRecordSchema(client);
  const terminal = isTerminalStatus(update.status);
  const result = await client.query(
    `UPDATE model_call_records
     SET status = $2,
         error = $3,
         metadata = COALESCE(metadata, '{}'::jsonb) || COALESCE($4::jsonb, '{}'::jsonb),
         finished_at = CASE
           WHEN $5::boolean THEN COALESCE(finished_at, NOW())
           ELSE finished_at
         END,
         duration_ms = CASE
           WHEN $5::boolean
           THEN GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - COALESCE(started_at, created_at))) * 1000))::int
           ELSE duration_ms
         END,
         updated_at = NOW()
     WHERE generation_job_id = ANY($1::uuid[])`,
    [
      ids,
      update.status,
      update.error,
      JSON.stringify(update.metadata || {}),
      terminal,
    ],
  );
  return result.rowCount || 0;
}
