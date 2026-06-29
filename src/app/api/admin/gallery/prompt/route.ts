import { NextRequest, NextResponse } from 'next/server';
import type { PoolClient } from 'pg';
import {
  AdminGalleryPromptError,
  updateAdminGalleryPrompt,
  type AdminGalleryPromptEmailMessage,
  type AdminGalleryPromptWorkRow,
} from '@/lib/admin-gallery-prompt-service';
import { getRequestBaseUrl, sendTemplatedEmail } from '@/lib/email-service';
import { writePlatformLog } from '@/lib/platform-logs';
import { requireAdminUser } from '@/lib/session-auth';
import { getDbClient } from '@/storage/database/local-db';

export const runtime = 'nodejs';

async function loadPublicGalleryWork(client: PoolClient, workId: string): Promise<AdminGalleryPromptWorkRow | null> {
  const result = await client.query(
    `SELECT w.id, w.user_id, w.type, w.title, w.prompt, w.negative_prompt,
            w.result_url, w.thumbnail_url, w.likes_count, w.is_public, w.status, w.created_at,
            p.email AS author_email,
            p.nickname AS author_nickname,
            p.display_nickname AS author_display_nickname,
            p.avatar_url AS author_avatar_url
     FROM works w
     LEFT JOIN profiles p ON p.id = w.user_id
     WHERE w.id = $1
     LIMIT 1`,
    [workId],
  );
  return (result.rows[0] as AdminGalleryPromptWorkRow | undefined) || null;
}

export async function PUT(request: NextRequest) {
  const admin = await requireAdminUser(request);
  if (admin instanceof NextResponse) return admin;

  const body = await request.json().catch(() => ({}));
  const client = await getDbClient();
  try {
    const assetBaseUrl = getRequestBaseUrl(request) || undefined;
    const result = await updateAdminGalleryPrompt(body, {
      admin,
      loadWork: workId => loadPublicGalleryWork(client, workId),
      updatePrompt: async (workId, prompt) => {
        const updateResult = await client.query(
          'UPDATE works SET prompt = $2, updated_at = NOW() WHERE id = $1 RETURNING id',
          [workId, prompt],
        );
        if ((updateResult.rowCount || 0) === 0) {
          throw new AdminGalleryPromptError('作品更新失败', 500);
        }
        const updated = await loadPublicGalleryWork(client, workId);
        if (!updated) throw new AdminGalleryPromptError('作品更新后读取失败', 500);
        return updated;
      },
      sendEmail: async (message: AdminGalleryPromptEmailMessage) => {
        try {
          await sendTemplatedEmail(client, {
            to: message.to,
            type: 'business',
            subject: message.subject,
            title: message.subject,
            body: message.body,
            note: '这是一封公开作品内容调整通知，请勿直接回复。',
            templateKind: 'admin',
            ipAddress: 'admin-gallery-prompt',
            assetBaseUrl,
          });
        } catch (error) {
          const text = error instanceof Error ? error.message : String(error);
          throw new AdminGalleryPromptError(`邮件发送失败：${text}`, 502);
        }
      },
      writeLog: async entry => {
        await writePlatformLog({
          type: entry.type === 'admin' ? 'admin' : 'admin',
          level: entry.level === 'warning' || entry.level === 'error' ? entry.level : 'info',
          action: String(entry.action || 'admin_gallery_prompt_update'),
          message: String(entry.message || '管理员修改公开画廊作品提示词并发送邮件通知'),
          userId: typeof entry.userId === 'string' ? entry.userId : admin.userId,
          targetType: typeof entry.targetType === 'string' ? entry.targetType : 'work',
          targetId: typeof entry.targetId === 'string' ? entry.targetId : null,
          metadata: (entry.metadata && typeof entry.metadata === 'object' ? entry.metadata : {}) as Record<string, unknown>,
          request,
        });
      },
    });

    return NextResponse.json({
      success: true,
      work: result.work,
      notificationSent: result.notificationSent,
    });
  } catch (error) {
    const status = error instanceof AdminGalleryPromptError ? error.status : 500;
    const message = error instanceof Error ? error.message : '修改画廊作品提示词失败';
    if (status >= 500) console.error('[admin/gallery/prompt] PUT error:', error);
    return NextResponse.json({ error: message }, { status });
  } finally {
    client.release();
  }
}
