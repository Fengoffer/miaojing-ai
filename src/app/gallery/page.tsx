'use client';

import { useState, useMemo, useEffect, useCallback, useRef, type CSSProperties, type SyntheticEvent } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  LayoutGrid,
  Heart,
  Download,
  Brush,
  ImagePlus,
  Video,
  Film,
  X,
  Clock,
  Cpu,
  Sparkles,
  Image as ImageIcon,
  MessageSquare,
  Copy,
  Maximize2,
  ArrowLeft,
  Trash2,
  Search,
} from 'lucide-react';
import { copyTextToClipboard, downloadFile, getImageDownloadExtension, triggerDownloadFile } from '@/lib/utils';
import { useAuth } from '@/lib/auth-store';
import { FullscreenPreview } from '@/components/fullscreen-preview';
import { ImageMetadataBadge } from '@/components/image-metadata-badge';
import { ReferencePreviewImage } from '@/components/reference-preview-image';
import { useImageActionsContextMenu } from '@/components/image-actions-context-menu';
import { buildCreationReuseDraft, type CreationReuseTarget, writeCreationReuseDraft } from '@/lib/creation-reuse';
import { GALLERY_CACHE_MAX_AGE_MS, isGalleryCacheEntryUsable } from '@/lib/gallery-cache-policy';
import { getPublicGalleryAvatarUrl } from '@/lib/gallery-response';
import { toast } from 'sonner';

const CATEGORIES = [
  { value: 'all', label: '全部', icon: LayoutGrid },
  { value: 'text2img', label: '文生图', icon: Brush },
  { value: 'img2img', label: '图生图', icon: ImagePlus },
  { value: 'text2video', label: '文生视频', icon: Video },
  { value: 'img2video', label: '图生视频', icon: Film },
];

const GALLERY_PAGE_SIZE = 18;
const GALLERY_CACHE_KEY = 'miaojing:gallery:v4';
const GALLERY_CACHE_VERSION = 4;
const GALLERY_CACHE_MAX_ENTRIES = 12;
const GALLERY_CACHE_MAX_WORKS_PER_ENTRY = 72;

/* ---------- Gallery Work (from API) ---------- */
interface GalleryWork {
  id: string;
  type: string;
  title?: string | null;
  prompt?: string | null;
  negativePrompt?: string | null;
  url: string;
  thumbnailUrl?: string | null;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
  likes: number;
  creditsCost?: number | null;
  params: Record<string, unknown>;
  referenceImage?: string | null;
  referenceImages?: string[];
  referenceImageThumbnails?: string[];
  publisherId: string;
  publisherNickname: string;
  publisherAvatarUrl?: string | null;
  publishedAt: string;
}

interface GalleryCacheEntry {
  works: GalleryWork[];
  total: number;
  nextOffset: number;
  hasMore: boolean;
  savedAt: number;
}

interface GalleryCacheStore {
  version: number;
  savedAt: number;
  entries: Record<string, GalleryCacheEntry>;
}

interface GalleryPageResponse {
  works?: GalleryWork[];
  total?: number;
  nextOffset?: number;
  hasMore?: boolean;
}

function sanitizeGalleryWorkForBrowserCache(work: GalleryWork): GalleryWork {
  const avatarUrl = getPublicGalleryAvatarUrl(work.publisherAvatarUrl);
  if (avatarUrl === (work.publisherAvatarUrl ?? null)) return work;
  return { ...work, publisherAvatarUrl: avatarUrl };
}

function sanitizeGalleryCacheEntry(entry: GalleryCacheEntry): GalleryCacheEntry {
  return {
    ...entry,
    works: entry.works.map(sanitizeGalleryWorkForBrowserCache),
  };
}

function buildGalleryCacheSignature(category: string, sortBy: string, searchQuery: string): string {
  return JSON.stringify({
    category,
    sortBy,
    search: searchQuery.trim().toLowerCase(),
  });
}

function readGalleryCacheStore(): GalleryCacheStore | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(GALLERY_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GalleryCacheStore;
    if (parsed?.version !== GALLERY_CACHE_VERSION || !parsed.entries || typeof parsed.entries !== 'object') {
      window.localStorage.removeItem(GALLERY_CACHE_KEY);
      return null;
    }
    return parsed;
  } catch {
    try {
      window.localStorage.removeItem(GALLERY_CACHE_KEY);
    } catch { /* ignore */ }
    return null;
  }
}

function writeGalleryCacheStore(store: GalleryCacheStore) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(GALLERY_CACHE_KEY, JSON.stringify(store));
  } catch {
    try {
      window.localStorage.removeItem(GALLERY_CACHE_KEY);
    } catch { /* ignore */ }
  }
}

function cleanupGalleryCache(store: GalleryCacheStore | null = readGalleryCacheStore()): GalleryCacheStore | null {
  if (!store) return null;
  const now = Date.now();
  const validEntries = Object.entries(store.entries)
    .filter(([, entry]) => now - Number(entry.savedAt || 0) <= GALLERY_CACHE_MAX_AGE_MS)
    .map(([key, entry]) => [key, sanitizeGalleryCacheEntry(entry)] as const)
    .sort((a, b) => Number(b[1].savedAt || 0) - Number(a[1].savedAt || 0))
    .slice(0, GALLERY_CACHE_MAX_ENTRIES);

  const nextStore: GalleryCacheStore = {
    version: GALLERY_CACHE_VERSION,
    savedAt: now,
    entries: Object.fromEntries(validEntries),
  };
  writeGalleryCacheStore(nextStore);
  return nextStore;
}

function getGalleryCacheEntry(signature: string): GalleryCacheEntry | null {
  const store = cleanupGalleryCache();
  const entry = store?.entries?.[signature];
  if (!entry || !isGalleryCacheEntryUsable(entry.savedAt)) return null;
  return sanitizeGalleryCacheEntry(entry);
}

function saveGalleryCacheEntry(signature: string, entry: GalleryCacheEntry) {
  const now = Date.now();
  const store = cleanupGalleryCache(readGalleryCacheStore()) || {
    version: GALLERY_CACHE_VERSION,
    savedAt: now,
    entries: {},
  };
  const cachedWorks = entry.works.slice(0, GALLERY_CACHE_MAX_WORKS_PER_ENTRY).map(sanitizeGalleryWorkForBrowserCache);
  store.entries[signature] = {
    ...entry,
    works: cachedWorks,
    nextOffset: entry.hasMore ? Math.min(entry.nextOffset, cachedWorks.length) : entry.nextOffset,
    savedAt: now,
  };
  store.savedAt = now;
  cleanupGalleryCache(store);
}

function removeGalleryWorksFromCache(ids: Set<string>) {
  const store = readGalleryCacheStore();
  if (!store) return;
  const now = Date.now();
  const entries = Object.fromEntries(
    Object.entries(store.entries).map(([key, entry]) => [
      key,
      {
        ...entry,
        works: entry.works.filter(work => !ids.has(work.id)),
        total: Math.max(0, Number(entry.total || 0) - entry.works.filter(work => ids.has(work.id)).length),
        nextOffset: Math.min(entry.nextOffset, entry.works.filter(work => !ids.has(work.id)).length),
        savedAt: now,
      },
    ]),
  );
  writeGalleryCacheStore({ version: GALLERY_CACHE_VERSION, savedAt: now, entries });
}

function getCategoryFromWork(work: GalleryWork): string {
  const mode = work.params?.creationMode || work.params?.workType || work.params?.mode;
  if (
    mode === 'text2img' ||
    mode === 'img2img' ||
    mode === 'text2video' ||
    mode === 'img2video'
  ) {
    return mode;
  }
  if (work.type === 'text2video' || work.type === 'img2video') {
    return work.type;
  }
  if (work.type === 'img2img') return work.type;
  const hasReference =
    Boolean(work.referenceImage) ||
    (Array.isArray(work.referenceImages) && work.referenceImages.length > 0) ||
    Boolean(work.params?.referenceImage) ||
    (Array.isArray(work.params?.referenceImages) && work.params.referenceImages.length > 0);
  // Fallback: infer from type + referenceImage
  if (work.type === 'video' || work.duration) {
    return hasReference ? 'img2video' : 'text2video';
  }
  return hasReference ? 'img2img' : 'text2img';
}

function getStyleLabelFromParams(params: Record<string, unknown> | undefined): string {
  const value = params?.styleLabel;
  return typeof value === 'string' ? value.trim() : '';
}

function getCategoryLabel(work: GalleryWork): string {
  const cat = CATEGORIES.find(c => c.value === getCategoryFromWork(work));
  return cat?.label ?? work.type;
}

function isVideoWork(work: GalleryWork): boolean {
  return work.type === 'video' || work.type === 'text2video' || work.type === 'img2video' || Boolean(work.duration);
}

function getVideoFallbackThumbnail(work: GalleryWork): string {
  const label = getCategoryLabel(work) || '视频';
  const title = (work.prompt || label).slice(0, 42);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#111827"/>
      <stop offset="52%" stop-color="#334155"/>
      <stop offset="100%" stop-color="#f59e0b"/>
    </linearGradient>
  </defs>
  <rect width="1280" height="720" fill="url(#bg)"/>
  <circle cx="640" cy="330" r="92" fill="#fff" fill-opacity="0.9"/>
  <path d="M612 280 L612 380 L700 330 Z" fill="#111827"/>
  <text x="640" y="516" text-anchor="middle" font-family="Arial, sans-serif" font-size="42" font-weight="700" fill="#fff">${escapeSvgText(label)}</text>
  <text x="640" y="568" text-anchor="middle" font-family="Arial, sans-serif" font-size="24" fill="#fff" opacity="0.72">${escapeSvgText(title)}</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function getDownloadFilename(work: GalleryWork): string {
  const extension = isVideoWork(work)
    ? 'mp4'
    : getImageDownloadExtension(
      work.url,
      typeof work.params?.outputFormat === 'string' ? work.params.outputFormat : undefined,
    );
  return `miaojing-${work.id}.${extension}`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function getAvatarText(nickname: string): string {
  const trimmed = nickname.trim();
  return trimmed ? trimmed.slice(0, 1).toUpperCase() : '匿';
}

function getWorkReferenceImages(work: GalleryWork): string[] {
  const fromArray = Array.isArray(work.referenceImages) ? work.referenceImages : [];
  const fromParams = Array.isArray(work.params?.referenceImages)
    ? (work.params.referenceImages as unknown[]).filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
  const single = typeof work.referenceImage === 'string' && work.referenceImage.trim()
    ? [work.referenceImage]
    : typeof work.params?.referenceImage === 'string' && work.params.referenceImage.trim()
      ? [work.params.referenceImage]
      : [];
  return [...new Set([...single, ...fromArray, ...fromParams].filter(url => url && !url.startsWith('data:') && !url.startsWith('[')))];
}

function getWorkReferenceImageThumbnails(work: GalleryWork): string[] {
  const fromArray = Array.isArray(work.referenceImageThumbnails) ? work.referenceImageThumbnails : [];
  const fromParams = Array.isArray(work.params?.referenceImageThumbnails)
    ? (work.params.referenceImageThumbnails as unknown[]).filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
  return [...new Set([...fromArray, ...fromParams].filter(url => url && !url.startsWith('data:') && !url.startsWith('[')))];
}

async function copyGalleryText(text: string, successMessage: string) {
  const copyResult = await copyTextToClipboard(text);
  if (copyResult === 'copied') {
    toast.success(successMessage);
  } else if (copyResult === 'manual') {
    toast.info('已选中文本，请按 Ctrl+C 复制');
  } else {
    toast.error('复制失败，请手动选择文本复制');
  }
}

function getCreateUrlForCategory(category: string): string {
  const type = category === 'img2img' || category === 'text2video' || category === 'img2video'
    ? category
    : 'text2img';
  return `/create?type=${type}`;
}

function isCreationReuseTarget(value: string): value is CreationReuseTarget {
  return value === 'text2img' || value === 'img2img' || value === 'text2video' || value === 'img2video';
}

type MediaSize = { width: number; height: number };
type GalleryCardPalette = {
  accent1: string;
  accent2: string;
  accent3: string;
  accent4: string;
  accent5: string;
  actionBg: string;
  actionFg: string;
  actionBorder: string;
  actionShadow: string;
};

type RgbColor = { r: number; g: number; b: number };
type ScoredColor = { color: RgbColor; score: number };

function clampColor(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function rgbToCss(color: RgbColor, alpha?: number): string {
  const { r, g, b } = color;
  return alpha === undefined
    ? `rgb(${clampColor(r)} ${clampColor(g)} ${clampColor(b)})`
    : `rgb(${clampColor(r)} ${clampColor(g)} ${clampColor(b)} / ${alpha})`;
}

function mixRgb(color: RgbColor, target: RgbColor, amount: number): RgbColor {
  return {
    r: color.r + (target.r - color.r) * amount,
    g: color.g + (target.g - color.g) * amount,
    b: color.b + (target.b - color.b) * amount,
  };
}

function getLuminance(color: RgbColor): number {
  return (0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b) / 255;
}

function getSaturation(color: RgbColor): number {
  const max = Math.max(color.r, color.g, color.b) / 255;
  const min = Math.min(color.r, color.g, color.b) / 255;
  return max === 0 ? 0 : (max - min) / max;
}

function getRgbDistance(a: RgbColor, b: RgbColor): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function getHueDistance(a: number, b: number): number {
  const diff = Math.abs(a - b);
  return Math.min(diff, 1 - diff);
}

function rgbToHsl({ r, g, b }: RgbColor) {
  const nr = r / 255, ng = g / 255, nb = b / 255;
  const max = Math.max(nr, ng, nb), min = Math.min(nr, ng, nb);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case nr: h = (ng - nb) / d + (ng < nb ? 6 : 0); break;
      case ng: h = (nb - nr) / d + 2; break;
      case nb: h = (nr - ng) / d + 4; break;
    }
    h /= 6;
  }
  return { h, s, l };
}

function hslToRgb({ h, s, l }: { h: number; s: number; l: number }): RgbColor {
  let r = 0, g = 0, b = 0;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return { r: r * 255, g: g * 255, b: b * 255 };
}

function makeVivid(color: RgbColor): RgbColor {
  const hsl = rgbToHsl(color);
  const luminance = getLuminance(color);
  const saturation = getSaturation(color);
  // 确保亮度不低于中等亮度，饱和度不低于鲜艳阈值
  const targetLightness = luminance < 0.45 ? 0.60 : Math.max(hsl.l, 0.55);
  const targetSaturation = saturation < 0.45 ? 0.75 : Math.max(hsl.s, 0.55);
  hsl.l = Math.min(0.85, targetLightness);   // 上限 85% 避免过曝
  hsl.s = Math.min(1.0, targetSaturation * 1.15); // 额外增饱和 15%
  return hslToRgb(hsl);
}

function selectImageAccentColors(candidates: ScoredColor[], average: RgbColor, strongest: RgbColor): RgbColor[] {
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const selected: RgbColor[] = [];
  const passes = [
    { hueDistance: 0.13, rgbDistance: 86 },
    { hueDistance: 0.08, rgbDistance: 58 },
    { hueDistance: 0.035, rgbDistance: 34 },
  ];

  for (const pass of passes) {
    for (const candidate of sorted) {
      if (selected.length >= 5) break;
      const vivid = makeVivid(candidate.color);
      const vividHue = rgbToHsl(vivid).h;
      const isDistinct = selected.every((color) => {
        const colorHue = rgbToHsl(color).h;
        return getHueDistance(vividHue, colorHue) >= pass.hueDistance || getRgbDistance(vivid, color) >= pass.rgbDistance;
      });
      if (isDistinct) {
        selected.push(vivid);
      }
    }
    if (selected.length >= 5) break;
  }

  for (const fallback of [strongest, average]) {
    const vivid = makeVivid(fallback);
    if (selected.length === 0 || selected.every(color => getRgbDistance(vivid, color) >= 24)) {
      selected.push(vivid);
    }
    if (selected.length >= 3) break;
  }

  const byHue = selected.slice(0, 5).sort((a, b) => rgbToHsl(a).h - rgbToHsl(b).h);
  return byHue.length > 0 ? byHue : [makeVivid(strongest)];
}

function getImagePalette(img: HTMLImageElement): GalleryCardPalette | null {
  try {
    const canvas = document.createElement('canvas');
    const size = 36;
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;

    context.drawImage(img, 0, 0, size, size);
    const data = context.getImageData(0, 0, size, size).data;
    let total = 0;
    const average: RgbColor = { r: 0, g: 0, b: 0 };
    let strongest: RgbColor = { r: 245, g: 166, b: 35 };
    let strongestScore = -1;
    const candidates: ScoredColor[] = [];

    for (let index = 0; index < data.length; index += 4) {
      const alpha = data[index + 3];
      if (alpha < 180) continue;
      const color = { r: data[index], g: data[index + 1], b: data[index + 2] };
      const luminance = getLuminance(color);
      if (luminance < 0.04 || luminance > 0.96) continue;

      average.r += color.r;
      average.g += color.g;
      average.b += color.b;
      total += 1;

      const saturation = getSaturation(color);
      const score = saturation * 0.7 + (1 - Math.abs(luminance - 0.55)) * 0.3;
      candidates.push({ color, score });
      if (score > strongestScore) {
        strongestScore = score;
        strongest = color;
      }
    }

    if (total === 0) return null;

    average.r /= total;
    average.g /= total;
    average.b /= total;
    const accents = selectImageAccentColors(candidates, average, strongest);
    const imageIsDark = getLuminance(average) < 0.48;
    const colorAt = (index: number) => accents[index % accents.length] || makeVivid(strongest);

    return {
      accent1: rgbToCss(colorAt(0)),
      accent2: rgbToCss(colorAt(1)),
      accent3: rgbToCss(colorAt(2)),
      accent4: rgbToCss(colorAt(3)),
      accent5: rgbToCss(colorAt(4)),
      actionBg: imageIsDark ? 'rgb(255 255 255 / 0.92)' : 'rgb(13 18 28 / 0.86)',
      actionFg: imageIsDark ? 'rgb(17 24 39)' : 'rgb(255 255 255)',
      actionBorder: imageIsDark ? 'rgb(255 255 255 / 0.72)' : 'rgb(255 255 255 / 0.22)',
      actionShadow: imageIsDark
        ? '0 12px 28px rgb(0 0 0 / 0.42), 0 0 0 1px rgb(255 255 255 / 0.18)'
        : '0 12px 28px rgb(0 0 0 / 0.30), 0 0 0 1px rgb(0 0 0 / 0.18)',
    };
  } catch {
    return null;
  }
}

function getGalleryCardStyle(palette?: GalleryCardPalette): CSSProperties {
  return {
    '--gallery-accent-1': palette?.accent1 || 'rgb(245 166 35)',
    '--gallery-accent-2': palette?.accent2 || 'rgb(56 189 248)',
    '--gallery-accent-3': palette?.accent3 || 'rgb(244 114 182)',
    '--gallery-accent-4': palette?.accent4 || palette?.accent2 || 'rgb(34 197 94)',
    '--gallery-accent-5': palette?.accent5 || palette?.accent1 || 'rgb(168 85 247)',
    '--gallery-action-bg': palette?.actionBg || 'rgb(255 255 255 / 0.92)',
    '--gallery-action-fg': palette?.actionFg || 'rgb(17 24 39)',
    '--gallery-action-border': palette?.actionBorder || 'rgb(255 255 255 / 0.58)',
    '--gallery-action-shadow': palette?.actionShadow || '0 12px 28px rgb(0 0 0 / 0.34), 0 0 0 1px rgb(255 255 255 / 0.18)',
  } as CSSProperties;
}

function getEstimatedWorkHeight(work: GalleryWork, measuredSize?: MediaSize): number {
  const width = Number(measuredSize?.width || work.width || 0);
  const height = Number(measuredSize?.height || work.height || 0);
  const imageHeight = width > 0 && height > 0 ? Math.max(120, (height / width) * 320) : 320;
  return imageHeight + 152 + 16;
}

function GalleryLoadingSkeleton({ columnCount }: { columnCount: number }) {
  const safeColumnCount = Math.max(2, Math.min(columnCount, 4));
  const columns = Array.from({ length: safeColumnCount }, (_, columnIndex) => {
    const heights = [300, 380, 260, 340, 420, 280];
    return Array.from({ length: 3 }, (_, itemIndex) => heights[(columnIndex + itemIndex) % heights.length]);
  });

  return (
    <div
      className="gallery-masonry-grid grid gap-4"
      style={{ gridTemplateColumns: `repeat(${safeColumnCount}, minmax(0, 1fr))` }}
      aria-label="画廊正在加载"
    >
      {columns.map((columnHeights, columnIndex) => (
        <div key={columnIndex} className="flex min-w-0 flex-col gap-4">
          {columnHeights.map((height, itemIndex) => (
            <div key={`${columnIndex}-${itemIndex}`} className="gallery-work-shell">
              <div className="overflow-hidden rounded-[14px] border border-white/[0.08] bg-white/[0.035] shadow-[0_16px_36px_rgba(0,0,0,0.16)] light:border-amber-900/14 light:bg-white/46">
                <div
                  className="animate-pulse bg-gradient-to-br from-muted/70 via-muted/35 to-muted/55"
                  style={{ height }}
                />
                <div className="space-y-3 p-3">
                  <div className="flex items-center gap-2">
                    <div className="h-6 w-6 animate-pulse rounded-full bg-muted/70" />
                    <div className="h-3 w-24 animate-pulse rounded-full bg-muted/70" />
                  </div>
                  <div className="h-3 w-full animate-pulse rounded-full bg-muted/60" />
                  <div className="h-3 w-4/5 animate-pulse rounded-full bg-muted/50" />
                  <div className="h-3 w-2/3 animate-pulse rounded-full bg-muted/40" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

const galleryGlassPanel =
  'liquid-glass';
const galleryGlassCard =
  'liquid-surface';
const detailGlassBlock =
  'rounded-xl border border-white/[0.08] bg-[#12161d]/82 shadow-[inset_0_1px_0_rgba(255,255,255,0.045),0_16px_36px_rgba(0,0,0,0.18)] backdrop-blur-xl light:border-amber-900/18 light:bg-white/36 light:text-foreground light:shadow-[inset_0_1px_0_rgba(255,255,255,0.70),0_16px_40px_rgba(83,61,27,0.12)]';
const detailGlassInner =
  'rounded-md border border-white/[0.07] bg-[#0d1219]/80 light:border-amber-900/16 light:bg-white/32';
const galleryMenuItemClass =
  'inline-flex h-10 cursor-pointer items-center gap-2.5 rounded-xl border border-transparent px-5 text-base font-semibold leading-none text-foreground/75 transition-colors hover:bg-white/[0.035]';
const galleryMenuItemActiveClass =
  'border-transparent bg-white/[0.075] text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_0_18px_rgba(244,166,36,0.18),0_6px_18px_rgba(0,0,0,0.18)] [&_svg]:text-primary';

export default function GalleryPage() {
  const [apiWorks, setApiWorks] = useState<GalleryWork[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextOffset, setNextOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [totalWorks, setTotalWorks] = useState(0);
  const [category, setCategory] = useState('all');
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [selectedWork, setSelectedWork] = useState<GalleryWork | null>(null);
  const [activeVideoWorkId, setActiveVideoWorkId] = useState<string | null>(null);
  const [fullscreenSrc, setFullscreenSrc] = useState<string | null>(null);
  const [fullscreenFallbackSrc, setFullscreenFallbackSrc] = useState<string | null>(null);
  const [referencePreviewSrc, setReferencePreviewSrc] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'newest' | 'popular'>('newest');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [masonryColumnCount, setMasonryColumnCount] = useState(4);
  const [measuredMediaSizes, setMeasuredMediaSizes] = useState<Record<string, MediaSize>>({});
  const [cardPalettes, setCardPalettes] = useState<Record<string, GalleryCardPalette>>({});
  const [selectedGalleryIds, setSelectedGalleryIds] = useState<Set<string>>(new Set());
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const galleryRequestSeqRef = useRef(0);
  const { openImageMenu, ImageActionsContextMenu } = useImageActionsContextMenu();

  const openFullscreenPreview = useCallback((src: string, fallbackSrc?: string | null) => {
    setFullscreenFallbackSrc(fallbackSrc || null);
    setFullscreenSrc(src);
  }, []);

  useEffect(() => {
    setActiveVideoWorkId(null);
  }, [selectedWork?.id]);

  useEffect(() => {
    const updateColumnCount = () => {
      const width = window.innerWidth;
      if (width >= 1280) setMasonryColumnCount(4);
      else if (width >= 1024) setMasonryColumnCount(3);
      else setMasonryColumnCount(2);
    };

    updateColumnCount();
    window.addEventListener('resize', updateColumnCount);
    return () => window.removeEventListener('resize', updateColumnCount);
  }, []);

  // ESC to close detail overlay
  useEffect(() => {
    if (!selectedWork) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelectedWork(null); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedWork]);

  // Prevent body scroll when detail is open
  useEffect(() => {
    if (selectedWork) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [selectedWork]);
  const { accessToken, isAdmin } = useAuth();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  const activeCacheSignature = useMemo(
    () => buildGalleryCacheSignature(category, sortBy, debouncedSearchQuery),
    [category, sortBy, debouncedSearchQuery],
  );

  const fetchGalleryPage = useCallback(async (offset: number, options?: { append?: boolean; background?: boolean }) => {
    const requestSeq = ++galleryRequestSeqRef.current;
    const append = Boolean(options?.append);
    const background = Boolean(options?.background);
    if (append) setLoadingMore(true);
    else if (background) setRefreshing(true);
    else setLoading(true);

    try {
      const params = new URLSearchParams({
        sort: sortBy,
        limit: String(GALLERY_PAGE_SIZE),
        offset: String(offset),
      });
      if (debouncedSearchQuery.trim()) params.set('q', debouncedSearchQuery.trim());
      if (category !== 'all') params.set('category', category);

      const res = await fetch(`/api/gallery?${params.toString()}`, {
        cache: background ? 'no-cache' : 'default',
      });
      if (!res.ok) return;

      const data = (await res.json()) as GalleryPageResponse;
      if (requestSeq !== galleryRequestSeqRef.current) return;
      const incomingWorks = Array.isArray(data.works) ? data.works : [];
      const incomingTotal = Number(data.total ?? 0);
      const incomingNextOffset = Number(data.nextOffset ?? offset + incomingWorks.length);
      const incomingHasMore = Boolean(data.hasMore ?? incomingNextOffset < incomingTotal);

      setApiWorks(prev => {
        const next = append
          ? [...prev, ...incomingWorks.filter(work => !prev.some(item => item.id === work.id))]
          : incomingWorks;
        saveGalleryCacheEntry(activeCacheSignature, {
          works: next,
          total: incomingTotal,
          nextOffset: incomingNextOffset,
          hasMore: incomingHasMore,
          savedAt: Date.now(),
        });
        return next;
      });
      setTotalWorks(incomingTotal);
      setNextOffset(incomingNextOffset);
      setHasMore(incomingHasMore);
    } catch {
      // Keep any cached or already loaded rows on transient network failures.
    } finally {
      if (requestSeq === galleryRequestSeqRef.current) {
        if (append) setLoadingMore(false);
        else if (background) setRefreshing(false);
        else setLoading(false);
      }
    }
  }, [activeCacheSignature, category, sortBy, debouncedSearchQuery]);

  useEffect(() => {
    const cached = getGalleryCacheEntry(activeCacheSignature);
    setSelectedGalleryIds(new Set());
    setMeasuredMediaSizes({});
    setCardPalettes({});

    if (cached) {
      setApiWorks(cached.works);
      setTotalWorks(cached.total);
      setNextOffset(cached.nextOffset);
      setHasMore(cached.hasMore);
      setLoading(false);
      void fetchGalleryPage(0, { background: true });
      return;
    }

    setApiWorks([]);
    setTotalWorks(0);
    setNextOffset(0);
    setHasMore(false);
    void fetchGalleryPage(0);
  }, [activeCacheSignature, fetchGalleryPage]);

  useEffect(() => {
    const sentinel = loadMoreRef.current;
    if (!sentinel || !hasMore || loading || loadingMore || refreshing) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some(entry => entry.isIntersecting)) {
          void fetchGalleryPage(nextOffset, { append: true });
        }
      },
      { root: null, rootMargin: '720px 0px', threshold: 0.01 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [fetchGalleryPage, hasMore, loading, loadingMore, nextOffset, refreshing]);

  const filteredWorks = useMemo(() => {
    const query = debouncedSearchQuery.trim().toLowerCase();
    return apiWorks.filter(work => {
      if (category !== 'all' && getCategoryFromWork(work) !== category) return false;
      if (!query) return true;
      const haystack = [
        work.title,
        work.prompt,
        work.negativePrompt,
        work.publisherNickname,
        work.params?.model,
        work.params?.modelLabel,
        work.type,
      ].map(value => String(value || '').toLowerCase()).join('\n');
      return haystack.includes(query);
    });
  }, [apiWorks, category, debouncedSearchQuery]);

  const apiWorkIds = useMemo(() => new Set(apiWorks.map(work => work.id)), [apiWorks]);

  const handleCardImageLoad = useCallback((workId: string, e: SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (img.naturalWidth <= 0 || img.naturalHeight <= 0) return;

    setMeasuredMediaSizes(prev => {
      const current = prev[workId];
      if (current?.width === img.naturalWidth && current?.height === img.naturalHeight) {
        return prev;
      }
      return {
        ...prev,
        [workId]: { width: img.naturalWidth, height: img.naturalHeight },
      };
    });

    const palette = getImagePalette(img);
    if (palette) {
      setCardPalettes(prev => ({
        ...prev,
        [workId]: palette,
      }));
    }
  }, []);

  const masonryColumns = useMemo(() => {
    const columns = Array.from({ length: masonryColumnCount }, () => [] as GalleryWork[]);
    const columnHeights = Array.from({ length: masonryColumnCount }, () => 0);
    filteredWorks.forEach((work) => {
      const targetIndex = columnHeights.indexOf(Math.min(...columnHeights));
      columns[targetIndex].push(work);
      columnHeights[targetIndex] += getEstimatedWorkHeight(work, measuredMediaSizes[work.id]);
    });
    return columns;
  }, [filteredWorks, masonryColumnCount, measuredMediaSizes]);

  const selectedReferenceImages = useMemo(
    () => selectedWork ? getWorkReferenceImages(selectedWork) : [],
    [selectedWork],
  );
  const selectedReferenceImageThumbnails = useMemo(
    () => selectedWork ? getWorkReferenceImageThumbnails(selectedWork) : [],
    [selectedWork],
  );

  const toggleLike = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (likedIds.has(id)) return;
    setLikedIds(prev => new Set(prev).add(id));
  };

  const handleDownload = async (url: string, filename: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (/\.(mp4|webm|mov|avi)(?:$|\?)/i.test(filename) || /\.(mp4|webm|mov|avi)(?:$|\?)/i.test(url)) {
      triggerDownloadFile(url, filename);
      toast.success('已开始下载');
      return;
    }
    const result = await downloadFile(url, filename);
    if (!result.ok) {
      window.open(url, '_blank');
    }
  };

  const handleReuseGalleryWork = (work: GalleryWork, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const target = getCategoryFromWork(work);
    if (!isCreationReuseTarget(target)) {
      toast.error('该作品暂不支持一键复用');
      return;
    }
    const draft = buildCreationReuseDraft(work, target, {
      source: 'gallery',
      useOutputAsReference: true,
    });
    writeCreationReuseDraft(target, draft);
    toast.success('已带入创作参数');
    window.location.href = getCreateUrlForCategory(target);
  };

  const toggleSelectGalleryWork = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setSelectedGalleryIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDeleteGalleryWorks = async (ids: string[], e?: React.MouseEvent) => {
    e?.stopPropagation();
    const targetIds = ids.filter(id => apiWorkIds.has(id));
    if (targetIds.length === 0) {
      toast.error('没有可删除的服务器画廊作品');
      return;
    }
    const confirmed = window.confirm(targetIds.length === 1 ? '确认从画廊移除这个作品？' : `确认从画廊批量移除 ${targetIds.length} 个作品？`);
    if (!confirmed) return;

    try {
      const res = await fetch('/api/gallery', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ ids: targetIds }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || '删除失败');
      }
      const removedIds = new Set<string>((data.ids || targetIds) as string[]);
      setApiWorks(prev => prev.filter(work => !removedIds.has(work.id)));
      removeGalleryWorksFromCache(removedIds);
      setTotalWorks(prev => Math.max(0, prev - removedIds.size));
      setSelectedGalleryIds(prev => new Set([...prev].filter(id => !removedIds.has(id))));
      if (selectedWork && removedIds.has(selectedWork.id)) {
        setSelectedWork(null);
      }
      toast.success(`已从画廊移除 ${data.removed ?? removedIds.size} 个作品`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  return (
    <div className="gallery-mobile-page min-h-screen bg-background">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3">
            <h1 className="font-serif text-3xl font-bold">作品画廊</h1>
          </div>
          <p className="mt-2 text-muted-foreground">探索社区创作，发现灵感之美</p>
        </div>

        <div className={`${galleryGlassPanel} mb-4 rounded-[28px] border-amber-900/10 p-3 shadow-[0_18px_45px_rgba(83,61,27,0.08),inset_0_1px_0_rgba(255,255,255,0.70)]`}>
          <div className="flex h-12 items-center gap-3 rounded-2xl border border-amber-900/12 bg-white/58 px-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.82),inset_0_0_0_1px_rgba(255,255,255,0.28)] transition-colors focus-within:border-primary/35 focus-within:bg-white/72 focus-within:shadow-[0_0_0_3px_rgba(245,166,35,0.12),inset_0_1px_0_rgba(255,255,255,0.86)] dark:border-white/10 dark:bg-white/[0.045] dark:focus-within:bg-white/[0.07]">
            <Search className="h-[18px] w-[18px] shrink-0 text-primary/75" />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="搜索作品、用户、提示词、模型"
              className="gallery-search-input h-full min-w-0 flex-1 rounded-none border-0 bg-transparent px-0 text-sm font-medium text-foreground shadow-none outline-none placeholder:text-muted-foreground/62"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
                aria-label="清空搜索"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Filters */}
        <div className={`${galleryGlassPanel} gallery-mobile-filter-bar mb-8 flex min-h-12 flex-col items-start justify-between gap-4 rounded-2xl p-1 sm:flex-row sm:items-center`}>
          <div className="gallery-mobile-filter-group flex flex-wrap gap-2">
            {CATEGORIES.map((cat) => {
              const Icon = cat.icon;
              return (
                <button
                  key={cat.value}
                  className={`${galleryMenuItemClass} ${category === cat.value ? galleryMenuItemActiveClass : ''}`}
                  onClick={() => setCategory(cat.value)}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {cat.label}
                </button>
              );
            })}
          </div>
          <div className="gallery-mobile-filter-group flex flex-wrap gap-2">
            <button
              className={`${galleryMenuItemClass} ${sortBy === 'newest' ? galleryMenuItemActiveClass : ''}`}
              onClick={() => setSortBy('newest')}
            >
              最新发布
            </button>
            <button
              className={`${galleryMenuItemClass} ${sortBy === 'popular' ? galleryMenuItemActiveClass : ''}`}
              onClick={() => setSortBy('popular')}
            >
              最受欢迎
            </button>
            {isAdmin && selectedGalleryIds.size > 0 && (
              <Button
                size="sm"
                variant="destructive"
                className="h-10 rounded-xl px-4 text-sm font-semibold"
                onClick={(e) => handleDeleteGalleryWorks([...selectedGalleryIds], e)}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                批量删除 {selectedGalleryIds.size}
              </Button>
            )}
          </div>
        </div>

        {/* Gallery Grid */}
        {loading ? (
          <GalleryLoadingSkeleton columnCount={masonryColumnCount} />
        ) : filteredWorks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
            <LayoutGrid className="h-16 w-16 mb-4 opacity-30" />
            <p className="text-lg font-serif">暂无作品</p>
            <p className="text-sm mt-1">创作并发布你的作品，让大家一起欣赏</p>
            <Button
              className="mt-4"
              variant="outline"
              onClick={() => window.location.href = getCreateUrlForCategory(category)}
            >
              <Sparkles className="h-4 w-4 mr-2" />
              前往创作
            </Button>
          </div>
        ) : (
          <>
            <div
              className="gallery-masonry-grid grid gap-4"
              style={{ gridTemplateColumns: `repeat(${masonryColumnCount}, minmax(0, 1fr))` }}
            >
              {masonryColumns.map((columnWorks, columnIndex) => (
                <div key={columnIndex} className="flex min-w-0 flex-col gap-4">
                  {columnWorks.map((work, columnItemIndex) => {
                  const mediaPreviewUrl = work.thumbnailUrl || (isVideoWork(work) ? getVideoFallbackThumbnail(work) : '');
                  const shouldLoadEagerly = columnItemIndex < 2;
                  return (
                    <div
                      key={work.id}
                      className="gallery-work-shell group"
                      style={getGalleryCardStyle(cardPalettes[work.id])}
                    >
                      <div className="gallery-card-border-frame">
                        <Card
                          className={`${galleryGlassCard} gallery-work-card w-full overflow-hidden cursor-pointer !rounded-[14px] !py-0`}
                          onClick={() => setSelectedWork(work)}
                        >
                        <div className="relative overflow-hidden bg-black/25">
                          {mediaPreviewUrl ? (
                            <img
                              src={mediaPreviewUrl}
                              alt={(work.prompt || '').slice(0, 30)}
                              className="block h-auto w-full object-contain"
                              loading={shouldLoadEagerly ? 'eager' : 'lazy'}
                              decoding="async"
                              onLoad={(e) => handleCardImageLoad(work.id, e)}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (isVideoWork(work)) setSelectedWork(work);
                                else openFullscreenPreview(work.url, work.thumbnailUrl);
                              }}
                              onContextMenu={(e) => {
                                if (isVideoWork(work)) return;
                                openImageMenu(e, work.url);
                              }}
                            />
                          ) : (
                            <div className="flex aspect-square w-full flex-col items-center justify-center bg-gradient-to-br from-muted to-muted/50">
                              <Sparkles className="h-8 w-8 text-muted-foreground/20" />
                            </div>
                          )}
                          {isAdmin && apiWorkIds.has(work.id) && (
                            <button
                              className={`absolute left-2 top-2 z-20 flex h-7 w-7 items-center justify-center rounded-lg border text-xs font-semibold backdrop-blur-md transition-colors ${
                                selectedGalleryIds.has(work.id)
                                  ? 'border-primary/60 bg-primary text-primary-foreground'
                                  : 'border-white/20 bg-black/45 text-white hover:bg-black/65'
                              }`}
                              onClick={(e) => toggleSelectGalleryWork(work.id, e)}
                              title={selectedGalleryIds.has(work.id) ? '取消选择' : '选择作品'}
                            >
                              {selectedGalleryIds.has(work.id) ? '✓' : ''}
                            </button>
                          )}
                          {isVideoWork(work) && (
                            <Badge className={`absolute left-2 z-20 ${isAdmin && apiWorkIds.has(work.id) ? 'top-11' : 'top-2'}`} variant="secondary">
                              <Film className="h-3 w-3 mr-1" />视频
                            </Badge>
                          )}
                          <Badge className="absolute top-2 right-2 z-20" variant="secondary">
                            {getCategoryLabel(work)}
                          </Badge>
                          <div className="pointer-events-none absolute inset-x-3 bottom-3 z-20 flex translate-y-2 justify-center gap-2 opacity-0 transition-all duration-300 ease-out group-hover:translate-y-0 group-hover:opacity-100">
                            <Button
                              size="sm"
                              variant="secondary"
                              className="gallery-work-action-button pointer-events-auto h-9 w-9 p-0"
                              onClick={(e) => toggleLike(work.id, e)}
                              title="点赞"
                            >
                              <Heart className={`h-4 w-4 ${likedIds.has(work.id) ? 'fill-current' : ''}`} />
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              className="gallery-work-action-button pointer-events-auto h-9 w-9 p-0"
                              onClick={(e) => handleReuseGalleryWork(work, e)}
                              title="一键复用"
                            >
                              <Sparkles className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              className="gallery-work-action-button pointer-events-auto h-9 w-9 p-0"
                              onClick={(e) => handleDownload(work.url, getDownloadFilename(work), e)}
                              title="下载"
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                            {isAdmin && apiWorkIds.has(work.id) && (
                              <Button
                                size="sm"
                                variant="destructive"
                                className="pointer-events-auto h-9 w-9 rounded-full p-0 shadow-[0_12px_28px_rgba(0,0,0,0.34)]"
                                onClick={(e) => handleDeleteGalleryWorks([work.id], e)}
                                title="从画廊删除"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </div>
                        <CardContent className="flex h-[152px] flex-col p-3">
                          <div className="flex items-center justify-between">
                            <div className="flex min-w-0 items-center gap-2">
                              <div className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/15 text-xs font-semibold text-primary ring-1 ring-primary/25">
                                {work.publisherAvatarUrl ? (
                                  <img
                                    src={work.publisherAvatarUrl}
                                    alt={work.publisherNickname}
                                    className="h-full w-full object-cover"
                                    loading="lazy"
                                    decoding="async"
                                  />
                                ) : (
                                  getAvatarText(work.publisherNickname)
                                )}
                              </div>
                              <span className="truncate text-sm font-medium">
                                {work.publisherNickname}
                              </span>
                            </div>
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Heart className={`h-3 w-3 ${likedIds.has(work.id) ? 'fill-rose-500 text-rose-500' : ''}`} />
                              {work.likes + (likedIds.has(work.id) ? 1 : 0)}
                            </div>
                          </div>
                          <p className="mt-2 h-[100px] overflow-hidden whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground line-clamp-5">
                            {work.prompt}
                          </p>
                        </CardContent>
                        </Card>
                      </div>
                    </div>
                  );
                  })}
                </div>
              ))}
            </div>
            <div ref={loadMoreRef} className="flex h-20 items-center justify-center text-sm text-muted-foreground">
              {loadingMore ? (
                <span>继续加载...</span>
              ) : hasMore ? (
                <span className="sr-only">滚动加载更多作品</span>
              ) : totalWorks > filteredWorks.length ? (
                <span>已显示当前筛选结果</span>
              ) : null}
            </div>
          </>
        )}
      </div>

      {/* Detail - Fullscreen Overlay */}
      {selectedWork && (
        <div
          className="gallery-detail-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md animate-in fade-in duration-200 light:bg-white/58 light:backdrop-blur-xl"
          onClick={(e) => { if (e.target === e.currentTarget) setSelectedWork(null); }}
        >
          <div className="gallery-detail-shell relative flex h-[96vh] w-[98vw] overflow-hidden rounded-2xl border border-white/[0.08] bg-[#07090d] shadow-[0_28px_80px_rgba(0,0,0,0.55)] light:border-amber-900/18 light:bg-white/30 light:shadow-[0_28px_80px_rgba(83,61,27,0.16),inset_0_1px_0_rgba(255,255,255,0.70)]">
            {selectedWork.url && !selectedWork.url.startsWith('data:') && (
              <>
                  <img
                    src={selectedWork.thumbnailUrl || (isVideoWork(selectedWork) ? getVideoFallbackThumbnail(selectedWork) : selectedWork.url)}
                    alt=""
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover opacity-48 blur-[5px]"
                  />
                <div className="pointer-events-none absolute inset-0 bg-black/42 light:bg-white/38" />
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.015),rgba(0,0,0,0.62))] light:bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.16),rgba(255,248,235,0.54))]" />
                </>
              )}
            {/* Left: Image/Video */}
            <div className="gallery-detail-media relative z-10 flex min-w-0 flex-1 items-center justify-center overflow-hidden bg-black/22 light:bg-white/12">
              {isVideoWork(selectedWork) ? (
                activeVideoWorkId !== selectedWork.id ? (
                  <button
                    type="button"
                    className="relative z-10 flex h-full w-full items-center justify-center bg-black/28"
                    onClick={() => setActiveVideoWorkId(selectedWork.id)}
                    aria-label="播放视频"
                  >
                    <img
                      src={selectedWork.thumbnailUrl || getVideoFallbackThumbnail(selectedWork)}
                      alt={(selectedWork.prompt || '视频预览').slice(0, 30)}
                      className="absolute inset-0 h-full w-full object-contain"
                    />
                    <span className="relative z-10 flex h-20 w-20 items-center justify-center rounded-full bg-white/90 text-slate-950 shadow-[0_18px_50px_rgba(0,0,0,0.35)]">
                      <Film className="h-8 w-8" />
                    </span>
                  </button>
                ) : (
                  <video
                    src={selectedWork.url}
                    poster={selectedWork.thumbnailUrl || getVideoFallbackThumbnail(selectedWork)}
                    controls
                    autoPlay
                    className="relative z-10 h-full w-full object-contain"
                  />
                )
              ) : (
                <img
                  src={selectedWork.thumbnailUrl || selectedWork.url}
                  alt={(selectedWork.prompt || '').slice(0, 30)}
                  className="relative z-10 h-full w-full cursor-zoom-in object-contain"
                  onClick={() => openFullscreenPreview(selectedWork.url, selectedWork.thumbnailUrl)}
                  onContextMenu={(event) => openImageMenu(event, selectedWork.url)}
                />
              )}
              {!isVideoWork(selectedWork) && (
                <ImageMetadataBadge
                  src={selectedWork.url}
                  width={selectedWork.width}
                  height={selectedWork.height}
                  loadMetadata={false}
                  className="absolute right-4 top-4 z-20"
                />
              )}
              {/* Fullscreen button overlay */}
              {!isVideoWork(selectedWork) && (
                <button
                  onClick={() => openFullscreenPreview(selectedWork.url, selectedWork.thumbnailUrl)}
                  className="absolute bottom-4 right-4 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white shadow-lg backdrop-blur-md transition-colors hover:bg-black/70"
                >
                  <Maximize2 className="h-5 w-5 text-white" />
                </button>
              )}
            </div>

            {/* Right: Info Panel */}
            <div className="gallery-detail-panel relative z-10 flex w-[410px] shrink-0 flex-col overflow-hidden border-l border-white/[0.07] bg-[#0a0d12]/74 backdrop-blur-2xl light:border-amber-900/14 light:bg-white/28">
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#0a0d12]/46 via-[#0a0d12]/72 to-[#0a0d12]/86 light:from-white/8 light:via-white/24 light:to-white/42" />
              {/* Close header */}
              <div className={`${detailGlassBlock} relative z-10 m-4 mb-0 flex items-center gap-2 px-4 py-3`}>
                <button
                  onClick={() => setSelectedWork(null)}
                  className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-white/[0.07]"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <h2 className="font-serif text-lg font-semibold">作品详情</h2>
                <button
                  onClick={() => setSelectedWork(null)}
                  className="ml-auto flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-white/[0.07]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="gallery-detail-content relative z-10 flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-4">
                {/* Publisher info */}
                <div className={`${detailGlassBlock} flex shrink-0 items-center gap-3 p-4`}>
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 text-sm font-semibold text-primary ring-1 ring-primary/25">
                    {selectedWork.publisherAvatarUrl ? (
                      <img
                        src={selectedWork.publisherAvatarUrl}
                        alt={selectedWork.publisherNickname}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      getAvatarText(selectedWork.publisherNickname)
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold">{selectedWork.publisherNickname}</p>
                    <p className="flex items-center gap-1 text-xs text-slate-400 light:text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {formatDate(selectedWork.publishedAt)}
                    </p>
                  </div>
                </div>

                {getStyleLabelFromParams(selectedWork.params) && (
                  <div className={`${detailGlassBlock} shrink-0 p-4`}>
                    <Badge variant="outline" className="text-xs">
                      风格：{getStyleLabelFromParams(selectedWork.params)}
                    </Badge>
                  </div>
                )}

                {/* Prompt */}
                {(selectedWork.prompt || selectedWork.negativePrompt) && (
                  <div className={`${detailGlassBlock} flex min-h-0 flex-1 flex-col space-y-4 p-4`}>
                    {selectedWork.prompt && (
                      <div className="flex min-h-0 flex-1 flex-col space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="flex items-center gap-2 text-sm font-medium text-slate-400 light:text-muted-foreground">
                            <MessageSquare className="h-4 w-4 text-primary" />
                            提示词
                          </p>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 gap-1 px-2 text-xs"
                            onClick={() => copyGalleryText(selectedWork.prompt || '', '提示词已复制')}
                          >
                            <Copy className="h-3 w-3" />复制
                          </Button>
                        </div>
                        <div className={`${detailGlassInner} min-h-0 flex-1 overflow-y-auto p-3`}>
                          <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-100 light:text-foreground">{selectedWork.prompt}</p>
                        </div>
                      </div>
                    )}
                    {selectedWork.negativePrompt && (
                      <div className="shrink-0 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="flex items-center gap-2 text-sm font-medium text-slate-400 light:text-muted-foreground">
                            <X className="h-4 w-4 text-destructive" />
                            负面提示词
                          </p>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 gap-1 px-2 text-xs"
                            onClick={() => copyGalleryText(selectedWork.negativePrompt || '', '负面提示词已复制')}
                          >
                            <Copy className="h-3 w-3" />复制
                          </Button>
                        </div>
                        <div className={`${detailGlassInner} max-h-28 overflow-y-auto p-3`}>
                          <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-300 light:text-foreground/75">
                            {selectedWork.negativePrompt}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Reference Image */}
                {selectedReferenceImages.length > 0 && (
                  <div className={`${detailGlassBlock} shrink-0 p-4`}>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <ImageIcon className="h-4 w-4 text-primary" />
                        <p className="text-sm font-medium text-slate-100 light:text-foreground">参考图</p>
                      </div>
                      <span className="text-xs text-slate-400 light:text-muted-foreground">{selectedReferenceImages.length} 张</span>
                    </div>
                    <div className="grid max-h-[240px] grid-cols-2 gap-2 overflow-y-auto pr-1">
                      {selectedReferenceImages.map((url, index) => (
                        <div key={`${url}-${index}`} className={`${detailGlassInner} group relative overflow-hidden`}>
                          <ReferencePreviewImage
                            thumbnailSrc={selectedReferenceImageThumbnails[index]}
                            src={url}
                            alt={`参考图 ${index + 1}`}
                            className="aspect-square w-full cursor-zoom-in object-cover"
                            onClick={() => setReferencePreviewSrc(url)}
                            onContextMenu={(event) => event.preventDefault()}
                          />
                          <div className="absolute inset-x-0 bottom-0 flex justify-end gap-1 bg-black/35 p-1 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100">
                            <button
                              className="flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-black"
                              onClick={() => setReferencePreviewSrc(url)}
                              title="查看参考图"
                            >
                              <Maximize2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className={`${detailGlassBlock} mt-auto shrink-0 space-y-4 p-4`}>
                  {/* Model & Params */}
                  {selectedWork.params && Object.keys(selectedWork.params).length > 0 && (
                    <div>
                      <div className="mb-3 flex items-center gap-2">
                      <Cpu className="h-4 w-4 text-primary" />
                      <p className="text-sm font-medium text-slate-100 light:text-foreground">模型与参数</p>
                      </div>
                      <div className="grid max-h-36 grid-cols-2 gap-3 overflow-y-auto text-sm">
                      {(!!selectedWork.params.modelLabel || !!selectedWork.params.model) && (
                        <div>
                          <p className="text-xs text-slate-500 light:text-muted-foreground/80">模型</p>
                          <p className="font-medium text-slate-100 light:text-foreground">{String(selectedWork.params.modelLabel || selectedWork.params.model || '')}</p>
                        </div>
                      )}
                      <div>
                        <p className="text-xs text-slate-500 light:text-muted-foreground/80">类型</p>
                        <Badge variant="secondary">{getCategoryLabel(selectedWork)}</Badge>
                      </div>
                      {!!selectedWork.params.size && (
                        <div>
                          <p className="text-xs text-slate-500 light:text-muted-foreground/80">尺寸</p>
                          <p className="text-slate-100 light:text-foreground">{String(selectedWork.params.size)}</p>
                        </div>
                      )}
                      {!!selectedWork.params.steps && (
                        <div>
                          <p className="text-xs text-slate-500 light:text-muted-foreground/80">步数</p>
                          <p className="text-slate-100 light:text-foreground">{String(selectedWork.params.steps)}</p>
                        </div>
                      )}
                      {!!selectedWork.params.cfg_scale && (
                        <div>
                          <p className="text-xs text-slate-500 light:text-muted-foreground/80">引导系数</p>
                          <p className="text-slate-100 light:text-foreground">{String(selectedWork.params.cfg_scale)}</p>
                        </div>
                      )}
                      {!!selectedWork.params.seed && (
                        <div>
                          <p className="text-xs text-slate-500 light:text-muted-foreground/80">种子</p>
                          <p className="text-slate-100 light:text-foreground">{String(selectedWork.params.seed)}</p>
                        </div>
                      )}
                      </div>
                    </div>
                  )}

                  <div className="gallery-detail-actions flex flex-wrap items-center justify-end gap-3 border-t border-white/[0.07] light:border-amber-900/14 pt-4">
                    <Button
                      size="sm"
                      variant={likedIds.has(selectedWork.id) ? 'default' : 'outline'}
                      className="mr-auto h-9 min-w-[92px] gap-1.5 px-3 text-sm font-semibold"
                      onClick={() => toggleLike(selectedWork.id)}
                    >
                      <Heart className={`h-3.5 w-3.5 ${likedIds.has(selectedWork.id) ? 'fill-current' : ''}`} />
                      {selectedWork.likes + (likedIds.has(selectedWork.id) ? 1 : 0)}
                    </Button>
                    <Button
                      size="sm"
                      className="h-9 min-w-[112px] gap-1.5 px-3 text-sm font-semibold"
                      onClick={() => handleDownload(selectedWork.url, getDownloadFilename(selectedWork))}
                    >
                      <Download className="h-3.5 w-3.5" />
                      下载{isVideoWork(selectedWork) ? '视频' : '图片'}
                    </Button>
                    {isAdmin && apiWorkIds.has(selectedWork.id) && (
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-9 min-w-[92px] gap-1.5 px-3 text-sm font-semibold"
                        onClick={(e) => handleDeleteGalleryWorks([selectedWork.id], e)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        删除
                      </Button>
                    )}
                    <Button
                      size="sm"
                      className="h-9 min-w-[112px] gap-1.5 px-3 text-sm font-semibold"
                      onClick={(e) => handleReuseGalleryWork(selectedWork, e)}
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      一键复用
                    </Button>
                  </div>
                    </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Fullscreen image preview overlay */}
      <FullscreenPreview
        src={fullscreenSrc || ''}
        fallbackSrc={fullscreenFallbackSrc}
        alt="全屏预览"
        open={!!fullscreenSrc}
        onClose={() => {
          setFullscreenSrc(null);
          setFullscreenFallbackSrc(null);
        }}
      />
      <FullscreenPreview
        src={referencePreviewSrc || ''}
        fallbackSrc={null}
        alt="参考图预览"
        open={!!referencePreviewSrc}
        onClose={() => setReferencePreviewSrc(null)}
        disableContextMenu
      />
      {ImageActionsContextMenu}
    </div>
  );
}
