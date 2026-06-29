import crypto from 'crypto';
import type { PoolClient } from 'pg';

export type RedeemCodeRow = {
  id: string;
  code: string;
  codeType: RedeemCodeType;
  creditsAmount: number;
  membershipTier: MembershipTier | null;
  membershipDurationValue: number | null;
  membershipDurationUnit: MembershipDurationUnit | null;
  note: string;
  isActive: boolean;
  batchId: string;
  createdBy: string | null;
  createdByEmail: string | null;
  createdByName: string | null;
  usedBy: string | null;
  usedByEmail: string | null;
  usedByName: string | null;
  usedAt: string | null;
  createdAt: string;
  updatedAt: string | null;
};

export type RedeemCodeType = 'credits' | 'membership';
export type MembershipTier = 'pro' | 'max' | 'ultra' | 'enterprise';
export type MembershipDurationUnit = 'day' | 'month' | 'year';

export type RedeemCodeListQuery = {
  search?: string;
  status?: 'all' | 'unused' | 'used' | 'inactive';
  limit?: number;
};

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MEMBERSHIP_TIERS = new Set(['pro', 'max', 'ultra', 'enterprise']);
const MEMBERSHIP_DURATION_UNITS = new Set(['day', 'month', 'year']);

export async function ensureRedeemCodeSchema(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS redeem_codes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      code VARCHAR(64) NOT NULL UNIQUE,
      normalized_code VARCHAR(64) NOT NULL UNIQUE,
      code_type VARCHAR(16) NOT NULL DEFAULT 'credits',
      credits_amount INTEGER NOT NULL DEFAULT 0,
      membership_tier VARCHAR(32),
      membership_duration_value INTEGER,
      membership_duration_unit VARCHAR(16),
      batch_id UUID NOT NULL DEFAULT gen_random_uuid(),
      note VARCHAR(255) NOT NULL DEFAULT '',
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_by UUID,
      used_by UUID,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ
    );

    ALTER TABLE redeem_codes ADD COLUMN IF NOT EXISTS code_type VARCHAR(16) NOT NULL DEFAULT 'credits';
    ALTER TABLE redeem_codes ADD COLUMN IF NOT EXISTS membership_tier VARCHAR(32);
    ALTER TABLE redeem_codes ADD COLUMN IF NOT EXISTS membership_duration_value INTEGER;
    ALTER TABLE redeem_codes ADD COLUMN IF NOT EXISTS membership_duration_unit VARCHAR(16);
    ALTER TABLE redeem_codes ALTER COLUMN credits_amount SET DEFAULT 0;
    ALTER TABLE redeem_codes DROP CONSTRAINT IF EXISTS redeem_codes_credits_amount_check;
    ALTER TABLE redeem_codes DROP CONSTRAINT IF EXISTS redeem_codes_payload_check;
    ALTER TABLE redeem_codes
      ADD CONSTRAINT redeem_codes_payload_check CHECK (
        (
          code_type = 'credits'
          AND credits_amount > 0
        )
        OR (
          code_type = 'membership'
          AND credits_amount >= 0
          AND membership_tier IN ('pro', 'max', 'ultra', 'enterprise')
          AND membership_duration_value > 0
          AND membership_duration_unit IN ('day', 'month', 'year')
        )
      );

    CREATE INDEX IF NOT EXISTS redeem_codes_created_at_idx ON redeem_codes (created_at DESC);
    CREATE INDEX IF NOT EXISTS redeem_codes_batch_id_idx ON redeem_codes (batch_id);
    CREATE INDEX IF NOT EXISTS redeem_codes_used_by_idx ON redeem_codes (used_by);
    CREATE INDEX IF NOT EXISTS redeem_codes_status_idx ON redeem_codes (is_active, used_at);
    CREATE INDEX IF NOT EXISTS redeem_codes_type_idx ON redeem_codes (code_type);
  `);
}

export function normalizeRedeemCode(value: string): string {
  return value.replace(/[^a-z0-9]/gi, '').toUpperCase();
}

function formatRedeemCode(normalized: string): string {
  return `MJ-${normalized.slice(0, 4)}-${normalized.slice(4, 8)}-${normalized.slice(8, 12)}`;
}

function randomNormalizedCode(): string {
  let code = '';
  for (let index = 0; index < 12; index += 1) {
    const byte = crypto.randomInt(0, CODE_ALPHABET.length);
    code += CODE_ALPHABET[byte];
  }
  return code;
}

function mapRedeemCodeRow(row: Record<string, unknown>): RedeemCodeRow {
  const codeType = row.code_type === 'membership' ? 'membership' : 'credits';
  return {
    id: String(row.id),
    code: String(row.code || ''),
    codeType,
    creditsAmount: Number(row.credits_amount || 0),
    membershipTier: codeType === 'membership' && typeof row.membership_tier === 'string'
      ? row.membership_tier as MembershipTier
      : null,
    membershipDurationValue: codeType === 'membership' && row.membership_duration_value != null
      ? Number(row.membership_duration_value)
      : null,
    membershipDurationUnit: codeType === 'membership' && typeof row.membership_duration_unit === 'string'
      ? row.membership_duration_unit as MembershipDurationUnit
      : null,
    note: String(row.note || ''),
    isActive: row.is_active !== false,
    batchId: String(row.batch_id || ''),
    createdBy: row.created_by ? String(row.created_by) : null,
    createdByEmail: row.created_by_email ? String(row.created_by_email) : null,
    createdByName: row.created_by_name ? String(row.created_by_name) : null,
    usedBy: row.used_by ? String(row.used_by) : null,
    usedByEmail: row.used_by_email ? String(row.used_by_email) : null,
    usedByName: row.used_by_name ? String(row.used_by_name) : null,
    usedAt: row.used_at ? new Date(row.used_at as string | Date).toISOString() : null,
    createdAt: row.created_at ? new Date(row.created_at as string | Date).toISOString() : '',
    updatedAt: row.updated_at ? new Date(row.updated_at as string | Date).toISOString() : null,
  };
}

export async function createRedeemCodes(
  client: PoolClient,
  input: {
    count: number;
    codeType?: RedeemCodeType;
    creditsAmount?: number;
    membershipTier?: string;
    membershipDurationValue?: number;
    membershipDurationUnit?: string;
    note?: string;
    createdBy: string;
  },
): Promise<{ batchId: string; codes: RedeemCodeRow[] }> {
  await ensureRedeemCodeSchema(client);

  const count = Math.min(Math.max(Math.floor(input.count || 1), 1), 500);
  const codeType: RedeemCodeType = input.codeType === 'membership' ? 'membership' : 'credits';
  const creditsAmount = codeType === 'credits' ? Math.floor(input.creditsAmount || 0) : 0;
  const membershipTier = normalizeMembershipTier(input.membershipTier);
  const membershipDurationValue = codeType === 'membership' ? Math.floor(input.membershipDurationValue || 0) : null;
  const membershipDurationUnit = normalizeMembershipDurationUnit(input.membershipDurationUnit);
  const note = (input.note || '').trim().slice(0, 255);
  if (codeType === 'credits' && (!Number.isFinite(creditsAmount) || creditsAmount <= 0)) {
    throw new Error('兑换积分数量必须大于 0');
  }
  if (codeType === 'membership') {
    if (!membershipTier) throw new Error('请选择会员等级');
    if (!membershipDurationUnit) throw new Error('请选择会员时长单位');
    if (!membershipDurationValue || membershipDurationValue <= 0) throw new Error('会员时长必须大于 0');
  }

  const batchId = crypto.randomUUID();
  const created: RedeemCodeRow[] = [];

  for (let index = 0; index < count; index += 1) {
    let inserted: RedeemCodeRow | null = null;
    for (let attempt = 0; attempt < 10 && !inserted; attempt += 1) {
      const normalized = normalizeRedeemCode(randomNormalizedCode());
      const code = formatRedeemCode(normalized);
      const result = await client.query(
        `INSERT INTO redeem_codes (
           code, normalized_code, code_type, credits_amount,
           membership_tier, membership_duration_value, membership_duration_unit,
           batch_id, note, created_by
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (normalized_code) DO NOTHING
         RETURNING *`,
        [
          code,
          normalized,
          codeType,
          creditsAmount,
          codeType === 'membership' ? membershipTier : null,
          codeType === 'membership' ? membershipDurationValue : null,
          codeType === 'membership' ? membershipDurationUnit : null,
          batchId,
          note,
          input.createdBy,
        ],
      );
      if (result.rows[0]) inserted = mapRedeemCodeRow(result.rows[0]);
    }

    if (!inserted) {
      throw new Error('生成兑换码失败，请重试');
    }
    created.push(inserted);
  }

  return { batchId, codes: created };
}

export async function listRedeemCodes(client: PoolClient, query: RedeemCodeListQuery = {}): Promise<RedeemCodeRow[]> {
  await ensureRedeemCodeSchema(client);

  const where: string[] = [];
  const params: unknown[] = [];

  if (query.status === 'unused') where.push('rc.used_at IS NULL AND rc.is_active = true');
  if (query.status === 'used') where.push('rc.used_at IS NOT NULL');
  if (query.status === 'inactive') where.push('rc.is_active = false');

  const search = (query.search || '').trim();
  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    where.push(`(
      lower(rc.code) LIKE $${params.length}
      OR lower(rc.note) LIKE $${params.length}
      OR lower(rc.code_type) LIKE $${params.length}
      OR lower(COALESCE(rc.membership_tier, '')) LIKE $${params.length}
      OR lower(COALESCE(used.email, '')) LIKE $${params.length}
      OR lower(COALESCE(used.display_nickname, used.nickname, '')) LIKE $${params.length}
    )`);
  }

  const limit = Math.min(Math.max(Math.floor(query.limit || 100), 20), 500);
  params.push(limit);

  const result = await client.query(
    `SELECT rc.*,
            creator.email AS created_by_email,
            COALESCE(NULLIF(creator.display_nickname, ''), creator.nickname) AS created_by_name,
            used.email AS used_by_email,
            COALESCE(NULLIF(used.display_nickname, ''), used.nickname) AS used_by_name
       FROM redeem_codes rc
       LEFT JOIN profiles creator ON creator.id = rc.created_by
       LEFT JOIN profiles used ON used.id = rc.used_by
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY rc.created_at DESC
      LIMIT $${params.length}`,
    params,
  );

  return result.rows.map(mapRedeemCodeRow);
}

export async function setRedeemCodeActive(client: PoolClient, id: string, isActive: boolean): Promise<RedeemCodeRow | null> {
  await ensureRedeemCodeSchema(client);
  const result = await client.query(
    `UPDATE redeem_codes
        SET is_active = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [id, isActive],
  );
  return result.rows[0] ? mapRedeemCodeRow(result.rows[0]) : null;
}

export async function deleteUnusedRedeemCode(client: PoolClient, id: string): Promise<boolean> {
  await ensureRedeemCodeSchema(client);
  const result = await client.query(
    'DELETE FROM redeem_codes WHERE id = $1 AND used_at IS NULL',
    [id],
  );
  return (result.rowCount || 0) > 0;
}

export async function redeemCodeForUser(
  client: PoolClient,
  input: { code: string; userId: string },
): Promise<{
  codeType: RedeemCodeType;
  creditsAmount: number;
  creditsBalance: number;
  code: string;
  membershipTier?: MembershipTier;
  membershipExpiresAt?: string;
  membershipDurationValue?: number;
  membershipDurationUnit?: MembershipDurationUnit;
}> {
  await ensureRedeemCodeSchema(client);
  const normalized = normalizeRedeemCode(input.code);
  if (normalized.length < 8 || normalized.length > 32) {
    throw new Error('兑换码格式不正确');
  }

  await client.query('BEGIN');
  try {
    const codeResult = await client.query(
      'SELECT * FROM redeem_codes WHERE normalized_code = $1 FOR UPDATE',
      [normalized],
    );
    const codeRow = codeResult.rows[0];
    if (!codeRow) throw new Error('兑换码不存在');
    if (codeRow.is_active === false) throw new Error('兑换码已停用');
    if (codeRow.used_at || codeRow.used_by) throw new Error('兑换码已被使用');

    const profileResult = await client.query(
      'SELECT id, role, credits_balance, membership_expires_at FROM profiles WHERE id = $1 AND is_active = true FOR UPDATE',
      [input.userId],
    );
    const profile = profileResult.rows[0];
    if (!profile) throw new Error('用户不存在或已停用');

    const codeType: RedeemCodeType = codeRow.code_type === 'membership' ? 'membership' : 'credits';
    const creditsAmount = Number(codeRow.credits_amount || 0);
    let creditsBalance = Number(profile.credits_balance || 0);
    let membershipTier: MembershipTier | undefined;
    let membershipExpiresAt: string | undefined;
    let membershipDurationValue: number | undefined;
    let membershipDurationUnit: MembershipDurationUnit | undefined;

    if (codeType === 'credits') {
      if (creditsAmount <= 0) throw new Error('兑换码配置无效');
      creditsBalance += creditsAmount;
      await client.query(
        'UPDATE profiles SET credits_balance = $1, updated_at = NOW() WHERE id = $2',
        [creditsBalance, input.userId],
      );
      await client.query(
        `INSERT INTO credit_transactions (user_id, amount, balance_after, type, description)
         VALUES ($1, $2, $3, $4, $5)`,
        [input.userId, creditsAmount, creditsBalance, 'redeem', `兑换码兑换：${codeRow.code}`],
      );
    } else {
      membershipTier = normalizeMembershipTier(codeRow.membership_tier) || undefined;
      membershipDurationValue = Number(codeRow.membership_duration_value || 0);
      membershipDurationUnit = normalizeMembershipDurationUnit(codeRow.membership_duration_unit) || undefined;
      if (!membershipTier || !membershipDurationValue || !membershipDurationUnit) {
        throw new Error('会员兑换码配置无效');
      }
      const expiresAt = computeMembershipExpiresAt(profile.membership_expires_at, membershipDurationValue, membershipDurationUnit);
      membershipExpiresAt = expiresAt.toISOString();
      const nextRole = profile.role === 'admin' || profile.role === 'enterprise_admin' ? profile.role : 'vip';
      await client.query(
        `UPDATE profiles
            SET membership_tier = $1,
                membership_expires_at = $2,
                role = $3,
                updated_at = NOW()
          WHERE id = $4`,
        [membershipTier, expiresAt, nextRole, input.userId],
      );
    }
    await client.query(
      `UPDATE redeem_codes
          SET used_by = $1, used_at = NOW(), updated_at = NOW()
        WHERE id = $2`,
      [input.userId, codeRow.id],
    );

    await client.query('COMMIT');
    return {
      codeType,
      creditsAmount,
      creditsBalance,
      code: String(codeRow.code),
      membershipTier,
      membershipExpiresAt,
      membershipDurationValue,
      membershipDurationUnit,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

function normalizeMembershipTier(value: unknown): MembershipTier | null {
  if (typeof value !== 'string') return null;
  const tier = value.trim().toLowerCase();
  return MEMBERSHIP_TIERS.has(tier) ? tier as MembershipTier : null;
}

function normalizeMembershipDurationUnit(value: unknown): MembershipDurationUnit | null {
  if (typeof value !== 'string') return null;
  const unit = value.trim().toLowerCase();
  return MEMBERSHIP_DURATION_UNITS.has(unit) ? unit as MembershipDurationUnit : null;
}

function computeMembershipExpiresAt(currentExpiresAt: unknown, amount: number, unit: MembershipDurationUnit): Date {
  const now = new Date();
  const current = currentExpiresAt ? new Date(currentExpiresAt as string | Date) : null;
  const base = current && Number.isFinite(current.getTime()) && current > now ? current : now;
  const next = new Date(base.getTime());
  if (unit === 'day') next.setDate(next.getDate() + amount);
  if (unit === 'month') next.setMonth(next.getMonth() + amount);
  if (unit === 'year') next.setFullYear(next.getFullYear() + amount);
  return next;
}
