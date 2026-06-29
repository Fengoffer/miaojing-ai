import { NextRequest, NextResponse } from 'next/server';
import { ensureEmailSchema, isValidEmail, normalizeEmail, sendVerificationCode } from '@/lib/email-service';
import { getDbClient } from '@/storage/database/local-db';
import { getAuthenticatedUserId } from '@/lib/session-auth';

export const runtime = 'nodejs';

function friendlyError(error: unknown) {
  return error instanceof Error ? error.message : '验证码发送失败，请稍后再试';
}

export async function POST(request: NextRequest) {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) {
    return NextResponse.json({ error: '请先登录后再验证邮箱' }, { status: 401 });
  }

  const client = await getDbClient();
  try {
    await ensureEmailSchema(client);
    const body = await request.json();
    const email = normalizeEmail(body.email);
    if (!isValidEmail(email)) {
      return NextResponse.json({ error: '请输入正确的邮箱地址' }, { status: 400 });
    }

    const user = await client.query('SELECT id, email FROM profiles WHERE id = $1 LIMIT 1', [userId]);
    if (user.rows.length === 0) {
      return NextResponse.json({ error: '账号不存在，请重新登录' }, { status: 404 });
    }

    const duplicate = await client.query(
      'SELECT id FROM profiles WHERE LOWER(email) = LOWER($1) AND id <> $2 LIMIT 1',
      [email, userId],
    );
    if (duplicate.rows.length > 0) {
      return NextResponse.json({ error: '该邮箱已被其他账号绑定' }, { status: 400 });
    }

    const result = await sendVerificationCode(client, request, { email, type: 'verify_email', userId });
    return NextResponse.json({ ...result, message: '验证码已发送，请查收邮箱' });
  } catch (error) {
    return NextResponse.json({ error: friendlyError(error) }, { status: 400 });
  } finally {
    client.release();
  }
}
