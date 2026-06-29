import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getRequestBaseUrl, isValidEmail, normalizeEmail, sendTemplatedEmail, type EmailMessageType } from '@/lib/email-service';
import { getDbClient } from '@/storage/database/local-db';

export const runtime = 'nodejs';

const ALLOWED_TYPES: EmailMessageType[] = [
  'register_success',
  'email_verified',
  'password_reset_success',
  'security_login',
  'announcement',
  'order',
  'business',
];

export async function POST(request: NextRequest) {
  const adminError = await requireAdmin(request);
  if (adminError) return adminError;

  const client = await getDbClient();
  try {
    const body = await request.json();
    const to = normalizeEmail(body.to);
    const type = ALLOWED_TYPES.includes(body.type) ? body.type : 'business';
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 120) : '';
    const bodyText = typeof body.body === 'string' ? body.body.trim().slice(0, 4000) : '';
    const buttonText = typeof body.buttonText === 'string' ? body.buttonText.trim().slice(0, 40) : '';
    const buttonUrl = typeof body.buttonUrl === 'string' ? body.buttonUrl.trim().slice(0, 500) : '';

    if (!isValidEmail(to)) {
      return NextResponse.json({ error: '请输入正确的收件邮箱' }, { status: 400 });
    }
    if (!title || !bodyText) {
      return NextResponse.json({ error: '请填写邮件标题和正文' }, { status: 400 });
    }
    if (buttonUrl && !/^https?:\/\/[^\s"'<>]+$/i.test(buttonUrl)) {
      return NextResponse.json({ error: '按钮链接必须是 HTTP(S) 地址' }, { status: 400 });
    }

    await sendTemplatedEmail(client, {
      to,
      type,
      subject: `【妙境】${title}`,
      title,
      body: bodyText,
      buttonText: buttonText || undefined,
      buttonUrl: buttonUrl || undefined,
      note: '这是一封系统通知邮件，请勿直接回复。',
      ipAddress: 'admin',
      assetBaseUrl: getRequestBaseUrl(request) || undefined,
    });

    return NextResponse.json({ success: true, message: '邮件已发送' });
  } catch (error) {
    const message = error instanceof Error ? error.message : '邮件发送失败';
    return NextResponse.json({ error: message }, { status: 400 });
  } finally {
    client.release();
  }
}
