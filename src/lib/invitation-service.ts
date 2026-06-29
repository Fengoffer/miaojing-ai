import crypto from 'crypto';
import type { PoolClient } from 'pg';

export const INVITATION_BONUS_CREDITS = 50;

export type InvitationReferralRow = {
  id: string;
  inviteCode: string;
  inviterUserId: string;
  inviteeUserId: string;
  inviterBonusCredits: number;
  inviteeBonusCredits: number;
  createdAt: string;
  inviterEmail?: string;
  inviterNickname?: string;
  inviteeEmail?: string;
  inviteeNickname?: string;
};

export async function ensureInvitationSchema(client: PoolClient): Promise<void> {
  await client.query(`
    ALTER TABLE profiles
      ADD COLUMN IF NOT EXISTS invite_code VARCHAR(32),
      ADD COLUMN IF NOT EXISTS referred_by_user_id UUID
  `);
  await client.query('CREATE UNIQUE INDEX IF NOT EXISTS profiles_invite_code_unique_idx ON profiles (invite_code) WHERE invite_code IS NOT NULL');
  await client.query('CREATE INDEX IF NOT EXISTS profiles_referred_by_user_id_idx ON profiles (referred_by_user_id)');
  await client.query(`
    UPDATE profiles
    SET invite_code = 'MJ' || UPPER(SUBSTRING(REPLACE(id::text, '-', ''), 1, 10)),
        updated_at = NOW()
    WHERE invite_code IS NULL OR invite_code = ''
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS invitation_referrals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      invite_code VARCHAR(32) NOT NULL,
      inviter_user_id UUID NOT NULL,
      invitee_user_id UUID NOT NULL UNIQUE,
      inviter_bonus_credits INTEGER NOT NULL DEFAULT ${INVITATION_BONUS_CREDITS},
      invitee_bonus_credits INTEGER NOT NULL DEFAULT ${INVITATION_BONUS_CREDITS},
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query('CREATE INDEX IF NOT EXISTS invitation_referrals_inviter_idx ON invitation_referrals (inviter_user_id, created_at DESC)');
  await client.query('CREATE INDEX IF NOT EXISTS invitation_referrals_invitee_idx ON invitation_referrals (invitee_user_id)');
  await client.query('CREATE INDEX IF NOT EXISTS invitation_referrals_created_at_idx ON invitation_referrals (created_at DESC)');
}

export function normalizeInviteCode(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 32)
    : '';
}

function generateInviteCode(): string {
  return `MJ${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

export async function getOrCreateInviteCode(client: PoolClient, userId: string): Promise<string> {
  await ensureInvitationSchema(client);
  const existing = await client.query(
    'SELECT invite_code FROM profiles WHERE id = $1 LIMIT 1',
    [userId],
  );
  const current = normalizeInviteCode(existing.rows[0]?.invite_code);
  if (current) return current;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = generateInviteCode();
    const result = await client.query(
      `UPDATE profiles
       SET invite_code = $1, updated_at = NOW()
       WHERE id = $2 AND (invite_code IS NULL OR invite_code = '')
       RETURNING invite_code`,
      [code, userId],
    ).catch((error: unknown) => {
      if (error instanceof Error && /duplicate key/i.test(error.message)) return { rows: [] };
      throw error;
    });
    const saved = normalizeInviteCode(result.rows[0]?.invite_code);
    if (saved) return saved;

    const afterRace = await client.query('SELECT invite_code FROM profiles WHERE id = $1 LIMIT 1', [userId]);
    const racedCode = normalizeInviteCode(afterRace.rows[0]?.invite_code);
    if (racedCode) return racedCode;
  }
  throw new Error('生成邀请码失败，请稍后重试');
}

export async function findInviterByCode(client: PoolClient, inviteCode: unknown) {
  await ensureInvitationSchema(client);
  const code = normalizeInviteCode(inviteCode);
  if (!code) return null;
  const result = await client.query(
    `SELECT id, email, COALESCE(NULLIF(display_nickname, ''), nickname, email) AS nickname, invite_code
     FROM profiles
     WHERE invite_code = $1 AND is_active = true
     LIMIT 1`,
    [code],
  );
  return result.rows[0] || null;
}

export async function applyInvitationReward(
  client: PoolClient,
  input: {
    inviterUserId: string;
    inviteeUserId: string;
    inviteCode: string;
    inviterBonusCredits?: number;
    inviteeBonusCredits?: number;
  },
): Promise<void> {
  await ensureInvitationSchema(client);
  const inviterBonus = Math.max(0, Math.floor(input.inviterBonusCredits ?? INVITATION_BONUS_CREDITS));
  const inviteeBonus = Math.max(0, Math.floor(input.inviteeBonusCredits ?? INVITATION_BONUS_CREDITS));
  if (!inviterBonus && !inviteeBonus) return;

  const inserted = await client.query(
    `INSERT INTO invitation_referrals (
       invite_code, inviter_user_id, invitee_user_id, inviter_bonus_credits, invitee_bonus_credits
     )
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (invitee_user_id) DO NOTHING
     RETURNING id`,
    [normalizeInviteCode(input.inviteCode), input.inviterUserId, input.inviteeUserId, inviterBonus, inviteeBonus],
  );
  if (inserted.rows.length === 0) return;

  await client.query(
    `UPDATE profiles
     SET referred_by_user_id = $1,
         credits_balance = credits_balance + $2,
         updated_at = NOW()
     WHERE id = $3`,
    [input.inviterUserId, inviteeBonus, input.inviteeUserId],
  );
  await client.query(
    `UPDATE profiles
     SET credits_balance = credits_balance + $1,
         updated_at = NOW()
     WHERE id = $2`,
    [inviterBonus, input.inviterUserId],
  );

  const balances = await client.query(
    `SELECT id, credits_balance
     FROM profiles
     WHERE id = ANY($1::uuid[])`,
    [[input.inviterUserId, input.inviteeUserId]],
  );
  const balanceByUser = new Map(balances.rows.map(row => [String(row.id), Number(row.credits_balance || 0)]));
  await client.query(
    `INSERT INTO credit_transactions (user_id, amount, balance_after, type, description)
     VALUES ($1, $2, $3, 'gift', $4), ($5, $6, $7, 'gift', $8)`,
    [
      input.inviterUserId,
      inviterBonus,
      balanceByUser.get(input.inviterUserId) || inviterBonus,
      '邀请新用户注册奖励',
      input.inviteeUserId,
      inviteeBonus,
      balanceByUser.get(input.inviteeUserId) || inviteeBonus,
      '通过邀请链接注册奖励',
    ],
  );
}

function toReferralRow(row: Record<string, unknown>): InvitationReferralRow {
  return {
    id: String(row.id || ''),
    inviteCode: String(row.invite_code || ''),
    inviterUserId: String(row.inviter_user_id || ''),
    inviteeUserId: String(row.invitee_user_id || ''),
    inviterBonusCredits: Number(row.inviter_bonus_credits || 0),
    inviteeBonusCredits: Number(row.invitee_bonus_credits || 0),
    createdAt: row.created_at ? String(row.created_at) : '',
    inviterEmail: row.inviter_email ? String(row.inviter_email) : undefined,
    inviterNickname: row.inviter_nickname ? String(row.inviter_nickname) : undefined,
    inviteeEmail: row.invitee_email ? String(row.invitee_email) : undefined,
    inviteeNickname: row.invitee_nickname ? String(row.invitee_nickname) : undefined,
  };
}

export async function listInvitationReferrals(
  client: PoolClient,
  options: { inviterUserId?: string; search?: string; page?: number; pageSize?: number } = {},
) {
  await ensureInvitationSchema(client);
  const params: unknown[] = [];
  const where: string[] = [];
  if (options.inviterUserId) {
    params.push(options.inviterUserId);
    where.push(`r.inviter_user_id = $${params.length}`);
  }
  const search = (options.search || '').trim().toLowerCase();
  if (search) {
    params.push(`%${search}%`);
    where.push(`(
      LOWER(COALESCE(inviter.email, '')) LIKE $${params.length}
      OR LOWER(COALESCE(inviter.nickname, '')) LIKE $${params.length}
      OR LOWER(COALESCE(inviter.display_nickname, '')) LIKE $${params.length}
      OR LOWER(COALESCE(invitee.email, '')) LIKE $${params.length}
      OR LOWER(COALESCE(invitee.nickname, '')) LIKE $${params.length}
      OR LOWER(COALESCE(invitee.display_nickname, '')) LIKE $${params.length}
      OR LOWER(r.invite_code) LIKE $${params.length}
    )`);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const page = Math.max(1, Math.floor(Number(options.page || 1)));
  const pageSize = Math.min(100, Math.max(1, Math.floor(Number(options.pageSize || 20))));
  const offset = (page - 1) * pageSize;

  const countResult = await client.query(
    `SELECT COUNT(*)::int AS total
     FROM invitation_referrals r
     LEFT JOIN profiles inviter ON inviter.id = r.inviter_user_id
     LEFT JOIN profiles invitee ON invitee.id = r.invitee_user_id
     ${whereSql}`,
    params,
  );
  const result = await client.query(
    `SELECT r.id, r.invite_code, r.inviter_user_id, r.invitee_user_id,
            r.inviter_bonus_credits, r.invitee_bonus_credits, r.created_at,
            inviter.email AS inviter_email,
            COALESCE(NULLIF(inviter.display_nickname, ''), inviter.nickname, inviter.email) AS inviter_nickname,
            invitee.email AS invitee_email,
            COALESCE(NULLIF(invitee.display_nickname, ''), invitee.nickname, invitee.email) AS invitee_nickname
     FROM invitation_referrals r
     LEFT JOIN profiles inviter ON inviter.id = r.inviter_user_id
     LEFT JOIN profiles invitee ON invitee.id = r.invitee_user_id
     ${whereSql}
     ORDER BY r.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pageSize, offset],
  );
  const total = Number(countResult.rows[0]?.total || 0);
  return {
    referrals: result.rows.map(row => toReferralRow(row)),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}
