'use client';

import type { CreationRecord } from '@/lib/creation-history-store';
import type { ImageOutputFormat, ImageQuality } from '@/lib/model-config';

export const TEXT_TO_IMAGE_DRAFT_KEY = 'miaojing:text-to-image-draft';
export const IMAGE_TO_IMAGE_DRAFT_KEY = 'miaojing:image-to-image-draft';
export const TEXT_TO_VIDEO_DRAFT_KEY = 'miaojing:text-to-video-draft';
export const IMAGE_TO_VIDEO_DRAFT_KEY = 'miaojing:image-to-video-draft';
export const TEXT_TO_IMAGE_DRAFT_EVENT = 'miaojing:text-to-image-draft';
export const IMAGE_TO_IMAGE_DRAFT_EVENT = 'miaojing:image-to-image-draft';
export const TEXT_TO_VIDEO_DRAFT_EVENT = 'miaojing:text-to-video-draft';
export const IMAGE_TO_VIDEO_DRAFT_EVENT = 'miaojing:image-to-video-draft';

export type CreationReuseTarget = 'text2img' | 'img2img' | 'text2video' | 'img2video';

export type CreationReuseDraft = {
  prompt?: string;
  negativePrompt?: string;
  model?: string;
  aspectRatio?: string;
  resolution?: string;
  count?: string;
  outputFormat?: ImageOutputFormat;
  imageQuality?: ImageQuality;
  styleLabel?: string;
  duration?: string;
  cameraMovement?: string;
  style?: string;
  guidanceScale?: number;
  strength?: number;
  referenceImage?: string;
  referenceImages?: string[];
  source?: 'creation-detail' | 'reverse-prompt' | 'gallery' | 'inspiration-gallery';
  sourceRecordId?: string;
  updatedAt?: number;
};

export type ImageCreationReuseDraft = CreationReuseDraft;

type CreationReuseSource = {
  id: string;
  url: string;
  prompt?: string | null;
  negativePrompt?: string | null;
  model?: string | null;
  params?: Record<string, unknown>;
  referenceImage?: string | null;
  referenceImages?: string[];
  thumbnailUrl?: string | null;
};

const TEXT_TO_IMAGE_ASPECT_RATIOS = new Set(['auto', '1:1', '16:9', '9:16', '4:3', '3:4']);
const IMAGE_TO_IMAGE_ASPECT_RATIOS = new Set(['auto', 'original', '1:1', '16:9', '9:16', '4:3', '3:4']);
const VIDEO_ASPECT_RATIOS = new Set(['1:1', '16:9', '9:16', '4:3', '3:4']);
const RESOLUTIONS = new Set(['auto', '1080P', '2K', '4K']);
const OUTPUT_FORMATS = new Set(['png', 'jpeg', 'webp']);
const IMAGE_QUALITIES = new Set(['auto', 'high', 'medium', 'low']);

function getString(params: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = params[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function getNumber(params: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = params[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return undefined;
}

function getStringArray(params: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    const value = params[key];
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
    }
  }
  return [];
}

function normalizeAspectRatio(value: string | undefined, target: CreationReuseTarget): string | undefined {
  if (!value) return undefined;
  const allowed = target === 'img2img'
    ? IMAGE_TO_IMAGE_ASPECT_RATIOS
    : target === 'text2video' || target === 'img2video'
      ? VIDEO_ASPECT_RATIOS
      : TEXT_TO_IMAGE_ASPECT_RATIOS;
  if (allowed.has(value)) return value;
  if (value === 'original' && target !== 'img2img') return target === 'text2img' ? 'auto' : undefined;
  return undefined;
}

function normalizeResolution(value: string | undefined): string | undefined {
  return value && RESOLUTIONS.has(value) ? value : undefined;
}

function normalizeCount(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value === 'auto') return value;
  const count = Number(value);
  if (!Number.isFinite(count)) return undefined;
  return String(Math.min(10, Math.max(1, Math.floor(count))));
}

function normalizeOutputFormat(value: string | undefined): ImageOutputFormat | undefined {
  return value && OUTPUT_FORMATS.has(value) ? value as ImageOutputFormat : undefined;
}

function normalizeImageQuality(value: string | undefined): ImageQuality | undefined {
  return value && IMAGE_QUALITIES.has(value) ? value as ImageQuality : undefined;
}

function normalizeReferenceUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  if (typeof window !== 'undefined' && trimmed.startsWith('/')) {
    return `${window.location.origin}${trimmed}`;
  }
  return trimmed;
}

function getReferenceImages(record: CreationReuseSource, target: CreationReuseTarget, useOutputAsReference: boolean): string[] {
  const params = record.params || {};
  const explicitReferences = [
    ...(typeof record.referenceImage === 'string' && record.referenceImage.trim() ? [record.referenceImage] : []),
    ...(Array.isArray(record.referenceImages) ? record.referenceImages : []),
    ...getStringArray(params, ['referenceImages']),
    ...getStringArray(params, ['images']),
    ...(getString(params, ['referenceImage', 'image']) ? [getString(params, ['referenceImage', 'image']) as string] : []),
  ];
  const normalized = explicitReferences
    .filter(url => url && !url.startsWith('data:') && !url.startsWith('['))
    .map(normalizeReferenceUrl);
  if (normalized.length > 0) return [...new Set(normalized)];

  if (
    useOutputAsReference
    && (target === 'img2img' || target === 'img2video')
    && record.url
    && !record.url.startsWith('data:')
    && !record.url.startsWith('[')
  ) {
    return [normalizeReferenceUrl(record.url)];
  }

  return [];
}

export function buildCreationReuseDraft(
  record: CreationReuseSource,
  target: CreationReuseTarget,
  options: { source?: CreationReuseDraft['source']; useOutputAsReference?: boolean } = {},
): CreationReuseDraft {
  const params = record.params || {};
  const draft: CreationReuseDraft = {
    prompt: record.prompt || '',
    negativePrompt: record.negativePrompt || '',
    model: record.model || getString(params, ['model']),
    aspectRatio: normalizeAspectRatio(getString(params, ['aspectRatio', 'aspect_ratio', 'ratio', 'imageRatio']), target),
    resolution: normalizeResolution(getString(params, ['resolution'])),
    count: normalizeCount(getString(params, ['count', 'batchCount'])),
    outputFormat: normalizeOutputFormat(getString(params, ['outputFormat', 'format'])),
    imageQuality: normalizeImageQuality(getString(params, ['imageQuality', 'quality'])),
    styleLabel: getString(params, ['styleLabel']),
    duration: getString(params, ['duration']),
    cameraMovement: getString(params, ['cameraMovement']),
    style: getString(params, ['style']),
    guidanceScale: getNumber(params, ['guidanceScale']),
    strength: getNumber(params, ['strength']),
    source: options.source || 'creation-detail',
    sourceRecordId: record.id,
    updatedAt: Date.now(),
  };

  if (target === 'img2img' || target === 'img2video') {
    const referenceImages = getReferenceImages(record, target, options.useOutputAsReference !== false);
    draft.referenceImage = referenceImages[0];
    draft.referenceImages = referenceImages;
    if (target === 'img2img') {
      draft.strength = draft.strength ?? 0.5;
    }
  }

  return draft;
}

export function buildImageCreationReuseDraft(record: CreationRecord, target: 'text2img' | 'img2img'): ImageCreationReuseDraft {
  return buildCreationReuseDraft(record, target, { source: 'creation-detail', useOutputAsReference: true });
}

function getDraftStorage(target: CreationReuseTarget): { key: string; eventName: string } {
  switch (target) {
    case 'img2img':
      return { key: IMAGE_TO_IMAGE_DRAFT_KEY, eventName: IMAGE_TO_IMAGE_DRAFT_EVENT };
    case 'text2video':
      return { key: TEXT_TO_VIDEO_DRAFT_KEY, eventName: TEXT_TO_VIDEO_DRAFT_EVENT };
    case 'img2video':
      return { key: IMAGE_TO_VIDEO_DRAFT_KEY, eventName: IMAGE_TO_VIDEO_DRAFT_EVENT };
    case 'text2img':
    default:
      return { key: TEXT_TO_IMAGE_DRAFT_KEY, eventName: TEXT_TO_IMAGE_DRAFT_EVENT };
  }
}

export function writeCreationReuseDraft(target: CreationReuseTarget, draft: CreationReuseDraft): void {
  if (typeof window === 'undefined') return;
  const { key, eventName } = getDraftStorage(target);
  try {
    window.localStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // Event delivery still updates already-mounted create panels if storage is full.
  }
  window.dispatchEvent(new CustomEvent(eventName, { detail: draft }));
}

export function writeImageCreationReuseDraft(target: 'text2img' | 'img2img', draft: ImageCreationReuseDraft): void {
  writeCreationReuseDraft(target, draft);
}
