import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getDbClient } from '@/storage/database/local-db';
import {
  ensureLocalImageThumbnail,
  ensureLocalVideoThumbnail,
  isCurrentLocalImageThumbnail,
  isCurrentLocalVideoThumbnail,
} from '@/lib/media-storage';
import { MAX_PUBLIC_GALLERY_AVATAR_URL_LENGTH, toPublicGalleryWork } from '@/lib/gallery-response';

const galleryThumbnailQueue = new Map<string, Record<string, unknown>>();
let galleryThumbnailProcessing = false;

function hasGalleryReferenceMetadata(params: Record<string, unknown>) {
  return typeof params.referenceImage === 'string' && params.referenceImage.trim().length > 0
    || (Array.isArray(params.referenceImages) && params.referenceImages.length > 0);
}

function mergeGalleryRowMetadata(target: Record<string, unknown>, source: Record<string, unknown>) {
  const targetParams = (target.params || {}) as Record<string, unknown>;
  const sourceParams = (source.params || {}) as Record<string, unknown>;
  if (!target.thumbnail_url && source.thumbnail_url) target.thumbnail_url = source.thumbnail_url;
  if (!target.width && source.width) target.width = source.width;
  if (!target.height && source.height) target.height = source.height;
  if (!hasGalleryReferenceMetadata(targetParams) && hasGalleryReferenceMetadata(sourceParams)) {
    target.params = {
      ...targetParams,
      referenceImage: sourceParams.referenceImage,
      referenceImages: sourceParams.referenceImages,
      referenceImageThumbnails: sourceParams.referenceImageThumbnails,
      refImageCount: sourceParams.refImageCount,
    };
  }
}

function dedupeGalleryRowsByResultUrl(rows: Record<string, unknown>[], metadataRows: Record<string, unknown>[] = []) {
  const byUrl = new Map<string, Record<string, unknown>[]>();
  for (const row of [...rows, ...metadataRows]) {
    if (typeof row.result_url !== 'string' || !row.result_url.trim()) continue;
    const group = byUrl.get(row.result_url) || [];
    group.push(row);
    byUrl.set(row.result_url, group);
  }
  return rows.map(row => {
    if (typeof row.result_url !== 'string' || !row.result_url.trim()) return row;
    const group = byUrl.get(row.result_url) || [];
    for (const candidate of group) {
      if (candidate.user_id && row.user_id && candidate.user_id !== row.user_id) continue;
      if (candidate !== row) mergeGalleryRowMetadata(row, candidate);
    }
    return row;
  });
}

async function ensureGalleryThumbnail(client: Awaited<ReturnType<typeof getDbClient>>, row: Record<string, unknown>) {
  const type = String(row.type || '');
  if (typeof row.result_url !== 'string') return row;
  if (type === 'text2video' || type === 'img2video') {
    if (isCurrentLocalVideoThumbnail(row.thumbnail_url)) return row;
    try {
      const thumbnailUrl = await ensureLocalVideoThumbnail(row.result_url, 'thumbnails/gallery/videos', String(row.prompt || 'Video'));
      if (!thumbnailUrl) return row;
      await client.query('UPDATE works SET thumbnail_url = $1 WHERE id = $2', [thumbnailUrl, row.id]);
      return { ...row, thumbnail_url: thumbnailUrl };
    } catch (error) {
      console.warn('[gallery] video thumbnail generation failed:', error instanceof Error ? error.message : error);
      return row;
    }
  }
  if (isCurrentLocalImageThumbnail(row.thumbnail_url)) return row;
  if (type !== 'text2img' && type !== 'img2img') return row;
  try {
    const thumbnailUrl = await ensureLocalImageThumbnail(row.result_url, 'thumbnails/gallery');
    if (!thumbnailUrl) return row;
    await client.query('UPDATE works SET thumbnail_url = $1 WHERE id = $2', [thumbnailUrl, row.id]);
    return { ...row, thumbnail_url: thumbnailUrl };
  } catch (error) {
    console.warn('[gallery] thumbnail generation failed:', error instanceof Error ? error.message : error);
    return row;
  }
}

function scheduleGalleryThumbnail(row: Record<string, unknown>) {
  const type = String(row.type || '');
  if (typeof row.result_url !== 'string') return;
  if (type === 'text2video' || type === 'img2video') {
    if (isCurrentLocalVideoThumbnail(row.thumbnail_url)) return;
  } else {
    if (isCurrentLocalImageThumbnail(row.thumbnail_url) || (type !== 'text2img' && type !== 'img2img')) return;
  }
  const id = String(row.id || row.result_url);
  galleryThumbnailQueue.set(id, row);
  if (galleryThumbnailProcessing) return;
  galleryThumbnailProcessing = true;
  void (async () => {
    try {
      while (galleryThumbnailQueue.size > 0) {
        const [nextId, nextRow] = galleryThumbnailQueue.entries().next().value as [string, Record<string, unknown>];
        galleryThumbnailQueue.delete(nextId);
        const client = await getDbClient();
        try {
          await ensureGalleryThumbnail(client, nextRow);
        } finally {
          client.release();
        }
      }
    } catch (error) {
      console.warn('[gallery] scheduled thumbnail generation failed:', error instanceof Error ? error.message : error);
    } finally {
      galleryThumbnailProcessing = false;
      if (galleryThumbnailQueue.size > 0) {
        scheduleGalleryThumbnail(galleryThumbnailQueue.values().next().value as Record<string, unknown>);
      }
    }
  })();
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams;
  const type = url.get('type');
  const category = url.get('category');
  const requestedLimit = parseInt(url.get('limit') || '50', 10);
  const requestedOffset = parseInt(url.get('offset') || '0', 10);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 300)) : 50;
  const offset = Number.isFinite(requestedOffset) ? Math.max(0, requestedOffset) : 0;
  const sort = url.get('sort') || 'newest';
  const search = (url.get('q') || url.get('search') || '').trim().toLowerCase();

  try {
    const client = await getDbClient();

    try {
      const where: string[] = [
        'w.is_public = true',
        'w.status = $1',
        "w.result_url LIKE '/api/local-storage/%'",
      ];
      const params: unknown[] = ['completed'];

      if (type === 'image') {
        params.push('text2img', 'img2img');
        where.push(`w.type IN ($${params.length - 1}, $${params.length})`);
      } else if (type === 'video') {
        params.push('text2video', 'img2video');
        where.push(`w.type IN ($${params.length - 1}, $${params.length})`);
      }

      if (category === 'text2img' || category === 'img2img' || category === 'text2video' || category === 'img2video') {
        params.push(category);
        const idx = params.length;
        where.push(`(
          w.type = $${idx}
          OR COALESCE(w.params->>'creationMode', w.params->>'workType', w.params->>'mode') = $${idx}
        )`);
      }

      if (search) {
        params.push(`%${search}%`);
        const idx = params.length;
        where.push(`(
          LOWER(COALESCE(w.title, '')) LIKE $${idx}
          OR LOWER(COALESCE(w.prompt, '')) LIKE $${idx}
          OR LOWER(COALESCE(w.negative_prompt, '')) LIKE $${idx}
          OR LOWER(COALESCE(p.display_nickname, p.nickname, '')) LIKE $${idx}
          OR LOWER(COALESCE(p.nickname, '')) LIKE $${idx}
          OR LOWER(COALESCE(p.email, '')) LIKE $${idx}
          OR LOWER(COALESCE(w.params::text, '')) LIKE $${idx}
        )`);
      }

      let query = `
        SELECT w.id, w.type, w.title, w.prompt, w.negative_prompt, w.result_url, w.thumbnail_url,
               w.width, w.height, w.duration, w.is_public, w.likes_count, w.credits_cost,
               w.status, w.created_at, w.user_id, w.params,
               p.nickname, p.display_nickname, p.email,
               CASE
                 WHEN p.avatar_url IS NULL OR p.avatar_url = '' THEN NULL
                 WHEN p.avatar_url LIKE 'data:%' OR length(p.avatar_url) > ${MAX_PUBLIC_GALLERY_AVATAR_URL_LENGTH} THEN NULL
                 ELSE p.avatar_url
               END AS avatar_url
        FROM works w
        LEFT JOIN profiles p ON p.id = w.user_id
        WHERE ${where.join(' AND ')}
      `;

      if (sort === 'popular') {
        query += ' ORDER BY w.likes_count DESC, w.created_at DESC';
      } else {
        query += ' ORDER BY w.created_at DESC';
      }

      query += ` LIMIT ${limit} OFFSET ${offset}`;

      const result = await client.query(query, params);
      const countResult = await client.query(
        `SELECT COUNT(*) as total
         FROM works w
         LEFT JOIN profiles p ON p.id = w.user_id
         WHERE ${where.join(' AND ')}`,
        params,
      );

      for (const row of result.rows || []) scheduleGalleryThumbnail(row);
      const resultRows = result.rows || [];
      const resultUrls = [...new Set(resultRows
        .map((row: Record<string, unknown>) => typeof row.result_url === 'string' ? row.result_url.trim() : '')
        .filter(Boolean))];
      let metadataRows: Record<string, unknown>[] = [];
      if (resultUrls.length > 0) {
        const metadataResult = await client.query(
          `SELECT id, result_url, thumbnail_url, width, height, user_id, params
             FROM works
            WHERE status = $1
              AND result_url = ANY($2::text[])`,
          ['completed', resultUrls],
        );
        metadataRows = metadataResult.rows || [];
      }
      const rows = dedupeGalleryRowsByResultUrl(resultRows, metadataRows);
      const works = rows.map((row: Record<string, unknown>) => toPublicGalleryWork(row));

      const total = parseInt(countResult.rows[0]?.total || '0', 10);
      const nextOffset = offset + works.length;

      return NextResponse.json(
        {
          works,
          total,
          nextOffset,
          hasMore: nextOffset < total,
        },
        {
          headers: {
            'Cache-Control': 'private, max-age=30, stale-while-revalidate=120',
          },
        },
      );
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[gallery] GET error:', err);
    return NextResponse.json({ error: '获取作品列表失败' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const body = await request.json().catch(() => ({}));
    const searchId = request.nextUrl.searchParams.get('id');
    const bodyIds = Array.isArray(body.ids) ? body.ids : [];
    const ids = [...new Set([searchId, ...bodyIds].filter((id): id is string => typeof id === 'string' && id.trim().length > 0))];

    if (ids.length === 0) {
      return NextResponse.json({ error: '缺少要删除的作品 ID' }, { status: 400 });
    }
    if (ids.length > 100) {
      return NextResponse.json({ error: '单次最多删除 100 个画廊作品' }, { status: 400 });
    }

    const client = await getDbClient();
    try {
      const result = await client.query(
        `UPDATE works
         SET is_public = false
         WHERE id = ANY($1) AND is_public = true
         RETURNING id`,
        [ids],
      );
      return NextResponse.json({
        success: true,
        removed: result.rowCount || 0,
        ids: result.rows.map((row: Record<string, unknown>) => row.id),
      });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[gallery] DELETE error:', err);
    return NextResponse.json({ error: '删除画廊作品失败' }, { status: 500 });
  }
}
