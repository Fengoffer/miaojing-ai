import { NextRequest, NextResponse } from 'next/server';
import { getDbClient } from '@/storage/database/local-db';
import { ensureEmailSchema } from '@/lib/email-service';
import { getAuthenticatedUserId } from '@/lib/session-auth';
import { getRequiredProductionSecret } from '@/lib/runtime-env';
import { ensureProfilePreferenceSchema } from '@/lib/profile-preferences';
import { ensureUserDisplayProfileSchema, generateDefaultAvatarDataUrl } from '@/lib/user-profile-defaults';

function normalizeRoleForTier(role: string | null | undefined, tier: string | null | undefined): string {
  const currentRole = role || 'user';
  if (currentRole === 'admin' || currentRole === 'enterprise_admin') return currentRole;
  return tier && tier !== 'free' ? 'vip' : currentRole === 'vip' ? 'user' : currentRole;
}

function canDisableWatermarkForProfile(role: string | null | undefined, tier: string | null | undefined): boolean {
  if (role === 'admin' || role === 'enterprise_admin') return true;
  return Boolean(tier && tier !== 'free');
}

function isEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isSafeAvatarUrl(value: string): boolean {
  if (!value) return true;
  if (value.length > 1_000_000) return false;
  if (/^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i.test(value)) return true;
  if (/^data:image\/svg\+xml;charset=utf-8,/i.test(value)) return true;
  if (/^https?:\/\/[^\s"'<>]+$/i.test(value)) return true;
  if (/^\/api\/local-storage\/[^\s"'<>]+$/i.test(value)) return true;
  return false;
}

function isSafeProfileText(value: string | undefined, maxLength: number): boolean {
  if (value === undefined) return true;
  return value.length <= maxLength && !/[\u0000-\u001f\u007f<>]/.test(value);
}

async function verifyPasswordHash(client: Awaited<ReturnType<typeof getDbClient>>, passwordHash: string, password: string): Promise<boolean> {
  const result = await client.query(
    'SELECT $1::text = crypt($2::text, $1::text) AS ok',
    [passwordHash, password]
  );
  return result.rows[0]?.ok === true;
}

export async function GET(request: NextRequest) {
  try {
    const tokenUserId = await getAuthenticatedUserId(request);
    if (!tokenUserId) {
      return NextResponse.json({ error: 'Please log in again' }, { status: 401 });
    }

    const client = await getDbClient();

    try {
      await ensureEmailSchema(client);
      await ensureProfilePreferenceSchema(client);
      await ensureUserDisplayProfileSchema(client);
      const result = await client.query(
        `SELECT id, email, nickname AS username, COALESCE(NULLIF(display_nickname, ''), nickname) AS nickname,
                COALESCE(NULLIF(display_nickname, ''), nickname) AS display_nickname,
                phone, role, membership_tier, credits_balance, daily_quota_used, daily_quota_limit,
                avatar_url, created_at, email_verified, email_verified_at, email_bound_at, preferred_theme,
                COALESCE(watermark_disabled, false) AS watermark_disabled
         FROM profiles WHERE id = $1`,
        [tokenUserId],
      );

      if (result.rows.length === 0) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }

      const profile = result.rows[0];
      const normalizedRole = normalizeRoleForTier(profile.role, profile.membership_tier);
      if (normalizedRole !== (profile.role || 'user')) {
        profile.role = normalizedRole;
        await client.query('UPDATE profiles SET role = $1, updated_at = NOW() WHERE id = $2', [normalizedRole, profile.id]);
      }

      return NextResponse.json({ profile });
    } finally {
      client.release();
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to get profile';
    console.error('[Profile Error]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const tokenUserId = await getAuthenticatedUserId(request);
  if (!tokenUserId) {
    return NextResponse.json({ error: 'Please log in again' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const hasEmail = Object.prototype.hasOwnProperty.call(body, 'email');
    const hasNickname = Object.prototype.hasOwnProperty.call(body, 'nickname');
    const hasPhone = Object.prototype.hasOwnProperty.call(body, 'phone');
    const hasAvatarUrl = Object.prototype.hasOwnProperty.call(body, 'avatarUrl');
    const hasWatermarkDisabled = Object.prototype.hasOwnProperty.call(body, 'watermarkDisabled');
    const watermarkDisabled = body.watermarkDisabled === true;
    const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
    const email = hasEmail && typeof body.email === 'string' ? body.email.trim() : undefined;
    const nickname = hasNickname && typeof body.nickname === 'string' ? body.nickname.trim() : undefined;
    const phone = hasPhone && typeof body.phone === 'string' ? body.phone.trim() : undefined;
    const avatarUrl = hasAvatarUrl && typeof body.avatarUrl === 'string' ? body.avatarUrl.trim() : undefined;

    if (email !== undefined && !isEmail(email)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
    }

    if (!isSafeProfileText(nickname, 50)) {
      return NextResponse.json({ error: 'Nickname is too long or contains invalid characters' }, { status: 400 });
    }

    if (!isSafeProfileText(phone, 30)) {
      return NextResponse.json({ error: 'Phone is too long or contains invalid characters' }, { status: 400 });
    }

    if (newPassword && newPassword.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
    }

    if (avatarUrl !== undefined && !isSafeAvatarUrl(avatarUrl)) {
      return NextResponse.json({ error: 'Invalid avatar image' }, { status: 400 });
    }

    const client = await getDbClient();

    try {
      await ensureEmailSchema(client);
      await ensureProfilePreferenceSchema(client);
      await ensureUserDisplayProfileSchema(client);
      await client.query('BEGIN');

      const profileResult = await client.query(
        `SELECT id, email, nickname AS username, COALESCE(NULLIF(display_nickname, ''), nickname) AS nickname,
                COALESCE(NULLIF(display_nickname, ''), nickname) AS display_nickname,
                phone, role, membership_tier, credits_balance, daily_quota_used, daily_quota_limit,
                avatar_url, created_at, email_verified, email_verified_at, email_bound_at, preferred_theme,
                COALESCE(watermark_disabled, false) AS watermark_disabled
         FROM profiles WHERE id = $1 FOR UPDATE`,
        [tokenUserId]
      );

      if (profileResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }

      const currentProfile = profileResult.rows[0];
      const authResult = await client.query(
        'SELECT id, email, password_hash FROM auth.users WHERE id = $1 FOR UPDATE',
        [tokenUserId]
      );
      const authUser = authResult.rows[0] || null;

      const hasUsername = Object.prototype.hasOwnProperty.call(body, 'username');
      const username = hasUsername && typeof body.username === 'string' ? body.username.trim() : undefined;
      const hasDisplayNickname = Object.prototype.hasOwnProperty.call(body, 'displayNickname') || hasNickname;
      const displayNickname = Object.prototype.hasOwnProperty.call(body, 'displayNickname') && typeof body.displayNickname === 'string'
        ? body.displayNickname.trim()
        : nickname;

      if (!isSafeProfileText(username, 50)) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Username is too long or contains invalid characters' }, { status: 400 });
      }

      if (username !== undefined && !username) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Username cannot be empty' }, { status: 400 });
      }

      if (displayNickname !== undefined && !displayNickname) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Display nickname cannot be empty' }, { status: 400 });
      }

      if (!isSafeProfileText(displayNickname, 50)) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Display nickname is too long or contains invalid characters' }, { status: 400 });
      }

      const canManageOwnWatermark = canDisableWatermarkForProfile(currentProfile.role, currentProfile.membership_tier);
      if (hasWatermarkDisabled && watermarkDisabled && !canManageOwnWatermark) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: '仅会员可关闭下载水印' }, { status: 403 });
      }
      const shouldUpdateWatermark = hasWatermarkDisabled && canManageOwnWatermark;

      if (username !== undefined && username !== currentProfile.username) {
        const duplicateUsername = await client.query(
          'SELECT id FROM profiles WHERE LOWER(nickname) = LOWER($1) AND id <> $2 LIMIT 1',
          [username, tokenUserId]
        );
        if (duplicateUsername.rows.length > 0) {
          await client.query('ROLLBACK');
          return NextResponse.json({ error: 'Username is already in use' }, { status: 400 });
        }
      }

      if (email !== undefined && email !== currentProfile.email) {
        const duplicateProfile = await client.query(
          'SELECT id FROM profiles WHERE email = $1 AND id <> $2 LIMIT 1',
          [email, tokenUserId]
        );
        const duplicateAuth = await client.query(
          'SELECT id FROM auth.users WHERE email = $1 AND id <> $2 LIMIT 1',
          [email, tokenUserId]
        );

        if (duplicateProfile.rows.length > 0 || duplicateAuth.rows.length > 0) {
          await client.query('ROLLBACK');
          return NextResponse.json({ error: 'Email is already in use' }, { status: 400 });
        }

        if (authUser) {
          await client.query('UPDATE auth.users SET email = $1 WHERE id = $2', [email, tokenUserId]);
        } else {
          await client.query(
            'INSERT INTO auth.users (id, email, created_at) VALUES ($1, $2, NOW())',
            [tokenUserId, email]
          );
        }
      }

      if (newPassword) {
        if (authUser?.password_hash) {
          if (!currentPassword) {
            await client.query('ROLLBACK');
            return NextResponse.json({ error: 'Current password is required' }, { status: 400 });
          }
          const passwordOk = await verifyPasswordHash(client, authUser.password_hash, currentPassword);
          if (!passwordOk) {
            await client.query('ROLLBACK');
            return NextResponse.json({ error: 'Current password is incorrect' }, { status: 401 });
          }
        } else if (currentProfile.role === 'admin' && currentPassword !== getRequiredProductionSecret('ADMIN_DEFAULT_PASSWORD', 'admin123')) {
          await client.query('ROLLBACK');
          return NextResponse.json({ error: 'Current password is incorrect' }, { status: 401 });
        }

        await client.query(
          `INSERT INTO auth.users (id, email, password_hash, created_at)
           VALUES ($1, $2, crypt($3, gen_salt('bf')), NOW())
           ON CONFLICT (id) DO UPDATE SET password_hash = crypt($3, gen_salt('bf'))`,
          [tokenUserId, email || currentProfile.email, newPassword]
        );
      }

      const nextDisplayNickname = displayNickname !== undefined
        ? displayNickname
        : currentProfile.display_nickname || currentProfile.nickname || currentProfile.username || currentProfile.email.split('@')[0];
      const nextAvatarUrl = avatarUrl !== undefined
        ? avatarUrl
        : currentProfile.avatar_url || generateDefaultAvatarDataUrl(`${tokenUserId}:${currentProfile.email}`, nextDisplayNickname);

      const updateResult = await client.query(
        `UPDATE profiles
         SET email = CASE WHEN $1::boolean THEN $2 ELSE email END,
             email_verified = CASE WHEN $1::boolean AND LOWER($2) <> LOWER(email) THEN false ELSE email_verified END,
             email_verified_at = CASE WHEN $1::boolean AND LOWER($2) <> LOWER(email) THEN NULL ELSE email_verified_at END,
             nickname = CASE WHEN $3::boolean THEN NULLIF($4, '') ELSE nickname END,
             display_nickname = CASE WHEN $5::boolean THEN NULLIF($6, '') ELSE COALESCE(NULLIF(display_nickname, ''), nickname) END,
             phone = CASE WHEN $7::boolean THEN NULLIF($8, '') ELSE phone END,
             avatar_url = CASE WHEN $9::boolean THEN NULLIF($10, '') ELSE COALESCE(NULLIF(avatar_url, ''), $11) END,
             watermark_disabled = CASE WHEN $12::boolean THEN $13 ELSE watermark_disabled END,
             updated_at = NOW()
         WHERE id = $14
         RETURNING id, email, nickname AS username, COALESCE(NULLIF(display_nickname, ''), nickname) AS nickname,
                   COALESCE(NULLIF(display_nickname, ''), nickname) AS display_nickname,
                   phone, role, membership_tier, credits_balance, daily_quota_used, daily_quota_limit,
                   avatar_url, created_at, email_verified, email_verified_at, email_bound_at, preferred_theme,
                   COALESCE(watermark_disabled, false) AS watermark_disabled`,
        [
          email !== undefined,
          email || null,
          username !== undefined,
          username || '',
          hasDisplayNickname,
          nextDisplayNickname,
          phone !== undefined,
          phone || '',
          avatarUrl !== undefined,
          avatarUrl || '',
          nextAvatarUrl,
          shouldUpdateWatermark,
          watermarkDisabled,
          tokenUserId,
        ]
      );

      await client.query('COMMIT');

      return NextResponse.json({
        success: true,
        profile: updateResult.rows[0],
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to update profile';
    console.error('[Profile Update Error]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
