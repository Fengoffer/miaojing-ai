import type { PoolClient } from 'pg';
import { getDbClient } from '@/storage/database/local-db';
import {
  IMAGE_STYLE_PRESET_LABELS,
  buildImage2StylePrompt,
  type ImageStylePreset,
} from '@/lib/model-config';

export type StoredImageStylePreset = ImageStylePreset & {
  id: string;
  usageCount: number;
  sortOrder: number;
};

export async function ensureStylePresetSchema(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS image_style_presets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      label VARCHAR(128) NOT NULL UNIQUE,
      prompt TEXT NOT NULL,
      usage_count INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT true,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ
    )
  `);
  await client.query('CREATE INDEX IF NOT EXISTS image_style_presets_active_usage_idx ON image_style_presets (is_active, usage_count DESC, sort_order ASC)');

  for (const [index, label] of IMAGE_STYLE_PRESET_LABELS.entries()) {
    await client.query(
      `INSERT INTO image_style_presets (label, prompt, sort_order)
       VALUES ($1, $2, $3)
       ON CONFLICT (label) DO UPDATE
       SET prompt = COALESCE(NULLIF(image_style_presets.prompt, ''), EXCLUDED.prompt),
           sort_order = image_style_presets.sort_order`,
      [label, buildImage2StylePrompt(label), (index + 1) * 10],
    );
  }
}

function mapStylePreset(row: Record<string, unknown>): StoredImageStylePreset {
  return {
    id: String(row.id),
    label: String(row.label || ''),
    prompt: String(row.prompt || ''),
    usageCount: Number(row.usage_count || 0),
    sortOrder: Number(row.sort_order || 0),
  };
}

export async function listImageStylePresets(): Promise<StoredImageStylePreset[]> {
  const client = await getDbClient();
  try {
    await ensureStylePresetSchema(client);
    const result = await client.query(
      `SELECT id, label, prompt, usage_count, sort_order
       FROM image_style_presets
       WHERE is_active = true
       ORDER BY usage_count DESC, sort_order ASC, label ASC`,
    );
    return result.rows.map(mapStylePreset);
  } finally {
    client.release();
  }
}

export async function incrementImageStylePresetUsage(
  client: PoolClient,
  label: string | undefined,
): Promise<void> {
  const normalized = label?.trim();
  if (!normalized) return;
  await ensureStylePresetSchema(client);
  await client.query(
    `INSERT INTO image_style_presets (label, prompt, usage_count, sort_order)
     VALUES ($1, $2, 1, 99990)
     ON CONFLICT (label) DO UPDATE
     SET usage_count = image_style_presets.usage_count + 1,
         updated_at = now()`,
    [normalized, buildImage2StylePrompt(normalized)],
  );
}
