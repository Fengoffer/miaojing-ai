'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ArrowLeft, Image as ImageIcon, Loader2, Search, Sparkles, X } from 'lucide-react';
import { buildCreationReuseDraft, type CreationReuseTarget, writeCreationReuseDraft } from '@/lib/creation-reuse';
import { useImageActionsContextMenu } from '@/components/image-actions-context-menu';
import { FullscreenPreview } from '@/components/fullscreen-preview';
import { toast } from 'sonner';

type InspirationWork = {
  id: string;
  type: string;
  prompt?: string | null;
  negativePrompt?: string | null;
  url: string;
  thumbnailUrl?: string | null;
  duration?: number | null;
  params: Record<string, unknown>;
  referenceImage?: string | null;
  referenceImages?: string[];
  publisherNickname?: string | null;
  publishedAt?: string | null;
};

const MODE_LABELS: Record<CreationReuseTarget, string> = {
  text2img: '文生图',
  img2img: '图生图',
  text2video: '文生视频',
  img2video: '图生视频',
};

function getWorkMode(work: InspirationWork): CreationReuseTarget {
  const mode = work.params?.creationMode || work.params?.workType || work.params?.mode;
  if (mode === 'text2img' || mode === 'img2img' || mode === 'text2video' || mode === 'img2video') {
    return mode;
  }
  if (work.type === 'text2video' || work.type === 'img2video' || work.type === 'img2img') {
    return work.type;
  }
  const hasReference =
    Boolean(work.referenceImage) ||
    (Array.isArray(work.referenceImages) && work.referenceImages.length > 0) ||
    Boolean(work.params?.referenceImage) ||
    (Array.isArray(work.params?.referenceImages) && work.params.referenceImages.length > 0);
  if (work.type === 'video' || work.duration) return hasReference ? 'img2video' : 'text2video';
  return hasReference ? 'img2img' : 'text2img';
}

function isVideoWork(work: InspirationWork): boolean {
  const mode = getWorkMode(work);
  return mode === 'text2video' || mode === 'img2video';
}

function getInspirationReferenceImages(work: InspirationWork): string[] {
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

function formatDate(iso?: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

export function InspirationGalleryDialog({
  mode,
  open,
  onOpenChange,
}: {
  mode: CreationReuseTarget;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [works, setWorks] = useState<InspirationWork[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedWork, setSelectedWork] = useState<InspirationWork | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [referencePreviewSrc, setReferencePreviewSrc] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchCollapseTimerRef = useRef<number | null>(null);
  const { openImageMenu, ImageActionsContextMenu } = useImageActionsContextMenu();

  const clearSearchCollapseTimer = useCallback(() => {
    if (searchCollapseTimerRef.current !== null) {
      window.clearTimeout(searchCollapseTimerRef.current);
      searchCollapseTimerRef.current = null;
    }
  }, []);

  const scheduleSearchCollapse = useCallback(() => {
    clearSearchCollapseTimer();
    if (searchQuery.trim()) return;
    searchCollapseTimerRef.current = window.setTimeout(() => {
      setSearchOpen(false);
      searchCollapseTimerRef.current = null;
    }, 1000);
  }, [clearSearchCollapseTimer, searchQuery]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    fetch('/api/gallery?sort=newest&limit=300')
      .then(res => res.ok ? res.json() : Promise.reject(new Error('画廊加载失败')))
      .then(data => {
        if (!cancelled) setWorks(Array.isArray(data.works) ? data.works : []);
      })
      .catch(err => {
        if (!cancelled) toast.error(err instanceof Error ? err.message : '画廊加载失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setSelectedWork(null);
      setReferencePreviewSrc(null);
      setSearchOpen(false);
      setSearchQuery('');
      clearSearchCollapseTimer();
    }
  }, [clearSearchCollapseTimer, open]);

  useEffect(() => {
    if (!searchOpen) return;
    searchInputRef.current?.focus();
  }, [searchOpen]);

  useEffect(() => {
    return () => clearSearchCollapseTimer();
  }, [clearSearchCollapseTimer]);

  const modeWorks = useMemo(
    () => works.filter(work => getWorkMode(work) === mode),
    [works, mode],
  );

  const filteredWorks = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return modeWorks;
    return modeWorks.filter(work => {
      const haystack = [
        work.prompt,
        work.negativePrompt,
        work.publisherNickname,
        work.type,
        work.params?.model,
        work.params?.modelLabel,
        work.params?.styleLabel,
      ].map(value => String(value || '').toLowerCase()).join('\n');
      return haystack.includes(query);
    });
  }, [modeWorks, searchQuery]);

  const handleReuse = useCallback((work: InspirationWork) => {
    const draft = buildCreationReuseDraft(work, mode, {
      source: 'inspiration-gallery',
      useOutputAsReference: true,
    });
    writeCreationReuseDraft(mode, draft);
    toast.success('已带入创作参数');
    onOpenChange(false);
  }, [mode, onOpenChange]);

  const selectedReferenceImages = useMemo(
    () => selectedWork ? getInspirationReferenceImages(selectedWork) : [],
    [selectedWork],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[90vh] w-[min(96vw,1120px)] !max-w-[1120px] overflow-hidden p-0 sm:!max-w-[1120px]" showCloseButton={false}>
        <div className="flex h-full min-h-0 flex-col">
          <DialogHeader className="shrink-0 border-b border-border/60 px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <DialogTitle className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-primary" />
                  获取灵感
                </DialogTitle>
                <DialogDescription>
                  当前仅显示画廊中的{MODE_LABELS[mode]}作品
                </DialogDescription>
              </div>
              <div
                className="relative flex shrink-0 items-center gap-1.5"
                onMouseEnter={clearSearchCollapseTimer}
                onMouseLeave={scheduleSearchCollapse}
              >
                <div
                  className={`absolute right-11 top-1/2 z-10 flex h-10 -translate-y-1/2 origin-right items-center gap-2 overflow-hidden rounded-2xl border border-amber-900/12 bg-white/72 px-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.82),inset_0_0_0_1px_rgba(255,255,255,0.28),0_10px_28px_rgba(83,61,27,0.12)] backdrop-blur-xl transition-[width,opacity,transform] duration-300 ease-out focus-within:border-primary/35 focus-within:bg-white/82 dark:border-white/10 dark:bg-white/[0.07] dark:focus-within:bg-white/[0.10] ${
                    searchOpen ? 'w-[min(56vw,320px)] scale-x-100 opacity-100' : 'pointer-events-none w-0 scale-x-90 opacity-0'
                  }`}
                >
                  <input
                    ref={searchInputRef}
                    value={searchQuery}
                    onChange={(event) => {
                      setSearchQuery(event.target.value);
                      if (event.target.value.trim()) clearSearchCollapseTimer();
                    }}
                    onFocus={clearSearchCollapseTimer}
                    placeholder={`搜索当前${MODE_LABELS[mode]}作品`}
                    className="gallery-search-input h-full min-w-0 flex-1 rounded-none border-0 bg-transparent p-0 text-sm font-medium text-foreground shadow-none outline-none ring-0 placeholder:text-muted-foreground/62 focus:outline-none focus:ring-0"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                      onClick={() => setSearchQuery('')}
                      aria-label="清空搜索"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setSearchOpen(true);
                    clearSearchCollapseTimer();
                  }}
                  title="搜索"
                >
                  <Search className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </DialogHeader>

          {selectedWork ? (
            <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_380px]">
              <div className="min-h-0 overflow-hidden bg-black/10 p-5">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setSelectedWork(null)}>
                    <ArrowLeft className="h-4 w-4" />
                    返回作品
                  </Button>
                </div>
                <div className="flex h-[calc(100%-44px)] min-h-0 items-center justify-center overflow-hidden rounded-xl border border-border/70 bg-black/25">
                  {isVideoWork(selectedWork) ? (
                    <video src={selectedWork.url} controls className="h-full w-full object-contain" />
                  ) : (
                    <img
                      src={selectedWork.thumbnailUrl || selectedWork.url}
                      alt={selectedWork.prompt || '作品详情'}
                      className="h-full w-full object-contain"
                      onContextMenu={(event) => openImageMenu(event, selectedWork.url)}
                    />
                  )}
                </div>
              </div>

              <aside className="flex min-h-0 flex-col gap-3 overflow-hidden border-t border-border/60 bg-background/52 p-4 lg:border-l lg:border-t-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{selectedWork.publisherNickname || '画廊作品'}</span>
                  <span className="text-xs text-muted-foreground">{formatDate(selectedWork.publishedAt)}</span>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-border/70 bg-background/50 p-3">
                  <p className="whitespace-pre-wrap break-words text-sm leading-6">{selectedWork.prompt || '无提示词'}</p>
                  {selectedWork.negativePrompt && (
                    <p className="mt-3 border-t border-border/60 pt-3 text-xs leading-5 text-muted-foreground">
                      {selectedWork.negativePrompt}
                    </p>
                  )}
                  {selectedReferenceImages.length > 0 && (
                    <div className="mt-3 border-t border-border/60 pt-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-muted-foreground">参考图</span>
                        <span className="text-[11px] text-muted-foreground">{selectedReferenceImages.length} 张</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {selectedReferenceImages.map((url, index) => (
                          <button
                            key={`${url}-${index}`}
                            type="button"
                            className="overflow-hidden rounded-lg border border-border/60 bg-muted"
                            onClick={() => setReferencePreviewSrc(url)}
                            onContextMenu={(event) => event.preventDefault()}
                            title={`查看参考图 ${index + 1}`}
                          >
                            <img src={url} alt={`参考图 ${index + 1}`} className="aspect-square w-full object-cover" loading="lazy" />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex justify-end gap-2">
                  <Button size="sm" onClick={() => handleReuse(selectedWork)}>
                    <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                    一键复用
                  </Button>
                </div>
              </aside>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">
              {loading ? (
                <div className="flex h-full min-h-[420px] flex-col items-center justify-center text-muted-foreground">
                  <Loader2 className="mb-3 h-8 w-8 animate-spin" />
                  <span className="text-sm">正在加载画廊作品</span>
                </div>
              ) : filteredWorks.length === 0 ? (
                <div className="flex h-full min-h-[420px] flex-col items-center justify-center text-muted-foreground">
                  <ImageIcon className="mb-3 h-10 w-10 opacity-30" />
                  <span className="text-sm">{searchQuery.trim() ? '没有匹配的作品' : `暂无可复用的${MODE_LABELS[mode]}作品`}</span>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                  {filteredWorks.map(work => {
                    const previewUrl = work.thumbnailUrl || work.url;
                    const video = isVideoWork(work);
                    return (
                      <button
                        key={work.id}
                        type="button"
                        className="group overflow-hidden rounded-xl border border-border/70 bg-background/45 text-left transition hover:border-primary/50 hover:shadow-[0_14px_36px_rgba(0,0,0,0.16)]"
                        onClick={() => setSelectedWork(work)}
                      >
                        <div className="relative aspect-[4/5] overflow-hidden bg-muted">
                          {video && !work.thumbnailUrl ? (
                            <video src={previewUrl} className="h-full w-full object-cover" preload="metadata" />
                          ) : (
                            <img src={previewUrl} alt={work.prompt || '画廊作品'} className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" loading="lazy" />
                          )}
                        </div>
                        <div className="p-3">
                          <p className="line-clamp-2 min-h-10 text-xs leading-5 text-muted-foreground">{work.prompt || '无提示词'}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          {ImageActionsContextMenu}
          <FullscreenPreview
            src={referencePreviewSrc || ''}
            fallbackSrc={null}
            alt="参考图预览"
            open={!!referencePreviewSrc}
            onClose={() => setReferencePreviewSrc(null)}
            disableContextMenu
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
