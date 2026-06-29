import { getClientAuthToken, getClientAuthUserId } from '@/lib/client-auth';

/**
 * 创作历史记录存储
 *
 * 保存用户所有生成记录（图片/视频 + 提示词 + 参数），
 * 在个人中心的历史记录中展示。
 */

export interface CreationRecord {
  id: string;
  type: 'image' | 'video' | 'reverse-prompt';
  url: string;           // 图片/视频地址（可以是 data URL 或远程 URL）
  thumbnailUrl?: string;
  width?: number | null;
  height?: number | null;
  prompt: string;        // 用户输入的提示词
  negativePrompt?: string;
  model: string;         // 模型ID（如 doubao-seedream-5-0-260128 或 custom:xxx）
  modelLabel: string;    // 模型显示名称（如 "See Dream" 或 "gpt-image-2"）
  isCustomModel: boolean;
  params: Record<string, unknown>;
  createdAt: string;     // ISO date string
  published?: boolean;   // Whether this work is published to the gallery
  publishedAt?: string;  // Set only after a confirmed gallery publish
  referenceImage?: string; // For img2img: the reference image URL
  referenceImages?: string[]; // Optional multiple reference image URLs
  referenceImageThumbnails?: string[];
  publisherNickname?: string; // Set when publishing
  creditsCost?: number;
}

/* ---------- Published Work (shared gallery) ---------- */
export interface PublishedWork {
  id: string;
  type: 'image' | 'video';
  url: string;
  thumbnailUrl?: string;
  width?: number | null;
  height?: number | null;
  prompt: string;
  negativePrompt?: string;
  model: string;
  modelLabel: string;
  isCustomModel: boolean;
  params: Record<string, unknown>;
  referenceImage?: string;
  referenceImages?: string[];
  referenceImageThumbnails?: string[];
  publisherId: string;
  publisherNickname: string;
  publishedAt: string;
  likes: number;
  creditsCost?: number;
}

const STORAGE_KEY = 'miaojing_creation_history';
const PUBLISHED_KEY = 'miaojing_published_gallery';
const HISTORY_MIGRATION_KEY = 'miaojing_creation_history_migrated_user';
const MAX_RECORDS = 200;
const MAX_PUBLISHED = 200;
// Max localStorage size for history data (3MB, leaving room for other stores)
const MAX_STORAGE_BYTES = 3 * 1024 * 1024;
const HISTORY_REQUEST_CACHE_MS = 1500;

export type CreationHistoryScope = {
  mode?: CreationMode;
  limit?: number;
};

const inflightHistoryRequests = new Map<string, Promise<CreationRecord[] | null>>();
const recentHistoryResponses = new Map<string, { records: CreationRecord[]; expiresAt: number }>();

export function isPlaceholder(url: string): boolean {
  return url === '[data-url]';
}

export type CreationMode = 'text2img' | 'img2img' | 'text2video' | 'img2video' | 'reverse-prompt';

export function getCreationMode(record: Pick<CreationRecord, 'type' | 'referenceImage' | 'referenceImages' | 'params'>): CreationMode {
  const params = record.params || {};
  const explicitMode = params.creationMode || params.workType || params.mode;
  if (
    explicitMode === 'text2img' ||
    explicitMode === 'img2img' ||
    explicitMode === 'text2video' ||
    explicitMode === 'img2video' ||
    explicitMode === 'reverse-prompt'
  ) {
    return explicitMode;
  }

  const hasReference =
    Boolean(record.referenceImage) ||
    (Array.isArray(record.referenceImages) && record.referenceImages.length > 0) ||
    Boolean(params.referenceImage) ||
    (Array.isArray(params.referenceImages) && params.referenceImages.length > 0) ||
    Number(params.refImageCount || 0) > 0;

  if (record.type === 'reverse-prompt') return 'reverse-prompt';
  if (record.type === 'video') return hasReference ? 'img2video' : 'text2video';
  return hasReference ? 'img2img' : 'text2img';
}

function estimateByteSize(str: string): number {
  return new Blob([str]).size;
}

function loadRecords(): CreationRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return dedupeCreationRecordsByUrl(JSON.parse(raw) as CreationRecord[]);
  } catch {
    // If parsing fails, clear corrupted data
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    return [];
  }
}

function dedupeCreationRecordsByUrl(records: CreationRecord[]): CreationRecord[] {
  const seen = new Set<string>();
  const deduped: CreationRecord[] = [];
  for (const record of records) {
    const key = record.url && !record.url.startsWith('[') ? record.url : record.id;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(record);
  }
  return deduped;
}

function sortCreationRecords(records: CreationRecord[]): CreationRecord[] {
  return [...records].sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
}

function mergeCreationRecords(records: CreationRecord[], incoming: CreationRecord[]): CreationRecord[] {
  return sortCreationRecords(dedupeCreationRecordsByUrl([...incoming, ...records]));
}

function matchesCreationHistoryScope(record: CreationRecord, scope?: CreationHistoryScope): boolean {
  return !scope?.mode || getCreationMode(record) === scope.mode;
}

function getScopedLocalRecords(scope?: CreationHistoryScope): CreationRecord[] {
  const scoped = loadRecords().filter(record => matchesCreationHistoryScope(record, scope));
  return typeof scope?.limit === 'number' && scope.limit > 0 ? scoped.slice(0, scope.limit) : scoped;
}

function normalizeHistoryLimit(limit?: number): number | null {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) return null;
  return Math.min(300, Math.max(1, Math.round(limit)));
}

function historyRequestKey(token: string, scope?: CreationHistoryScope): string {
  return `${token}:${scope?.mode || 'all'}:${normalizeHistoryLimit(scope?.limit) || 'default'}`;
}

function buildHistoryUrl(scope?: CreationHistoryScope): string {
  const params = new URLSearchParams();
  const limit = normalizeHistoryLimit(scope?.limit);
  if (scope?.mode) params.set('mode', scope.mode);
  if (limit) params.set('limit', String(limit));
  const query = params.toString();
  return query ? `/api/creation-history?${query}` : '/api/creation-history';
}

function saveRecords(records: CreationRecord[], notify = true): void {
  if (typeof window === 'undefined') return;
  const trimmed = dedupeCreationRecordsByUrl(records.slice(0, MAX_RECORDS));
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Quota exceeded — progressively remove oldest records
    let shrinking = [...trimmed];
    while (shrinking.length > 0) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(shrinking));
        break;
      } catch {
        shrinking = shrinking.slice(0, -1);
      }
    }
  }
  if (notify) {
    recentHistoryResponses.clear();
    window.dispatchEvent(new CustomEvent('creation-history-updated'));
  }
}

async function fetchServerRecords(scope?: CreationHistoryScope): Promise<CreationRecord[] | null> {
  const token = getClientAuthToken();
  if (!token) return null;
  const key = historyRequestKey(token, scope);
  const cached = recentHistoryResponses.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.records;
  const inflight = inflightHistoryRequests.get(key);
  if (inflight) return inflight;

  const request = fetch(buildHistoryUrl(scope), {
    headers: { Authorization: `Bearer ${token}` },
  }).then(async res => {
    if (!res.ok) return null;
    const data = await res.json();
    const records = Array.isArray(data.records) ? data.records : [];
    recentHistoryResponses.set(key, { records, expiresAt: Date.now() + HISTORY_REQUEST_CACHE_MS });
    return records;
  }).finally(() => {
    inflightHistoryRequests.delete(key);
  });
  inflightHistoryRequests.set(key, request);
  return request;
}

async function persistServerRecords(records: CreationRecord[] | CreationRecord, scope?: CreationHistoryScope): Promise<CreationRecord[] | null> {
  const token = getClientAuthToken();
  if (!token) return null;
  await fetch('/api/creation-history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(Array.isArray(records) ? { records } : records),
  });
  recentHistoryResponses.clear();
  return fetchServerRecords(scope);
}

async function deleteServerRecord(id?: string, scope?: CreationHistoryScope): Promise<CreationRecord[] | null> {
  const token = getClientAuthToken();
  if (!token) return null;
  const res = await fetch(id ? `/api/creation-history?id=${encodeURIComponent(id)}` : '/api/creation-history', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(typeof data.error === 'string' ? data.error : '删除服务器记录失败');
  }
  recentHistoryResponses.clear();
  return fetchServerRecords(scope);
}

async function migrateLocalHistoryIfNeeded(scope?: CreationHistoryScope): Promise<CreationRecord[] | null> {
  const userId = getClientAuthUserId();
  const token = getClientAuthToken();
  if (!userId || !token) return null;
  if (localStorage.getItem(HISTORY_MIGRATION_KEY) !== userId) {
    const localRecords = loadRecords().filter(record => record.url && !record.url.startsWith('data:') && !record.url.startsWith('['));
    if (localRecords.length > 0) {
      await persistServerRecords(localRecords, scope);
    }
    localStorage.setItem(HISTORY_MIGRATION_KEY, userId);
  }
  return fetchServerRecords(scope);
}

export function addCreationRecord(record: Omit<CreationRecord, 'id' | 'createdAt'>, scope?: CreationHistoryScope): CreationRecord {
  const records = loadRecords();
  const newRecord: CreationRecord = {
    ...record,
    // Note: since API now returns S3 presigned URLs instead of data URLs,
    // we store the URL directly — no compression needed
    id: `rec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  };
  const existingIndex = records.findIndex(item => item.url === newRecord.url && !isPlaceholder(item.url));
  if (existingIndex !== -1) {
    records[existingIndex] = {
      ...records[existingIndex],
      ...newRecord,
      id: records[existingIndex].id,
      createdAt: records[existingIndex].createdAt,
      published: records[existingIndex].published || newRecord.published,
      publishedAt: records[existingIndex].publishedAt || newRecord.publishedAt,
    };
    saveRecords(records);
    return records[existingIndex];
  }
  records.unshift(newRecord);

  // Enforce count limit
  if (records.length > MAX_RECORDS) {
    records.length = MAX_RECORDS;
  }

  // Enforce storage size limit
  while (records.length > 0 && estimateByteSize(JSON.stringify(records)) > MAX_STORAGE_BYTES) {
    records.pop();
  }

  saveRecords(records);
  void persistServerRecords(newRecord, scope).then(serverRecords => {
    if (serverRecords) saveRecords(mergeCreationRecords(loadRecords(), serverRecords), false);
  }).catch(() => { /* local fallback */ });
  return newRecord;
}

export function getCreationRecords(): CreationRecord[] {
  return loadRecords();
}

export function getCreationRecordCount(): number {
  return loadRecords().length;
}

export async function deleteCreationRecord(id: string, scope?: CreationHistoryScope): Promise<void> {
  const token = getClientAuthToken();
  if (token) {
    const serverRecords = await deleteServerRecord(id, scope);
    if (serverRecords) {
      if (scope?.mode || scope?.limit) {
        saveRecords(mergeCreationRecords(loadRecords().filter(record => record.id !== id), serverRecords));
      } else {
        saveRecords(serverRecords);
      }
    }
    return;
  }
  const records = loadRecords().filter(r => r.id !== id);
  saveRecords(records);
}

export function clearCreationRecords(): void {
  saveRecords([]);
  void deleteServerRecord().then(serverRecords => {
    if (serverRecords) saveRecords(serverRecords, false);
  }).catch(() => { /* local fallback */ });
}

/**
 * React Hook - 订阅创作历史变更
 */
import { useState, useEffect, useCallback } from 'react';

export function useCreationHistory(scope?: CreationHistoryScope) {
  const [records, setRecords] = useState<CreationRecord[]>([]);

  useEffect(() => {
    const isScoped = Boolean(scope?.mode || scope?.limit);
    const applyRecords = (serverRecords: CreationRecord[] | null) => {
      if (serverRecords) {
        if (isScoped) {
          saveRecords(mergeCreationRecords(loadRecords(), serverRecords), false);
          setRecords(serverRecords);
        } else {
          saveRecords(serverRecords, false);
          setRecords(serverRecords);
        }
        return;
      }
      setRecords(getScopedLocalRecords(scope));
    };

    setRecords(getScopedLocalRecords(scope));
    migrateLocalHistoryIfNeeded(scope).then(applyRecords).catch(() => { /* keep local fallback */ });

    const handler = () => {
      fetchServerRecords(scope).then(applyRecords).catch(() => setRecords(getScopedLocalRecords(scope)));
    };
    window.addEventListener('creation-history-updated', handler);
    window.addEventListener('miaojing_auth_updated', handler);
    window.addEventListener('storage', handler);

    return () => {
      window.removeEventListener('creation-history-updated', handler);
      window.removeEventListener('miaojing_auth_updated', handler);
      window.removeEventListener('storage', handler);
    };
  }, [scope?.mode, scope?.limit]);

  const add = useCallback((record: Omit<CreationRecord, 'id' | 'createdAt'>) => {
    const newRecord = addCreationRecord(record, scope);
    setRecords(getScopedLocalRecords(scope));
    return newRecord;
  }, [scope?.mode, scope?.limit]);

  const remove = useCallback(async (id: string) => {
    await deleteCreationRecord(id, scope);
    setRecords(getScopedLocalRecords(scope));
  }, [scope?.mode, scope?.limit]);

  const clear = useCallback(() => {
    clearCreationRecords();
    setRecords([]);
  }, []);

  return { records, add, remove, clear };
}

/* ========== Published Gallery API ========== */

function loadPublished(): PublishedWork[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(PUBLISHED_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    try { localStorage.removeItem(PUBLISHED_KEY); } catch { /* ignore */ }
    return [];
  }
}

function savePublished(works: PublishedWork[]): void {
  if (typeof window === 'undefined') return;
  const trimmed = works.slice(0, MAX_PUBLISHED);
  try {
    localStorage.setItem(PUBLISHED_KEY, JSON.stringify(trimmed));
  } catch {
    let shrinking = [...trimmed];
    while (shrinking.length > 0) {
      try {
        localStorage.setItem(PUBLISHED_KEY, JSON.stringify(shrinking));
        break;
      } catch {
        shrinking = shrinking.slice(0, -1);
      }
    }
  }
  window.dispatchEvent(new CustomEvent('published-works-updated'));
}

/** Publish a creation record to the public gallery */
export function publishWork(
  record: CreationRecord,
  publisherId: string,
  publisherNickname: string,
): void {
  if (record.type === 'reverse-prompt') return;

  // Mark as published in history
  const records = loadRecords();
  const idx = records.findIndex(r => r.id === record.id);
  if (idx !== -1) {
    records[idx].published = true;
    records[idx].publishedAt = new Date().toISOString();
    records[idx].publisherNickname = publisherNickname;
    saveRecords(records);
  }

  // Add to published works (prevent duplicates)
  const works = loadPublished();
  if (works.some(w => w.id === record.id)) return;

  works.unshift({
    id: record.id,
    type: record.type,
    url: record.url,
    prompt: record.prompt,
    negativePrompt: record.negativePrompt,
    model: record.model,
    modelLabel: record.modelLabel,
    isCustomModel: record.isCustomModel,
    params: record.params,
    referenceImage: record.referenceImage,
    referenceImages: record.referenceImages,
    referenceImageThumbnails: record.referenceImageThumbnails,
    publisherId,
    publisherNickname,
    publishedAt: new Date().toISOString(),
    likes: 0,
  });
  savePublished(works);
}

/** Unpublish a work */
export function unpublishWork(id: string): void {
  const records = loadRecords();
  const idx = records.findIndex(r => r.id === id);
  if (idx !== -1) {
    records[idx].published = false;
    delete records[idx].publishedAt;
    saveRecords(records);
  }
  const works = loadPublished().filter(w => w.id !== id);
  savePublished(works);
}

/** Quick-share a generated result to gallery (no existing record needed) */
export async function shareToGallery(options: {
  type: 'image' | 'video';
  url: string;
  prompt?: string;
  model?: string;
  modelLabel?: string;
  publisherId?: string;
  publisherNickname?: string;
  negativePrompt?: string;
  referenceImage?: string;
  referenceImages?: string[];
  referenceImageThumbnails?: string[];
  params?: Record<string, unknown>;
  creditsCost?: number;
  thumbnailUrl?: string;
  width?: number | null;
  height?: number | null;
}): Promise<void> {
  const token = getClientAuthToken();
  if (!token) {
    throw new Error('请先登录后再分享作品');
  }

  const res = await fetch('/api/gallery/publish', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      userId: options.publisherId,
      type: options.type,
      prompt: options.prompt,
      negativePrompt: options.negativePrompt,
      resultUrl: options.url,
      thumbnailUrl: options.thumbnailUrl,
      width: options.width,
      height: options.height,
      model: options.model,
      modelLabel: options.modelLabel,
      referenceImage: options.referenceImage,
      referenceImages: options.referenceImages,
      referenceImageThumbnails: options.referenceImageThumbnails,
      params: options.params,
      creditsCost: options.creditsCost,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : '分享失败，请重试');
  }

  const works = loadPublished();
  const existingIndex = works.findIndex(w => w.url === options.url);
  const publishedWork: PublishedWork = {
    id: existingIndex >= 0 ? works[existingIndex].id : `pub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: options.type,
    url: options.url,
    thumbnailUrl: options.thumbnailUrl,
    width: options.width,
    height: options.height,
    prompt: options.prompt || '',
    negativePrompt: options.negativePrompt,
    model: options.model || '',
    modelLabel: options.modelLabel || '',
    isCustomModel: false,
    params: options.params || {},
    referenceImage: options.referenceImage,
    referenceImages: options.referenceImages,
    referenceImageThumbnails: options.referenceImageThumbnails,
    publisherId: options.publisherId || 'anonymous',
    publisherNickname: options.publisherNickname || '匿名用户',
    publishedAt: new Date().toISOString(),
    likes: existingIndex >= 0 ? works[existingIndex].likes : 0,
    creditsCost: options.creditsCost,
  };
  if (existingIndex >= 0) {
    works[existingIndex] = publishedWork;
  } else {
    works.unshift(publishedWork);
  }
  savePublished(works);
  window.dispatchEvent(new CustomEvent('creation-history-updated'));

  // Mark the corresponding creation record as published
  markRecordAsPublished(options.url);
}

/** Mark a creation record as published by URL */
export function markRecordAsPublished(url: string): void {
  const records = loadRecords();
  const idx = records.findIndex(r => r.url === url);
  if (idx !== -1) {
    records[idx].published = true;
    records[idx].publishedAt = new Date().toISOString();
    saveRecords(records);
    window.dispatchEvent(new CustomEvent('creation-history-updated'));
  }
}

/** Check if a URL has already been published to gallery */
export function isUrlPublished(url: string): boolean {
  // Check creation records
  const records = loadRecords();
  if (records.some(r => r.url === url && r.published && r.publishedAt)) return true;
  return false;
}

/**
 * Sync localStorage published works AND published creation records to Supabase.
 * This ensures that previously shared works (stored only in localStorage)
 * are visible to all visitors, not just the publisher's browser.
 * Returns the number of works that were synced.
 */
export async function syncPublishedToSupabase(): Promise<number> {
  // Collect all URLs to sync from both published gallery and creation history
  const published = loadPublished();
  const records = loadRecords();

  // Gather all works to sync
  const toSync: Array<{
    url: string;
    type: string;
    prompt: string;
    negativePrompt?: string;
    model: string;
    modelLabel: string;
    referenceImage?: string;
    referenceImages?: string[];
    referenceImageThumbnails?: string[];
    params: Record<string, unknown>;
    publisherId?: string;
    publisherNickname?: string;
  }> = [];

  // From published gallery
  for (const work of published) {
    if (work.url && !work.url.startsWith('data:') && !work.url.startsWith('[')) {
      toSync.push({
        url: work.url,
        type: work.type,
        prompt: work.prompt || '',
        negativePrompt: work.negativePrompt,
        model: work.model || '',
        modelLabel: work.modelLabel || '',
        referenceImage: work.referenceImage,
        referenceImages: work.referenceImages,
        referenceImageThumbnails: work.referenceImageThumbnails,
        params: work.params || {},
        publisherId: work.publisherId,
        publisherNickname: work.publisherNickname,
      });
    }
  }

  // From creation history with published flag
  for (const r of records) {
    if (r.published && r.url && !r.url.startsWith('data:') && !r.url.startsWith('[') && !toSync.some(w => w.url === r.url)) {
      toSync.push({
        url: r.url,
        type: r.type,
        prompt: r.prompt,
        negativePrompt: r.negativePrompt,
        model: r.model || '',
        modelLabel: r.modelLabel || '',
        referenceImage: r.referenceImage,
        referenceImages: r.referenceImages,
        referenceImageThumbnails: r.referenceImageThumbnails,
        params: r.params || {},
      });
    }
  }

  if (toSync.length === 0) return 0;

  let synced = 0;
  // Get the list of URLs already in Supabase to avoid duplicates
  let existingUrls = new Set<string>();
  try {
    const res = await fetch('/api/gallery?limit=200');
    if (res.ok) {
      const data = await res.json();
      existingUrls = new Set((data.works || []).map((w: { url: string }) => w.url));
    }
  } catch { /* proceed anyway */ }

  for (const work of toSync) {
    const url = work.url;
    // Skip if already in Supabase
    if (existingUrls.has(url)) { synced++; continue; }

    try {
      const token = getClientAuthToken();
      if (!token) continue;
      const res = await fetch('/api/gallery/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          userId: work.publisherId && work.publisherId !== 'anonymous' ? work.publisherId : undefined,
          type: work.type,
          prompt: work.prompt,
          negativePrompt: work.negativePrompt,
          resultUrl: url,
          model: work.model,
          modelLabel: work.modelLabel,
          referenceImage: work.referenceImage,
          referenceImages: work.referenceImages,
          referenceImageThumbnails: work.referenceImageThumbnails,
          params: work.params,
        }),
      });
      if (res.ok) {
        await res.json().catch(() => ({}));
        synced++;
      } else {
        console.warn('[gallery sync] Failed to publish:', url.slice(0, 60), await res.text().catch(() => ''));
      }
    } catch (err) {
      console.warn('[gallery sync] Error publishing:', url.slice(0, 60), err);
    }
  }

  return synced;
}

/** Get all published works */
export function getPublishedWorks(): PublishedWork[] {
  return loadPublished();
}

/** Like a published work */
export function likePublishedWork(id: string): void {
  const works = loadPublished();
  const idx = works.findIndex(w => w.id === id);
  if (idx !== -1) {
    works[idx].likes += 1;
    savePublished(works);
  }
}

/**
 * React Hook - 订阅已发布作品变更
 */
export function usePublishedWorks() {
  const [works, setWorks] = useState<PublishedWork[]>([]);

  useEffect(() => {
    setWorks(loadPublished());

    const handler = () => setWorks(loadPublished());
    window.addEventListener('published-works-updated', handler);
    window.addEventListener('storage', handler);

    return () => {
      window.removeEventListener('published-works-updated', handler);
      window.removeEventListener('storage', handler);
    };
  }, []);

  const publish = useCallback((record: CreationRecord, publisherId: string, publisherNickname: string) => {
    publishWork(record, publisherId, publisherNickname);
    setWorks(loadPublished());
  }, []);

  const unpublish = useCallback((id: string) => {
    unpublishWork(id);
    setWorks(loadPublished());
  }, []);

  const like = useCallback((id: string) => {
    likePublishedWork(id);
    setWorks(loadPublished());
  }, []);

  return { works, publish, unpublish, like };
}
