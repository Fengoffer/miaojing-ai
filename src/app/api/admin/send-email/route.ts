import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/session-auth';
import {
  createAdminEmailSendBatch,
  getRequestBaseUrl,
  isValidEmail,
  listAdminEmailSendBatches,
  normalizeEmail,
  sendAdminEmailBatchInBackground,
} from '@/lib/email-service';
import { getDbClient } from '@/storage/database/local-db';

export const runtime = 'nodejs';

const MAX_TARGETED_RECIPIENTS = 200;
const MAX_BROADCAST_RECIPIENTS = 5000;
type AdminMailKind = 'notification' | 'admin';
type AdminMailContentMode = 'markdown' | 'image';

function normalizeMailKind(value: unknown): AdminMailKind {
  return value === 'admin' ? 'admin' : 'notification';
}

function normalizeContentMode(value: unknown): AdminMailContentMode {
  return value === 'image' ? 'image' : 'markdown';
}

function normalizeIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(item => /^[0-9a-fA-F-]{36}$/.test(item)))];
}

function isUuid(value: string): boolean {
  return /^[0-9a-fA-F-]{36}$/.test(value);
}

function normalizeEmailList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map(normalizeEmail)
    .filter(isValidEmail))];
}

async function loadRecipients(client: Awaited<ReturnType<typeof getDbClient>>, body: Record<string, unknown>) {
  const mode = body.mode === 'all' ? 'all' : 'selected';

  if (mode === 'all') {
    const result = await client.query(
      `SELECT id, email
       FROM profiles
       WHERE COALESCE(role, 'user') NOT IN ('admin', 'enterprise_admin')
         AND COALESCE(is_active, true) = true
         AND COALESCE(email, '') <> ''
       ORDER BY created_at ASC
       LIMIT $1`,
      [MAX_BROADCAST_RECIPIENTS],
    );
    return result.rows
      .map(row => ({ id: String(row.id), email: normalizeEmail(row.email) }))
      .filter(row => isValidEmail(row.email));
  }

  const userIds = normalizeIdList(body.userIds);
  const emails = normalizeEmailList(body.emails);

  if (userIds.length === 0 && emails.length === 0) return [];
  if (userIds.length + emails.length > MAX_TARGETED_RECIPIENTS) {
    throw new Error(`单次指定发送最多 ${MAX_TARGETED_RECIPIENTS} 个收件人`);
  }

  const result = await client.query(
    `SELECT id, email
     FROM profiles
     WHERE COALESCE(role, 'user') NOT IN ('admin', 'enterprise_admin')
       AND COALESCE(is_active, true) = true
       AND COALESCE(email, '') <> ''
       AND (
         id = ANY($1::uuid[])
         OR LOWER(email) = ANY($2::text[])
       )`,
    [userIds, emails],
  );

  return result.rows
    .map(row => ({ id: String(row.id), email: normalizeEmail(row.email) }))
    .filter(row => isValidEmail(row.email));
}

export async function POST(request: NextRequest) {
  const admin = await requireAdminUser(request);
  if (admin instanceof NextResponse) return admin;

  const client = await getDbClient();
  let releaseClient = true;
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 120) : '';
    const content = typeof body.content === 'string' ? body.content.trim().slice(0, 20000) : '';
    const contentMode = normalizeContentMode(body.contentMode);
    const imageUrl = typeof body.imageUrl === 'string' ? body.imageUrl.trim().slice(0, 1000) : '';
    const imageAlt = typeof body.imageAlt === 'string' ? body.imageAlt.trim().slice(0, 120) : '';
    const buttonText = typeof body.buttonText === 'string' ? body.buttonText.trim().slice(0, 40) : '';
    const buttonUrl = typeof body.buttonUrl === 'string' ? body.buttonUrl.trim().slice(0, 500) : '';
    const mailKind = normalizeMailKind(body.mailKind);
    const mailKindLabel = mailKind === 'admin' ? '管理员邮件' : '通知邮件';

    if (!title || (contentMode === 'markdown' && !content)) {
      return NextResponse.json({ error: '请填写邮件标题和正文内容' }, { status: 400 });
    }
    if (contentMode === 'image' && !imageUrl) {
      return NextResponse.json({ error: '请填写纯图片邮件的图片地址' }, { status: 400 });
    }
    if (imageUrl && !/^https?:\/\/[^\s"'<>]+$/i.test(imageUrl) && !/^\/[^\s"'<>]+$/.test(imageUrl)) {
      return NextResponse.json({ error: '图片地址必须是 HTTP(S) 地址或站内 / 开头路径' }, { status: 400 });
    }
    if (buttonUrl && !/^https?:\/\/[^\s"'<>]+$/i.test(buttonUrl)) {
      return NextResponse.json({ error: '按钮链接必须是 HTTP(S) 地址' }, { status: 400 });
    }

    const recipients = await loadRecipients(client, body);
    const uniqueRecipients = [...new Map(recipients.map(item => [item.email, item])).values()];
    if (uniqueRecipients.length === 0) {
      return NextResponse.json({ error: '没有可发送的非管理员用户邮箱' }, { status: 400 });
    }

    const assetBaseUrl = getRequestBaseUrl(request) || undefined;
    const subject = `【妙境】${title}`;
    const batchId = await createAdminEmailSendBatch(client, {
      mode: body.mode === 'all' ? 'all' : 'selected',
      mailKind,
      title,
      subject,
      recipientCount: uniqueRecipients.length,
      createdBy: admin.userId,
    });

    releaseClient = false;
    void sendAdminEmailBatchInBackground({
      client,
      batchId,
      recipients: uniqueRecipients,
      mailKind,
      mailKindLabel,
      subject,
      title,
      content: contentMode === 'markdown' ? content : undefined,
      contentMode,
      imageUrl: contentMode === 'image' ? imageUrl : undefined,
      imageAlt: contentMode === 'image' ? imageAlt || title : undefined,
      buttonText: buttonText || undefined,
      buttonUrl: buttonUrl || undefined,
      assetBaseUrl,
      mode: body.mode === 'all' ? 'all' : 'selected',
    });

    return NextResponse.json({
      batchId,
      success: true,
      status: 'sending',
      total: uniqueRecipients.length,
      sent: 0,
      failedCount: 0,
      failed: [],
      message: `邮件已开始发送给 ${uniqueRecipients.length} 个用户，可在发送记录中查看进度`,
    }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : '邮件发送失败';
    return NextResponse.json({ error: message }, { status: 400 });
  } finally {
    if (releaseClient) client.release();
  }
}

export async function GET(request: NextRequest) {
  const admin = await requireAdminUser(request);
  if (admin instanceof NextResponse) return admin;

  const { searchParams } = new URL(request.url);
  const batchId = (searchParams.get('batchId') || '').trim();
  if (batchId && !isUuid(batchId)) {
    return NextResponse.json({ error: '邮件批次 ID 格式不正确' }, { status: 400 });
  }

  const client = await getDbClient();
  try {
    const result = await listAdminEmailSendBatches(client, {
      batchId: batchId || undefined,
      limit: Number(searchParams.get('limit') || 20),
      logLimit: Number(searchParams.get('logLimit') || (batchId ? 1000 : 200)),
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : '邮件发送记录加载失败';
    return NextResponse.json({ error: message }, { status: 400 });
  } finally {
    client.release();
  }
}
