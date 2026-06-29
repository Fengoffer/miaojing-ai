export const GALLERY_CACHE_TTL_MS = 5 * 60 * 1000;
export const GALLERY_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function isGalleryCacheEntryFresh(savedAt: unknown, now = Date.now()): boolean {
  const savedAtMs = Number(savedAt || 0);
  return Number.isFinite(savedAtMs) && now - savedAtMs <= GALLERY_CACHE_TTL_MS;
}

export function isGalleryCacheEntryUsable(savedAt: unknown, now = Date.now()): boolean {
  const savedAtMs = Number(savedAt || 0);
  return Number.isFinite(savedAtMs) && now - savedAtMs <= GALLERY_CACHE_MAX_AGE_MS;
}
