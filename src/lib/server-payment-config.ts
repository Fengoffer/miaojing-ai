import type { PoolClient } from 'pg';
import { decryptSecret, encryptSecret, previewSecret } from '@/lib/server-crypto';

export type PaymentMethodType = 'alipay' | 'wechat' | 'stripe' | 'manual';

export interface ServerPaymentMethod {
  id: string;
  type: PaymentMethodType;
  name: string;
  isActive: boolean;
  config: Record<string, string>;
}

const SECRET_CONFIG_KEYS = new Set([
  'apiKey',
  'secretKey',
  'privateKey',
  'alipayPublicKey',
]);

const DEFAULT_PAYMENT_METHODS: ServerPaymentMethod[] = [
  { id: 'pm-alipay', type: 'alipay', name: '支付宝', isActive: true, config: {} },
  { id: 'pm-wechat', type: 'wechat', name: '微信支付', isActive: false, config: {} },
  { id: 'pm-manual', type: 'manual', name: '手动转账', isActive: false, config: {} },
  { id: 'pm-stripe', type: 'stripe', name: 'Stripe', isActive: false, config: {} },
];

export async function ensurePaymentMethodsSchema(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS payment_methods (
      id VARCHAR(64) PRIMARY KEY,
      type VARCHAR(32) NOT NULL,
      name VARCHAR(128) NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT FALSE,
      public_config JSONB NOT NULL DEFAULT '{}'::jsonb,
      secret_config_encrypted JSONB NOT NULL DEFAULT '{}'::jsonb,
      secret_config_preview JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ
    )
  `);

  for (const method of DEFAULT_PAYMENT_METHODS) {
    await client.query(
      `INSERT INTO payment_methods (id, type, name, is_active)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [method.id, method.type, method.name, method.isActive],
    );
  }
}

function normalizeType(value: unknown): PaymentMethodType {
  return value === 'wechat' || value === 'stripe' || value === 'manual' ? value : 'alipay';
}

function asStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => typeof entry === 'string')
      .map(([key, entry]) => [key, String(entry)]),
  );
}

function maskConfig(publicConfig: Record<string, string>, secretPreview: Record<string, string>) {
  const safe: Record<string, string> = { ...publicConfig };
  for (const [key, value] of Object.entries(secretPreview)) {
    safe[key] = value || '****';
  }
  return safe;
}

export function toSafePaymentMethod(row: Record<string, unknown>): ServerPaymentMethod {
  return {
    id: String(row.id || ''),
    type: normalizeType(row.type),
    name: String(row.name || ''),
    isActive: row.is_active !== false,
    config: maskConfig(asStringRecord(row.public_config), asStringRecord(row.secret_config_preview)),
  };
}

export async function listPaymentMethods(client: PoolClient): Promise<ServerPaymentMethod[]> {
  await ensurePaymentMethodsSchema(client);
  const result = await client.query(
    `SELECT id, type, name, is_active, public_config, secret_config_preview
     FROM payment_methods
     ORDER BY CASE id
       WHEN 'pm-alipay' THEN 1
       WHEN 'pm-wechat' THEN 2
       WHEN 'pm-manual' THEN 3
       WHEN 'pm-stripe' THEN 4
       ELSE 10
     END, created_at ASC`,
  );
  return result.rows.map(toSafePaymentMethod);
}

function splitConfig(config: Record<string, string>, existingSecrets: Record<string, string>) {
  const publicConfig: Record<string, string> = {};
  const secretConfigEncrypted: Record<string, string> = { ...existingSecrets };
  const secretConfigPreview: Record<string, string> = {};

  for (const [key, rawValue] of Object.entries(config)) {
    const value = String(rawValue || '').trim();
    if (SECRET_CONFIG_KEYS.has(key)) {
      if (value && value !== '********' && !value.startsWith('***')) {
        secretConfigEncrypted[key] = encryptSecret(value);
      }
      const secret = decryptSecret(secretConfigEncrypted[key]);
      if (secret) secretConfigPreview[key] = previewSecret(secret);
      continue;
    }
    publicConfig[key] = value;
  }

  for (const [key, encrypted] of Object.entries(secretConfigEncrypted)) {
    if (!secretConfigPreview[key]) {
      const secret = decryptSecret(encrypted);
      if (secret) secretConfigPreview[key] = previewSecret(secret);
    }
  }

  return { publicConfig, secretConfigEncrypted, secretConfigPreview };
}

export async function savePaymentMethod(
  client: PoolClient,
  id: string,
  updates: Partial<Pick<ServerPaymentMethod, 'name' | 'isActive' | 'config'>>,
): Promise<ServerPaymentMethod[]> {
  await ensurePaymentMethodsSchema(client);
  const currentResult = await client.query(
    'SELECT id, type, name, is_active, secret_config_encrypted FROM payment_methods WHERE id = $1',
    [id],
  );
  if (currentResult.rows.length === 0) throw new Error('支付方式不存在');

  const fields: string[] = [];
  const params: unknown[] = [];
  let idx = 1;
  const add = (column: string, value: unknown, cast = '') => {
    fields.push(`${column} = $${idx++}${cast}`);
    params.push(value);
  };

  if (typeof updates.name === 'string') add('name', updates.name.trim());
  if (typeof updates.isActive === 'boolean') add('is_active', updates.isActive);
  if (updates.config && typeof updates.config === 'object') {
    const split = splitConfig(asStringRecord(updates.config), asStringRecord(currentResult.rows[0].secret_config_encrypted));
    add('public_config', JSON.stringify(split.publicConfig), '::jsonb');
    add('secret_config_encrypted', JSON.stringify(split.secretConfigEncrypted), '::jsonb');
    add('secret_config_preview', JSON.stringify(split.secretConfigPreview), '::jsonb');
  }

  if (fields.length > 0) {
    fields.push('updated_at = NOW()');
    params.push(id);
    await client.query(`UPDATE payment_methods SET ${fields.join(', ')} WHERE id = $${idx}`, params);
  }

  return listPaymentMethods(client);
}
