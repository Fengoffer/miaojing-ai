import { NextRequest, NextResponse } from 'next/server';
import { sendVerificationCode, normalizeEmail, isValidEmail } from '@/lib/email-service';
import { getDbClient } from '@/storage/database/local-db';

export const runtime = 'nodejs';

function friendlyError(error: unknown) {
  return error instanceof Error ? error.message : '验证码发送失败，请稍后再试';
}

export async function POST(request: NextRequest) {
  const client = await getDbClient();
  try {
    const body = await request.json();
    const email = normalizeEmail(body.email);

    if (!isValidEmail(email)) {
      return NextResponse.json({ error: '请输入正确的邮箱地址' }, { status: 400 });
    }

    const existing = await client.query(
      'SELECT id FROM profiles WHERE LOWER(email) = LOWER($1) LIMIT 1',
      [email],
    );
    if (existing.rows.length > 0) {
      return NextResponse.json({ error: '该邮箱已注册，请直接登录' }, { status: 400 });
    }

    const result = await sendVerificationCode(client, request, { email, type: 'register' });
    return NextResponse.json({ ...result, message: '验证码已发送，请查收邮箱' });
  } catch (error) {
    return NextResponse.json({ error: friendlyError(error) }, { status: 400 });
  } finally {
    client.release();
  }
}
