import { NextRequest, NextResponse } from 'next/server';
import { ensureEmailSchema, getRequestBaseUrl, isValidEmail, normalizeEmail, sendTemplatedEmail, verifyEmailCode } from '@/lib/email-service';
import { getDbClient } from '@/storage/database/local-db';

export const runtime = 'nodejs';

function passwordStrongEnough(value: string): boolean {
  return value.length >= 8 && /[a-zA-Z]/.test(value) && /\d/.test(value);
}

function friendlyError(error: unknown) {
  return error instanceof Error ? error.message : '密码重置失败，请稍后再试';
}

export async function POST(request: NextRequest) {
  const client = await getDbClient();
  try {
    await ensureEmailSchema(client);
    const body = await request.json();
    const email = normalizeEmail(body.email);
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

    if (!isValidEmail(email) || !/^[a-z0-9]{4,10}$/i.test(code)) {
      return NextResponse.json({ error: '邮箱或验证码格式不正确' }, { status: 400 });
    }
    if (!passwordStrongEnough(newPassword)) {
      return NextResponse.json({ error: '新密码至少 8 位，并同时包含字母和数字' }, { status: 400 });
    }

    await client.query('BEGIN');
    await verifyEmailCode(client, { email, type: 'reset_password', code });

    const user = await client.query(
      `SELECT p.id, p.nickname
       FROM profiles p
       JOIN auth.users u ON u.id = p.id
       WHERE LOWER(p.email) = LOWER($1) AND p.email_verified = true
       LIMIT 1`,
      [email],
    );
    if (user.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: '该邮箱尚未绑定或未完成验证' }, { status: 400 });
    }

    await client.query(
      `UPDATE auth.users
       SET password_hash = crypt($1, gen_salt('bf'))
       WHERE id = $2`,
      [newPassword, user.rows[0].id],
    );
    await client.query('COMMIT');

    await sendTemplatedEmail(client, {
      to: email,
      type: 'password_reset_success',
      subject: '【妙境】密码已重置',
      title: '密码重置成功',
      intro: '你的妙境账号密码已成功重置。请使用新密码重新登录。',
      note: '若非本人操作，请立即联系管理员并检查账号安全。',
      assetBaseUrl: getRequestBaseUrl(request) || undefined,
    }).catch(() => undefined);

    return NextResponse.json({ success: true, message: '密码已重置，请重新登录' });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    return NextResponse.json({ error: friendlyError(error) }, { status: 400 });
  } finally {
    client.release();
  }
}
