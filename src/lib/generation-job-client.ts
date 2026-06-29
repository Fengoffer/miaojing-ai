import {
  getClientAuthHeaders,
  getClientAuthToken,
  getClientAuthUserId,
  getRequiredClientAuthToken,
  handleClientAuthFailure,
} from '@/lib/client-auth';

export type GenerationJobType = 'image' | 'video' | 'reverse-prompt';

export type GenerationJobStatus = {
  id?: string;
  jobId?: string;
  type?: GenerationJobType;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  result?: Record<string, unknown>;
  error?: string | null;
  payload?: Record<string, unknown>;
  estimateSeconds?: number;
  elapsed_seconds?: number;
  progress?: Record<string, unknown>;
  eta?: {
    estimateSeconds?: number;
    source?: string;
    sampleCount?: number;
    windowDays?: number | null;
  };
  created_at?: string;
  started_at?: string | null;
  finished_at?: string | null;
  updated_at?: string;
};

type GenerationJobOptions = {
  timeoutMs?: number;
  intervalMs?: number;
  onStatus?: (status: GenerationJobStatus) => void;
};

type PollGenerationJobOptions = GenerationJobOptions & {
  jobId: string;
  type?: GenerationJobType;
  clientRequestId?: string;
};

type PendingGenerationJob = {
  jobId: string;
  type: GenerationJobType;
  createdAt: number;
  clientRequestId?: string;
};

const ACTIVE_JOBS_REQUEST_TTL_MS = 1200;
const GENERATION_JOB_STATUS_REQUEST_TIMEOUT_MS = 15_000;
const GENERATION_JOB_STATUS_REQUEST_ATTEMPTS = 3;
const PENDING_GENERATION_JOBS_STORAGE_PREFIX = 'miaojing:generation-jobs:pending:';
const PENDING_GENERATION_JOBS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const activeJobsRequestCache = new Map<string, {
  expiresAt: number;
  promise: Promise<GenerationJobStatus[]>;
}>();

export class GenerationJobStillRunningError extends Error {
  status: GenerationJobStatus | null;

  constructor(status: GenerationJobStatus | null) {
    super('生成任务仍在执行，请稍后在创作历史中查看');
    this.name = 'GenerationJobStillRunningError';
    this.status = status;
  }
}

export class GenerationJobCancelledError extends Error {
  status: GenerationJobStatus | null;

  constructor(status: GenerationJobStatus | null) {
    super('任务已取消');
    this.name = 'GenerationJobCancelledError';
    this.status = status;
  }
}

class GenerationJobStatusRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GenerationJobStatusRetryableError';
  }
}

function isRetryableGenerationJobStatusHttpStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function isRetryableGenerationJobStatusError(error: unknown): boolean {
  if (error instanceof GenerationJobStatusRetryableError) return true;
  if (isAbortError(error)) return true;
  const message = error instanceof Error ? error.message : String(error || '');
  return /任务查询暂时不可用|任务查询超时|Upstream service unavailable|HTTP 50[234]|fetch failed|network|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket|aborted/i.test(message);
}

function normalizeGenerationJobTypes(types?: GenerationJobType[]): GenerationJobType[] {
  return Array.from(new Set((types || []).filter(Boolean))).sort();
}

function isGenerationJobType(value: unknown): value is GenerationJobType {
  return value === 'image' || value === 'video' || value === 'reverse-prompt';
}

function isTerminalGenerationJobStatus(status: GenerationJobStatus['status']): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled';
}

function getGenerationJobStatusClientRequestId(status: GenerationJobStatus): string {
  const payloadValue = status.payload?.clientRequestId;
  if (typeof payloadValue === 'string' && payloadValue.trim()) return payloadValue.trim();
  const progressValue = status.progress?.clientRequestId;
  if (typeof progressValue === 'string' && progressValue.trim()) return progressValue.trim();
  return '';
}

function hashAuthToken(authToken: string): string {
  let hash = 2166136261;
  for (let index = 0; index < authToken.length; index += 1) {
    hash ^= authToken.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function getActiveJobsRequestKey(types: GenerationJobType[], authToken: string): string {
  return `${hashAuthToken(authToken)}:${types.join(',') || 'all'}`;
}

function getAuthStorageIdentity(authToken = getClientAuthToken()): string | null {
  if (typeof window === 'undefined') return null;
  const userId = getClientAuthUserId();
  if (userId) return userId;
  return authToken ? hashAuthToken(authToken) : null;
}

function getPendingGenerationJobsStorageKey(authToken = getClientAuthToken()): string | null {
  const identity = getAuthStorageIdentity(authToken);
  return identity ? `${PENDING_GENERATION_JOBS_STORAGE_PREFIX}${identity}` : null;
}

function normalizePendingGenerationJobs(value: unknown): PendingGenerationJob[] {
  if (!Array.isArray(value)) return [];
  const cutoff = Date.now() - PENDING_GENERATION_JOBS_MAX_AGE_MS;
  const seen = new Set<string>();
  const jobs: PendingGenerationJob[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Partial<PendingGenerationJob>;
    const jobId = typeof record.jobId === 'string' ? record.jobId.trim() : '';
    if (!jobId || seen.has(jobId) || !isGenerationJobType(record.type)) continue;
    const createdAt = Number(record.createdAt);
    if (!Number.isFinite(createdAt) || createdAt < cutoff) continue;
    seen.add(jobId);
    jobs.push({
      jobId,
      type: record.type,
      createdAt,
      clientRequestId: typeof record.clientRequestId === 'string' && record.clientRequestId.trim()
        ? record.clientRequestId.trim()
        : undefined,
    });
  }
  return jobs.sort((a, b) => b.createdAt - a.createdAt).slice(0, 100);
}

function readPendingGenerationJobs(authToken = getClientAuthToken()): PendingGenerationJob[] {
  if (typeof window === 'undefined') return [];
  const key = getPendingGenerationJobsStorageKey(authToken);
  if (!key) return [];
  try {
    return normalizePendingGenerationJobs(JSON.parse(window.localStorage.getItem(key) || '[]'));
  } catch {
    return [];
  }
}

function writePendingGenerationJobs(jobs: PendingGenerationJob[], authToken = getClientAuthToken()) {
  if (typeof window === 'undefined') return;
  const key = getPendingGenerationJobsStorageKey(authToken);
  if (!key) return;
  const normalized = normalizePendingGenerationJobs(jobs);
  try {
    if (normalized.length === 0) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, JSON.stringify(normalized));
    }
  } catch {
    // localStorage quota failures should not block generation.
  }
}

export function rememberPendingGenerationJob(
  type: GenerationJobType,
  jobId: string,
  payload?: Record<string, unknown>,
) {
  const id = jobId.trim();
  if (!id) return;
  const authToken = getClientAuthToken();
  if (!authToken) return;
  const existing = readPendingGenerationJobs(authToken).filter(job => job.jobId !== id);
  const clientRequestId = typeof payload?.clientRequestId === 'string' && payload.clientRequestId.trim()
    ? payload.clientRequestId.trim()
    : undefined;
  writePendingGenerationJobs([
    {
      jobId: id,
      type,
      createdAt: Date.now(),
      clientRequestId,
    },
    ...existing,
  ], authToken);
}

export function forgetPendingGenerationJob(jobId: string) {
  const id = jobId.trim();
  if (!id) return;
  const authToken = getClientAuthToken();
  if (!authToken) return;
  const next = readPendingGenerationJobs(authToken).filter(job => job.jobId !== id);
  writePendingGenerationJobs(next, authToken);
}

function sleep(ms: number) {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

export async function runGenerationFinalCountdown(
  onTick: (seconds: number | null) => void,
  seconds = 3,
) {
  for (let remaining = seconds; remaining > 0; remaining -= 1) {
    onTick(remaining);
    await sleep(1000);
  }
  onTick(0);
}

async function pollGenerationJob<T extends Record<string, unknown>>(
  options: PollGenerationJobOptions,
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 900_000;
  const intervalMs = options.intervalMs ?? 2_000;
  const startedAt = Date.now();
  let lastStatus: GenerationJobStatus | null = null;

  while (Date.now() - startedAt < timeoutMs) {
    await sleep(intervalMs);

    let statusData: GenerationJobStatus;
    try {
      statusData = await fetchGenerationJobStatus(options.jobId);
      if (!isTerminalGenerationJobStatus(statusData.status) && options.clientRequestId) {
        const clientRequestStatus = await fetchGenerationJobByClientRequestId(
          options.clientRequestId,
          options.type ? [options.type] : undefined,
        );
        if (clientRequestStatus && isTerminalGenerationJobStatus(clientRequestStatus.status)) {
          statusData = clientRequestStatus;
        }
      }
    } catch (error) {
      if (isRetryableGenerationJobStatusError(error)) {
        continue;
      }
      throw error;
    }
    options.onStatus?.(statusData as GenerationJobStatus);
    lastStatus = statusData as GenerationJobStatus;

    if (statusData.status === 'succeeded') {
      forgetPendingGenerationJob(options.jobId);
      return (statusData.result || {}) as T;
    }
    if (statusData.status === 'failed') {
      forgetPendingGenerationJob(options.jobId);
      throw new Error(statusData.error || '生成任务失败');
    }
    if (statusData.status === 'cancelled') {
      forgetPendingGenerationJob(options.jobId);
      throw new GenerationJobCancelledError(statusData as GenerationJobStatus);
    }
  }

  throw new GenerationJobStillRunningError(lastStatus);
}

export async function continueGenerationJob<T extends Record<string, unknown>>(
  jobId: string,
  options: GenerationJobOptions = {},
): Promise<T> {
  return pollGenerationJob<T>({ ...options, jobId });
}

export async function continueGenerationJobUntilSettled<T extends Record<string, unknown>>(
  jobId: string,
  options: GenerationJobOptions & { retryDelayMs?: number } = {},
): Promise<T> {
  const retryDelayMs = options.retryDelayMs ?? 3000;
  while (true) {
    try {
      return await continueGenerationJob<T>(jobId, options);
    } catch (error) {
      if (error instanceof GenerationJobStillRunningError) {
        await sleep(retryDelayMs);
        continue;
      }
      throw error;
    }
  }
}

export async function fetchGenerationJobStatus(
  jobId: string,
  authToken = getClientAuthToken(),
): Promise<GenerationJobStatus> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= GENERATION_JOB_STATUS_REQUEST_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), GENERATION_JOB_STATUS_REQUEST_TIMEOUT_MS);
    try {
      const params = new URLSearchParams();
      params.set('_t', String(Date.now()));
      const res = await fetch(`/api/generation-jobs/${encodeURIComponent(jobId)}?${params.toString()}`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache',
          ...getClientAuthHeaders(authToken),
        },
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) return data as GenerationJobStatus;
      handleClientAuthFailure(res.status, data.error);
      const message = data.error || `任务查询失败 (${res.status})`;
      if (isRetryableGenerationJobStatusHttpStatus(res.status)) {
        throw new GenerationJobStatusRetryableError(message);
      }
      throw new Error(message);
    } catch (error) {
      lastError = error;
      if (!isRetryableGenerationJobStatusError(error) || attempt >= GENERATION_JOB_STATUS_REQUEST_ATTEMPTS) {
        if (isAbortError(error)) throw new GenerationJobStatusRetryableError('任务查询超时，请稍后重试');
        throw error;
      }
      await sleep(600 * attempt);
    } finally {
      window.clearTimeout(timeoutId);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('任务查询暂时不可用，请稍后重试');
}

export async function fetchActiveGenerationJobs(types?: GenerationJobType[]): Promise<GenerationJobStatus[]> {
  const authToken = getClientAuthToken();
  if (!authToken) return [];
  const normalizedTypes = normalizeGenerationJobTypes(types);
  const cacheKey = getActiveJobsRequestKey(normalizedTypes, authToken);
  const now = Date.now();
  const cached = activeJobsRequestCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.promise;
  }

  const params = new URLSearchParams();
  params.set('status', 'queued,running');
  if (normalizedTypes.length > 0) params.set('type', normalizedTypes.join(','));
  params.set('_t', String(Date.now()));
  const promise = (async () => {
    const res = await fetch(`/api/generation-jobs?${params.toString()}`, {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache',
        ...getClientAuthHeaders(authToken),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `任务列表查询失败 (${res.status})`);
    }
    return Array.isArray(data.jobs) ? data.jobs as GenerationJobStatus[] : [];
  })();
  activeJobsRequestCache.set(cacheKey, {
    expiresAt: now + ACTIVE_JOBS_REQUEST_TTL_MS,
    promise,
  });
  promise.catch(() => {
    const current = activeJobsRequestCache.get(cacheKey);
    if (current?.promise === promise) activeJobsRequestCache.delete(cacheKey);
  });
  return promise;
}

export async function fetchGenerationJobByClientRequestId(
  clientRequestId: string,
  types?: GenerationJobType[],
  authToken = getClientAuthToken(),
): Promise<GenerationJobStatus | null> {
  const normalizedClientRequestId = clientRequestId.trim();
  if (!authToken || !normalizedClientRequestId) return null;
  const normalizedTypes = normalizeGenerationJobTypes(types);
  const params = new URLSearchParams();
  params.set('clientRequestId', normalizedClientRequestId);
  params.set('status', 'queued,running,succeeded,failed,cancelled');
  params.set('limit', '1');
  if (normalizedTypes.length > 0) params.set('type', normalizedTypes.join(','));
  params.set('_t', String(Date.now()));
  const res = await fetch(`/api/generation-jobs?${params.toString()}`, {
    cache: 'no-store',
    headers: {
      'Cache-Control': 'no-cache',
      ...getClientAuthHeaders(authToken),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    handleClientAuthFailure(res.status, data.error);
    throw new Error(data.error || `任务查询失败 (${res.status})`);
  }
  const jobs = Array.isArray(data.jobs) ? data.jobs as GenerationJobStatus[] : [];
  return jobs[0] || null;
}

export async function fetchRecoverableGenerationJobs(types?: GenerationJobType[]): Promise<GenerationJobStatus[]> {
  const authToken = getClientAuthToken();
  if (!authToken) return [];
  const normalizedTypes = normalizeGenerationJobTypes(types);
  const allowedTypes = normalizedTypes.length > 0 ? new Set<GenerationJobType>(normalizedTypes) : null;
  const activeJobs = await fetchActiveGenerationJobs(types);
  const jobsById = new Map<string, GenerationJobStatus>();
  for (const job of activeJobs) {
    const jobId = String(job.jobId || job.id || '');
    if (jobId) jobsById.set(jobId, job);
  }

  const pendingJobs = readPendingGenerationJobs(authToken)
    .filter(job => !allowedTypes || allowedTypes.has(job.type));
  await Promise.all(pendingJobs.map(async pending => {
    if (jobsById.has(pending.jobId)) return;
    try {
      let status = await fetchGenerationJobStatus(pending.jobId, authToken);
      if (!isTerminalGenerationJobStatus(status.status) && pending.clientRequestId) {
        const clientRequestStatus = await fetchGenerationJobByClientRequestId(
          pending.clientRequestId,
          [pending.type],
          authToken,
        );
        if (clientRequestStatus && isTerminalGenerationJobStatus(clientRequestStatus.status)) {
          status = clientRequestStatus;
        }
      }
      const statusType = isGenerationJobType(status.type) ? status.type : pending.type;
      if (allowedTypes && !allowedTypes.has(statusType)) return;
      const clientRequestId = pending.clientRequestId || getGenerationJobStatusClientRequestId(status);
      jobsById.set(pending.jobId, {
        ...status,
        type: statusType,
        jobId: status.jobId || status.id || pending.jobId,
        payload: {
          ...(status.payload || {}),
          ...(clientRequestId ? { clientRequestId } : {}),
        },
      });
    } catch (error) {
      if (error instanceof Error && /任务不存在|404/.test(error.message)) {
        forgetPendingGenerationJob(pending.jobId);
      }
    }
  }));

  return Array.from(jobsById.values()).sort((a, b) => {
    const aTime = Date.parse(a.created_at || a.updated_at || '') || 0;
    const bTime = Date.parse(b.created_at || b.updated_at || '') || 0;
    return bTime - aTime;
  });
}

export async function cancelGenerationJob(jobId: string): Promise<GenerationJobStatus> {
  const authToken = getRequiredClientAuthToken();
  const authHeaders = getClientAuthHeaders(authToken);
  const res = await fetch(`/api/generation-jobs/${encodeURIComponent(jobId)}`, {
    method: 'PATCH',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      ...authHeaders,
    },
    body: JSON.stringify({ action: 'cancel' }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    handleClientAuthFailure(res.status, data.error);
    throw new Error(data.error || `取消任务失败 (${res.status})`);
  }
  forgetPendingGenerationJob(jobId);
  return data as GenerationJobStatus;
}

export async function runGenerationJob<T extends Record<string, unknown>>(
  type: GenerationJobType,
  payload: Record<string, unknown>,
  options: GenerationJobOptions = {},
): Promise<T> {
  const authToken = getRequiredClientAuthToken();
  const authHeaders = getClientAuthHeaders(authToken);
  const createRes = await fetch('/api/generation-jobs', {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      ...authHeaders,
    },
    body: JSON.stringify({ type, payload }),
  });

  const createData = await createRes.json().catch(() => ({}));
  if (!createRes.ok || !createData.jobId) {
    handleClientAuthFailure(createRes.status, createData.error);
    throw new Error(createData.error || `任务创建失败 (${createRes.status})`);
  }
  rememberPendingGenerationJob(type, createData.jobId, payload);
  options.onStatus?.({
    ...createData,
    status: 'queued',
  } as GenerationJobStatus);

  return pollGenerationJob<T>({
    ...options,
    timeoutMs: options.timeoutMs ?? (type === 'video' ? 600_000 : 900_000),
    jobId: createData.jobId,
    type,
    clientRequestId: typeof payload.clientRequestId === 'string' ? payload.clientRequestId.trim() : undefined,
  });
}
