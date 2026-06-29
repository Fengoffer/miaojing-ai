import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { encryptApiKeyForStorage, ensureSystemApiSchema, normalizeAllowedMembershipTiers, toSafeSystemApi } from '@/lib/server-api-config';
import { parseImportedManifestBundle, resolveImportedProfileApiUrl, saveSystemApiManifestFile } from '@/lib/user-api-manifest';
import { getDbClient } from '@/storage/database/local-db';

function normalizeType(value: unknown): 'image' | 'video' | 'text' {
  return value === 'videos' || value === 'video'
    ? 'video'
    : value === 'text'
      ? 'text'
      : 'image';
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const body = await request.json().catch(() => ({}));
  const rawText = typeof body.configText === 'string' ? body.configText : '';
  let bundle;
  try {
    bundle = parseImportedManifestBundle(rawText);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '配置 JSON 解析失败' }, { status: 400 });
  }
  for (const profile of bundle.profiles) {
    const apiUrl = resolveImportedProfileApiUrl(bundle, profile);
    if (!apiUrl) {
      return NextResponse.json({
        error: `${profile.name || profile.model || '当前配置'} 缺少中转 API 请求地址，请先在文档中找到 API Base URL 或完整请求端点后再导入`,
      }, { status: 400 });
    }
  }

  const secret = encryptApiKeyForStorage('');
  const client = await getDbClient();
  try {
    await client.query('BEGIN');
    await ensureSystemApiSchema(client);

    const saved = [];
    const allowedMembershipTiers = normalizeAllowedMembershipTiers(body.allowedMembershipTiers);
    for (const profile of bundle.profiles) {
      const provider = bundle.customProviders.find(item => item.id === profile.provider)
        || bundle.customProviders.find(item => item.name === profile.provider)
        || bundle.customProviders[0];
      const providerName = provider?.name || profile.provider || '智能配置服务商';
      const profileName = profile.name || providerName;
      const apiUrl = resolveImportedProfileApiUrl(bundle, profile);
      const result = await client.query(
        `INSERT INTO system_api_configs (
           provider, name, api_url, model_name, model_group, note,
           api_key_encrypted, api_key_preview, type, credits_per_use,
           billing_mode, fixed_price, input_price_per_1k, output_price_per_1k,
           model_ratio, completion_ratio, group_ratio, price_note,
           manifest_path, is_default, allowed_membership_tiers,
           is_active, sort_order, created_at, updated_at
         )
         VALUES ($1, $2, $3, $4, 'default', $5,
                 $6, '待填写', $7, $8,
                 'fixed', $9, 0, 0,
                 1, 1, 1, $10,
                 '', $11, $12::jsonb, true,
                 COALESCE((SELECT MAX(sort_order) + 1 FROM system_api_configs), 0), NOW(), NOW())
         RETURNING id, provider, name, api_url, model_name, model_group, note, api_key_preview,
                   type, credits_per_use, billing_mode, fixed_price, input_price_per_1k,
                   output_price_per_1k, model_ratio, completion_ratio, group_ratio,
                   price_note, manifest_path, is_default, allowed_membership_tiers,
                   is_active, sort_order, created_at, updated_at`,
        [
          providerName,
          profileName,
          apiUrl,
          profile.model || 'gpt-image-2',
          profileName,
          secret.encrypted,
          normalizeType(profile.apiMode),
          Number(body.creditsPerUse) || 10,
          Number(body.fixedPrice) || 10,
          '智能配置 API 导入，API Key 需编辑后填写',
          body.isDefault !== false,
          JSON.stringify(allowedMembershipTiers),
        ],
      );
      const row = result.rows[0];
      const manifestPath = await saveSystemApiManifestFile({
        keyId: String(row.id),
        bundle,
        profile,
      });
      const updated = await client.query(
        `UPDATE system_api_configs
            SET manifest_path = $1,
                updated_at = NOW()
          WHERE id = $2
          RETURNING id, provider, name, api_url, model_name, model_group, note, api_key_preview,
                    type, credits_per_use, billing_mode, fixed_price, input_price_per_1k,
                    output_price_per_1k, model_ratio, completion_ratio, group_ratio,
                    price_note, manifest_path, is_default, allowed_membership_tiers,
                    is_active, sort_order, created_at, updated_at`,
        [manifestPath, row.id],
      );
      saved.push(toSafeSystemApi(updated.rows[0]));
    }

    await client.query('COMMIT');
    return NextResponse.json({
      success: true,
      apis: saved,
      message: `已导入 ${saved.length} 个系统 API 配置，请编辑后填写 API Key 和定价`,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    return NextResponse.json({ error: error instanceof Error ? error.message : '导入配置失败' }, { status: 500 });
  } finally {
    client.release();
  }
}
