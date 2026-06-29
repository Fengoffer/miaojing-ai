import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/session-auth';
import { getDbClient } from '@/storage/database/local-db';
import { parseImportedManifestBundle, readManifestCapabilities, resolveImportedProfileApiUrl, saveUserApiManifestFile } from '@/lib/user-api-manifest';
import { isGenericApiKeyNote } from '@/lib/model-display';

function normalizeType(value: unknown): 'image' | 'video' | 'text' {
  return value === 'videos' || value === 'video'
    ? 'video'
    : value === 'text'
      ? 'text'
      : 'image';
}

function mapKey(row: Record<string, unknown>) {
  return {
    id: row.id,
    provider: row.provider || '',
    supplierName: row.supplier_name || row.provider || '',
    apiUrl: row.api_url || '',
    modelName: row.model_name || '',
    note: row.note || '',
    manifestPath: row.manifest_path || '',
    capabilities: readManifestCapabilities(row.manifest_path as string | null | undefined),
    apiKey: '',
    apiKeyPreview: row.api_key_preview || '待填写',
    type: normalizeType(row.type),
    isActive: row.is_active !== false,
    createdAt: row.created_at,
  };
}

export async function POST(request: NextRequest) {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) return NextResponse.json({ error: '请先登录' }, { status: 401 });

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

  const client = await getDbClient();
  try {
    await client.query('BEGIN');
    await client.query(`
      ALTER TABLE user_api_keys ADD COLUMN IF NOT EXISTS supplier_name VARCHAR(128);
      ALTER TABLE user_api_keys ADD COLUMN IF NOT EXISTS type VARCHAR(16) NOT NULL DEFAULT 'image';
      ALTER TABLE user_api_keys ADD COLUMN IF NOT EXISTS note TEXT;
      ALTER TABLE user_api_keys ADD COLUMN IF NOT EXISTS manifest_path TEXT;
    `);

    const saved = [];
    for (const profile of bundle.profiles) {
      const provider = bundle.customProviders.find(item => item.id === profile.provider)
        || bundle.customProviders.find(item => item.name === profile.provider)
        || bundle.customProviders[0];
      const profileName = profile.name || provider?.name || '自定义服务商';
      const providerName = provider?.name || profileName;
      const apiUrl = resolveImportedProfileApiUrl(bundle, profile);
      const modelName = String(profile.model || '').trim();
      const note = profileName && !isGenericApiKeyNote(profileName) && profileName !== modelName
        ? profileName
        : '';
      const result = await client.query(
        `INSERT INTO user_api_keys (
           user_id, provider, supplier_name, api_url, model_name, note,
           manifest_path, api_key_encrypted, api_key_preview, type, is_active,
           created_at, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, '', '', '待填写', $7, true, NOW(), NOW())
         RETURNING *`,
        [
          userId,
          providerName,
          providerName,
          apiUrl,
          modelName,
          note,
          normalizeType(profile.apiMode),
        ],
      );
      const row = result.rows[0];
      const manifestPath = await saveUserApiManifestFile({
        userId,
        keyId: String(row.id),
        bundle,
        profile,
      });
      const updated = await client.query(
        `UPDATE user_api_keys
            SET manifest_path = $1,
                updated_at = NOW()
          WHERE id = $2 AND user_id = $3
          RETURNING *`,
        [manifestPath, row.id, userId],
      );
      saved.push(mapKey(updated.rows[0]));
    }

    await client.query('COMMIT');
    return NextResponse.json({
      success: true,
      keys: saved,
      message: `已导入 ${saved.length} 个 API 配置，请编辑后填写 API Key`,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    return NextResponse.json({ error: error instanceof Error ? error.message : '导入配置失败' }, { status: 500 });
  } finally {
    client.release();
  }
}
