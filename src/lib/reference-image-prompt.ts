export interface ReferenceImagePromptAnnotation {
  index: number;
  token: string;
  name?: string;
  width?: number;
  height?: number;
}

function normalizePositiveInteger(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number(value);
    return parsed > 0 ? parsed : undefined;
  }
  return undefined;
}

function normalizeDimension(value: unknown): number | undefined {
  const parsed = normalizePositiveInteger(value);
  return parsed && parsed <= 100_000 ? parsed : undefined;
}

function normalizeToken(value: unknown, index: number): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return `@参考图${index}`;
  return raw.startsWith('@') ? raw : `@参考图${index}`;
}

function truncateInlineText(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 80);
}

export function normalizeReferenceImageAnnotations(
  value: unknown,
  referenceCount: number,
): ReferenceImagePromptAnnotation[] {
  if (!Array.isArray(value) || referenceCount <= 0) return [];
  const normalized: ReferenceImagePromptAnnotation[] = [];
  const usedIndexes = new Set<number>();

  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const index = normalizePositiveInteger(record.index);
    if (!index || index > referenceCount || usedIndexes.has(index)) continue;
    usedIndexes.add(index);

    const name = typeof record.name === 'string' ? truncateInlineText(record.name) : undefined;
    const width = normalizeDimension(record.width);
    const height = normalizeDimension(record.height);
    normalized.push({
      index,
      token: normalizeToken(record.token, index),
      ...(name ? { name } : {}),
      ...(width ? { width } : {}),
      ...(height ? { height } : {}),
    });
  }

  return normalized;
}

export function buildReferenceImagePrompt(
  prompt: string,
  referenceCount: number,
  annotationsInput?: unknown,
): string {
  const trimmedPrompt = typeof prompt === 'string' ? prompt.trim() : '';
  if (!trimmedPrompt || referenceCount <= 0) return trimmedPrompt;

  const normalized = normalizeReferenceImageAnnotations(annotationsInput, referenceCount);
  const byIndex = new Map(normalized.map(annotation => [annotation.index, annotation]));
  const annotations = Array.from({ length: referenceCount }, (_, offset) => {
    const index = offset + 1;
    return byIndex.get(index) || { index, token: `@参考图${index}` };
  });

  const lines = annotations.map(annotation => {
    const details = [
      annotation.name ? `文件名：${annotation.name}` : '',
      annotation.width && annotation.height ? `尺寸：${annotation.width}x${annotation.height}` : '',
    ].filter(Boolean);
    const suffix = details.length > 0 ? `（${details.join('，')}）` : '';
    return `${annotation.token} 对应上传的第${annotation.index}张参考图${suffix}。当提示词提到 ${annotation.token} 时，请把它理解为这张参考图，并按用户描述提取其主体、风格、构图、动作或局部元素。`;
  });

  return [
    trimmedPrompt,
    '[参考图标注说明]',
    ...lines,
  ].join('\n');
}
