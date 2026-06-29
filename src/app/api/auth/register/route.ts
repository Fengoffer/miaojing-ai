import { NextRequest, NextResponse } from 'next/server';
import { getDbClient } from '@/storage/database/local-db';
import { ensureEmailSchema, getRequestBaseUrl, normalizeEmail, sendTemplatedEmail, verifyEmailCode } from '@/lib/email-service';
import { getRequiredProductionSecret } from '@/lib/runtime-env';
import { ensureProfilePreferenceSchema } from '@/lib/profile-preferences';
import { ensureUserDisplayProfileSchema, generateChineseNickname, generateDefaultAvatarDataUrl, normalizeUsername } from '@/lib/user-profile-defaults';
import { createSessionToken } from '@/lib/session-auth';
import {
  INVITATION_BONUS_CREDITS,
  applyInvitationReward,
  ensureInvitationSchema,
  findInviterByCode,
  getOrCreateInviteCode,
  normalizeInviteCode,
} from '@/lib/invitation-service';

function isStrongPassword(password: string): boolean {
  return password.length >= 8 && /[A-Za-z]/.test(password) && /\d/.test(password);
}

export async function POST(request: NextRequest) {
  try {
    const { email, password, nickname, phone, inviteCode, referralCode, emailCode, acceptedTerms } = await request.json();
    const normalizedEmail = normalizeEmail(email);
    const normalizedReferralCode = normalizeInviteCode(referralCode || inviteCode);

    if (!normalizedEmail || !password) {
      return NextResponse.json({ error: 'Please enter email and password' }, { status: 400 });
    }

    if (acceptedTerms !== true) {
      return NextResponse.json({ error: '请先阅读并同意服务条款和隐私政策' }, { status: 400 });
    }

    if (!isStrongPassword(password)) {
      return NextResponse.json({ error: '密码至少 8 位，并同时包含字母和数字' }, { status: 400 });
    }

    const isAdminRegistration = typeof inviteCode === 'string'
      && inviteCode === getRequiredProductionSecret('ADMIN_INVITE_CODE', 'miaojing-admin-2024');
    const client = await getDbClient();

    try {
      await ensureEmailSchema(client);
      await ensureProfilePreferenceSchema(client);
      await ensureUserDisplayProfileSchema(client);
      await ensureInvitationSchema(client);
      if (isAdminRegistration) {
        const existingAdminResult = await client.query(
          'SELECT id FROM profiles WHERE role = $1',
          ['admin']
        );

        if (existingAdminResult.rows.length > 0) {
          return NextResponse.json(
            { error: 'Admin account already exists' },
            { status: 400 }
          );
        }
      }

      const existingUserResult = await client.query(
        'SELECT id FROM profiles WHERE email = $1',
        [normalizedEmail]
      );

      if (existingUserResult.rows.length > 0) {
        return NextResponse.json(
          { error: 'Email is already registered' },
          { status: 400 }
        );
      }

      const userId = crypto.randomUUID();
      const username = normalizeUsername(nickname, normalizedEmail.split('@')[0]);

      const existingUsernameResult = await client.query(
        'SELECT id FROM profiles WHERE LOWER(nickname) = LOWER($1) LIMIT 1',
        [username]
      );

      if (existingUsernameResult.rows.length > 0) {
        return NextResponse.json(
          { error: 'Username is already registered' },
          { status: 400 }
        );
      }

      if (!isAdminRegistration) {
        if (typeof emailCode !== 'string' || !/^[a-z0-9]{4,10}$/i.test(emailCode)) {
          return NextResponse.json({ error: '请输入正确的邮箱验证码' }, { status: 400 });
        }
        await client.query('BEGIN');
        try {
          await verifyEmailCode(client, {
            email: normalizedEmail,
            type: 'register',
            code: typeof emailCode === 'string' ? emailCode : '',
          });
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      }

      const inviter = !isAdminRegistration && normalizedReferralCode
        ? await findInviterByCode(client, normalizedReferralCode)
        : null;
      if (normalizedReferralCode && !isAdminRegistration && !inviter) {
        return NextResponse.json({ error: '邀请链接无效或邀请人账号不可用' }, { status: 400 });
      }

      const role = isAdminRegistration ? 'admin' : 'user';
      const membershipTier = isAdminRegistration ? 'enterprise' : 'free';
      const creditsBalance = isAdminRegistration ? 9999 : 10;
      let finalCreditsBalance = creditsBalance;
      const dailyQuotaLimit = isAdminRegistration ? 999 : 5;
      const displayNickname = isAdminRegistration ? username : generateChineseNickname(`${userId}:${normalizedEmail}`);
      const avatarUrl = generateDefaultAvatarDataUrl(`${userId}:${normalizedEmail}`, displayNickname);

      await client.query('BEGIN');
      try {
        await client.query(
          `INSERT INTO auth.users (id, email, password_hash, created_at)
           VALUES ($1, $2, crypt($3, gen_salt('bf')), NOW())`,
          [userId, normalizedEmail, password]
        );

        await client.query(
          `INSERT INTO profiles (
             id, email, nickname, display_nickname, avatar_url, phone, role, membership_tier, credits_balance,
             daily_quota_limit, daily_quota_used, is_active, email_verified,
             email_verified_at, email_bound_at, email_sender_domain, invite_code, referred_by_user_id
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CASE WHEN $13 THEN NOW() ELSE NULL END, CASE WHEN $13 THEN NOW() ELSE NULL END, $14, $15, $16)
           ON CONFLICT (id) DO UPDATE SET
             email = EXCLUDED.email,
             nickname = EXCLUDED.nickname,
             display_nickname = EXCLUDED.display_nickname,
             avatar_url = EXCLUDED.avatar_url,
             phone = EXCLUDED.phone,
             role = EXCLUDED.role,
             membership_tier = EXCLUDED.membership_tier,
             credits_balance = EXCLUDED.credits_balance,
             daily_quota_limit = EXCLUDED.daily_quota_limit,
             daily_quota_used = EXCLUDED.daily_quota_used,
             is_active = EXCLUDED.is_active,
             email_verified = EXCLUDED.email_verified,
             email_verified_at = EXCLUDED.email_verified_at,
             email_bound_at = EXCLUDED.email_bound_at,
             email_sender_domain = EXCLUDED.email_sender_domain,
             invite_code = COALESCE(profiles.invite_code, EXCLUDED.invite_code),
             referred_by_user_id = COALESCE(profiles.referred_by_user_id, EXCLUDED.referred_by_user_id)`,
          [
            userId,
            normalizedEmail,
            username,
            displayNickname,
            avatarUrl,
            phone || null,
            role,
            membershipTier,
            creditsBalance,
            dailyQuotaLimit,
            0,
            true,
            true,
            normalizedEmail.split('@')[1] || null,
            null,
            inviter?.id || null,
          ]
        );
        await getOrCreateInviteCode(client, userId);

        await client.query(
          'INSERT INTO credit_transactions (user_id, amount, balance_after, type, description) VALUES ($1, $2, $3, $4, $5)',
          [userId, creditsBalance, creditsBalance, 'gift', isAdminRegistration ? 'Admin initial credits' : 'New user registration bonus']
        ).catch(() => undefined);

        if (inviter?.id && String(inviter.id) !== userId) {
          await applyInvitationReward(client, {
            inviterUserId: String(inviter.id),
            inviteeUserId: userId,
            inviteCode: normalizedReferralCode,
          });
          finalCreditsBalance += INVITATION_BONUS_CREDITS;
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }

      await sendTemplatedEmail(client, {
        to: normalizedEmail,
        type: 'register_success',
        subject: '【妙境】注册成功',
        title: '注册成功',
        intro: isAdminRegistration ? '管理员账号已创建成功。' : '你的妙境账号已注册成功，邮箱也已完成验证。',
        note: '若非本人操作，请尽快联系管理员。',
        assetBaseUrl: getRequestBaseUrl(request) || undefined,
      }).catch(() => undefined);

      const accessToken = createSessionToken(userId, role);
      return NextResponse.json({
        user: {
          id: userId,
          email: normalizedEmail,
          username,
          nickname: displayNickname,
          display_nickname: displayNickname,
          role,
          membership_tier: membershipTier,
          credits_balance: finalCreditsBalance,
          daily_quota_used: 0,
          daily_quota_limit: dailyQuotaLimit,
          avatar_url: avatarUrl,
          phone: phone || null,
          email_verified: true,
          email_verified_at: new Date().toISOString(),
          preferred_theme: 'dark',
        },
        session: { access_token: accessToken },
        message: isAdminRegistration
          ? 'Admin account registered'
          : inviter
            ? `Registration successful, invitation bonus ${INVITATION_BONUS_CREDITS} credits added`
            : 'Registration successful',
      });
    } finally {
      client.release();
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Registration failed';
    console.error('[Register Error]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
