export function getMigrationCheckBaseUrl(env = process.env) {
  const explicit = String(env.MIGRATION_CHECK_BASE_URL || env.APP_BASE_URL || '').trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const port = String(env.MIGRATION_CHECK_WEB_PORT || env.WEB_PORT || env.PORT || '8000').trim();
  return `http://127.0.0.1:${port}`;
}

export function getMigrationStorageUrlTimeoutMs(env = process.env) {
  const parsed = Number(env.MIGRATION_CHECK_STORAGE_URL_TIMEOUT_MS || 10_000);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), 60_000) : 10_000;
}

export function getMigrationStorageUrlConcurrency(env = process.env) {
  const parsed = Number(env.MIGRATION_CHECK_STORAGE_URL_CONCURRENCY || 8);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), 20) : 8;
}

export async function checkStorageUrl(baseUrl, storageUrl, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 10_000);
  const fetchImpl = options.fetchImpl || fetch;
  const targetUrl = `${baseUrl}${storageUrl}`;

  try {
    const response = await fetchImpl(targetUrl, {
      method: 'HEAD',
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    await response.body?.cancel?.();

    if (isReachableStorageResponse(response)) {
      return { ok: true };
    }

    if (response.status !== 405) {
      return { ok: false, error: `HTTP ${response.status}` };
    }

    const fallback = await fetchImpl(targetUrl, {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    await fallback.body?.cancel?.();
    if (!isReachableStorageResponse(fallback)) {
      return { ok: false, error: `HTTP ${fallback.status}` };
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function isReachableStorageResponse(response) {
  if (response.ok) return true;
  return response.status >= 300
    && response.status < 400
    && Boolean(response.headers?.get?.('location'));
}
