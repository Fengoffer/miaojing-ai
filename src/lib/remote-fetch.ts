import dns from 'dns/promises';
import net from 'net';

const MAX_REDIRECTS = 3;
const DEFAULT_RETRY_STATUSES = new Set([403, 408, 429, 500, 502, 503, 504]);
const PUBLIC_RESOURCE_ACCEPT = 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8';
const PUBLIC_RESOURCE_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';

export type FetchPublicHttpUrlRetryOptions = {
  attempts?: number;
  retryDelayMs?: number;
  retryStatuses?: number[];
  timeoutMs?: number;
};

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map(part => Number(part));
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 10
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || a === 0;
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  return normalized === '::1'
    || normalized === '::'
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || normalized.startsWith('fe80:');
}

function isPrivateAddress(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return isPrivateIpv4(ip);
  if (family === 6) return isPrivateIpv6(ip);
  return true;
}

async function assertPublicHttpUrl(url: URL): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only HTTP(S) URLs are supported');
  }
  if (url.username || url.password) {
    throw new Error('URL credentials are not allowed');
  }

  const addresses = await dns.lookup(url.hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(address => isPrivateAddress(address.address))) {
    throw new Error('Private or local network URLs are not allowed');
  }
}

function buildPublicResourceHeaders(headersInit?: HeadersInit): Headers {
  const headers = new Headers(headersInit);
  if (!headers.has('accept')) headers.set('Accept', PUBLIC_RESOURCE_ACCEPT);
  if (!headers.has('user-agent')) headers.set('User-Agent', PUBLIC_RESOURCE_USER_AGENT);
  return headers;
}

function isRetryableFetchError(error: unknown): boolean {
  if (error instanceof DOMException) {
    return error.name === 'AbortError' || error.name === 'TimeoutError';
  }
  const message = error instanceof Error ? error.message : String(error || '');
  return /fetch failed|network|timeout|aborted|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(message);
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function fetchPublicHttpUrl(input: string, init: RequestInit = {}, redirectCount = 0): Promise<Response> {
  if (redirectCount > MAX_REDIRECTS) throw new Error('Too many redirects');

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error('Invalid URL');
  }

  await assertPublicHttpUrl(url);
  const response = await fetch(url, {
    ...init,
    headers: buildPublicResourceHeaders(init.headers),
    redirect: 'manual',
  });

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    if (!location) return response;
    const redirected = new URL(location, url).toString();
    return fetchPublicHttpUrl(redirected, init, redirectCount + 1);
  }

  return response;
}

export async function fetchPublicHttpUrlWithRetry(
  input: string,
  init: RequestInit = {},
  options: FetchPublicHttpUrlRetryOptions = {},
): Promise<Response> {
  const attempts = Math.max(1, Math.floor(options.attempts || 3));
  const retryDelayMs = Math.max(0, Math.floor(options.retryDelayMs ?? 500));
  const retryStatuses = new Set(options.retryStatuses || Array.from(DEFAULT_RETRY_STATUSES));
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const attemptInit: RequestInit = options.timeoutMs && !init.signal
        ? { ...init, signal: AbortSignal.timeout(options.timeoutMs) }
        : init;
      const response = await fetchPublicHttpUrl(input, attemptInit);
      if (!retryStatuses.has(response.status) || attempt === attempts) return response;
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !isRetryableFetchError(error)) throw error;
    }

    await delay(retryDelayMs);
  }

  if (lastError instanceof Error) throw lastError;
  throw new Error('Failed to fetch public HTTP URL');
}
