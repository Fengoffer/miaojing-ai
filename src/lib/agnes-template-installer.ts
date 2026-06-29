import {
  encryptApiKeyForStorage,
  ensureSystemApiSchema,
  normalizeAllowedMembershipTiers,
  normalizeVideoUsageModes,
  toSafeSystemApi,
} from '@/lib/server-api-config';
import { resolveImportedProfileApiUrl, saveSystemApiManifestFile } from '@/lib/user-api-manifest';
import {
  AGNES_BASE_URL,
  AGNES_IMAGE_MODEL_GROUP,
  AGNES_IMAGE_MODEL_TEMPLATES,
  AGNES_PROVIDER_NAME,
  AGNES_TEXT_MODEL_GROUP,
  AGNES_TEXT_MODEL_TEMPLATES,
  AGNES_VIDEO_MODEL_GROUP,
  AGNES_VIDEO_MODEL_TEMPLATES,
  buildAgnesImageManifestBundle,
  buildAgnesVideoManifestBundle,
  type AgnesImageModelTemplate,
  type AgnesVideoModelTemplate,
} from '@/lib/agnes-model-templates';
import { getDbClient } from '@/storage/database/local-db';
import type { ImportedManifestBundle } from '@/lib/user-api-manifest';

type DbClient = Awaited<ReturnType<typeof getDbClient>>;

type AgnesInstallInput = {
  syncImageModels?: boolean;
  syncVideoModels?: boolean;
  syncTextModels?: boolean;
  allowedMembershipTiers?: unknown;
  isDefault?: unknown;
  saveManifestFile?: (input: {
    keyId: string;
    bundle: ImportedManifestBundle;
    profile: ImportedManifestBundle['profiles'][number];
  }) => Promise<string>;
};

const AGNES_CHAT_COMPLETIONS_URL = `${AGNES_BASE_URL}/v1/chat/completions`;

function agnesImagePriceNote(template: AgnesImageModelTemplate): string {
  return `Agnes 免费模型；文档价格 $0 / image。参数来自 ${template.sourceDoc}`;
}

function agnesVideoPriceNote(template: AgnesVideoModelTemplate): string {
  return `Agnes 免费模型；文档价格 $0 / second。参数来自 ${template.sourceDoc}`;
}

async function insertAgnesSystemApi(
  client: DbClient,
  input: {
    provider: string;
    name: string;
    apiUrl: string;
    modelName: string;
    modelGroup: string;
    note: string;
    type: 'image' | 'video' | 'text';
    billingMode: 'free' | 'fixed' | 'duration';
    priceNote: string;
    isDefault: boolean;
    allowedMembershipTiersJson: string;
    pollingOrder: number;
    videoUsageModesJson: string;
    sortOffset: number;
  },
) {
  const secret = encryptApiKeyForStorage('');
  const result = await client.query(
    `INSERT INTO system_api_configs (
       provider, name, api_url, model_name, model_group, note,
       api_key_encrypted, api_key_preview, type, credits_per_use,
       billing_mode, fixed_price, duration_price_per_second, input_price_per_1k, output_price_per_1k,
       model_ratio, completion_ratio, group_ratio, price_note,
       manifest_path, is_default, allowed_membership_tiers,
       polling_mode, polling_order, video_usage_modes, is_active, sort_order, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6,
             $7, $8, $9, $10,
             $11, $12, $13, $14, $15,
             $16, $17, $18, $19,
             '', $20, $21::jsonb,
             $22, $23, $24::jsonb, $25, COALESCE((SELECT MAX(sort_order) + 1 FROM system_api_configs), 0) + $26, NOW(), NOW())
     RETURNING id, provider, name, api_url, model_name, model_group, note, api_key_preview,
               type, credits_per_use, billing_mode, fixed_price, duration_price_per_second, input_price_per_1k,
               output_price_per_1k, model_ratio, completion_ratio, group_ratio,
               price_note, manifest_path, is_default, allowed_membership_tiers,
               polling_mode, polling_order, video_usage_modes, is_active, sort_order, created_at, updated_at`,
    [
      input.provider,
      input.name,
      input.apiUrl,
      input.modelName,
      input.modelGroup,
      input.note,
      secret.encrypted,
      secret.preview,
      input.type,
      0,
      input.billingMode,
      0,
      0,
      0,
      0,
      1,
      1,
      1,
      input.priceNote,
      input.isDefault,
      input.allowedMembershipTiersJson,
      'sequential',
      input.pollingOrder,
      input.videoUsageModesJson,
      false,
      input.sortOffset,
    ],
  );
  return result.rows[0];
}

async function attachManifest(
  client: DbClient,
  row: Record<string, unknown>,
  bundle: ImportedManifestBundle,
  saveManifestFile: NonNullable<AgnesInstallInput['saveManifestFile']>,
) {
  const profile = bundle.profiles[0];
  const manifestPath = await saveManifestFile({
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
                type, credits_per_use, billing_mode, fixed_price, duration_price_per_second, input_price_per_1k,
                output_price_per_1k, model_ratio, completion_ratio, group_ratio,
                price_note, manifest_path, is_default, allowed_membership_tiers,
                polling_mode, polling_order, video_usage_modes, is_active, sort_order, created_at, updated_at`,
    [manifestPath, row.id],
  );
  return updated.rows[0];
}

export async function installAgnesTemplatesWithClient(client: DbClient, input: AgnesInstallInput = {}) {
  const allowedMembershipTiers = normalizeAllowedMembershipTiers(input.allowedMembershipTiers);
  const allowedMembershipTiersJson = JSON.stringify(allowedMembershipTiers);
  const isDefault = input.isDefault !== false;
  const saveManifestFile = input.saveManifestFile || saveSystemApiManifestFile;
  const saved = [];

  if (input.syncImageModels) {
    await client.query('DELETE FROM system_api_configs WHERE provider = $1 AND type = $2', [AGNES_PROVIDER_NAME, 'image']);
    for (const [index, template] of AGNES_IMAGE_MODEL_TEMPLATES.entries()) {
      const bundle = buildAgnesImageManifestBundle(template);
      const profile = bundle.profiles[0];
      const apiUrl = resolveImportedProfileApiUrl(bundle, profile) || `${AGNES_BASE_URL}/v1/images/generations`;
      const row = await insertAgnesSystemApi(client, {
        provider: AGNES_PROVIDER_NAME,
        name: template.displayName,
        apiUrl,
        modelName: template.modelName,
        modelGroup: AGNES_IMAGE_MODEL_GROUP,
        note: `${template.displayName}（Agnes AI 内置免费图片模型）`,
        type: 'image',
        billingMode: 'free',
        priceNote: agnesImagePriceNote(template),
        isDefault,
        allowedMembershipTiersJson,
        pollingOrder: index,
        videoUsageModesJson: JSON.stringify(normalizeVideoUsageModes(undefined)),
        sortOffset: index,
      });
      saved.push(toSafeSystemApi(await attachManifest(client, row, bundle, saveManifestFile)));
    }
  }

  if (input.syncVideoModels) {
    await client.query('DELETE FROM system_api_configs WHERE provider = $1 AND type = $2', [AGNES_PROVIDER_NAME, 'video']);
    for (const [index, template] of AGNES_VIDEO_MODEL_TEMPLATES.entries()) {
      const bundle = buildAgnesVideoManifestBundle(template);
      const profile = bundle.profiles[0];
      const apiUrl = resolveImportedProfileApiUrl(bundle, profile) || AGNES_BASE_URL;
      const row = await insertAgnesSystemApi(client, {
        provider: AGNES_PROVIDER_NAME,
        name: template.displayName,
        apiUrl,
        modelName: template.modelName,
        modelGroup: AGNES_VIDEO_MODEL_GROUP,
        note: `${template.displayName}（Agnes AI 内置免费视频模型）`,
        type: 'video',
        billingMode: 'free',
        priceNote: agnesVideoPriceNote(template),
        isDefault,
        allowedMembershipTiersJson,
        pollingOrder: index,
        videoUsageModesJson: JSON.stringify(normalizeVideoUsageModes(template.usageModes)),
        sortOffset: AGNES_IMAGE_MODEL_TEMPLATES.length + index,
      });
      saved.push(toSafeSystemApi(await attachManifest(client, row, bundle, saveManifestFile)));
    }
  }

  if (input.syncTextModels) {
    await client.query('DELETE FROM system_api_configs WHERE provider = $1 AND type = $2', [AGNES_PROVIDER_NAME, 'text']);
    for (const [index, template] of AGNES_TEXT_MODEL_TEMPLATES.entries()) {
      const row = await insertAgnesSystemApi(client, {
        provider: AGNES_PROVIDER_NAME,
        name: template.displayName,
        apiUrl: AGNES_CHAT_COMPLETIONS_URL,
        modelName: template.modelName,
        modelGroup: AGNES_TEXT_MODEL_GROUP,
        note: template.note,
        type: 'text',
        billingMode: 'free',
        priceNote: `Agnes 免费模型；文档价格 $0。参数来自 ${template.sourceDoc}`,
        isDefault,
        allowedMembershipTiersJson,
        pollingOrder: index,
        videoUsageModesJson: JSON.stringify(normalizeVideoUsageModes(undefined)),
        sortOffset: AGNES_IMAGE_MODEL_TEMPLATES.length + AGNES_VIDEO_MODEL_TEMPLATES.length + index,
      });
      saved.push(toSafeSystemApi(row));
    }
  }

  return saved;
}

export async function installAgnesTemplates(input: AgnesInstallInput = {}) {
  const client = await getDbClient();
  try {
    await client.query('BEGIN');
    await ensureSystemApiSchema(client);
    const saved = await installAgnesTemplatesWithClient(client, input);
    await client.query('COMMIT');
    return saved;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
