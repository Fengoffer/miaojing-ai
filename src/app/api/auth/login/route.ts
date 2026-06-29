import { NextRequest, NextResponse } from 'next/server';
import { getDbClient } from '@/storage/database/local-db';
import { ensureEmailSchema } from '@/lib/email-service';
import { createSessionToken } from '@/lib/session-auth';
import { getRequiredProductionSecret } from '@/lib/runtime-env';
import { writePlatformLog } from '@/lib/platform-logs';
import { ensureProfilePreferenceSchema, normalizePreferredTheme } from '@/lib/profile-preferences';
import { ensureUserDisplayProfileSchema, generateChineseNickname, generateDefaultAvatarDataUrl } from '@/lib/user-profile-defaults';

function normalizeRoleForTier(role: string | null | undefined, tier: string | null | undefined): string {
  const currentRole = role || 'user';
  if (currentRole === 'admin' || currentRole === 'enterprise_admin') return currentRole;
  return tier && tier !== 'free' ? 'vip' : currentRole === 'vip' ? 'user' : currentRole;
}

async function verifyPasswordHash(client: Awaited<ReturnType<typeof getDbClient>>, passwordHash: string, password: string): Promise<boolean> {
  const result = await client.query(
    'SELECT $1::text = crypt($2::text, $1::text) AS ok',
    [passwordHash, password]
  );
  return result.rows[0]?.ok === true;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email: rawEmail, account, phone: rawPhone, password, adminOnly } = body;

    const identifier = account || rawEmail || rawPhone;
    if (!identifier || !password) {
      return NextResponse.json({ error: 'Please enter account and password' }, { status: 400 });
    }

    const client = await getDbClient();

    try {
      await ensureEmailSchema(client);
      await ensureProfilePreferenceSchema(client);
      await ensureUserDisplayProfileSchema(client);
      let loginEmail = identifier;
      let userId = '';
      let userRole = 'user';
      let username = '';
      let userNickname = '';
      let userMembershipTier = 'free';
      let userCreditsBalance = 0;
      let userDailyQuotaUsed = 0;
      let userDailyQuotaLimit = 5;
      let userAvatarUrl: string | null = null;
      let userPhone: string | null = null;
      let userCreatedAt: string | null = null;
      let userEmailVerified = false;
      let userEmailVerifiedAt: string | null = null;
      let userPreferredTheme: 'dark' | 'light' = 'dark';

      const isEmailFormat = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier);
      let isAdminAccount = false;
      let adminProfileId: string | null = null;

      if (!isEmailFormat) {
        const adminLookup = await client.query(
          "SELECT id, email, nickname, COALESCE(NULLIF(display_nickname, ''), nickname) AS display_nickname, role FROM profiles WHERE (nickname = $1 OR phone = $1) AND role = 'admin' LIMIT 1",
          [identifier]
        );
        if (adminLookup.rows.length > 0) {
          isAdminAccount = true;
          adminProfileId = adminLookup.rows[0].id;
          loginEmail = adminLookup.rows[0].email;
          username = adminLookup.rows[0].nickname || '';
          userNickname = adminLookup.rows[0].display_nickname || username;
        } else {
          const nicknameLower = String(identifier).toLowerCase();
          if (nicknameLower === 'admin' || nicknameLower.startsWith('admin')) {
            const anyLookup = await client.query(
              "SELECT id, email, nickname, COALESCE(NULLIF(display_nickname, ''), nickname) AS display_nickname, role FROM profiles WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1"
            );
            if (anyLookup.rows.length > 0) {
              isAdminAccount = true;
              adminProfileId = anyLookup.rows[0].id;
              loginEmail = anyLookup.rows[0].email;
              username = anyLookup.rows[0].nickname || '';
              userNickname = anyLookup.rows[0].display_nickname || username;
            }
          }
        }
      } else {
        const adminLookup = await client.query(
          "SELECT id, email, nickname, COALESCE(NULLIF(display_nickname, ''), nickname) AS display_nickname, role FROM profiles WHERE email = $1 AND role = 'admin' LIMIT 1",
          [identifier]
        );
        if (adminLookup.rows.length > 0) {
          isAdminAccount = true;
          adminProfileId = adminLookup.rows[0].id;
          loginEmail = identifier;
          username = adminLookup.rows[0].nickname || '';
          userNickname = adminLookup.rows[0].display_nickname || username;
        }
      }

      if (isAdminAccount) {
        const authResult = await client.query(
          'SELECT id, email, created_at, password_hash FROM auth.users WHERE email = $1',
          [loginEmail]
        );

        if (authResult.rows.length > 0 && authResult.rows[0].password_hash) {
          const passwordOk = await verifyPasswordHash(client, authResult.rows[0].password_hash, password);
          if (!passwordOk) {
            return NextResponse.json({ error: 'Invalid admin password' }, { status: 401 });
          }
        } else if (password !== getRequiredProductionSecret('ADMIN_DEFAULT_PASSWORD', 'admin123')) {
          return NextResponse.json({ error: 'Invalid admin password' }, { status: 401 });
        }

        userRole = 'admin';
        userMembershipTier = 'enterprise';
        userCreditsBalance = 9999;
        userDailyQuotaLimit = 999;
        username = username || 'admin';
        userNickname = userNickname || username || '管理员';
        userEmailVerified = true;
        userEmailVerifiedAt = new Date().toISOString();

        if (authResult.rows.length > 0) {
          userId = authResult.rows[0].id;
          userCreatedAt = authResult.rows[0].created_at;
        } else if (adminProfileId) {
          userId = adminProfileId;
          await client.query(
            'INSERT INTO auth.users (id, email, created_at) VALUES ($1, $2, NOW()) ON CONFLICT (id) DO NOTHING',
            [userId, loginEmail]
          );
          userCreatedAt = new Date().toISOString();
        } else {
          userId = crypto.randomUUID();
          await client.query(
            'INSERT INTO auth.users (id, email, created_at) VALUES ($1, $2, NOW())',
            [userId, loginEmail]
          );
          userCreatedAt = new Date().toISOString();
        }

        await client.query(
          `INSERT INTO profiles (id, email, nickname, display_nickname, role, membership_tier, credits_balance, daily_quota_limit, daily_quota_used, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (id) DO UPDATE SET
             role = $5,
             membership_tier = $6,
             credits_balance = $7,
             daily_quota_limit = $8,
             nickname = $3,
             display_nickname = COALESCE(NULLIF(profiles.display_nickname, ''), $4),
             is_active = true,
             email_verified = true,
             email_verified_at = COALESCE(profiles.email_verified_at, NOW()),
             email_bound_at = COALESCE(profiles.email_bound_at, NOW())`,
          [userId, loginEmail, username, userNickname, 'admin', 'enterprise', 9999, 999, 0, true]
        );

        const adminThemeResult = await client.query(
          'SELECT preferred_theme FROM profiles WHERE id = $1 LIMIT 1',
          [userId]
        );
        userPreferredTheme = normalizePreferredTheme(adminThemeResult.rows[0]?.preferred_theme);

        if (adminProfileId && adminProfileId !== userId) {
          await client.query(
            'UPDATE profiles SET role = $1, membership_tier = $2, credits_balance = $3, daily_quota_limit = $4 WHERE id = $5',
            ['admin', 'enterprise', 9999, 999, adminProfileId]
          );
        }
      } else {
        if (!isEmailFormat) {
          const profileResult = await client.query(
            'SELECT id, email, nickname, COALESCE(NULLIF(display_nickname, \'\'), nickname) AS display_nickname, phone, role FROM profiles WHERE nickname = $1 OR phone = $1 LIMIT 1',
            [identifier]
          );

          if (profileResult.rows.length > 0) {
            const profile = profileResult.rows[0];
            loginEmail = profile.email;
            userId = profile.id;
            userRole = profile.role || 'user';
            username = profile.nickname || '';
            userNickname = profile.display_nickname || profile.nickname;
            userPhone = profile.phone;
          } else {
            return NextResponse.json({ error: 'Account does not exist' }, { status: 401 });
          }
        }

        const authResult = await client.query(
          'SELECT id, email, created_at, password_hash FROM auth.users WHERE email = $1',
          [loginEmail]
        );

        if (authResult.rows.length === 0) {
          return NextResponse.json({ error: 'Account does not exist' }, { status: 401 });
        }

        const authUser = authResult.rows[0];
        if (authUser.password_hash) {
          const passwordOk = await verifyPasswordHash(client, authUser.password_hash, password);
          if (!passwordOk) {
            return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
          }
        } else {
          return NextResponse.json({ error: '该账号缺少密码凭据，请联系管理员重置密码后再登录' }, { status: 401 });
        }

        userId = authUser.id;
        userCreatedAt = authUser.created_at;

        const profileResult = await client.query(
          'SELECT nickname, COALESCE(NULLIF(display_nickname, \'\'), nickname) AS display_nickname, role, membership_tier, credits_balance, daily_quota_used, daily_quota_limit, avatar_url, phone, email_verified, email_verified_at, preferred_theme FROM profiles WHERE id = $1',
          [userId]
        );

        if (profileResult.rows.length > 0) {
          const profile = profileResult.rows[0];
          username = profile.nickname || loginEmail.split('@')[0];
          userNickname = profile.display_nickname || username;
          userMembershipTier = profile.membership_tier || 'free';
          userRole = normalizeRoleForTier(profile.role, userMembershipTier);
          userCreditsBalance = profile.credits_balance || 0;
          userDailyQuotaUsed = profile.daily_quota_used || 0;
          userDailyQuotaLimit = profile.daily_quota_limit || 5;
          userAvatarUrl = profile.avatar_url || null;
          if (!userAvatarUrl) {
            userAvatarUrl = generateDefaultAvatarDataUrl(`${userId}:${loginEmail}`, userNickname);
            await client.query('UPDATE profiles SET avatar_url = $1, updated_at = NOW() WHERE id = $2', [userAvatarUrl, userId]);
          }
          userPhone = profile.phone || null;
          userEmailVerified = profile.email_verified === true;
          userEmailVerifiedAt = profile.email_verified_at || null;
          userPreferredTheme = normalizePreferredTheme(profile.preferred_theme);
          if (userRole !== (profile.role || 'user')) {
            await client.query('UPDATE profiles SET role = $1, updated_at = NOW() WHERE id = $2', [userRole, userId]);
          }
        } else {
          username = loginEmail.split('@')[0];
          userNickname = generateChineseNickname(`${userId}:${loginEmail}`);
          userAvatarUrl = generateDefaultAvatarDataUrl(`${userId}:${loginEmail}`, userNickname);
          await client.query(
            `INSERT INTO profiles (id, email, nickname, display_nickname, avatar_url, role, membership_tier, credits_balance, daily_quota_used, daily_quota_limit)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (id) DO UPDATE SET email = $2, nickname = $3, display_nickname = COALESCE(NULLIF(profiles.display_nickname, ''), $4), avatar_url = COALESCE(NULLIF(profiles.avatar_url, ''), $5), email_verified = false, email_verified_at = NULL`,
            [userId, loginEmail, username, userNickname, userAvatarUrl, userRole, userMembershipTier, userCreditsBalance, userDailyQuotaUsed, userDailyQuotaLimit]
          );
        }
      }

      if (adminOnly === true && userRole !== 'admin' && userRole !== 'enterprise_admin') {
        void writePlatformLog({
          type: 'security',
          level: 'warning',
          action: 'console_login_denied',
          message: '非管理员账号尝试登录管理后台被拒绝',
          userId,
          userName: userNickname,
          userEmail: loginEmail,
          request,
        });
        return NextResponse.json({ error: 'Only administrators can log in to the console' }, { status: 403 });
      }

      const accessToken = createSessionToken(userId, userRole);
      void writePlatformLog({
        type: 'auth',
        level: 'info',
        action: adminOnly === true ? 'console_login_success' : 'user_login_success',
        message: adminOnly === true ? '管理员登录管理后台成功' : '用户登录成功',
        userId,
        userName: userNickname,
        userEmail: loginEmail,
        request,
      });

      return NextResponse.json({
        user: {
          id: userId,
          email: loginEmail,
          username,
          nickname: userNickname,
          display_nickname: userNickname,
          role: userRole,
          membership_tier: userMembershipTier,
          credits_balance: userCreditsBalance,
          daily_quota_used: userDailyQuotaUsed,
          daily_quota_limit: userDailyQuotaLimit,
          avatar_url: userAvatarUrl,
          phone: userPhone,
          created_at: userCreatedAt,
          email_verified: userEmailVerified,
          email_verified_at: userEmailVerifiedAt,
          preferred_theme: userPreferredTheme,
        },
        session: { access_token: accessToken },
      });
    } finally {
      client.release();
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Login failed';
    console.error('[Login Error]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
