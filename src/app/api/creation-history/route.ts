import { NextRequest, NextResponse } from 'next/server';
import { getDbClient } from '@/storage/database/local-db';
import { getAuthenticatedUserId } from '@/lib/session-auth';
import { isTrustedInternalGenerationRequest, isUuid } from '@/lib/server-api-config';
import {
  isCurrentLocalImageThumbnail,
  isCurrentLocalVideoThumbnail,
} from '@/lib/media-storage';
import {
  dedupeRowsByResultUrl,
  ensureWorkThumbnail,
  isVideoWorkType,
  mapCreationHistoryWork,
  saveCreationHistoryRecords,
} from '@/lib/creation-history-service';

const workThumbnailQueue = new Map<string, Record<string, unknown>>();
let workThumbnailProcessing = false;
const DEFAULT_HISTORY_LIMIT = 300;
const MAX_HISTORY_LIMIT = 300;
const HISTORY_MODE_VALUES = new Set(['text2img', 'img2img', 'text2video', 'img2video', 'reverse-prompt']);
function getHistoryLimit(value: string | null): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return DEFAULT_HISTORY_LIMIT;
  return Math.min(MAX_HISTORY_LIMIT, Math.max(1, Math.round(number)));
}

function getHistoryMode(value: string | null): string | null {
  if (!value) return null;
  if (value === 'reversePrompt') return 'reverse-prompt';
  return HISTORY_MODE_VALUES.has(value) ? value : null;
}

function getHistoryModeCondition(): string {
  const hasReferenceCondition = `(
                 NULLIF(params->>'referenceImage', '') IS NOT NULL
                 OR (CASE WHEN jsonb_typeof(params->'referenceImages') = 'array' THEN jsonb_array_length(params->'referenceImages') ELSE 0 END) > 0
                 OR (CASE WHEN (params->>'refImageCount') ~ '^[0-9]+$' THEN (params->>'refImageCount')::int ELSE 0 END) > 0
               )`;
  return `AND (
           type = $2
           OR params->>'creationMode' = $2
           OR params->>'workType' = $2
           OR params->>'mode' = $2
           OR (
             $2 IN ('text2img', 'img2img')
             AND type = 'image'
             AND (
               ($2 = 'img2img' AND ${hasReferenceCondition})
               OR ($2 = 'text2img' AND NOT ${hasReferenceCondition})
             )
           )
           OR (
             $2 IN ('text2video', 'img2video')
             AND type = 'video'
             AND (
               ($2 = 'img2video' AND ${hasReferenceCondition})
               OR ($2 = 'text2video' AND NOT ${hasReferenceCondition})
             )
           )
         )`;
}

function scheduleWorkThumbnail(row: Record<string, unknown>) {
  const type = String(row.type || '');
  if (typeof row.result_url !== 'string') return;
  if (isVideoWorkType(type)) {
    if (isCurrentLocalVideoThumbnail(row.thumbnail_url)) return;
  } else {
    if (isCurrentLocalImageThumbnail(row.thumbnail_url) || (type !== 'text2img' && type !== 'img2img')) return;
  }
  const id = String(row.id || row.result_url);
  workThumbnailQueue.set(id, row);
  if (workThumbnailProcessing) return;
  workThumbnailProcessing = true;
  void (async () => {
    try {
      while (workThumbnailQueue.size > 0) {
        const [nextId, nextRow] = workThumbnailQueue.entries().next().value as [string, Record<string, unknown>];
        workThumbnailQueue.delete(nextId);
        const client = await getDbClient();
        try {
          await ensureWorkThumbnail(client, nextRow);
        } finally {
          client.release();
        }
      }
    } catch (error) {
      console.warn('[creation-history] scheduled thumbnail generation failed:', error instanceof Error ? error.message : error);
    } finally {
      workThumbnailProcessing = false;
      if (workThumbnailQueue.size > 0) scheduleWorkThumbnail(workThumbnailQueue.values().next().value as Record<string, unknown>);
    }
  })();
}

export async function GET(request: NextRequest) {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  const limit = getHistoryLimit(request.nextUrl.searchParams.get('limit'));
  const mode = getHistoryMode(request.nextUrl.searchParams.get('mode'));
  const client = await getDbClient();
  try {
    const sql = `SELECT id, type, prompt, negative_prompt, params, result_url, thumbnail_url, width, height, is_public, status, credits_cost, created_at
       FROM works
       WHERE user_id = $1 AND status = 'completed'
         ${mode ? getHistoryModeCondition() : ''}
       ORDER BY created_at DESC
       LIMIT $${mode ? 3 : 2}`;
    const result = await client.query(sql, mode ? [userId, mode, limit] : [userId, limit]);
    const rows = dedupeRowsByResultUrl(result.rows);
    for (const row of rows) scheduleWorkThumbnail(row);
    return NextResponse.json({ records: rows.map(mapCreationHistoryWork) });
  } finally {
    client.release();
  }
}

export async function POST(request: NextRequest) {
  const trustedInternalRequest = isTrustedInternalGenerationRequest(request);
  const trustedUserId = trustedInternalRequest
    ? request.headers.get('x-miaojing-generation-user-id')
    : null;
  const userId = isUuid(trustedUserId)
    ? trustedUserId
    : await getAuthenticatedUserId(request);
  if (!userId) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  const body = await request.json();
  const records = Array.isArray(body.records) ? body.records : [body];
  const saved = await saveCreationHistoryRecords(userId, records);
  return NextResponse.json({ records: saved });
}

export async function DELETE(request: NextRequest) {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  const id = request.nextUrl.searchParams.get('id');
  const client = await getDbClient();
  try {
    if (id) {
      await client.query('DELETE FROM works WHERE id = $1 AND user_id = $2', [id, userId]);
    } else {
      await client.query('DELETE FROM works WHERE user_id = $1', [userId]);
    }
    return NextResponse.json({ success: true });
  } finally {
    client.release();
  }
}
