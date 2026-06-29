import { createHash } from 'crypto';
import { getDbClient } from '@/storage/database/local-db';

export const TOTAL_LAYOUT_COMPOSITION_COUNT = 100;
const SOURCE_REPOSITORY = 'https://github.com/nevertoday/100-layout-compositions';
const SOURCE_LICENSE = 'CC BY 4.0';

export type LayoutCompositionSkillInput = {
  prompt: string;
  aspectRatio?: string;
  resolution?: string;
  hasReferenceImage?: boolean;
};

export type LayoutCompositionSkillResult = {
  enabled: boolean;
  prompt: string;
  layoutId?: string;
  attribution?: string;
};

let cachedEnabled: { value: boolean; expiresAt: number } | null = null;

export function clearLayoutCompositionSkillCache() {
  cachedEnabled = null;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stableLayoutNumber(input: LayoutCompositionSkillInput): number {
  const hash = createHash('sha256')
    .update([
      normalizeText(input.prompt).slice(0, 500),
      normalizeText(input.aspectRatio),
      normalizeText(input.resolution),
      input.hasReferenceImage ? 'reference' : 'text',
    ].join('|'))
    .digest();
  return (hash[0] % TOTAL_LAYOUT_COMPOSITION_COUNT) + 1;
}

export function getLayoutCompositionReference(layoutNumber: number) {
  layoutNumber = Math.min(TOTAL_LAYOUT_COMPOSITION_COUNT, Math.max(1, Math.floor(layoutNumber)));
  const id = `layout-${layoutNumber.toString().padStart(3, '0')}`;
  return {
    id,
    sourceImage: `${SOURCE_REPOSITORY}/blob/main/images/${id}.png`,
    thumbnail: `${SOURCE_REPOSITORY}/blob/main/thumbnails/${id}.jpg`,
  };
}

export function buildLayoutCompositionInstruction(input: LayoutCompositionSkillInput): {
  layoutId: string;
  instruction: string;
  attribution: string;
} {
  const reference = getLayoutCompositionReference(stableLayoutNumber(input));
  const ratio = normalizeText(input.aspectRatio) || '当前画面比例';
  const resolution = normalizeText(input.resolution) || '当前分辨率';
  return {
    layoutId: reference.id,
    attribution: `Composition reference inspired by nevertoday/100-layout-compositions ${reference.id}, ${SOURCE_LICENSE}: ${SOURCE_REPOSITORY}`,
    instruction: [
      `构图优化 Skill：参考 ${reference.id} 的版式构成规律组织画面。`,
      `保持用户原始主体、内容和风格不变，只借鉴画面重心、留白比例、前中后景层次、视觉动线、主体位置、裁切边界和节奏关系。`,
      `适配 ${ratio} 与 ${resolution}，让主体更清晰、层次更稳定、边缘不过度拥挤。`,
      '不要添加文字、Logo、品牌标识或海报排版，不要复制参考图里的具体图形元素。',
    ].join('\n'),
  };
}

export async function isLayoutCompositionSkillEnabled(): Promise<boolean> {
  if (process.env.IMAGE_COMPOSITION_SKILL_ENABLED === 'true') return true;
  if (process.env.IMAGE_COMPOSITION_SKILL_ENABLED === 'false') return false;
  if (cachedEnabled && cachedEnabled.expiresAt > Date.now()) return cachedEnabled.value;

  const client = await getDbClient();
  try {
    await client.query('ALTER TABLE site_config ADD COLUMN IF NOT EXISTS image_composition_skill_enabled BOOLEAN NOT NULL DEFAULT FALSE');
    const result = await client.query('SELECT image_composition_skill_enabled FROM site_config WHERE id = 1');
    const value = result.rows[0]?.image_composition_skill_enabled === true;
    cachedEnabled = { value, expiresAt: Date.now() + 30_000 };
    return value;
  } catch {
    return false;
  } finally {
    client.release();
  }
}

export async function applyLayoutCompositionSkillToPrompt(input: LayoutCompositionSkillInput): Promise<LayoutCompositionSkillResult> {
  const enabled = await isLayoutCompositionSkillEnabled();
  if (!enabled) return { enabled: false, prompt: input.prompt };
  const { layoutId, instruction, attribution } = buildLayoutCompositionInstruction(input);
  return {
    enabled: true,
    layoutId,
    attribution,
    prompt: `${input.prompt.trim()}\n\n${instruction}`,
  };
}
