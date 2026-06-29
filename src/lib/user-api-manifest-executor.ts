import { fetchPublicHttpUrl } from '@/lib/remote-fetch';
import { localStorage } from '@/lib/local-storage';
import {
  buildCustomApiHeaders,
  fetchWithRetry,
  parseCustomApiError,
  parseCustomApiJsonWithProgress,
} from '@/lib/custom-api-fetch';
import {
  type ManifestEndpoint,
  type ManifestPollEndpoint,
  type StoredUserApiManifest,
  readUserApiManifestFileAsync,
} from '@/lib/user-api-manifest';

type ManifestParams = Record<string, unknown> & {
  size?: string;
  quality?: string;
  output_format?: string;
  output_compression?: string | number;
  moderation?: string;
  n?: number;
  aspect_ratio?: string;
  duration?: number | string;
  resolution?: string;
  fps?: number;
};

export type UserApiManifestExecutionInput = {
  manifestPath?: string;
  apiUrl?: string;
  apiKey: string;
  modelName?: string;
  prompt: string;
  jobId?: string | null;
  params?: ManifestParams;
  inputImages?: string[];
  inputImageUrls?: string[];
  mask?: string;
  preferEdit?: boolean;
  timeoutMs: number;
  onProgress?: (progress: Record<string, unknown>) => void | Promise<void>;
};

export type UserApiManifestExecutionResult = {
  images: string[];
  videos: string[];
  raw: unknown;
};

const OMIT = Symbol('omit');

type ManifestReaderOverride = (manifestPath: string | null | undefined) => Promise<StoredUserApiManifest | null>;

async function readManifestForExecution(manifestPath: string | null | undefined): Promise<StoredUserApiManifest | null> {
  const override = (globalThis as typeof globalThis & {
    __MIAOJING_TEST_READ_USER_API_MANIFEST_FILE_ASYNC__?: ManifestReaderOverride;
  }).__MIAOJING_TEST_READ_USER_API_MANIFEST_FILE_ASYNC__;
  if (override) return override(manifestPath);
  return readUserApiManifestFileAsync(manifestPath);
}

function publicAppBaseUrl(): string {
  return (process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '');
}

function toAbsolutePublicUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const baseUrl = publicAppBaseUrl();
  return baseUrl && url.startsWith('/') ? `${baseUrl}${url}` : url;
}

function stripSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, '');
}

function buildManifestUrl(baseUrl: string, endpointPath: string, query?: Record<string, unknown>): string {
  const renderedPath = endpointPath.trim();
  const url = /^https?:\/\//i.test(renderedPath)
    ? new URL(renderedPath)
    : (() => {
        const base = (baseUrl || '').trim();
        if (!base) throw new Error('API 请求地址为空，请在配置中填写 Base URL');
        const baseUrlObject = new URL(base);
        const basePath = stripSlashes(baseUrlObject.pathname);
        const endpoint = stripSlashes(renderedPath);
        if (!endpoint || basePath.endsWith(endpoint)) return baseUrlObject;
        baseUrlObject.pathname = `/${[basePath, endpoint].filter(Boolean).join('/')}`;
        return baseUrlObject;
      })();

  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, typeof value === 'string' ? value : JSON.stringify(value));
  }
  return url.toString();
}

function getPathValue(value: unknown, dottedPath: string): unknown {
  if (!dottedPath) return value;
  if (dottedPath.includes('|')) {
    for (const path of dottedPath.split('|').map(item => item.trim()).filter(Boolean)) {
      const matched = getPathValue(value, path);
      if (matched !== undefined && matched !== null && matched !== '') return matched;
    }
    return undefined;
  }
  if (dottedPath.includes('*')) {
    return valuesAtPath(value, dottedPath).find(item => item !== undefined && item !== null && item !== '');
  }
  return dottedPath.split('.').reduce<unknown>((current, segment) => {
    if (current === undefined || current === null) return undefined;
    if (Array.isArray(current)) {
      const index = Number(segment);
      return Number.isInteger(index) ? current[index] : undefined;
    }
    if (typeof current === 'object') return (current as Record<string, unknown>)[segment];
    return undefined;
  }, value);
}

export function extractManifestTaskId(value: unknown): string | number | undefined {
  if (typeof value === 'string' || typeof value === 'number') return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = extractManifestTaskId(item);
      if (nested !== undefined) return nested;
    }
    return undefined;
  }
  if (!value || typeof value !== 'object') return undefined;

  const directKeys = ['task_id', 'taskId', 'taskID', 'taskid', '任务id', '任务ID', '任务Id', 'id', 'task'];
  for (const key of directKeys) {
    const child = (value as Record<string, unknown>)[key];
    if (typeof child === 'string' || typeof child === 'number') return child;
  }

  for (const key of ['任务ids', '任务IDs', '任务Ids', 'task_ids', 'taskIds', 'taskIDs']) {
    const nested = extractManifestTaskId((value as Record<string, unknown>)[key]);
    if (nested !== undefined) return nested;
  }

  for (const key of ['data', 'result', 'output']) {
    const nested = extractManifestTaskId((value as Record<string, unknown>)[key]);
    if (nested !== undefined) return nested;
  }

  return undefined;
}

function valuesAtPath(value: unknown, dottedPath: string): unknown[] {
  const segments = dottedPath.split('.').filter(Boolean);
  const walk = (current: unknown, index: number): unknown[] => {
    if (index >= segments.length) return [current];
    if (current === undefined || current === null) return [];
    const segment = segments[index];
    if (segment === '*') {
      if (Array.isArray(current)) return current.flatMap(item => walk(item, index + 1));
      if (typeof current === 'object') return Object.values(current as Record<string, unknown>).flatMap(item => walk(item, index + 1));
      return [];
    }
    if (Array.isArray(current)) {
      const arrayIndex = Number(segment);
      return Number.isInteger(arrayIndex) ? walk(current[arrayIndex], index + 1) : [];
    }
    if (typeof current === 'object') return walk((current as Record<string, unknown>)[segment], index + 1);
    return [];
  };
  return walk(value, 0);
}

function getTemplateVariable(path: string, input: UserApiManifestExecutionInput): unknown {
  const context = {
    profile: {
      model: input.modelName,
    },
    prompt: input.prompt,
    params: input.params || {},
    inputImages: {
      dataUrls: input.inputImages || [],
      urls: input.inputImageUrls || input.inputImages || [],
    },
    mask: {
      dataUrl: input.mask,
    },
  };
  return getPathValue(context, path);
}

function parseDataUrlForUpload(value: string): { buffer: Buffer; mimeType: string; ext: string } | null {
  const match = value.match(/^data:([^;]+);base64,([\s\S]+)$/);
  if (!match) return null;
  const mimeType = match[1].split(';')[0] || 'application/octet-stream';
  const ext = mimeType.split('/')[1] || 'bin';
  return {
    buffer: Buffer.from(match[2], 'base64'),
    mimeType,
    ext,
  };
}

async function uploadManifestInputDataUrl(value: string, index: number): Promise<string | null> {
  const parsed = parseDataUrlForUpload(value);
  if (!parsed) return null;

  const fileKey = await localStorage.uploadFileObjectOnly({
    fileContent: parsed.buffer,
    fileName: `manifest-reference-images/${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}.${parsed.ext}`,
    contentType: parsed.mimeType,
  });

  const objectReadUrl = localStorage.generateObjectReadUrl(fileKey, 3600);
  if (objectReadUrl) return objectReadUrl;

  const publicUrl = await localStorage.generatePresignedUrl({ key: fileKey, expireTime: 3600 });
  return publicUrl ? toAbsolutePublicUrl(publicUrl) : null;
}

function getObjectReadUrlForStoredInputImage(value: string): string | null {
  const key = localStorage.getKeyFromPublicUrl(value);
  return key ? localStorage.generateObjectReadUrl(key, 3600) : null;
}

async function resolveManifestInputImageReferences(inputImages: string[]): Promise<string[]> {
  const resolved: string[] = [];
  for (let index = 0; index < inputImages.length; index += 1) {
    const value = inputImages[index]?.trim();
    if (!value) continue;
    if (value.startsWith('data:')) {
      const publicUrl = await uploadManifestInputDataUrl(value, index);
      resolved.push(publicUrl || value);
      continue;
    }
    const objectReadUrl = getObjectReadUrlForStoredInputImage(value);
    if (objectReadUrl) {
      resolved.push(objectReadUrl);
      continue;
    }
    resolved.push(toAbsolutePublicUrl(value));
  }
  return Array.from(new Set(resolved));
}

function renderTemplate(value: unknown, input: UserApiManifestExecutionInput): unknown | typeof OMIT {
  if (typeof value === 'string') {
    const exact = value.match(/^\$([a-zA-Z0-9_.]+)$/);
    if (!exact) return value;
    const resolved = getTemplateVariable(exact[1], input);
    if (resolved === undefined || resolved === null || resolved === '') return OMIT;
    if (Array.isArray(resolved) && resolved.length === 0) return OMIT;
    return resolved;
  }
  if (Array.isArray(value)) {
    const array = value.map(item => renderTemplate(item, input)).filter(item => item !== OMIT);
    return array.length > 0 ? array : OMIT;
  }
  if (value && typeof value === 'object') {
    const rendered: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const next = renderTemplate(child, input);
      if (next !== OMIT) rendered[key] = next;
    }
    return Object.keys(rendered).length > 0 ? rendered : {};
  }
  return value;
}

function renderObjectTemplate(value: Record<string, unknown> | undefined, input: UserApiManifestExecutionInput): Record<string, unknown> | undefined {
  const rendered = renderTemplate(value || {}, input);
  return rendered && rendered !== OMIT && typeof rendered === 'object' && !Array.isArray(rendered)
    ? rendered as Record<string, unknown>
    : undefined;
}

function replaceTaskIdPlaceholders(value: unknown, taskId?: string): unknown {
  if (!taskId) return value;
  if (typeof value === 'string') return value.replaceAll('{task_id}', taskId);
  if (Array.isArray(value)) return value.map(item => replaceTaskIdPlaceholders(item, taskId));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([key, child]) => [key, replaceTaskIdPlaceholders(child, taskId)]),
    );
  }
  return value;
}

function numberFromUnknown(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getManifestProgress(raw: unknown, status: unknown): Record<string, unknown> {
  const percent = numberFromUnknown(getPathValue(raw, 'progress'))
    ?? numberFromUnknown(getPathValue(raw, 'data.progress'))
    ?? numberFromUnknown(getPathValue(raw, 'result.progress'));
  const remainingSeconds = numberFromUnknown(getPathValue(raw, 'remainingSeconds'))
    ?? numberFromUnknown(getPathValue(raw, 'remaining_seconds'))
    ?? numberFromUnknown(getPathValue(raw, 'eta'))
    ?? numberFromUnknown(getPathValue(raw, 'eta_seconds'));
  return {
    ...(percent !== undefined ? { percent } : {}),
    ...(remainingSeconds !== undefined ? { remainingSeconds } : {}),
    message: typeof status === 'string' ? status : '等待上游任务完成',
  };
}

function normalizeManifestComparableValue(value: unknown): string {
  return String(value).trim().toLowerCase();
}

function manifestValueMatches(candidates: unknown[] | undefined, actual: unknown): boolean {
  if (!candidates?.length) return false;
  const normalizedActual = normalizeManifestComparableValue(actual);
  return candidates.some(value => normalizeManifestComparableValue(value) === normalizedActual);
}

function dataUrlToBlob(value: string): { blob: Blob; fileName: string } | null {
  const parsed = parseDataUrlForUpload(value);
  if (!parsed) return null;
  const arrayBuffer = parsed.buffer.buffer.slice(
    parsed.buffer.byteOffset,
    parsed.buffer.byteOffset + parsed.buffer.byteLength,
  ) as ArrayBuffer;
  return {
    blob: new Blob([arrayBuffer], { type: parsed.mimeType }),
    fileName: `image.${parsed.ext}`,
  };
}

async function appendFile(formData: FormData, field: string, value: string, index: number): Promise<void> {
  const parsed = dataUrlToBlob(value);
  if (parsed) {
    formData.append(field, parsed.blob, index === 0 ? parsed.fileName : `image-${index + 1}.${parsed.fileName.split('.').pop() || 'bin'}`);
    return;
  }

  if (/^https?:\/\//i.test(value)) {
    const response = await fetchPublicHttpUrl(value);
    if (!response.ok) throw new Error(`下载参考图失败: ${response.status}`);
    const mimeType = response.headers.get('content-type')?.split(';')[0] || 'application/octet-stream';
    const ext = mimeType.split('/')[1] || 'bin';
    formData.append(field, new Blob([Buffer.from(await response.arrayBuffer())], { type: mimeType }), `image-${index + 1}.${ext}`);
  }
}

async function buildRequestBody(endpoint: ManifestEndpoint, input: UserApiManifestExecutionInput): Promise<{ body?: BodyInit; headers: Record<string, string> }> {
  const headers = buildCustomApiHeaders(input.apiKey);
  const bodyObject = renderObjectTemplate(endpoint.body, input) || {};

  if (endpoint.contentType === 'multipart') {
    const formData = new FormData();
    delete headers['Content-Type'];
    for (const [key, value] of Object.entries(bodyObject)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const item of value) formData.append(key, typeof item === 'string' ? item : JSON.stringify(item));
      } else {
        formData.append(key, typeof value === 'string' ? value : String(value));
      }
    }
    for (const file of endpoint.files || []) {
      const sourceValues = file.source === 'mask'
        ? (input.mask ? [input.mask] : [])
        : (input.inputImages || []);
      const values = file.array ? sourceValues : sourceValues.slice(0, 1);
      for (let index = 0; index < values.length; index += 1) {
        await appendFile(formData, file.field, values[index], index);
      }
    }
    return { body: formData, headers };
  }

  return { body: JSON.stringify(bodyObject), headers };
}

function extractMediaFromResult(raw: unknown, endpoint: ManifestEndpoint | ManifestPollEndpoint): { images: string[]; videos: string[] } {
  const result = endpoint.result || {};
  const b64Images = (result.b64JsonPaths || [])
    .flatMap(path => valuesAtPath(raw, path))
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map(value => value.startsWith('data:') ? value : `data:image/png;base64,${value}`);
  const b64Videos = (result.b64VideoPaths || [])
    .flatMap(path => valuesAtPath(raw, path))
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map(value => value.startsWith('data:') ? value : `data:video/mp4;base64,${value}`);
  const imageValues = [
    ...(result.imageUrlPaths || []).flatMap(path => valuesAtPath(raw, path)),
    ...b64Images,
  ];
  const videoValues = [
    ...(result.videoUrlPaths || []).flatMap(path => valuesAtPath(raw, path)),
    ...b64Videos,
  ];
  return {
    images: Array.from(new Set(imageValues.filter((value): value is string => typeof value === 'string' && value.trim().length > 0))),
    videos: Array.from(new Set(videoValues.filter((value): value is string => typeof value === 'string' && value.trim().length > 0))),
  };
}

function normalizeFetchErrorMessage(error: unknown, stage: string): string {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return `${stage}超时，请稍后重试`;
  }
  const message = error instanceof Error ? error.message : String(error || '');
  if (/fetch failed|network|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND/i.test(message)) {
    return `${stage}网络连接失败，请稍后重试`;
  }
  return message || `${stage}失败`;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

const AGNES_VIDEO_MANIFEST_SUBMIT_TIMEOUT_MS = 10 * 60_000;

function isAgnesVideoManifestRequest(input: UserApiManifestExecutionInput): boolean {
  const modelName = (input.modelName || '').toLowerCase();
  const apiUrl = (input.apiUrl || '').toLowerCase();
  return modelName.startsWith('agnes-video-')
    || (modelName.includes('agnes-video') && apiUrl.includes('agnes-ai'));
}

function isAgnesImageManifestRequest(input: UserApiManifestExecutionInput): boolean {
  const modelName = (input.modelName || '').toLowerCase();
  const apiUrl = (input.apiUrl || '').toLowerCase();
  return modelName.startsWith('agnes-image-')
    || (modelName.includes('agnes-image') && apiUrl.includes('agnes-ai'));
}

function getUrlHostForLog(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const parsed = new URL(value);
    return parsed.host;
  } catch {
    return value.startsWith('/api/local-storage/') ? 'app-local-storage' : 'non-url';
  }
}

function collectImageReferenceFields(value: unknown, path = '', depth = 0): Array<{ field: string; values: string[] }> {
  if (depth > 6 || !value || typeof value !== 'object') return [];
  const refs: Array<{ field: string; values: string[] }> = [];
  const pushIfImageReference = (field: string, candidate: unknown) => {
    const values = Array.isArray(candidate)
      ? candidate.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : typeof candidate === 'string' && candidate.trim()
        ? [candidate]
        : [];
    const imageValues = values.filter(item => (
      item.startsWith('data:image/')
      || item.startsWith('/api/local-storage/')
      || /^https?:\/\//i.test(item)
    ));
    if (imageValues.length > 0) refs.push({ field, values: imageValues });
  };

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      refs.push(...collectImageReferenceFields(item, `${path}.${index}`, depth + 1));
    });
    return refs;
  }

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const nextPath = path ? `${path}.${key}` : key;
    if (/^(image|images|image_url|image_urls|init_image|reference_urls|base64Array|img_url|image_tail)$/i.test(key)) {
      pushIfImageReference(nextPath, child);
    }
    refs.push(...collectImageReferenceFields(child, nextPath, depth + 1));
  }
  return refs;
}

function logManifestReferenceFields(input: UserApiManifestExecutionInput, endpoint: ManifestEndpoint | ManifestPollEndpoint, body: BodyInit | undefined, method: string): void {
  if (!('contentType' in endpoint) || method === 'GET') return;
  const inputImageCount = input.inputImageUrls?.length || input.inputImages?.length || 0;
  if (inputImageCount === 0) return;
  const bodyObject = (() => {
    if (typeof body !== 'string') return {};
    try { return JSON.parse(body) as Record<string, unknown>; } catch { return {}; }
  })();
  const refs = collectImageReferenceFields(bodyObject);
  const values = refs.flatMap(item => item.values);
  console.log('[User API Manifest Image Refs] Request refs:', JSON.stringify({
    model: input.modelName,
    path: endpoint.path,
    inputImageCount,
    imageFields: refs.map(item => item.field),
    bodyImageCount: values.length,
    bodyImageHosts: Array.from(new Set(values.map(getUrlHostForLog).filter(Boolean))),
    usesStoredObjectRefs: values.some(value => /X-Amz-Signature=/i.test(value)),
  }));
}

function getManifestRequestTimeoutMs(totalTimeoutMs: number, method: string, input: UserApiManifestExecutionInput): number {
  const isPoll = method === 'GET';
  const fallback = isPoll
    ? 60_000
    : isAgnesVideoManifestRequest(input)
      ? AGNES_VIDEO_MANIFEST_SUBMIT_TIMEOUT_MS
      : 180_000;
  const envValue = isPoll
    ? process.env.USER_API_MANIFEST_POLL_REQUEST_TIMEOUT_MS
    : isAgnesVideoManifestRequest(input)
      ? process.env.AGNES_VIDEO_MANIFEST_SUBMIT_TIMEOUT_MS || process.env.USER_API_MANIFEST_SUBMIT_TIMEOUT_MS
      : process.env.USER_API_MANIFEST_SUBMIT_TIMEOUT_MS;
  return Math.max(1_000, Math.min(totalTimeoutMs, parsePositiveInt(envValue, fallback)));
}

function isTransientPollError(message: string): boolean {
  return /上游任务轮询(?:网络连接失败|超时)|上游网关暂时不可用|HTTP 50[234]|fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND/i.test(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getInputJobId(input: UserApiManifestExecutionInput): string {
  return input.jobId || 'direct';
}

function notifyManifestProgress(input: UserApiManifestExecutionInput, progress: Record<string, unknown>): void {
  Promise.resolve(input.onProgress?.(progress)).catch(error => {
    console.error('[User API Manifest Progress] update failed:', getInputJobId(input), error);
  });
}

async function requestManifestEndpoint(
  endpoint: ManifestEndpoint | ManifestPollEndpoint,
  input: UserApiManifestExecutionInput,
  taskId?: string,
): Promise<unknown> {
  const renderedQuery = renderObjectTemplate(endpoint.query, input);
  const query = replaceTaskIdPlaceholders(renderedQuery, taskId) as Record<string, unknown> | undefined;
  const path = taskId ? endpoint.path.replaceAll('{task_id}', encodeURIComponent(taskId)) : endpoint.path;
  const url = buildManifestUrl(input.apiUrl || '', path, query);
  const method = (endpoint.method || 'POST').toUpperCase();
  const { body, headers } = 'contentType' in endpoint
    ? await buildRequestBody(endpoint, input)
    : { body: method === 'GET' ? undefined : JSON.stringify(query || {}), headers: buildCustomApiHeaders(input.apiKey) };
  const timeoutMs = getManifestRequestTimeoutMs(input.timeoutMs, method, input);
  console.log('[User API Manifest Request]', JSON.stringify({
    jobId: getInputJobId(input),
    method,
    url,
    model: input.modelName,
    stage: method === 'GET' ? 'poll' : 'submit',
    timeoutMs,
  }));
  if ('contentType' in endpoint && method !== 'GET' && isAgnesImageManifestRequest(input)) {
    const bodyObject = (() => {
      if (typeof body !== 'string') return {};
      try { return JSON.parse(body) as Record<string, unknown>; } catch { return {}; }
    })();
    const extraBody = bodyObject.extra_body as Record<string, unknown> | undefined;
    const extraBodyImage = extraBody?.image;
    const bodyImage = extraBodyImage || bodyObject.image;
    const bodyImageValues = Array.isArray(bodyImage) ? bodyImage : typeof bodyImage === 'string' ? [bodyImage] : [];
    console.log('[User API Manifest Agnes Image] Request refs:', JSON.stringify({
      model: input.modelName,
      path: endpoint.path,
      imageField: extraBodyImage ? 'extra_body.image' : bodyObject.image ? 'image' : 'none',
      inputImageCount: input.inputImageUrls?.length || input.inputImages?.length || 0,
      bodyImageCount: bodyImageValues.length,
      bodyImageHosts: Array.from(new Set(bodyImageValues.map(getUrlHostForLog).filter(Boolean))),
      usesStoredObjectRefs: bodyImageValues.some(value => typeof value === 'string' && /X-Amz-Signature=/i.test(value)),
      hasExtraBodyResponseFormat: Boolean(extraBody?.response_format),
    }));
  }
  logManifestReferenceFields(input, endpoint, body, method);

  let response: Response;
  try {
    response = await fetchWithRetry(
      url,
      { method, headers, body: method === 'GET' ? undefined : body },
      timeoutMs,
      1,
    );
  } catch (error) {
    const stage = method === 'GET' ? '上游任务轮询' : '上游任务创建';
    console.error('[User API Manifest Request Error]', JSON.stringify({
      jobId: getInputJobId(input),
      method,
      url,
      stage,
      message: error instanceof Error ? error.message : String(error || ''),
    }));
    throw new Error(normalizeFetchErrorMessage(error, stage));
  }
  console.log('[User API Manifest Response]', JSON.stringify({
    jobId: getInputJobId(input),
    method,
    url,
    status: response.status,
  }));
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(parseCustomApiError(response.status, errorText));
  }
  try {
    return await parseCustomApiJsonWithProgress(response, progress => notifyManifestProgress(input, progress));
  } catch (error) {
    throw new Error(normalizeFetchErrorMessage(error, '上游响应解析'));
  }
}

async function pollManifestResult(
  poll: ManifestPollEndpoint,
  taskId: string,
  input: UserApiManifestExecutionInput,
): Promise<{ raw: unknown; images: string[]; videos: string[] }> {
  const intervalMs = Math.max(1000, (poll.intervalSeconds || 5) * 1000);
  const deadline = Date.now() + input.timeoutMs;
  let attempt = 0;
  let lastTransientError = '';

  while (Date.now() < deadline) {
    if (attempt > 0) await sleep(intervalMs);
    let raw: unknown;
    try {
      raw = await requestManifestEndpoint(poll, input, taskId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || '');
      if (Date.now() < deadline && isTransientPollError(message)) {
        lastTransientError = message;
        notifyManifestProgress(input, { message, source: 'upstream' });
        attempt += 1;
        continue;
      }
      throw error;
    }
    const status = poll.statusPath ? getPathValue(raw, poll.statusPath) : undefined;
    const finalValue = poll.finalPath ? getPathValue(raw, poll.finalPath) : undefined;
    const isFinal = manifestValueMatches(poll.finalValues, finalValue);
    if (manifestValueMatches(poll.failureValues, status)) {
      const error = poll.errorPath ? getPathValue(raw, poll.errorPath) : undefined;
      throw new Error(typeof error === 'string' && error ? error : `上游任务失败: ${String(status)}`);
    }
    const media = extractMediaFromResult(raw, poll);
    const isSuccess = manifestValueMatches(poll.successValues, status);
    const hasMedia = media.images.length > 0 || media.videos.length > 0;
    if (isSuccess && hasMedia) {
      return { raw, ...media };
    }
    if (isSuccess && !hasMedia) {
      notifyManifestProgress(input, {
        percent: 95,
        message: '上游已完成，正在等待结果地址',
        source: 'upstream',
      });
      attempt += 1;
      continue;
    }
    if ((!poll.finalValues?.length && isSuccess) || (!poll.successValues?.length && hasMedia) || (isFinal && isSuccess && hasMedia)) {
      return { raw, ...media };
    }
    notifyManifestProgress(input, getManifestProgress(raw, status));
    attempt += 1;
  }

  throw new Error(lastTransientError ? `上游任务轮询超时：${lastTransientError}` : '上游任务轮询超时');
}

export async function executeUserApiManifest(input: UserApiManifestExecutionInput): Promise<UserApiManifestExecutionResult | null> {
  if (!input.manifestPath) return null;
  const stored = await readManifestForExecution(input.manifestPath);
  if (!stored) throw new Error('选中的模型已关联智能 API 配置文件，但配置文件不存在或格式无效');
  const endpoint = input.preferEdit && stored.provider.editSubmit ? stored.provider.editSubmit : stored.provider.submit;
  if (!endpoint) throw new Error('Manifest 缺少提交接口配置');

  const executionInput = {
    ...input,
    apiUrl: input.apiUrl || stored.profile.baseUrl || '',
    modelName: input.modelName || stored.profile.model || '',
    inputImageUrls: input.inputImageUrls || await resolveManifestInputImageReferences(input.inputImages || []),
  };
  notifyManifestProgress(executionInput, { percent: 2, message: '上游任务创建中' });
  const submitRaw = await requestManifestEndpoint(endpoint, executionInput);
  const submitMedia = extractMediaFromResult(submitRaw, endpoint);
  if (submitMedia.images.length > 0 || submitMedia.videos.length > 0 || !endpoint.taskIdPath) {
    return { raw: submitRaw, ...submitMedia };
  }

  if (!stored.provider.poll) {
    throw new Error('Manifest 返回了任务 ID，但缺少 poll 轮询配置');
  }
  const taskId = extractManifestTaskId(getPathValue(submitRaw, endpoint.taskIdPath));
  if (taskId === undefined) {
    throw new Error(`Manifest 未能从 ${endpoint.taskIdPath} 读取任务 ID`);
  }
  notifyManifestProgress(executionInput, { percent: 8, message: '上游任务已创建，等待生成结果' });
  return pollManifestResult(stored.provider.poll, String(taskId), executionInput);
}
