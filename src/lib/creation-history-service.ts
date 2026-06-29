import { getDbClient } from '@/storage/database/local-db';
import {
  ensureLocalImageThumbnail,
  ensureLocalVideoThumbnail,
  isCurrentLocalImageThumbnail,
  isCurrentLocalVideoThumbnail,
} from '@/lib/media-storage';
import {
  getReferenceImageInputs,
  getReferenceThumbnailInputs,
  persistReferenceImages,
} from '@/lib/reference-image-storage';

type DbClient = Awaited<ReturnType<typeof getDbClient>>;

export type CreationHistoryRecordInput = Record<string, unknown>;

export function toWorkType(type: string, params: Record<string, unknown>): string {
  const explicitMode = params.creationMode || params.workType || params.mode;
  if (explicitMode === 'text2img' || explicitMode === 'img2img' || explicitMode === 'text2video' || explicitMode === 'img2video' || explicitMode === 'reverse-prompt') {
    return explicitMode;
  }
  if (type === 'reverse-prompt') return 'reverse-prompt';
  const hasReference = Boolean(params.referenceImage)
    || (Array.isArray(params.referenceImages) && params.referenceImages.length > 0)
    || Number(params.refImageCount || 0) > 0;
  if (type === 'video') return hasReference ? 'img2video' : 'text2video';
  return hasReference ? 'img2img' : 'text2img';
}

function fromWorkType(type: string): 'image' | 'video' | 'reverse-prompt' {
  if (type === 'reverse-prompt') return 'reverse-prompt';
  return type.includes('video') ? 'video' : 'image';
}

export function isVideoWorkType(type: string): boolean {
  return type === 'text2video' || type === 'img2video' || type === 'video';
}

export function mapCreationHistoryWork(row: Record<string, unknown>) {
  const params = (row.params || {}) as Record<string, unknown>;
  const referenceImages = Array.isArray(params.referenceImages)
    ? params.referenceImages.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : typeof params.referenceImage === 'string' && params.referenceImage.trim()
      ? [params.referenceImage]
      : undefined;
  const referenceImageThumbnails = getReferenceThumbnailInputs(params);
  return {
    id: row.id,
    type: fromWorkType(String(row.type || 'text2img')),
    url: row.result_url,
    thumbnailUrl: row.thumbnail_url || undefined,
    width: row.width || undefined,
    height: row.height || undefined,
    prompt: row.prompt || '',
    negativePrompt: row.negative_prompt || undefined,
    model: params.model || '',
    modelLabel: params.modelLabel || params.model || '',
    isCustomModel: Boolean(params.isCustomModel),
    params,
    referenceImage: referenceImages?.[0],
    referenceImages,
    referenceImageThumbnails: referenceImageThumbnails.length > 0 ? referenceImageThumbnails : undefined,
    creditsCost: Number(row.credits_cost || 0),
    published: row.is_public === true,
    publishedAt: row.is_public === true ? row.created_at : undefined,
    createdAt: row.created_at,
  };
}

export function getPositiveInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
}

export async function ensureWorkThumbnail(client: DbClient, row: Record<string, unknown>) {
  const type = String(row.type || '');
  if (typeof row.result_url !== 'string') return row;
  if (isVideoWorkType(type)) {
    if (isCurrentLocalVideoThumbnail(row.thumbnail_url)) return row;
    try {
      const thumbnailUrl = await ensureLocalVideoThumbnail(row.result_url, 'thumbnails/works/videos', String(row.prompt || 'Video'));
      if (!thumbnailUrl) return row;
      await client.query('UPDATE works SET thumbnail_url = $1 WHERE id = $2', [thumbnailUrl, row.id]);
      return { ...row, thumbnail_url: thumbnailUrl };
    } catch (error) {
      console.warn('[creation-history] video thumbnail generation failed:', error instanceof Error ? error.message : error);
      return row;
    }
  }
  if (isCurrentLocalImageThumbnail(row.thumbnail_url)) return row;
  if (type !== 'text2img' && type !== 'img2img') return row;
  try {
    const thumbnailUrl = await ensureLocalImageThumbnail(row.result_url, 'thumbnails/works');
    if (!thumbnailUrl) return row;
    await client.query('UPDATE works SET thumbnail_url = $1 WHERE id = $2', [thumbnailUrl, row.id]);
    return { ...row, thumbnail_url: thumbnailUrl };
  } catch (error) {
    console.warn('[creation-history] thumbnail generation failed:', error instanceof Error ? error.message : error);
    return row;
  }
}

function hasReferenceMetadata(params: Record<string, unknown>): boolean {
  return typeof params.referenceImage === 'string' && params.referenceImage.trim().length > 0
    || (Array.isArray(params.referenceImages) && params.referenceImages.length > 0);
}

export function mergeWorkRowMetadata(target: Record<string, unknown>, source: Record<string, unknown>) {
  const targetParams = (target.params || {}) as Record<string, unknown>;
  const sourceParams = (source.params || {}) as Record<string, unknown>;
  if (!target.thumbnail_url && source.thumbnail_url) target.thumbnail_url = source.thumbnail_url;
  if (!target.width && source.width) target.width = source.width;
  if (!target.height && source.height) target.height = source.height;
  if (!hasReferenceMetadata(targetParams) && hasReferenceMetadata(sourceParams)) {
    target.params = {
      ...targetParams,
      referenceImage: sourceParams.referenceImage,
      referenceImages: sourceParams.referenceImages,
      referenceImageThumbnails: sourceParams.referenceImageThumbnails,
      refImageCount: sourceParams.refImageCount,
    };
  }
}

export function dedupeRowsByResultUrl(rows: Record<string, unknown>[]) {
  const seen = new Set<string>();
  const deduped: Record<string, unknown>[] = [];
  for (const row of rows) {
    const key = typeof row.result_url === 'string' && row.result_url.trim()
      ? row.result_url
      : String(row.id || '');
    if (seen.has(key)) {
      const target = deduped.find(item => (
        typeof item.result_url === 'string' && item.result_url.trim()
          ? item.result_url
          : String(item.id || '')
      ) === key);
      if (target) mergeWorkRowMetadata(target, row);
      continue;
    }
    seen.add(key);
    for (const candidate of rows) {
      const candidateKey = typeof candidate.result_url === 'string' && candidate.result_url.trim()
        ? candidate.result_url
        : String(candidate.id || '');
      if (candidateKey === key && candidate !== row) mergeWorkRowMetadata(row, candidate);
    }
    deduped.push(row);
  }
  return deduped;
}

function historyRecordDedupeLockKey(userId: string, url: string): string {
  return `${userId}:${url}`;
}

export async function saveCreationHistoryRecords(
  userId: string,
  records: CreationHistoryRecordInput[],
) {
  const client = await getDbClient();
  try {
    await client.query('BEGIN');
    const saved = [];
    for (const record of records) {
      const recordParams = (record.params || {}) as Record<string, unknown>;
      const initialParams = {
        ...recordParams,
        model: record.model || recordParams.model,
        modelLabel: record.modelLabel || recordParams.modelLabel,
        isCustomModel: Boolean(record.isCustomModel),
        referenceImage: record.referenceImage || recordParams.referenceImage,
        referenceImages: record.referenceImages || recordParams.referenceImages,
      };
      const persistedReferences = await persistReferenceImages(getReferenceImageInputs({
        referenceImage: record.referenceImage,
        referenceImages: record.referenceImages,
        params: initialParams,
      }));
      const referenceImages = persistedReferences.map(item => item.url);
      const referenceImageThumbnails = persistedReferences.map(item => item.thumbnailUrl || item.url);
      const params = {
        ...initialParams,
        referenceImage: referenceImages[0] || undefined,
        referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
        referenceImageThumbnails: referenceImageThumbnails.length > 0 ? referenceImageThumbnails : undefined,
      };
      const workType = toWorkType(String(record.type || 'image'), params);
      let url = String(record.url || '').trim();
      let thumbnailUrl = String(record.thumbnailUrl || '').trim() || null;
      const width = getPositiveInteger(record.width || recordParams.width);
      const height = getPositiveInteger(record.height || recordParams.height);
      if (workType === 'reverse-prompt') {
        url = url && !url.startsWith('data:') ? url : `[reverse-prompt:${record.id || Date.now()}]`;
      }
      if (!url || url.startsWith('data:')) continue;
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        historyRecordDedupeLockKey(userId, url),
      ]);
      if (!thumbnailUrl && isVideoWorkType(workType)) {
        try {
          thumbnailUrl = await ensureLocalVideoThumbnail(url, 'thumbnails/works/videos', String(record.prompt || 'Video'));
        } catch (error) {
          console.warn('[creation-history] video thumbnail generation failed:', error instanceof Error ? error.message : error);
        }
      }
      if (!thumbnailUrl && (workType === 'text2img' || workType === 'img2img')) {
        try {
          thumbnailUrl = await ensureLocalImageThumbnail(url, 'thumbnails/works');
        } catch (error) {
          console.warn('[creation-history] thumbnail generation failed:', error instanceof Error ? error.message : error);
        }
      }
      const existing = await client.query(
        `SELECT id, type, prompt, negative_prompt, params, result_url, thumbnail_url, width, height, is_public, status, credits_cost, created_at
         FROM works
         WHERE user_id = $1 AND result_url = $2
         LIMIT 1`,
        [userId, url],
      );
      if (existing.rows[0]) {
        const existingRow = existing.rows[0];
        const existingParams = (existingRow.params || {}) as Record<string, unknown>;
        const shouldPatchReferences = referenceImages.length > 0 && (
          !Array.isArray(existingParams.referenceImages) ||
          existingParams.referenceImages.length === 0
        );
        if ((thumbnailUrl && !existingRow.thumbnail_url) || (width && !existingRow.width) || (height && !existingRow.height) || shouldPatchReferences) {
          const nextParams = shouldPatchReferences
            ? {
                ...existingParams,
                referenceImage: referenceImages[0],
                referenceImages,
                referenceImageThumbnails,
                refImageCount: Math.max(Number(existingParams.refImageCount || 0), referenceImages.length),
              }
            : existingParams;
          await client.query(
            `UPDATE works
             SET thumbnail_url = COALESCE(thumbnail_url, $1),
                 width = COALESCE(width, $2),
                 height = COALESCE(height, $3),
                 params = $4::jsonb
             WHERE id = $5`,
            [thumbnailUrl, width, height, JSON.stringify(nextParams), existingRow.id],
          );
          existingRow.thumbnail_url = existingRow.thumbnail_url || thumbnailUrl;
          existingRow.width = existingRow.width || width;
          existingRow.height = existingRow.height || height;
          existingRow.params = nextParams;
        }
        saved.push(mapCreationHistoryWork(existingRow));
        continue;
      }
      const result = await client.query(
        `INSERT INTO works (user_id, type, prompt, negative_prompt, params, result_url, thumbnail_url, width, height, is_public, status, credits_cost, created_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, 'completed', $11, COALESCE($12::timestamptz, NOW()))
         RETURNING id, type, prompt, negative_prompt, params, result_url, thumbnail_url, width, height, is_public, status, credits_cost, created_at`,
        [
          userId,
          workType,
          record.prompt || '',
          record.negativePrompt || null,
          JSON.stringify(params),
          url,
          thumbnailUrl,
          width,
          height,
          Boolean(record.published && record.publishedAt),
          Number(record.creditsCost || 0),
          record.createdAt || null,
        ],
      );
      if (result.rows[0]) saved.push(mapCreationHistoryWork(result.rows[0]));
    }
    await client.query('COMMIT');
    return saved;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
