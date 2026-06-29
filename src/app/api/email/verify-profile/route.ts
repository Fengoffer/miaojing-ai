import { NextRequest, NextResponse } from 'next/server';
import { ensureEmailSchema, getRequestBaseUrl, isValidEmail, normalizeEmail, sendTemplatedEmail, verifyEmailCode } from '@/lib/email-service';
import { getDbClient } from '@/storage/database/local-db';
import { getAuthenticatedUserId } from '@/lib/session-auth';

export const runtime = 'nodejs';

function friendlyError(error: unknown) {
  return error instanceof Error ? error.message : '邮箱验证失败，请稍后再试';
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
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    if (!isValidEmail(email) || !/^[a-z0-9]{4,10}$/i.test(code)) {
      return NextResponse.json({ error: '邮箱或验证码格式不正确' }, { status: 400 });
    }

    await client.query('BEGIN');
    await verifyEmailCode(client, { email, type: 'verify_email', code });

    const duplicate = await client.query(
      'SELECT id FROM profiles WHERE LOWER(email) = LOWER($1) AND id <> $2 LIMIT 1',
      [email, userId],
    );
    if (duplicate.rows.length > 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: '该邮箱已被其他账号绑定' }, { status: 400 });
    }

    const domain = email.includes('@') ? email.split('@')[1] : null;
    const profile = await client.query(
      `UPDATE profiles
       SET email = $1,
           email_verified = true,
           email_verified_at = NOW(),
           email_bound_at = COALESCE(email_bound_at, NOW()),
           email_sender_domain = $2,
           updated_at = NOW()
       WHERE id = $3
       RETURNING id, email, nickname, phone, role, membership_tier, credits_balance, daily_quota_used, daily_quota_limit, avatar_url, created_at, email_verified, email_verified_at, email_bound_at`,
      [email, domain, userId],
    );
    await client.query('UPDATE auth.users SET email = $1 WHERE id = $2', [email, userId]);
    await client.query('COMMIT');

    await sendTemplatedEmail(client, {
      to: email,
      type: 'email_verified',
      subject: '【妙境】邮箱验证成功',
      title: '邮箱验证成功',
      intro: '你的账号邮箱已完成验证，后续可用于找回密码和安全通知。',
      note: '若非本人操作，请尽快修改账号密码。',
      assetBaseUrl: getRequestBaseUrl(request) || undefined,
    }).catch(() => undefined);

    return NextResponse.json({ success: true, profile: profile.rows[0], message: '邮箱验证成功' });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    return NextResponse.json({ error: friendlyError(error) }, { status: 400 });
  } finally {
    client.release();
  }
}
