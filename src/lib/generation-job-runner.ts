import { getInternalGenerationHeaders } from '@/lib/server-api-config';
import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';

export type GenerationJobType = 'image' | 'video' | 'reverse-prompt';

type InternalGenerationResponse = {
  statusCode: number;
  data: Record<string, unknown>;
};

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function getGenerationPayloadTimeoutMs(type: GenerationJobType): number {
  const fallback = type === 'video' ? 25 * 60_000 : type === 'reverse-prompt' ? 5 * 60_000 : 20 * 60_000;
  return parsePositiveInt(process.env.GENERATION_INTERNAL_REQUEST_TIMEOUT_MS, fallback);
}

function requestInternalGenerationJson(
  url: string,
  headers: Record<string, string>,
  payload: Record<string, unknown>,
  timeoutMs: number,
): Promise<InternalGenerationResponse> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const body = JSON.stringify(payload);
    const transport = target.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = transport(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        method: 'POST',
        path: `${target.pathname}${target.search}`,
        headers: {
          ...headers,
          'Content-Length': Buffer.byteLength(body),
        },
      },
      res => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.once('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          try {
            resolve({
              statusCode: res.statusCode || 500,
              data: raw ? JSON.parse(raw) as Record<string, unknown> : {},
            });
          } catch {
            resolve({
              statusCode: res.statusCode || 500,
              data: raw ? { error: raw } : {},
            });
          }
        });
      },
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`内部生成请求超时（${Math.ceil(timeoutMs / 1000)} 秒）`));
    });
    req.once('close', () => {
      req.destroy();
    });
    req.once('error', error => reject(error));
    req.end(body);
  });
}

export async function runGenerationPayload(
  type: GenerationJobType,
  payload: Record<string, unknown>,
  options: { userId?: string | null; jobId?: string | null } = {},
) {
  const port = process.env.PORT || process.env.DEPLOY_RUN_PORT || '5000';
  const baseUrl = process.env.GENERATION_INTERNAL_BASE_URL || `http://127.0.0.1:${port}`;
  const endpoint = type === 'image' ? '/api/generate/image' : type === 'video' ? '/api/generate/video' : '/api/generate/reverse-prompt';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...getInternalGenerationHeaders(),
  };
  if (options.userId) headers['x-miaojing-generation-user-id'] = options.userId;
  if (options.jobId) headers['x-miaojing-generation-job-id'] = options.jobId;

  const url = `${baseUrl}${endpoint}`;
  const timeoutMs = getGenerationPayloadTimeoutMs(type);
  const startedAt = Date.now();
  console.log('[generation-runner] internal request start:', JSON.stringify({
    jobId: options.jobId || null,
    type,
    url,
    timeoutMs,
  }));

  const { statusCode, data } = await requestInternalGenerationJson(
    url,
    headers,
    payload,
    timeoutMs,
  ).catch(error => {
    const message = error instanceof Error ? error.message : String(error || '');
    console.error('[generation-runner] internal request failed:', JSON.stringify({
      jobId: options.jobId || null,
      type,
      url,
      elapsedMs: Date.now() - startedAt,
      message,
    }));
    if (/fetch failed|network|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket|aborted/i.test(message)) {
      throw new Error(`内部生成请求网络连接失败：${message || 'request failed'}`);
    }
    throw error;
  });
  console.log('[generation-runner] internal request finished:', JSON.stringify({
    jobId: options.jobId || null,
    type,
    url,
    statusCode,
    elapsedMs: Date.now() - startedAt,
  }));

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(
      typeof data?.error === 'string'
        ? data.error
        : `Generation request failed (${statusCode})`,
    );
  }

  return data;
}
