/**
 * Shared utility for making custom API requests from the server side.
 *
 * Key fixes for 502 Cloudflare errors:
 * 1. Adds User-Agent header (Node.js fetch omits it by default, triggering WAF blocks)
 * 2. Adds Accept header to look like a normal HTTP client
 * 3. Automatic retry with delay for transient 5xx errors (502/503/504)
 * 4. AbortController timeout for all requests
 */
import { fetchPublicHttpUrl } from '@/lib/remote-fetch';
import { STREAM_UNSUPPORTED_SYNC_CONFIRM_PREFIX } from '@/lib/custom-image-fallback';

type UpstreamProgress = Record<string, unknown> & {
  percent?: number;
  remainingSeconds?: number;
  estimateSeconds?: number;
  message?: string;
};

const STREAM_EVENTS_FIELD = '__streamEvents';
const STREAM_TEXT_FIELD = '__streamText';
export { STREAM_UNSUPPORTED_SYNC_CONFIRM_PREFIX };

export type CustomApiErrorContext = 'image' | 'multimodal';

/**
 * Default headers that mimic a browser-like HTTP client.
 *
 * CRITICAL: Many API proxies (e.g., mozhevip.top) route requests based on User-Agent.
 * Desktop clients like Cherry Studio (Electron/Chromium) send browser-like User-Agent
 * and get routed to working account pools. Custom/unknown User-Agent strings get routed
 * to empty/broken pools, resulting in 503 "No available compatible accounts".
 *
 * Using a Chrome-like User-Agent ensures the proxy routes our requests the same way
 * as Cherry Studio and other desktop clients.
 */
const STANDARD_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'Accept': '*/*',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
};

/** Build request headers, merging standard headers with the Authorization header */
export function buildCustomApiHeaders(apiKey: string): Record<string, string> {
  return {
    ...STANDARD_HEADERS,
    'Authorization': `Bearer ${apiKey}`,
  };
}

/**
 * Fetch with automatic retry for transient server errors (502/503/504).
 * Many Cloudflare/proxy errors are transient and succeed on retry.
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  timeoutMs: number,
  maxRetries: number = 1,
): Promise<Response> {
  const retryableStatuses = new Set([502, 503, 504]);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchPublicHttpUrl(url, {
        ...options,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // If it's a retryable server error and we have retries left, wait and retry
      if (retryableStatuses.has(response.status) && attempt < maxRetries) {
        const errorBody = await response.text().catch(() => '');
        console.warn(
          `[Custom API Retry] Attempt ${attempt + 1} got ${response.status}, retrying in 2s...`,
          errorBody.slice(0, 100),
        );

        // Wait 2 seconds before retrying (don't consume the body yet)
        await new Promise((resolve) => setTimeout(resolve, 2000));
        continue;
      }

      return response;
    } catch (error: unknown) {
      clearTimeout(timeoutId);

      // Don't retry on abort (timeout) - throw immediately
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error;
      }

      // Network errors: retry once if we have retries left
      if (attempt < maxRetries) {
        const msg = error instanceof Error ? error.message : '';
        console.warn(`[Custom API Retry] Attempt ${attempt + 1} network error: ${msg}, retrying in 2s...`);
        await new Promise((resolve) => setTimeout(resolve, 2000));
        continue;
      }

      throw error;
    }
  }

  // Should never reach here, but TypeScript needs it
  throw new Error('Max retries exceeded');
}

function numberFromUnknown(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function extractUpstreamProgress(value: unknown): UpstreamProgress | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  const progressObject = data.progress && typeof data.progress === 'object' && !Array.isArray(data.progress)
    ? data.progress as Record<string, unknown>
    : data;

  const percent = numberFromUnknown(
    progressObject.percent
      ?? progressObject.percentage
      ?? progressObject.progress
      ?? progressObject.progress_percent
      ?? progressObject.progressPercent,
  );
  const remainingSeconds = numberFromUnknown(
    progressObject.remainingSeconds
      ?? progressObject.remaining_seconds
      ?? progressObject.eta
      ?? progressObject.eta_seconds
      ?? progressObject.etaSeconds,
  );
  const estimateSeconds = numberFromUnknown(
    progressObject.estimateSeconds
      ?? progressObject.estimated_seconds
      ?? progressObject.total_seconds
      ?? progressObject.duration,
  );
  const messageValue = progressObject.message ?? progressObject.status ?? progressObject.stage;
  const message = typeof messageValue === 'string' ? messageValue : undefined;

  if (
    percent === undefined
    && remainingSeconds === undefined
    && estimateSeconds === undefined
    && !message
  ) {
    return null;
  }

  return {
    percent,
    remainingSeconds,
    estimateSeconds,
    message,
  };
}

function extractStreamingTextDelta(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const data = value as Record<string, unknown>;
  const chunks: string[] = [];

  if (Array.isArray(data.choices)) {
    for (const choice of data.choices as Array<Record<string, unknown>>) {
      const delta = choice.delta as Record<string, unknown> | undefined;
      const message = choice.message as Record<string, unknown> | undefined;
      const directText = choice.text;
      if (delta) {
        if (typeof delta.content === 'string') chunks.push(delta.content);
        if (typeof delta.text === 'string') chunks.push(delta.text);
      }
      if (message) {
        if (typeof message.content === 'string') chunks.push(message.content);
        if (typeof message.text === 'string') chunks.push(message.text);
      }
      if (typeof directText === 'string') chunks.push(directText);
    }
  }

  if (typeof data.delta === 'string') chunks.push(data.delta);
  if (typeof data.text === 'string') chunks.push(data.text);
  if (typeof data.content === 'string') chunks.push(data.content);
  return chunks.join('');
}

function attachStreamMetadata(value: unknown, streamEvents: unknown[], streamText: string): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return {
      ...(value as Record<string, unknown>),
      [STREAM_EVENTS_FIELD]: streamEvents,
      ...(streamText ? { [STREAM_TEXT_FIELD]: streamText } : {}),
    };
  }

  return {
    result: value,
    [STREAM_EVENTS_FIELD]: streamEvents,
    ...(streamText ? { [STREAM_TEXT_FIELD]: streamText } : {}),
  };
}

/**
 * Parses normal JSON responses and simple streaming/SSE/NDJSON responses.
 * If upstream continuously returns progress chunks, each detected progress
 * chunk is forwarded to the generation job status table for the frontend ETA.
 */
export async function parseCustomApiJsonWithProgress(
  response: Response,
  onProgress?: (progress: UpstreamProgress) => void | Promise<void>,
): Promise<unknown> {
  const contentType = response.headers.get('content-type') || '';
  if (!response.body || !/(text\/event-stream|application\/x-ndjson|text\/plain|stream)/i.test(contentType)) {
    const data = await response.json();
    const progress = extractUpstreamProgress(data);
    if (progress) await onProgress?.(progress);
    return data;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let lastJson: unknown = null;
  const streamEvents: unknown[] = [];
  let streamText = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split(/\r?\n/);
      buffer = done ? '' : lines.pop() || '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line === 'data: [DONE]' || line === '[DONE]') continue;
        if (line.startsWith('event:')) {
          const eventName = line.slice(6).trim();
          const progress = extractUpstreamProgress({ message: `event: ${eventName}` });
          if (progress) await onProgress?.(progress);
          continue;
        }
        const payload = line.startsWith('data:') ? line.slice(5).trim() : line;
        if (!payload || payload === '[DONE]') continue;
        try {
          const parsed = JSON.parse(payload);
          lastJson = parsed;
          streamEvents.push(parsed);
          streamText += extractStreamingTextDelta(parsed);
          const progress = extractUpstreamProgress(parsed);
          if (progress) await onProgress?.(progress);
        } catch {
          const progress = extractUpstreamProgress({ message: payload });
          if (progress) await onProgress?.(progress);
        }
      }

      if (done) break;
    }
  } catch (error) {
    if (!lastJson && !streamText) throw error;
    console.warn('[Custom API Stream] stream ended with read error after receiving data:', error instanceof Error ? error.message : error);
  }

  if (buffer.trim()) {
    try {
      lastJson = JSON.parse(buffer.trim());
      streamEvents.push(lastJson);
      streamText += extractStreamingTextDelta(lastJson);
    } catch {
      // Ignore trailing non-JSON stream fragments.
    }
  }

  if (lastJson) return attachStreamMetadata(lastJson, streamEvents, streamText);
  if (streamText) return attachStreamMetadata({ text: streamText }, streamEvents, streamText);
  throw new Error('上游接口未返回可解析的结果数据');
}

export function parseCustomApiError(status: number, rawBody: string, context: CustomApiErrorContext = 'image'): string {
  const trimmed = rawBody.trim();
  if (trimmed.startsWith(STREAM_UNSUPPORTED_SYNC_CONFIRM_PREFIX)) return trimmed;
  if (
    /stream/i.test(trimmed)
    && /(not support|not supported|unsupported|disable|disabled|invalid|不支持|未开启|关闭|不兼容)/i.test(trimmed)
  ) {
    return `${STREAM_UNSUPPORTED_SYNC_CONFIRM_PREFIX}上游接口不支持当前流式生图请求。请确认是否重新发起同步生图请求；同步请求可能耗时更久，且仍受上游网关超时限制。`;
  }
  if (status === 413 || /request entity too large|payload too large|content too large/i.test(trimmed)) {
    return '参考图请求体过大，上游模型服务拒绝接收。平台不会压缩用户图片；请更换更小的参考图，或让 API 供应商提高图生图上传限制。';
  }
  if (status === 524 || /cloudflare|error code 524|a timeout occurred|origin web server timed out/i.test(trimmed)) {
    return context === 'multimodal'
      ? '上游多模态模型网关超时（Cloudflare 524）。请确认该供应商当前支持图片输入的多模态/Responses 接口，或稍后重试。'
      : '上游 API 同步生图请求超时（Cloudflare 524）。请确认该供应商已开启流式生图或异步任务接口；高分辨率生图不要走会长时间无响应的同步接口。';
  }
  if (
    [502, 503, 504].includes(status)
    || /bad gateway|service unavailable|gateway timeout/i.test(trimmed)
  ) {
    return `上游网关暂时不可用（HTTP ${status}）。平台已自动重试一次仍失败，请稍后再试。`;
  }
  return trimmed || `HTTP ${status}`;
}
