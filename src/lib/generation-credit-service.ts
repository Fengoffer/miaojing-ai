import type { PoolClient } from 'pg';
import { isUuid } from '@/lib/server-api-config';

type BillingMode = 'free' | 'fixed' | 'ratio' | 'token' | 'duration';

export interface GenerationCreditCharge {
  creditsCost: number;
  balanceAfter: number;
  description: string;
}

export interface GenerationCreditRefund {
  creditsRefunded: number;
  balanceAfter: number;
  description: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizePositiveInteger(value: unknown, fallback = 1): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.floor(parsed));
}

function resolveImageResultCount(payload: Record<string, unknown>, result: Record<string, unknown>): number {
  const images = Array.isArray(result.images) ? result.images : [];
  if (images.length > 0) return images.length;
  return normalizePositiveInteger(payload.count, 1);
}

function resolvePerUseCredits(row: Record<string, unknown>): number {
  const billingMode = String(row.billing_mode || 'fixed') as BillingMode;
  if (billingMode === 'free') return 0;
  const creditsPerUse = Number(row.credits_per_use || 0);
  const fixedPrice = Number(row.fixed_price || 0);
  if (billingMode === 'fixed') return Math.ceil(fixedPrice || creditsPerUse || 0);
  return Math.ceil(creditsPerUse || fixedPrice || 0);
}

export async function resolveGenerationCreditCost(
  client: PoolClient,
  input: {
    type: 'image' | 'video';
    payload: Record<string, unknown>;
    result?: Record<string, unknown>;
  },
): Promise<{ creditsCost: number; description: string; systemApiId: string } | null> {
  const config = asRecord(input.payload.customApiConfig);
  const systemApiId = typeof config.systemApiId === 'string' ? config.systemApiId.trim() : '';
  if (!isUuid(systemApiId)) return null;

  const apiResult = await client.query(
    `SELECT id, provider, name, model_name, type, credits_per_use, billing_mode, fixed_price,
            duration_price_per_second
       FROM system_api_configs
      WHERE id = $1
      LIMIT 1`,
    [systemApiId],
  );
  const api = apiResult.rows[0] as Record<string, unknown> | undefined;
  if (!api) return null;

  const billingMode = String(api.billing_mode || 'fixed') as BillingMode;
  let quantity = 1;
  if (input.type === 'image') {
    quantity = resolveImageResultCount(input.payload, input.result || {});
  } else if (billingMode === 'duration') {
    quantity = normalizePositiveInteger(input.payload.duration, 1);
  }

  const perUseCredits = resolvePerUseCredits(api);
  const creditsCost = billingMode === 'duration' && input.type === 'video'
    ? Math.ceil(quantity * Number(api.duration_price_per_second || 0))
    : Math.ceil(perUseCredits * quantity);

  if (!Number.isFinite(creditsCost) || creditsCost <= 0) return null;

  const modelLabel = String(api.name || api.model_name || config.modelName || '系统默认模型');
  const provider = String(api.provider || '系统 API');
  return {
    creditsCost,
    systemApiId,
    description: `${input.type === 'video' ? '视频生成' : '图片生成'} - ${modelLabel}（${provider}）`,
  };
}

export async function resolvePendingGenerationCreditCost(
  client: PoolClient,
  userId: string,
  payload: Record<string, unknown>,
): Promise<number> {
  if (!isUuid(userId)) return 0;
  const payloadJson = JSON.stringify(payload);
  const pendingResult = await client.query(
    `SELECT type, payload
       FROM generation_jobs
      WHERE user_id = $1
        AND status IN ('queued', 'running')
        AND payload <> $2::jsonb`,
    [userId, payloadJson],
  );

  let pendingCost = 0;
  for (const row of pendingResult.rows) {
    const type = row.type === 'image' || row.type === 'video' ? row.type : null;
    if (!type) continue;
    const pendingPayload = asRecord(row.payload);
    const cost = await resolveGenerationCreditCost(client, {
      type,
      payload: pendingPayload,
    });
    pendingCost += cost?.creditsCost || 0;
  }
  return pendingCost;
}

export async function ensureGenerationCreditsAvailable(
  client: PoolClient,
  userId: string,
  input: {
    type: 'image' | 'video';
    payload: Record<string, unknown>;
  },
): Promise<void> {
  const cost = await resolveGenerationCreditCost(client, input);
  if (!cost) return;
  const profileResult = await client.query(
    'SELECT credits_balance FROM profiles WHERE id = $1 FOR UPDATE',
    [userId],
  );
  const balance = Number(profileResult.rows[0]?.credits_balance || 0);
  const pendingCost = await resolvePendingGenerationCreditCost(client, userId, input.payload);
  const availableBalance = balance - pendingCost;
  if (availableBalance < cost.creditsCost) {
    throw new Error(`积分不足，本次生成需要 ${cost.creditsCost} 积分，已排队任务预占 ${pendingCost} 积分，当前余额 ${balance} 积分`);
  }
}

export async function chargeGenerationCredits(
  client: PoolClient,
  input: {
    userId: string | null;
    type: 'image' | 'video';
    payload: Record<string, unknown>;
    result: Record<string, unknown>;
  },
): Promise<GenerationCreditCharge | null> {
  if (!input.userId || !isUuid(input.userId)) return null;
  const cost = await resolveGenerationCreditCost(client, input);
  if (!cost) return null;

  const profileResult = await client.query(
    'SELECT credits_balance FROM profiles WHERE id = $1 FOR UPDATE',
    [input.userId],
  );
  const currentBalance = Number(profileResult.rows[0]?.credits_balance || 0);
  if (currentBalance < cost.creditsCost) {
    throw new Error(`积分不足，本次生成需要 ${cost.creditsCost} 积分，当前余额 ${currentBalance} 积分`);
  }
  const balanceAfter = currentBalance - cost.creditsCost;

  await client.query(
    'UPDATE profiles SET credits_balance = $1, updated_at = NOW() WHERE id = $2',
    [balanceAfter, input.userId],
  );
  await client.query(
    `INSERT INTO credit_transactions (user_id, amount, balance_after, type, description)
     VALUES ($1, $2, $3, 'consume', $4)`,
    [input.userId, -cost.creditsCost, balanceAfter, cost.description],
  );

  return {
    creditsCost: cost.creditsCost,
    balanceAfter,
    description: cost.description,
  };
}

export async function refundGenerationCredits(
  client: PoolClient,
  input: {
    userId: string | null;
    charge: GenerationCreditCharge | null;
    reason: string;
  },
): Promise<GenerationCreditRefund | null> {
  if (!input.userId || !isUuid(input.userId) || !input.charge || input.charge.creditsCost <= 0) {
    return null;
  }

  const profileResult = await client.query(
    'SELECT credits_balance FROM profiles WHERE id = $1 FOR UPDATE',
    [input.userId],
  );
  const currentBalance = Number(profileResult.rows[0]?.credits_balance || 0);
  const balanceAfter = currentBalance + input.charge.creditsCost;
  const description = `${input.charge.description} - ${input.reason}`;

  await client.query(
    'UPDATE profiles SET credits_balance = $1, updated_at = NOW() WHERE id = $2',
    [balanceAfter, input.userId],
  );
  await client.query(
    `INSERT INTO credit_transactions (user_id, amount, balance_after, type, description)
     VALUES ($1, $2, $3, 'refund', $4)`,
    [input.userId, input.charge.creditsCost, balanceAfter, description],
  );

  return {
    creditsRefunded: input.charge.creditsCost,
    balanceAfter,
    description,
  };
}
