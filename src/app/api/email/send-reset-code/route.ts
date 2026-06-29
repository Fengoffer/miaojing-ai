import { NextRequest, NextResponse } from 'next/server';
import { ensureEmailSchema, isValidEmail, normalizeEmail, sendVerificationCode } from '@/lib/email-service';
import { getDbClient } from '@/storage/database/local-db';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const client = await getDbClient();
  try {
    await ensureEmailSchema(client);
    const body = await request.json();
    const email = normalizeEmail(body.email);
    if (!isValidEmail(email)) {
      return NextResponse.json({ error: '请输入正确的邮箱地址' }, { status: 400 });
    }

    const user = await client.query(
      `SELECT p.id
       FROM profiles p
       JOIN auth.users u ON u.id = p.id
       WHERE LOWER(p.email) = LOWER($1) AND p.email_verified = true AND u.password_hash IS NOT NULL
       LIMIT 1`,
      [email],
    );

    if (user.rows.length > 0) {
      try {
        await sendVerificationCode(client, request, {
          email,
          type: 'reset_password',
          userId: user.rows[0].id,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : '验证码发送失败，请稍后再试';
        return NextResponse.json({ error: message }, { status: 400 });
      }
    }

    return NextResponse.json({
      success: true,
      cooldown: 60,
      message: '如果该邮箱已绑定并验证，我们已发送重置验证码',
    });
  } finally {
    client.release();
  }
}
