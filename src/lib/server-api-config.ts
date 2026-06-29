import crypto from 'crypto';
import { NextRequest } from 'next/server';
import { decryptSecret, encryptSecret, previewSecret } from '@/lib/server-crypto';
import { getAuthenticatedUserId } from '@/lib/session-auth';
import { getDbClient } from '@/storage/database/local-db';
import { isProductionRuntime } from '@/lib/runtime-env';
import { readManifestCapabilities } from '@/lib/user-api-manifest';
import {
  ensureAgnesSystemApiManifest,
  getAgnesSystemApiManifestCapabilities,
} from '@/lib/agnes-system-manifest';
import { getAgnesModelCapabilities } from '@/lib/agnes-model-templates';
import type { ManagedVideoUsageMode, ModelCapabilityConfig } from '@/lib/model-config-types';

export type MembershipTier = 'free' | 'pro' | 'max' | 'ultra';
export type SystemApiPollingMode = 'sequential' | 'random' | 'custom';

export const SYSTEM_API_MEMBERSHIP_TIERS: MembershipTier[] = ['free', 'pro', 'max', 'ultra'];
export const SYSTEM_API_POLLING_MODES: SystemApiPollingMode[] = ['sequential', 'random', 'custom'];

export type ServerManagedApiConfig = {
  id: string;
  provider: string;
  name: string;
  apiUrl: string;
  modelName: string;
  modelGroup: string;
  note: string;
  apiKey: string;
  apiKeyPreview: string;
  type: 'image' | 'video' | 'text';
  creditsPerUse: number;
  billingMode: 'free' | 'fixed' | 'ratio' | 'token' | 'duration';
  fixedPrice: number;
  durationPricePerSecond: number;
  inputPricePer1K: number;
  outputPricePer1K: number;
  modelRatio: number;
  completionRatio: number;
  groupRatio: number;
  priceNote: string;
  manifestPath: string;
  capabilities?: ModelCapabilityConfig;
  isDefault: boolean;
  allowedMembershipTiers: MembershipTier[];
  pollingMode: SystemApiPollingMode;
  pollingOrder: number;
  videoUsageModes: ManagedVideoUsageMode[];
  isActive: boolean;
  sortOrder: number;
  createdAt?: string;
  updatedAt?: string | null;
};

export type ClientApiConfigRef = {
  apiUrl?: string;
  modelName?: string;
  apiKey?: string;
  provider?: string;
  customApiKeyId?: string;
  systemApiId?: string;
  manifestPath?: string;
};

export function normalizeMembershipTier(value: unknown): MembershipTier {
  if (value === 'basic') return 'pro';
  if (value === 'enterprise') return 'ultra';
  if (value === 'pro' || value === 'max' || value === 'ultra' || value === 'free') return value;
  return 'free';
}

export function normalizeAllowedMembershipTiers(value: unknown): MembershipTier[] {
  if (typeof value === 'string' && value.trim().startsWith('[')) {
    try {
      return normalizeAllowedMembershipTiers(JSON.parse(value));
    } catch {
      // Fall through to comma-separated parsing below.
    }
  }
  const values = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];
  const normalized = values
    .map(item => normalizeMembershipTier(String(item).trim()))
    .filter((item, index, arr) => arr.indexOf(item) === index);
  return normalized.length > 0 ? normalized : [...SYSTEM_API_MEMBERSHIP_TIERS];
}

export function systemApiAllowsMembershipTier(api: Pick<ServerManagedApiConfig, 'allowedMembershipTiers'>, tier: unknown): boolean {
  return normalizeAllowedMembershipTiers(api.allowedMembershipTiers).includes(normalizeMembershipTier(tier));
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

type DbClient = Awaited<ReturnType<typeof getDbClient>>;

function isDatabaseOwnershipError(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: string }).code === '42501';
}

async function applyOptionalSystemApiSchemaChange(client: DbClient, sql: string): Promise<void> {
  try {
    await client.query(sql);
  } catch (err) {
    if (isDatabaseOwnershipError(err)) {
      console.warn('[system-api-schema] skipped optional schema change because the database user is not the table owner');
      return;
    }
    throw err;
  }
}

export function getInternalGenerationSecret(): string {
  const secret = process.env.GENERATION_INTERNAL_SECRET || process.env.JWT_SECRET || process.env.DATA_ENCRYPTION_KEY;
  if (secret) return secret;
  if (isProductionRuntime()) {
    throw new Error('GENERATION_INTERNAL_SECRET, JWT_SECRET or DATA_ENCRYPTION_KEY is required in production');
  }
  return 'miaojing-local-generation-secret';
}

export function getInternalGenerationHeaders(): Record<string, string> {
  return { 'x-miaojing-generation-internal': getInternalGenerationSecret() };
}

export function isTrustedInternalGenerationRequest(request: NextRequest): boolean {
  const provided = request.headers.get('x-miaojing-generation-internal') || '';
  const expected = getInternalGenerationSecret();
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return providedBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

export async function ensureSystemApiSchema(client: DbClient): Promise<void> {
  await applyOptionalSystemApiSchemaChange(client, `
    CREATE TABLE IF NOT EXISTS system_api_configs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      provider VARCHAR(128),
      name VARCHAR(255) NOT NULL,
      api_url TEXT NOT NULL DEFAULT '',
      model_name VARCHAR(255) NOT NULL,
      model_group VARCHAR(128) NOT NULL DEFAULT 'default',
      note TEXT NOT NULL DEFAULT '',
      api_key_encrypted TEXT NOT NULL DEFAULT '',
      api_key_preview VARCHAR(64) NOT NULL DEFAULT '',
      type VARCHAR(16) NOT NULL DEFAULT 'image',
      credits_per_use INTEGER NOT NULL DEFAULT 10,
      billing_mode VARCHAR(24) NOT NULL DEFAULT 'fixed',
      fixed_price NUMERIC(12, 4) NOT NULL DEFAULT 0,
      duration_price_per_second NUMERIC(12, 6) NOT NULL DEFAULT 0,
      input_price_per_1k NUMERIC(12, 6) NOT NULL DEFAULT 0,
      output_price_per_1k NUMERIC(12, 6) NOT NULL DEFAULT 0,
      model_ratio NUMERIC(12, 6) NOT NULL DEFAULT 1,
      completion_ratio NUMERIC(12, 6) NOT NULL DEFAULT 1,
      group_ratio NUMERIC(12, 6) NOT NULL DEFAULT 1,
      price_note TEXT NOT NULL DEFAULT '',
      manifest_path TEXT NOT NULL DEFAULT '',
      is_default BOOLEAN NOT NULL DEFAULT true,
      allowed_membership_tiers JSONB NOT NULL DEFAULT '["free","pro","max","ultra"]'::jsonb,
      polling_mode VARCHAR(16) NOT NULL DEFAULT 'sequential',
      polling_order INTEGER NOT NULL DEFAULT 0,
      video_usage_modes JSONB NOT NULL DEFAULT '["text-to-video","image-to-video"]'::jsonb,
      is_active BOOLEAN NOT NULL DEFAULT true,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ
    )
  `);
  await applyOptionalSystemApiSchemaChange(client, `
    ALTER TABLE system_api_configs
      ADD COLUMN IF NOT EXISTS model_group VARCHAR(128) NOT NULL DEFAULT 'default',
      ADD COLUMN IF NOT EXISTS billing_mode VARCHAR(24) NOT NULL DEFAULT 'fixed',
      ADD COLUMN IF NOT EXISTS fixed_price NUMERIC(12, 4) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS duration_price_per_second NUMERIC(12, 6) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS input_price_per_1k NUMERIC(12, 6) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS output_price_per_1k NUMERIC(12, 6) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS model_ratio NUMERIC(12, 6) NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS completion_ratio NUMERIC(12, 6) NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS group_ratio NUMERIC(12, 6) NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS price_note TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS manifest_path TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS allowed_membership_tiers JSONB NOT NULL DEFAULT '["free","pro","max","ultra"]'::jsonb,
      ADD COLUMN IF NOT EXISTS polling_mode VARCHAR(16) NOT NULL DEFAULT 'sequential',
      ADD COLUMN IF NOT EXISTS polling_order INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS video_usage_modes JSONB NOT NULL DEFAULT '["text-to-video","image-to-video"]'::jsonb
  `);
  await applyOptionalSystemApiSchemaChange(client, 'CREATE INDEX IF NOT EXISTS system_api_configs_active_type_sort_idx ON system_api_configs (is_active, type, sort_order)');
  await applyOptionalSystemApiSchemaChange(client, 'CREATE INDEX IF NOT EXISTS system_api_configs_group_type_sort_idx ON system_api_configs (model_group, type, sort_order)');
  await applyOptionalSystemApiSchemaChange(client, 'CREATE INDEX IF NOT EXISTS system_api_configs_default_sort_idx ON system_api_configs (is_default, is_active, sort_order)');
  await applyOptionalSystemApiSchemaChange(client, 'CREATE INDEX IF NOT EXISTS system_api_configs_polling_idx ON system_api_configs (type, model_name, is_default, is_active, polling_order, sort_order)');
  await applyOptionalSystemApiSchemaChange(client, 'CREATE INDEX IF NOT EXISTS system_api_configs_display_polling_idx ON system_api_configs (type, name, is_default, is_active, polling_order, sort_order)');
}

function normalizeBillingMode(value: unknown): ServerManagedApiConfig['billingMode'] {
  return value === 'free' || value === 'ratio' || value === 'token' || value === 'duration' ? value : 'fixed';
}

export function normalizeSystemApiPollingMode(value: unknown): SystemApiPollingMode {
  return value === 'random' || value === 'custom' ? value : 'sequential';
}

export function normalizeVideoUsageModes(value: unknown): ManagedVideoUsageMode[] {
  const raw = typeof value === 'string' && value.trim().startsWith('[')
    ? (() => {
        try { return JSON.parse(value); } catch { return value; }
      })()
    : value;
  const values = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
  const normalized = values
    .map(item => String(item).trim())
    .filter((item): item is ManagedVideoUsageMode => item === 'text-to-video' || item === 'image-to-video')
    .filter((item, index, arr) => arr.indexOf(item) === index);
  return normalized.length > 0 ? normalized : ['text-to-video', 'image-to-video'];
}

export function getAgnesSystemApiCapabilitiesFallback(row: Record<string, unknown>): ModelCapabilityConfig | undefined {
  return getAgnesSystemApiManifestCapabilities(row) || getAgnesModelCapabilities(String(row.model_name || '').toLowerCase());
}

export function toSafeSystemApi(row: Record<string, unknown>, includeInactive = true): Omit<ServerManagedApiConfig, 'apiKey'> & { apiKey: '' } {
  return {
    id: String(row.id || ''),
    provider: String(row.provider || ''),
    name: String(row.name || ''),
    apiUrl: String(row.api_url || ''),
    modelName: String(row.model_name || ''),
    modelGroup: String(row.model_group || 'default'),
    note: String(row.note || ''),
    apiKey: '',
    apiKeyPreview: String(row.api_key_preview || ''),
    type: row.type === 'video' || row.type === 'text' ? row.type : 'image',
    creditsPerUse: Number(row.credits_per_use || 0),
    billingMode: normalizeBillingMode(row.billing_mode),
    fixedPrice: Number(row.fixed_price || 0),
    durationPricePerSecond: Number(row.duration_price_per_second || 0),
    inputPricePer1K: Number(row.input_price_per_1k || 0),
    outputPricePer1K: Number(row.output_price_per_1k || 0),
    modelRatio: Number(row.model_ratio || 1),
    completionRatio: Number(row.completion_ratio || 1),
    groupRatio: Number(row.group_ratio || 1),
    priceNote: String(row.price_note || ''),
    manifestPath: String(row.manifest_path || ''),
    capabilities: getAgnesSystemApiCapabilitiesFallback(row) || readManifestCapabilities(String(row.manifest_path || '')),
    isDefault: row.is_default !== false,
    allowedMembershipTiers: normalizeAllowedMembershipTiers(row.allowed_membership_tiers),
    pollingMode: normalizeSystemApiPollingMode(row.polling_mode),
    pollingOrder: Number(row.polling_order || 0),
    videoUsageModes: normalizeVideoUsageModes(row.video_usage_modes),
    isActive: includeInactive ? row.is_active !== false : true,
    sortOrder: Number(row.sort_order || 0),
    createdAt: row.created_at ? String(row.created_at) : undefined,
    updatedAt: row.updated_at ? String(row.updated_at) : null,
  };
}

function getSystemApiDisplayKey(api: Pick<ServerManagedApiConfig, 'name' | 'modelName'>): string {
  return api.name?.trim() || api.modelName?.trim() || '';
}

function getSystemApiCollapseKey(api: ServerManagedApiConfig): string {
  const family = getProviderProtocolFamily(api as unknown as Record<string, unknown>);
  return `${api.type}:${family}:${getSystemApiDisplayKey(api)}`;
}

export async function getUserMembershipTier(userId: string): Promise<MembershipTier> {
  const client = await getDbClient();
  try {
    const result = await client.query('SELECT membership_tier FROM profiles WHERE id = $1 LIMIT 1', [userId]);
    return normalizeMembershipTier(result.rows[0]?.membership_tier);
  } finally {
    client.release();
  }
}

export async function listSystemApis(
  includeInactive = false,
  options: { defaultOnly?: boolean; userTier?: MembershipTier | string | null; collapseDefaultModels?: boolean } = {},
) {
  const client = await getDbClient();
  try {
    await ensureSystemApiSchema(client);
    const result = await client.query(
      `SELECT id, provider, name, api_url, model_name, model_group, note, api_key_preview, type,
              credits_per_use, billing_mode, fixed_price, duration_price_per_second, input_price_per_1k, output_price_per_1k,
              model_ratio, completion_ratio, group_ratio, price_note, manifest_path,
              is_default, allowed_membership_tiers, polling_mode, polling_order,
              video_usage_modes, is_active, sort_order, created_at, updated_at
       FROM system_api_configs
       ${includeInactive ? '' : 'WHERE is_active = true'}
       ORDER BY model_group ASC, sort_order ASC, created_at ASC`,
    );
    const apis = result.rows
      .map(row => toSafeSystemApi(row, includeInactive))
      .filter(api => !options.defaultOnly || api.isDefault)
      .filter(api => !options.userTier || systemApiAllowsMembershipTier(api, options.userTier));
    if (!options.collapseDefaultModels) return apis;
    const seen = new Set<string>();
    return apis.filter(api => {
      const key = getSystemApiCollapseKey(api);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  } finally {
    client.release();
  }
}

function shuffleSystemApis<T>(items: T[]): T[] {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function sortSystemApiPollingRows(rows: Record<string, unknown>[], mode: SystemApiPollingMode) {
  if (mode === 'random') return shuffleSystemApis(rows);
  return [...rows].sort((a, b) => {
    const primaryA = mode === 'custom' ? Number(a.polling_order || 0) : Number(a.sort_order || 0);
    const primaryB = mode === 'custom' ? Number(b.polling_order || 0) : Number(b.sort_order || 0);
    if (primaryA !== primaryB) return primaryA - primaryB;
    const secondaryA = mode === 'custom' ? Number(a.sort_order || 0) : Number(a.polling_order || 0);
    const secondaryB = mode === 'custom' ? Number(b.sort_order || 0) : Number(b.polling_order || 0);
    if (secondaryA !== secondaryB) return secondaryA - secondaryB;
    return String(a.created_at || '').localeCompare(String(b.created_at || ''));
  });
}

function normalizeProviderFamilyText(value: unknown): string {
  return String(value || '').replace(/\s+/g, '').toLowerCase();
}

function getProviderProtocolFamily(row: Record<string, unknown>): 'agnes' | 'generic' {
  const provider = normalizeProviderFamilyText([
    row.provider,
    row.name,
    row.api_url,
    row.apiUrl,
  ].filter(Boolean).join(' '));
  const modelGroup = String(row.model_group || row.modelGroup || '').trim().toLowerCase();
  if (provider.includes('agnes') || modelGroup === 'agnes-image' || modelGroup === 'agnes-video' || modelGroup.startsWith('agnes-')) {
    return 'agnes';
  }
  return 'generic';
}

export async function resolveSystemApiPollingCandidates(
  request: NextRequest,
  input: ClientApiConfigRef | undefined,
  trustedUserId?: string | null,
): Promise<ClientApiConfigRef[]> {
  if (!isUuid(input?.systemApiId)) return [];

  const trustedInternal = isTrustedInternalGenerationRequest(request);
  const userId = trustedUserId || await getAuthenticatedUserId(request);
  if (!userId && !trustedInternal) throw new Error('请先登录后再使用系统 API');

  const client = await getDbClient();
  try {
    await ensureSystemApiSchema(client);
    const selectedResult = await client.query(
      `SELECT id, provider, type, name, api_url, model_name, model_group, is_default, allowed_membership_tiers, polling_mode
       FROM system_api_configs
       WHERE id = $1 AND is_active = true
       LIMIT 1`,
      [input.systemApiId],
    );
    if (selectedResult.rows.length === 0) throw new Error('系统 API 不存在或未启用');
    const selected = selectedResult.rows[0];
    if (selected.is_default === false) throw new Error('该系统 API 未开放为平台默认模型');

    const tier = userId
      ? normalizeMembershipTier((await client.query('SELECT membership_tier FROM profiles WHERE id = $1 LIMIT 1', [userId])).rows[0]?.membership_tier)
      : 'free';
    if (!normalizeAllowedMembershipTiers(selected.allowed_membership_tiers).includes(tier)) {
      throw new Error('当前会员等级无权使用该系统 API');
    }
    const selectedFamily = getProviderProtocolFamily(selected);

    const candidatesResult = await client.query(
      `SELECT id, provider, name, api_url, model_name, model_group, manifest_path, api_key_encrypted,
              type,
              allowed_membership_tiers, polling_mode, polling_order, sort_order, created_at
       FROM system_api_configs
       WHERE type = $1
         AND COALESCE(NULLIF(BTRIM(name), ''), model_name) = $2
         AND is_default = true
         AND is_active = true`,
      [selected.type, String(selected.name || selected.model_name || '').trim()],
    );
    const allowedRows = candidatesResult.rows.filter(row => (
      normalizeAllowedMembershipTiers(row.allowed_membership_tiers).includes(tier)
    ));
    const protocolRows = selectedFamily === 'generic'
      ? allowedRows
      : allowedRows.filter(row => getProviderProtocolFamily(row) === selectedFamily);
    const candidateRows = selectedFamily === 'generic' ? allowedRows : protocolRows;
    if (candidateRows.length === 0) throw new Error('当前会员等级无权使用该系统 API');

    const mode = normalizeSystemApiPollingMode(selected.polling_mode || candidateRows[0]?.polling_mode);
    return Promise.all(sortSystemApiPollingRows(candidateRows, mode).map(async row => {
      const agnesManifest = await ensureAgnesSystemApiManifest(client, row);
      return {
        provider: String(row.provider || row.name || 'system'),
        apiUrl: agnesManifest?.apiUrl || String(row.api_url || ''),
        modelName: String(row.model_name || ''),
        apiKey: decryptSecret(String(row.api_key_encrypted || '')) || '',
        manifestPath: agnesManifest?.manifestPath || String(row.manifest_path || ''),
        systemApiId: String(row.id || ''),
      };
    }));
  } finally {
    client.release();
  }
}

export async function resolveServerApiConfig(
  request: NextRequest,
  input: ClientApiConfigRef | undefined,
  trustedUserId?: string | null,
): Promise<ClientApiConfigRef | undefined> {
  if (!input) return undefined;

  if (isUuid(input.customApiKeyId)) {
    const userId = trustedUserId || await getAuthenticatedUserId(request);
    if (!userId) throw new Error('请先登录后再使用自定义 API');
    const client = await getDbClient();
    try {
      const result = await client.query(
        `SELECT provider, supplier_name, api_url, model_name, manifest_path, api_key_encrypted, type
         FROM user_api_keys
         WHERE id = $1 AND user_id = $2 AND is_active = true
         LIMIT 1`,
        [input.customApiKeyId, userId],
      );
      if (result.rows.length === 0) throw new Error('自定义 API 不存在或未启用');
      const row = result.rows[0];
      const apiKey = decryptSecret(row.api_key_encrypted);
      if (!apiKey) throw new Error('自定义 API 密钥不可用，请重新保存密钥');
      return {
        provider: row.supplier_name || row.provider || 'custom',
        apiUrl: row.api_url || '',
        modelName: row.model_name || '',
        apiKey,
        manifestPath: row.manifest_path || '',
        customApiKeyId: input.customApiKeyId,
      };
    } finally {
      client.release();
    }
  }

  if (isUuid(input.systemApiId)) {
    const trustedInternal = isTrustedInternalGenerationRequest(request);
    const userId = trustedUserId || await getAuthenticatedUserId(request);
    if (!userId && !trustedInternal) throw new Error('请先登录后再使用系统 API');
    const client = await getDbClient();
    try {
      await ensureSystemApiSchema(client);
      const result = await client.query(
        `SELECT id, provider, name, api_url, model_name, model_group, manifest_path, api_key_encrypted,
                type, is_default, allowed_membership_tiers
         FROM system_api_configs
         WHERE id = $1 AND is_active = true
         LIMIT 1`,
        [input.systemApiId],
      );
      if (result.rows.length === 0) throw new Error('系统 API 不存在或未启用');
      const row = result.rows[0];
      if (row.is_default === false) throw new Error('该系统 API 未开放为平台默认模型');
      if (userId) {
        const tierResult = await client.query('SELECT membership_tier FROM profiles WHERE id = $1 LIMIT 1', [userId]);
        const tier = normalizeMembershipTier(tierResult.rows[0]?.membership_tier);
        if (!normalizeAllowedMembershipTiers(row.allowed_membership_tiers).includes(tier)) {
          throw new Error('当前会员等级无权使用该系统 API');
        }
      }
      const agnesManifest = await ensureAgnesSystemApiManifest(client, row);
      return {
        provider: row.provider || row.name || 'system',
        apiUrl: agnesManifest?.apiUrl || row.api_url || '',
        modelName: row.model_name || '',
        apiKey: decryptSecret(row.api_key_encrypted) || '',
        manifestPath: agnesManifest?.manifestPath || row.manifest_path || '',
        systemApiId: input.systemApiId,
      };
    } finally {
      client.release();
    }
  }

  if (input.apiKey) return { ...input, manifestPath: '' };
  return undefined;
}

export async function resolveSystemTextApiByModelName(
  request: NextRequest,
  modelName: string,
  trustedUserId?: string | null,
): Promise<ClientApiConfigRef | undefined> {
  const normalizedModelName = modelName.trim().toLowerCase();
  if (!normalizedModelName) return undefined;

  const trustedInternal = isTrustedInternalGenerationRequest(request);
  const userId = trustedUserId || await getAuthenticatedUserId(request);
  if (!userId && !trustedInternal) throw new Error('请先登录后再使用系统 API');

  const client = await getDbClient();
  try {
    await ensureSystemApiSchema(client);
    const result = await client.query(
      `SELECT id, provider, name, api_url, model_name, model_group, manifest_path, api_key_encrypted,
              type, is_default, allowed_membership_tiers, sort_order, created_at
       FROM system_api_configs
       WHERE model_name = $1
         AND type = 'text'
         AND is_default = true
         AND is_active = true
       ORDER BY sort_order ASC, created_at ASC
       LIMIT 10`,
      [normalizedModelName],
    );
    if (result.rows.length === 0) return undefined;

    const tier = userId
      ? normalizeMembershipTier((await client.query('SELECT membership_tier FROM profiles WHERE id = $1 LIMIT 1', [userId])).rows[0]?.membership_tier)
      : 'free';
    const row = result.rows.find(candidate => (
      normalizeAllowedMembershipTiers(candidate.allowed_membership_tiers).includes(tier)
    ));
    if (!row) throw new Error('当前会员等级无权使用该系统 API');

    return {
      provider: row.provider || row.name || 'system',
      apiUrl: row.api_url || '',
      modelName: row.model_name || normalizedModelName,
      apiKey: decryptSecret(row.api_key_encrypted) || '',
      manifestPath: row.manifest_path || '',
      systemApiId: String(row.id || ''),
    };
  } finally {
    client.release();
  }
}

export function encryptApiKeyForStorage(apiKey: string) {
  const normalized = apiKey.trim();
  return {
    encrypted: normalized ? encryptSecret(normalized) : '',
    preview: normalized ? previewSecret(normalized) : '',
  };
}
