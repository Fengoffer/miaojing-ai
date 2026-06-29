import type { CustomApiKey } from '@/lib/custom-api-store';
import type { ManagedSystemApi } from '@/lib/model-config-types';

function compactLabel(parts: Array<string | null | undefined>): string {
  return parts.map(part => part?.trim()).filter(Boolean).join(' / ');
}

export function isGenericApiKeyNote(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return /^(导入的\s*API\s*Key|已导入的?\s*API\s*Key|Imported\s*API\s*Key|API\s*Key)$/i.test(value.trim());
}

export function getCustomApiModelLabel(key: CustomApiKey | undefined): string {
  if (!key) return '自定义模型';
  const note = key.note?.trim();
  const modelName = key.modelName?.trim();
  if (note && !isGenericApiKeyNote(note) && note !== modelName) {
    return compactLabel([note, modelName]);
  }
  return compactLabel([key.supplierName || key.provider, modelName]) || modelName || '自定义模型';
}

export function getSystemApiModelLabel(api: ManagedSystemApi | undefined): string {
  if (!api) return '默认模型';
  const displayName = api.name?.trim();
  if (displayName) return displayName;
  return api.note?.trim() || api.modelName?.trim() || compactLabel([api.provider, api.modelName]) || '默认模型';
}
