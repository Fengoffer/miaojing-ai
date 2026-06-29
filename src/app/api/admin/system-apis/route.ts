import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getDbClient } from '@/storage/database/local-db';
import {
  encryptApiKeyForStorage,
  ensureSystemApiSchema,
  isUuid,
  listSystemApis,
  normalizeAllowedMembershipTiers,
  normalizeSystemApiPollingMode,
  normalizeVideoUsageModes,
  toSafeSystemApi,
} from '@/lib/server-api-config';

async function readBody(request: NextRequest) {
  return request.json().catch(() => ({}));
}

function normalizeType(value: unknown): 'image' | 'video' | 'text' {
  return value === 'video' || value === 'text' ? value : 'image';
}

function normalizeBillingMode(value: unknown): 'free' | 'fixed' | 'ratio' | 'token' | 'duration' {
  return value === 'free' || value === 'ratio' || value === 'token' || value === 'duration' ? value : 'fixed';
}

function numberOrDefault(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const includeInactive = request.nextUrl.searchParams.get('includeInactive') !== 'false';
  return NextResponse.json({ apis: await listSystemApis(includeInactive) });
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const body = await readBody(request);
  if (!body.name?.trim() || !body.modelName?.trim()) {
    return NextResponse.json({ error: '请填写显示名称和模型名称' }, { status: 400 });
  }

  const secret = encryptApiKeyForStorage(String(body.apiKey || ''));
  const billingMode = normalizeBillingMode(body.billingMode);
  const client = await getDbClient();
  try {
    await ensureSystemApiSchema(client);
    const result = await client.query(
      `INSERT INTO system_api_configs (
         provider, name, api_url, model_name, model_group, note, api_key_encrypted,
         api_key_preview, type, credits_per_use, billing_mode, fixed_price,
         duration_price_per_second, input_price_per_1k, output_price_per_1k, model_ratio, completion_ratio,
         group_ratio, price_note, manifest_path, is_default, allowed_membership_tiers,
         polling_mode, polling_order,
         video_usage_modes, is_active, sort_order
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
               $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
               $21, $22::jsonb, $23, $24, $25::jsonb, $26, COALESCE((SELECT MAX(sort_order) + 1 FROM system_api_configs), 0))
       RETURNING id, provider, name, api_url, model_name, model_group, note, api_key_preview,
                 type, credits_per_use, billing_mode, fixed_price, duration_price_per_second, input_price_per_1k,
                 output_price_per_1k, model_ratio, completion_ratio, group_ratio,
                 price_note, manifest_path, is_default, allowed_membership_tiers,
                 polling_mode, polling_order, video_usage_modes, is_active, sort_order, created_at, updated_at`,
      [
        String(body.provider || '').trim(),
        String(body.name).trim(),
        String(body.apiUrl || '').trim(),
        String(body.modelName).trim(),
        String(body.modelGroup || 'default').trim() || 'default',
        String(body.note || '').trim(),
        secret.encrypted,
        secret.preview,
        normalizeType(body.type),
        billingMode === 'free' ? 0 : numberOrDefault(body.creditsPerUse, 10),
        billingMode,
        billingMode === 'free' ? 0 : numberOrDefault(body.fixedPrice, 0),
        billingMode === 'free' ? 0 : numberOrDefault(body.durationPricePerSecond, 0),
        billingMode === 'free' ? 0 : numberOrDefault(body.inputPricePer1K, 0),
        billingMode === 'free' ? 0 : numberOrDefault(body.outputPricePer1K, 0),
        numberOrDefault(body.modelRatio, 1),
        numberOrDefault(body.completionRatio, 1),
        numberOrDefault(body.groupRatio, 1),
        String(body.priceNote || '').trim(),
        '',
        body.isDefault !== false,
        JSON.stringify(normalizeAllowedMembershipTiers(body.allowedMembershipTiers)),
        normalizeSystemApiPollingMode(body.pollingMode),
        numberOrDefault(body.pollingOrder, 0),
        JSON.stringify(normalizeVideoUsageModes(body.videoUsageModes)),
        body.isActive !== false,
      ],
    );
    return NextResponse.json({ api: toSafeSystemApi(result.rows[0]) });
  } finally {
    client.release();
  }
}

export async function PUT(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const body = await readBody(request);
  if (!isUuid(body.id) || !body.name?.trim() || !body.modelName?.trim()) {
    return NextResponse.json({ error: '缺少 API ID、显示名称或模型名称' }, { status: 400 });
  }

  const updates: string[] = [];
  const params: unknown[] = [];
  let idx = 1;
  const billingMode = normalizeBillingMode(body.billingMode);
  const add = (column: string, value: unknown) => {
    updates.push(`${column} = $${idx++}`);
    params.push(value);
  };

  add('provider', String(body.provider || '').trim());
  add('name', String(body.name).trim());
  add('api_url', String(body.apiUrl || '').trim());
  add('model_name', String(body.modelName).trim());
  add('model_group', String(body.modelGroup || 'default').trim() || 'default');
  add('note', String(body.note || '').trim());
  add('type', normalizeType(body.type));
  add('credits_per_use', billingMode === 'free' ? 0 : numberOrDefault(body.creditsPerUse, 10));
  add('billing_mode', billingMode);
  add('fixed_price', billingMode === 'free' ? 0 : numberOrDefault(body.fixedPrice, 0));
  add('duration_price_per_second', billingMode === 'free' ? 0 : numberOrDefault(body.durationPricePerSecond, 0));
  add('input_price_per_1k', billingMode === 'free' ? 0 : numberOrDefault(body.inputPricePer1K, 0));
  add('output_price_per_1k', billingMode === 'free' ? 0 : numberOrDefault(body.outputPricePer1K, 0));
  add('model_ratio', numberOrDefault(body.modelRatio, 1));
  add('completion_ratio', numberOrDefault(body.completionRatio, 1));
  add('group_ratio', numberOrDefault(body.groupRatio, 1));
  add('price_note', String(body.priceNote || '').trim());
  add('is_default', body.isDefault !== false);
  updates.push(`allowed_membership_tiers = $${idx++}::jsonb`);
  params.push(JSON.stringify(normalizeAllowedMembershipTiers(body.allowedMembershipTiers)));
  add('polling_mode', normalizeSystemApiPollingMode(body.pollingMode));
  add('polling_order', numberOrDefault(body.pollingOrder, 0));
  updates.push(`video_usage_modes = $${idx++}::jsonb`);
  params.push(JSON.stringify(normalizeVideoUsageModes(body.videoUsageModes)));
  add('is_active', body.isActive !== false);
  if (body.sortOrder !== undefined) add('sort_order', Number(body.sortOrder || 0));

  if (typeof body.apiKey === 'string' && body.apiKey.trim() && body.apiKey !== '********') {
    const secret = encryptApiKeyForStorage(body.apiKey);
    add('api_key_encrypted', secret.encrypted);
    add('api_key_preview', secret.preview);
  }
  if (body.clearApiKey === true) {
    add('api_key_encrypted', '');
    add('api_key_preview', '');
  }
  updates.push('updated_at = NOW()');
  params.push(body.id);

  const client = await getDbClient();
  try {
    await ensureSystemApiSchema(client);
    const result = await client.query(
      `UPDATE system_api_configs
       SET ${updates.join(', ')}
       WHERE id = $${idx}
       RETURNING id, provider, name, api_url, model_name, model_group, note, api_key_preview,
                 type, credits_per_use, billing_mode, fixed_price, duration_price_per_second, input_price_per_1k,
                 output_price_per_1k, model_ratio, completion_ratio, group_ratio,
                 price_note, manifest_path, is_default, allowed_membership_tiers,
                 polling_mode, polling_order, video_usage_modes, is_active, sort_order, created_at, updated_at`,
      params,
    );
    if (result.rows.length === 0) {
      return NextResponse.json({ error: '系统 API 不存在' }, { status: 404 });
    }
    await client.query(
      `UPDATE system_api_configs
       SET polling_mode = $1
       WHERE type = $2 AND model_name = $3`,
      [result.rows[0].polling_mode, result.rows[0].type, result.rows[0].model_name],
    );
    return NextResponse.json({ api: toSafeSystemApi(result.rows[0]) });
  } finally {
    client.release();
  }
}

export async function DELETE(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const body = await readBody(request);
  const id = body.id || request.nextUrl.searchParams.get('id');
  if (!isUuid(id)) return NextResponse.json({ error: '缺少 API ID' }, { status: 400 });

  const client = await getDbClient();
  try {
    await ensureSystemApiSchema(client);
    await client.query('DELETE FROM system_api_configs WHERE id = $1', [id]);
    return NextResponse.json({ success: true });
  } finally {
    client.release();
  }
}
