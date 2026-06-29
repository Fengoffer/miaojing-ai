import { NextRequest, NextResponse } from 'next/server';
import { getDbClient } from '@/storage/database/local-db';
import { getAuthenticatedUserId } from '@/lib/session-auth';
import { resolveGalleryPublishMedia, resolveGalleryReferenceImages } from '@/lib/gallery-publish-media';

export async function POST(request: NextRequest) {
  try {
    const tokenUserId = await getAuthenticatedUserId(request);
    if (!tokenUserId) {
      return NextResponse.json({ error: '请先登录后再发布作品' }, { status: 401 });
    }

    const body = await request.json();
    const {
      userId,
      type,
      prompt,
      negativePrompt,
      resultUrl,
      thumbnailUrl,
      width,
      height,
      duration,
      params,
      model,
      modelLabel,
      creditsCost,
    } = body;

    if (!resultUrl) {
      return NextResponse.json({ error: '缺少作品 URL' }, { status: 400 });
    }

    const client = await getDbClient();

    try {
      const profileResult = await client.query(
        'SELECT id FROM profiles WHERE id = $1 AND is_active = true LIMIT 1',
        [tokenUserId],
      );
      if (profileResult.rows.length === 0) {
        return NextResponse.json({ error: '发布用户不存在或已停用' }, { status: 403 });
      }

      const paramsRecord = (params as Record<string, unknown> | undefined) || {};
      const referenceInput = [
        body.referenceImage,
        ...(Array.isArray(body.referenceImages) ? body.referenceImages : []),
        paramsRecord.referenceImage,
        ...(Array.isArray(paramsRecord.referenceImages) ? paramsRecord.referenceImages : []),
      ].filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
      const hasReference = referenceInput.length > 0;
      const explicitMode = paramsRecord.creationMode || body.creationMode;
      const workType = explicitMode === 'text2img' || explicitMode === 'img2img' || explicitMode === 'text2video' || explicitMode === 'img2video'
        ? explicitMode
        : type === 'video' ? (hasReference ? 'img2video' : 'text2video')
        : type === 'image' ? (hasReference ? 'img2img' : 'text2img')
        : type;

      const safeUserId = tokenUserId;

      const id = crypto.randomUUID();
      let galleryResultUrl = resultUrl;
      let galleryThumbnailUrl = thumbnailUrl || null;
      try {
        const media = await resolveGalleryPublishMedia({
          type,
          resultUrl,
          thumbnailUrl,
          prompt,
        });
        galleryResultUrl = media.resultUrl;
        galleryThumbnailUrl = media.thumbnailUrl;
      } catch (copyError) {
        console.warn('[gallery/publish] prepare gallery media failed:', copyError);
        return NextResponse.json({ error: '发布作品媒体处理失败，请重试' }, { status: 502 });
      }
      let galleryReferenceImages: string[] = [];
      try {
        galleryReferenceImages = await resolveGalleryReferenceImages(referenceInput);
      } catch (referenceError) {
        console.warn('[gallery/publish] prepare gallery reference images failed:', referenceError);
        return NextResponse.json({ error: '发布参考图处理失败，请重试' }, { status: 502 });
      }

      await client.query(
        `INSERT INTO works (id, user_id, type, title, prompt, negative_prompt, result_url, thumbnail_url, width, height, duration, is_public, likes_count, credits_cost, status, params)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true, 0, $12, 'completed', $13)`,
        [
          id,
          safeUserId,
          workType,
          body.title || null,
          prompt || null,
          negativePrompt || null,
          galleryResultUrl,
          galleryThumbnailUrl,
          width || null,
          height || null,
          duration || null,
          creditsCost || 0,
          JSON.stringify({
            ...paramsRecord,
            model,
            modelLabel,
            referenceImage: galleryReferenceImages[0],
            referenceImages: galleryReferenceImages.length > 0 ? galleryReferenceImages : undefined,
          }),
        ]
      );

      return NextResponse.json({ success: true, workId: id, resultUrl: galleryResultUrl, referenceImages: galleryReferenceImages });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[gallery/publish] POST error:', err);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}


