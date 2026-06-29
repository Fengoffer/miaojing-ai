import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import {
  getEmailSettings,
  getRequestBaseUrl,
  publicEmailSettings,
  renderEmailTemplate,
  saveEmailSettings,
  sendTemplatedEmail,
} from '@/lib/email-service';
import { getDbClient } from '@/storage/database/local-db';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const adminError = await requireAdmin(request);
  if (adminError) return adminError;

  const client = await getDbClient();
  try {
    const settings = await getEmailSettings(client);
    const platformUrl = getRequestBaseUrl(request) || settings.appBaseUrl;
    const preview = renderEmailTemplate(settings, {
      title: '通知邮件模板预览',
      intro: '这是一封由管理员发送给用户的通知邮件示例，用于预览全局通用邮件模板效果。',
      body: '你可以在后台使用这套模板发送系统公告、功能更新、订单提醒、活动通知和安全提醒。实际发送时，标题、正文、按钮和备注会替换为管理员填写的内容。',
      buttonText: '进入妙境',
      buttonUrl: platformUrl,
      note: '验证码邮件使用独立安全验证模板；管理员通知、管理员邮件和提醒邮件使用这套通用模板。',
      templateKind: 'notification',
      assetBaseUrl: platformUrl,
    });
    return NextResponse.json({ settings: publicEmailSettings(settings), preview });
  } finally {
    client.release();
  }
}

export async function PUT(request: NextRequest) {
  const adminError = await requireAdmin(request);
  if (adminError) return adminError;

  const client = await getDbClient();
  try {
    const body = await request.json();
    const settings = await saveEmailSettings(client, body);
    return NextResponse.json({ success: true, settings, message: '邮箱配置已保存' });
  } catch (error) {
    const message = error instanceof Error ? error.message : '邮箱配置保存失败';
    return NextResponse.json({ error: message }, { status: 400 });
  } finally {
    client.release();
  }
}

export async function POST(request: NextRequest) {
  const adminError = await requireAdmin(request);
  if (adminError) return adminError;

  const client = await getDbClient();
  try {
    const body = await request.json();
    const to = typeof body.to === 'string' ? body.to.trim() : '';
    if (!to) {
      return NextResponse.json({ error: '请填写测试收件邮箱' }, { status: 400 });
    }
    await sendTemplatedEmail(client, {
      to,
      type: 'business',
      subject: '【妙境】邮箱配置测试',
      title: '邮箱配置测试',
      intro: '如果你收到这封邮件，说明自定义域名邮箱 SMTP 配置已生效。',
      note: '请同时检查收件箱、垃圾箱，以及 SPF/DKIM/DMARC 解析状态。',
      ipAddress: 'admin-test',
      assetBaseUrl: getRequestBaseUrl(request) || undefined,
    });
    return NextResponse.json({ success: true, message: '测试邮件已发送' });
  } catch (error) {
    const message = error instanceof Error ? error.message : '测试邮件发送失败';
    return NextResponse.json({ error: message }, { status: 400 });
  } finally {
    client.release();
  }
}
