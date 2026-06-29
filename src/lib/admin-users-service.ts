import type { PoolClient } from 'pg';
import { ensureInvitationSchema } from '@/lib/invitation-service';
import { ensureProfilePreferenceSchema } from '@/lib/profile-preferences';

export type AdminUsersQuery = {
  search?: string;
  page?: number;
  pageSize?: number;
};

function normalizeRoleForTier(role: string | null | undefined, tier: string | null | undefined): string {
  const currentRole = role || 'user';
  if (currentRole === 'admin' || currentRole === 'enterprise_admin') return currentRole;
  return tier && tier !== 'free' ? 'vip' : currentRole === 'vip' ? 'user' : currentRole;
}

function normalizeMembershipTier(tier: string | null | undefined): string {
  if (tier === 'basic') return 'pro';
  if (tier === 'enterprise') return 'ultra';
  if (tier === 'pro' || tier === 'max' || tier === 'ultra' || tier === 'free') return tier;
  return 'free';
}

function isDefaultAdmin(row: Record<string, unknown>): boolean {
  return row.role === 'admin' && row.email === 'admin@example.com';
}

function toAdminUser(row: Record<string, unknown>) {
  const membershipTier = normalizeMembershipTier(row.membership_tier as string);
  const role = normalizeRoleForTier(row.role as string | undefined, membershipTier);
  return {
    id: row.id,
    email: row.email || '',
    username: row.nickname || '',
    nickname: row.display_nickname || row.nickname || '',
    role,
    membership_tier: membershipTier,
    credits_balance: row.credits_balance ?? 0,
    daily_quota_limit: row.daily_quota_limit ?? 5,
    daily_quota_used: row.daily_quota_used ?? 0,
    is_active: row.is_active !== false,
    watermark_disabled: row.watermark_disabled === true,
    avatar_url: row.avatar_url || null,
    phone: row.phone || null,
    invite_code: row.invite_code || null,
    referred_by_user_id: row.referred_by_user_id || null,
    referred_by_email: row.referred_by_email || null,
    referred_by_nickname: row.referred_by_nickname || null,
    invited_count: Number(row.invited_count || 0),
    created_at: row.created_at || row.auth_created_at,
    email_confirmed: true,
  };
}

function clampPage(value: unknown): number {
  const page = Number(value);
  return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
}

function clampPageSize(value: unknown): number {
  const pageSize = Number(value);
  if (!Number.isFinite(pageSize) || pageSize <= 0) return 20;
  return Math.min(Math.max(Math.floor(pageSize), 10), 100);
}

export async function listAdminUsers(client: PoolClient, query: AdminUsersQuery = {}) {
  await ensureInvitationSchema(client);
  await ensureProfilePreferenceSchema(client);
  const page = clampPage(query.page);
  const pageSize = clampPageSize(query.pageSize);
  const offset = (page - 1) * pageSize;
  const search = (query.search || '').trim();
  const params: unknown[] = [];
  let whereClause = '';

  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    whereClause = `
      WHERE LOWER(p.email) LIKE $1
        OR LOWER(COALESCE(p.nickname, '')) LIKE $1
        OR LOWER(COALESCE(p.display_nickname, '')) LIKE $1
        OR LOWER(COALESCE(p.phone, '')) LIKE $1
        OR p.id::text LIKE $1
        OR LOWER(COALESCE(p.role, '')) LIKE $1
        OR LOWER(COALESCE(p.membership_tier, '')) LIKE $1
    `;
  }

  const countResult = await client.query(
    `SELECT COUNT(*)::int AS total FROM profiles p ${whereClause}`,
    params
  );

  const result = await client.query(
    `SELECT p.id, p.email, p.nickname, p.display_nickname, p.role, p.membership_tier,
       p.credits_balance, p.daily_quota_limit, p.daily_quota_used,
       p.is_active, COALESCE(p.watermark_disabled, false) AS watermark_disabled,
       p.avatar_url, p.phone, p.invite_code, p.referred_by_user_id,
       ref.email AS referred_by_email,
       COALESCE(NULLIF(ref.display_nickname, ''), ref.nickname, ref.email) AS referred_by_nickname,
       COALESCE(invited.invited_count, 0) AS invited_count,
       p.created_at,
       u.created_at as auth_created_at
     FROM profiles p
     LEFT JOIN auth.users u ON p.id = u.id
     LEFT JOIN profiles ref ON ref.id = p.referred_by_user_id
     LEFT JOIN (
       SELECT inviter_user_id, COUNT(*)::int AS invited_count
       FROM invitation_referrals
       GROUP BY inviter_user_id
     ) invited ON invited.inviter_user_id = p.id
     ${whereClause}
     ORDER BY p.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pageSize, offset]
  );

  const total = Number(countResult.rows[0]?.total || 0);
  return {
    users: result.rows.map((row: Record<string, unknown>) => toAdminUser(row)),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function updateAdminUser(client: PoolClient, body: Record<string, unknown>) {
  await ensureProfilePreferenceSchema(client);

  const { userId, ...updates } = body;

  if (!userId) {
    return { status: 400, body: { error: '缺少用户ID' } };
  }

  const currentResult = await client.query(
    'SELECT id, email, role, membership_tier FROM profiles WHERE id = $1 LIMIT 1',
    [userId]
  );
  if (currentResult.rows.length === 0) {
    return { status: 404, body: { error: '用户不存在' } };
  }

  const membershipTier = updates.membership_tier ?? updates.membershipTier;
  const creditsBalance = updates.credits_balance ?? updates.creditsBalance;
  const dailyQuotaLimit = updates.daily_quota_limit ?? updates.dailyQuotaLimit;
  const dailyQuotaUsed = updates.daily_quota_used ?? updates.dailyQuotaUsed;
  const watermarkDisabled = updates.watermark_disabled ?? updates.watermarkDisabled;
  const isActive = updates.is_active ?? updates.isActive ?? (updates.status !== undefined ? updates.status === 'active' : undefined);
  const newPassword = typeof updates.newPassword === 'string' ? updates.newPassword.trim() : '';
  const nextTier = normalizeMembershipTier((membershipTier ?? currentResult.rows[0].membership_tier ?? 'free') as string);
  const requestedRole = (updates.role ?? currentResult.rows[0].role ?? 'user') as string;
  const nextRole = normalizeRoleForTier(requestedRole, nextTier);
  const defaultAdmin = isDefaultAdmin(currentResult.rows[0]);

  if (defaultAdmin) {
    const requestedActive = updates.is_active ?? updates.isActive ?? (updates.status !== undefined ? updates.status === 'active' : undefined);
    if (
      (updates.email !== undefined && updates.email !== currentResult.rows[0].email)
      || (updates.role !== undefined && updates.role !== 'admin')
      || (membershipTier !== undefined && normalizeMembershipTier(String(membershipTier)) === 'free')
      || requestedActive === false
    ) {
      return { status: 403, body: { error: '系统内置管理员账号不可删除、停用、降级或修改邮箱' } };
    }
  }

  const setClauses: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  setClauses.push(`role = $${paramIdx++}`); params.push(defaultAdmin ? 'admin' : nextRole);
  if (membershipTier !== undefined) { setClauses.push(`membership_tier = $${paramIdx++}`); params.push(nextTier); }
  if (creditsBalance !== undefined) { setClauses.push(`credits_balance = $${paramIdx++}`); params.push(creditsBalance); }
  if (dailyQuotaLimit !== undefined) { setClauses.push(`daily_quota_limit = $${paramIdx++}`); params.push(dailyQuotaLimit); }
  if (dailyQuotaUsed !== undefined) { setClauses.push(`daily_quota_used = $${paramIdx++}`); params.push(dailyQuotaUsed); }
  if (watermarkDisabled !== undefined) { setClauses.push(`watermark_disabled = $${paramIdx++}`); params.push(watermarkDisabled === true); }
  if (isActive !== undefined) { setClauses.push(`is_active = $${paramIdx++}`); params.push(isActive); }
  if (updates.username !== undefined) { setClauses.push(`nickname = $${paramIdx++}`); params.push(updates.username); }
  if (updates.nickname !== undefined) { setClauses.push(`display_nickname = $${paramIdx++}`); params.push(updates.nickname); }
  if (updates.phone !== undefined) { setClauses.push(`phone = $${paramIdx++}`); params.push(updates.phone); }
  if (updates.email !== undefined) { setClauses.push(`email = $${paramIdx++}`); params.push(updates.email); }
  setClauses.push('updated_at = NOW()');

  params.push(userId);
  await client.query(
    `UPDATE profiles SET ${setClauses.join(', ')} WHERE id = $${paramIdx}`,
    params
  );

  if (newPassword) {
    if (newPassword.length < 6) {
      return { status: 400, body: { error: '密码至少6位' } };
    }
    await client.query(
      `INSERT INTO auth.users (id, email, password_hash, created_at)
       VALUES ($1, $2, crypt($3, gen_salt('bf')), NOW())
       ON CONFLICT (id) DO UPDATE SET password_hash = crypt($3, gen_salt('bf'))`,
      [userId, currentResult.rows[0].email, newPassword]
    );
  }

  if (updates.email) {
    await client.query(
      'UPDATE auth.users SET email = $1 WHERE id = $2',
      [updates.email, userId]
    ).catch(() => { /* non-critical */ });
  }

  const updated = await client.query(
    `SELECT p.id, p.email, p.nickname, p.display_nickname, p.role, p.membership_tier,
       p.credits_balance, p.daily_quota_limit, p.daily_quota_used,
       p.is_active, COALESCE(p.watermark_disabled, false) AS watermark_disabled,
       p.avatar_url, p.phone, p.invite_code, p.referred_by_user_id,
       ref.email AS referred_by_email,
       COALESCE(NULLIF(ref.display_nickname, ''), ref.nickname, ref.email) AS referred_by_nickname,
       COALESCE(invited.invited_count, 0) AS invited_count,
       p.created_at,
       u.created_at as auth_created_at
     FROM profiles p
     LEFT JOIN auth.users u ON p.id = u.id
     LEFT JOIN profiles ref ON ref.id = p.referred_by_user_id
     LEFT JOIN (
       SELECT inviter_user_id, COUNT(*)::int AS invited_count
       FROM invitation_referrals
       GROUP BY inviter_user_id
     ) invited ON invited.inviter_user_id = p.id
     WHERE p.id = $1
     LIMIT 1`,
    [userId]
  );

  return {
    status: 200,
    body: {
      success: true,
      user: updated.rows[0] ? toAdminUser(updated.rows[0]) : null,
    },
  };
}

export async function deleteAdminUser(client: PoolClient, userId: string, requesterId?: string | null) {
  if (!userId) {
    return { status: 400, body: { error: '缺少用户ID' } };
  }

  if (requesterId && requesterId === userId) {
    return { status: 403, body: { error: '不能删除当前登录的管理员账号' } };
  }

  const currentResult = await client.query(
    'SELECT id, email, role FROM profiles WHERE id = $1 LIMIT 1',
    [userId]
  );
  if (currentResult.rows.length === 0) {
    return { status: 404, body: { error: '用户不存在' } };
  }

  const currentUser = currentResult.rows[0] as Record<string, unknown>;
  if (isDefaultAdmin(currentUser)) {
    return { status: 403, body: { error: '系统内置默认管理员账号不可删除' } };
  }

  await client.query('BEGIN');
  try {
    await deleteRowsReferencingUserWorks(client, userId);
    await deleteRowsByUserId(client, userId);
    await client.query('DELETE FROM works WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM profiles WHERE id = $1', [userId]);
    await client.query('DELETE FROM auth.users WHERE id = $1', [userId]).catch(() => { /* auth row may not exist */ });
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }

  return { status: 200, body: { success: true, deletedUserId: userId } };
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

async function getPublicTablesWithColumn(client: PoolClient, columnName: string): Promise<string[]> {
  const result = await client.query(
    `SELECT table_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND column_name = $1
     ORDER BY table_name`,
    [columnName],
  );
  return result.rows.map((row: Record<string, unknown>) => String(row.table_name));
}

async function deleteRowsReferencingUserWorks(client: PoolClient, userId: string): Promise<void> {
  const columns = ['work_id', 'related_work_id'];
  for (const column of columns) {
    const tables = await getPublicTablesWithColumn(client, column);
    for (const table of tables) {
      if (table === 'works') continue;
      await client.query(
        `DELETE FROM ${quoteIdentifier(table)}
         WHERE ${quoteIdentifier(column)} IN (SELECT id FROM works WHERE user_id = $1)`,
        [userId],
      ).catch(() => { /* Older deployments may have incompatible optional tables. */ });
    }
  }
}

async function deleteRowsByUserId(client: PoolClient, userId: string): Promise<void> {
  const tables = await getPublicTablesWithColumn(client, 'user_id');
  for (const table of tables) {
    if (table === 'profiles' || table === 'works') continue;
    await client.query(
      `DELETE FROM ${quoteIdentifier(table)} WHERE user_id = $1`,
      [userId],
    ).catch(() => { /* Older deployments may have incompatible optional tables. */ });
  }
}
