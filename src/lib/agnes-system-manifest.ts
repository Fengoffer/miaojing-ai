import type { ModelCapabilityConfig } from '@/lib/model-config-types';
import type { ImportedManifestBundle } from '@/lib/user-api-manifest';
import { readUserApiManifestFile, saveSystemApiManifestFile } from '@/lib/user-api-manifest';
import {
  AGNES_BASE_URL,
  AGNES_IMAGE_MODEL_GROUP,
  AGNES_IMAGE_MODEL_TEMPLATES,
  AGNES_PROVIDER_NAME,
  AGNES_VIDEO_MODEL_GROUP,
  AGNES_VIDEO_MODEL_TEMPLATES,
  buildAgnesImageManifestBundle,
  buildAgnesVideoManifestBundle,
} from '@/lib/agnes-model-templates';

type QueryableClient = {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
};

type AgnesSystemApiRow = {
  id?: unknown;
  provider?: unknown;
  type?: unknown;
  model_name?: unknown;
  model_group?: unknown;
  api_url?: unknown;
  manifest_path?: unknown;
};

type AgnesManifestSource = {
  bundle: ImportedManifestBundle;
  profile: ImportedManifestBundle['profiles'][number];
  apiUrl: string;
  modelGroup: string;
  capabilities: ModelCapabilityConfig;
};

function normalizeProvider(value: unknown): string {
  return String(value || '').replace(/\s+/g, '').toLowerCase();
}

function isAgnesProvider(value: unknown): boolean {
  const normalized = normalizeProvider(value);
  return normalized === normalizeProvider(AGNES_PROVIDER_NAME)
    || normalized.includes('agnes');
}

function isAgnesModelGroup(value: unknown): boolean {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === AGNES_IMAGE_MODEL_GROUP
    || normalized === AGNES_VIDEO_MODEL_GROUP
    || normalized.startsWith('agnes-');
}

function isAgnesSystemApiRow(row: AgnesSystemApiRow): boolean {
  return isAgnesProvider(row.provider) || isAgnesModelGroup(row.model_group);
}

function buildAgnesSystemApiManifestSource(row: AgnesSystemApiRow): AgnesManifestSource | null {
  if (!isAgnesSystemApiRow(row)) return null;
  const modelName = String(row.model_name || '').trim();
  if (!modelName) return null;

  if (row.type === 'image') {
    const template = AGNES_IMAGE_MODEL_TEMPLATES.find(item => item.modelName === modelName);
    if (!template) return null;
    const bundle = buildAgnesImageManifestBundle(template);
    return {
      bundle,
      profile: bundle.profiles[0],
      apiUrl: `${AGNES_BASE_URL}/v1/images/generations`,
      modelGroup: AGNES_IMAGE_MODEL_GROUP,
      capabilities: template.capabilities,
    };
  }

  if (row.type === 'video') {
    const template = AGNES_VIDEO_MODEL_TEMPLATES.find(item => item.modelName === modelName);
    if (!template) return null;
    const bundle = buildAgnesVideoManifestBundle(template);
    return {
      bundle,
      profile: bundle.profiles[0],
      apiUrl: AGNES_BASE_URL,
      modelGroup: AGNES_VIDEO_MODEL_GROUP,
      capabilities: template.capabilities,
    };
  }

  return null;
}

export function getAgnesSystemApiManifestCapabilities(row: AgnesSystemApiRow): ModelCapabilityConfig | undefined {
  return buildAgnesSystemApiManifestSource(row)?.capabilities;
}

function isStoredManifestCurrent(manifestPath: string, source: AgnesManifestSource): boolean {
  const stored = readUserApiManifestFile(manifestPath);
  if (!stored) return false;
  const provider = source.bundle.customProviders[0];
  return (
    stored?.profile?.model === source.profile.model
    && JSON.stringify(stored.provider?.submit || null) === JSON.stringify(provider?.submit || null)
    && JSON.stringify(stored.provider?.poll || null) === JSON.stringify(provider?.poll || null)
    && JSON.stringify(stored.capabilities || null) === JSON.stringify(source.capabilities || null)
  );
}

export async function ensureAgnesSystemApiManifest(
  client: QueryableClient,
  row: AgnesSystemApiRow,
): Promise<{ manifestPath: string; apiUrl: string } | null> {
  const source = buildAgnesSystemApiManifestSource(row);
  const id = String(row.id || '').trim();
  if (!source || !id) return null;

  let manifestPath = String(row.manifest_path || '').trim();
  if (!manifestPath || !isStoredManifestCurrent(manifestPath, source)) {
    manifestPath = await saveSystemApiManifestFile({
      keyId: id,
      bundle: source.bundle,
      profile: source.profile,
    });
  }

  const currentManifestPath = String(row.manifest_path || '').trim();
  const currentApiUrl = String(row.api_url || '').trim().replace(/\/+$/, '');
  const currentModelGroup = String(row.model_group || '').trim();
  const shouldUpdate = (
    currentManifestPath !== manifestPath
    || currentApiUrl !== source.apiUrl.replace(/\/+$/, '')
    || !currentModelGroup
    || currentModelGroup === 'default'
  );

  if (shouldUpdate) {
    await client.query(
      `UPDATE system_api_configs
          SET manifest_path = $1,
              api_url = $2,
              model_group = CASE
                WHEN COALESCE(NULLIF(BTRIM(model_group), ''), 'default') = 'default' THEN $3
                ELSE model_group
              END,
              updated_at = NOW()
        WHERE id = $4
          AND type = $5
          AND (
            replace(lower(provider), ' ', '') = 'agnesai'
            OR provider ILIKE '%agnes%'
            OR COALESCE(model_group, '') LIKE 'agnes-%'
            OR COALESCE(model_group, '') = $3
          )`,
      [manifestPath, source.apiUrl, source.modelGroup, id, row.type],
    );
  }

  return { manifestPath, apiUrl: source.apiUrl };
}
