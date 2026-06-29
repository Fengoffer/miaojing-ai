'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { type CreationRecord, deleteCreationRecord, getCreationMode, isPlaceholder, shareToGallery, isUrlPublished } from '@/lib/creation-history-store';
import { buildCreationReuseDraft, writeCreationReuseDraft, type CreationReuseTarget } from '@/lib/creation-reuse';
import { copyTextToClipboard, downloadFile, getImageDownloadExtension } from '@/lib/utils';
import { useAuth } from '@/lib/auth-store';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Download, Copy, FileSearch, ImageOff, Film, ImageIcon, Share2, CheckCircle2, Maximize2, RotateCcw, PencilLine, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { FullscreenPreview } from '@/components/fullscreen-preview';
import { ImageMetadataBadge } from '@/components/image-metadata-badge';
import { useImageActionsContextMenu } from '@/components/image-actions-context-menu';
import { ReferencePreviewImage } from '@/components/reference-preview-image';

interface CreationDetailDialogProps {
  record: CreationRecord | null;
  open: boolean;
  onClose: () => void;
  onPublishChange?: () => void;
  onDelete?: (record: CreationRecord) => void | Promise<void>;
}

function parseAspectRatio(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return width / height;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x || 1;
}

function formatAspectRatio(width: number, height: number): string | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;

  const commonRatios = [
    { label: '1:1', value: 1 },
    { label: '3:4', value: 3 / 4 },
    { label: '4:3', value: 4 / 3 },
    { label: '9:16', value: 9 / 16 },
    { label: '16:9', value: 16 / 9 },
    { label: '2:3', value: 2 / 3 },
    { label: '3:2', value: 3 / 2 },
  ];
  const ratio = width / height;
  const matched = commonRatios.find(item => Math.abs(item.value - ratio) < 0.035);
  if (matched) return matched.label;

  const divisor = gcd(width, height);
  const ratioWidth = Math.round(width / divisor);
  const ratioHeight = Math.round(height / divisor);
  if (ratioWidth <= 64 && ratioHeight <= 64) return `${ratioWidth}:${ratioHeight}`;
  return ratio.toFixed(2);
}

function parseDimensions(value: unknown): { width: number; height: number } | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value);
  const match = text.match(/(\d{2,5})\s*[x×*]\s*(\d{2,5})/i);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { width, height };
}

function getConfiguredAspectRatio(params: Record<string, unknown>, prompt: string): string | null {
  const keys = ['aspectRatio', 'aspect_ratio', 'ratio', 'imageRatio', 'videoRatio'];
  for (const key of keys) {
    const value = params[key];
    if (typeof value === 'string' && value.trim()) {
      const ratioText = value.trim();
      if (parseAspectRatio(ratioText)) return ratioText;
    }
  }

  const sizeKeys = ['resolution', 'size', 'imageSize', 'videoSize', 'dimensions'];
  for (const key of sizeKeys) {
    const dimensions = parseDimensions(params[key]);
    if (dimensions) return formatAspectRatio(dimensions.width, dimensions.height);
  }

  const promptMatch = prompt.match(/(?:aspect\s*ratio|画面比例|比例)\s*[:：]\s*(\d+(?:\.\d+)?\s*:\s*\d+(?:\.\d+)?)/i);
  if (promptMatch) {
    const ratioText = promptMatch[1].replace(/\s+/g, '');
    if (parseAspectRatio(ratioText)) return ratioText;
  }

  return null;
}

function getRecordReferenceImages(record: CreationRecord): string[] {
  const fromArray = Array.isArray(record.referenceImages) ? record.referenceImages : [];
  const fromParams = Array.isArray(record.params?.referenceImages)
    ? (record.params.referenceImages as unknown[]).filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
  const single = record.referenceImage && !isPlaceholder(record.referenceImage)
    ? [record.referenceImage]
    : typeof record.params?.referenceImage === 'string' && !isPlaceholder(record.params.referenceImage)
      ? [record.params.referenceImage]
      : [];
  return [...new Set([...single, ...fromArray, ...fromParams].filter(url => url && !url.startsWith('[')))];
}

function getRecordReferenceImageThumbnails(record: CreationRecord): string[] {
  const fromRecord = Array.isArray(record.referenceImageThumbnails) ? record.referenceImageThumbnails : [];
  const fromParams = Array.isArray(record.params?.referenceImageThumbnails)
    ? (record.params.referenceImageThumbnails as unknown[]).filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
  return [...new Set([...fromRecord, ...fromParams].filter(url => url && !url.startsWith('data:') && !url.startsWith('[')))];
}

function getReuseTarget(record: CreationRecord): CreationReuseTarget | null {
  if (record.type === 'image') {
    const mode = getCreationMode(record);
    return mode === 'img2img' ? 'img2img' : 'text2img';
  }
  if (record.type === 'video') {
    const mode = getCreationMode(record);
    return mode === 'img2video' ? 'img2video' : 'text2video';
  }
  return null;
}

export function CreationDetailDialog({ record, open, onClose, onPublishChange, onDelete }: CreationDetailDialogProps) {
  const router = useRouter();
  const { user } = useAuth();
  const [isPublished, setIsPublished] = useState(false);
  const [fullscreenSrc, setFullscreenSrc] = useState<string | null>(null);
  const [fullscreenFallbackSrc, setFullscreenFallbackSrc] = useState<string | null>(null);
  const [mediaAspectRatio, setMediaAspectRatio] = useState<number | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 1280, height: 900 });
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const { openImageMenu, ImageActionsContextMenu } = useImageActionsContextMenu();

  const openFullscreenPreview = useCallback((src: string, fallbackSrc?: string | null) => {
    setFullscreenFallbackSrc(fallbackSrc || null);
    setFullscreenSrc(src);
  }, []);

  useEffect(() => {
    if (record) {
      setIsPublished(isUrlPublished(record.url));
    }
  }, [record]);

  useEffect(() => {
    if (!open) {
      setFullscreenSrc(null);
      setFullscreenFallbackSrc(null);
    }
  }, [open]);

  useEffect(() => {
    setFullscreenSrc(null);
    setFullscreenFallbackSrc(null);
    setMediaAspectRatio(null);
  }, [record?.url]);

  useEffect(() => {
    const updateViewportSize = () => {
      setViewportSize({ width: window.innerWidth, height: window.innerHeight });
    };

    updateViewportSize();
    window.addEventListener('resize', updateViewportSize);
    return () => window.removeEventListener('resize', updateViewportSize);
  }, []);

  if (!record) return null;

  const isReversePromptRecord = record.type === 'reverse-prompt';
  const referenceImages = getRecordReferenceImages(record);
  const referenceImageThumbnails = getRecordReferenceImageThumbnails(record);

  const handleDownload = async () => {
    const url = record.url;
    if (isPlaceholder(url)) {
      toast.error('图片链接已过期，无法下载');
      return;
    }

    const ext = record.type === 'video'
      ? 'mp4'
      : getImageDownloadExtension(
        url,
        typeof record.params?.outputFormat === 'string' ? record.params.outputFormat : undefined,
      );
    const filename = `miaojing-${Date.now()}.${ext}`;
    const result = await downloadFile(url, filename);
    if (result.ok) {
      toast.success('下载成功');
    } else {
      toast.error(result.error || '下载失败，请重试');
    }
  };

  const handleCopyPrompt = async () => {
    if (!record.prompt) return;
    const copyResult = await copyTextToClipboard(record.prompt);
    if (copyResult === 'copied') {
      toast.success('提示词已复制');
    } else if (copyResult === 'manual') {
      toast.info('已选中提示词，请按 Ctrl+C 复制');
    } else {
      toast.error('复制失败，请手动选择文本复制');
    }
  };

  const handleCopyNegativePrompt = async () => {
    if (!record.negativePrompt) return;
    const copyResult = await copyTextToClipboard(record.negativePrompt);
    if (copyResult === 'copied') {
      toast.success('反向提示词已复制');
    } else if (copyResult === 'manual') {
      toast.info('已选中反向提示词，请按 Ctrl+C 复制');
    } else {
      toast.error('复制失败，请手动选择文本复制');
    }
  };

  const handleShareToGallery = async () => {
    if (record.type === 'reverse-prompt') {
      toast.info('图片反推记录不能分享到画廊');
      return;
    }
    if (isPublished) {
      toast.info('该作品已分享到画廊');
      return;
    }
    try {
      await shareToGallery({
        type: record.type as 'image' | 'video',
        url: record.url,
        prompt: record.prompt,
        model: record.model,
        modelLabel: record.modelLabel,
        publisherId: user?.id,
        publisherNickname: user?.nickname || user?.username || user?.email?.split('@')[0] || '匿名用户',
        negativePrompt: record.negativePrompt,
        referenceImage: record.referenceImage,
        referenceImages: record.referenceImages,
        thumbnailUrl: record.thumbnailUrl,
        width: record.width,
        height: record.height,
        params: record.params,
      });
      setIsPublished(true);
      onPublishChange?.();
      toast.success('已分享到画廊');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '分享失败，请重试');
    }
  };

  const handleReuseConfig = () => {
    const target = getReuseTarget(record);
    if (!target) {
      toast.info('当前作品暂不支持复用配置');
      return;
    }
    const draft = buildCreationReuseDraft(record, target, {
      source: 'creation-detail',
      useOutputAsReference: target === 'img2img' || target === 'img2video',
    });
    writeCreationReuseDraft(target, draft);
    onClose();
    router.push(`/create?type=${target}&reuse=${encodeURIComponent(record.id)}`);
    const targetLabel: Record<CreationReuseTarget, string> = {
      text2img: '文生图',
      img2img: '图生图',
      text2video: '文生视频',
      img2video: '图生视频',
    };
    toast.success(`已填入${targetLabel[target]}`);
  };

  const handleEditOutput = () => {
    if (record.type !== 'image' || isPlaceholder(record.url)) {
      toast.info('当前作品没有可用图片，无法作为图生图参考图');
      return;
    }
    const draft = buildCreationReuseDraft(record, 'img2img', { source: 'creation-detail', useOutputAsReference: true });
    writeCreationReuseDraft('img2img', draft);
    onClose();
    router.push(`/create?type=img2img&reuse=${encodeURIComponent(record.id)}`);
    toast.success('已填入图生图');
  };

  const handleDeleteWork = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      if (onDelete) {
        await onDelete(record);
      } else {
        await deleteCreationRecord(record.id);
      }
      setDeleteConfirmOpen(false);
      onClose();
      toast.success('作品已删除');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除失败，请重试');
    } finally {
      setDeleting(false);
    }
  };

  const deleteConfirmDialog = (
    <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认删除作品？</AlertDialogTitle>
          <AlertDialogDescription>
            删除该作品后将无法恢复，相关创作历史也会从服务器删除。是否确认删除？
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={deleting}
            onClick={(event) => {
              event.preventDefault();
              void handleDeleteWork();
            }}
          >
            {deleting ? '删除中' : '确认删除'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  if (isReversePromptRecord) {
    const displayCreatedAt = new Date(record.createdAt).toLocaleString('zh-CN');
    const referenceImage = record.referenceImage && !isPlaceholder(record.referenceImage) ? record.referenceImage : null;

    return (
      <>
        <Dialog open={open && !fullscreenSrc} onOpenChange={(v) => !v && onClose()}>
          <DialogContent className="!max-w-[1100px] max-h-[92vh] overflow-hidden">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileSearch className="h-5 w-5" />
                图片反推详情
              </DialogTitle>
            </DialogHeader>

            <div className="grid min-h-[560px] gap-5 overflow-hidden md:grid-cols-[minmax(280px,420px)_minmax(0,1fr)]">
              <div className="flex min-h-0 flex-col gap-3 overflow-hidden">
                <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl border border-border bg-black/20">
                  {referenceImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={referenceImage}
                      alt="参考图片"
                      className="h-full w-full cursor-zoom-in object-contain"
                      onClick={() => openFullscreenPreview(referenceImage)}
                      onContextMenu={(event) => openImageMenu(event, referenceImage)}
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <FileSearch className="h-14 w-14 opacity-30" />
                      <p className="text-sm">参考图片未持久化，仅保留反推提示词</p>
                    </div>
                  )}
                  {referenceImage && (
                    <button
                      onClick={() => openFullscreenPreview(referenceImage)}
                      className="absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/40 transition-colors hover:bg-black/60"
                    >
                      <Maximize2 className="h-4 w-4 text-white" />
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 gap-2 text-sm leading-5 text-muted-foreground">
                  <div>时间：{displayCreatedAt}</div>
                  <div>类型：图片反推</div>
                  <div>模型：{record.modelLabel || record.model || '-'}</div>
                </div>
              </div>

              <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card/40 p-4">
                <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
                  <div className="flex min-h-0 flex-1 flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-muted-foreground">正向提示词</p>
                      <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-xs" onClick={handleCopyPrompt}>
                        <Copy className="h-3 w-3" />复制
                      </Button>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border bg-muted/50 p-3">
                      <p className="whitespace-pre-wrap break-words text-sm leading-6">{record.prompt || '（无提示词）'}</p>
                    </div>
                  </div>

                  {record.negativePrompt && (
                    <div className="flex max-h-[180px] shrink-0 flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-muted-foreground">反向提示词</p>
                        <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-xs" onClick={handleCopyNegativePrompt}>
                          <Copy className="h-3 w-3" />复制
                        </Button>
                      </div>
                      <div className="overflow-y-auto rounded-md border border-border bg-muted/50 p-3">
                        <p className="whitespace-pre-wrap break-words text-sm leading-6">{record.negativePrompt}</p>
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-4 flex justify-end gap-2 border-t border-border pt-4">
                  <Button className="h-10 min-w-[102px] gap-1.5 px-3 text-sm font-semibold" onClick={handleCopyPrompt}>
                    <Copy className="h-3.5 w-3.5" />
                    复制提示词
                  </Button>
                  <Button
                    variant="destructive"
                    className="h-10 min-w-[102px] gap-1.5 px-3 text-sm font-semibold"
                    onClick={() => setDeleteConfirmOpen(true)}
                    disabled={deleting}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {deleting ? '删除中' : '删除作品'}
                  </Button>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>

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
        {ImageActionsContextMenu}
        {deleteConfirmDialog}
      </>
    );
  }

  const isPlaceholderUrl = isPlaceholder(record.url);
  const configuredAspectRatioText = getConfiguredAspectRatio(record.params, record.prompt);
  const configuredAspectRatio = parseAspectRatio(configuredAspectRatioText);
  const previewAspectRatio = mediaAspectRatio || configuredAspectRatio || 1;
  const isSquarePreview = previewAspectRatio >= 0.95 && previewAspectRatio <= 1.05;
  const squarePreviewSize = Math.round(
    Math.max(
      360,
      Math.min(
        760,
        viewportSize.height * 0.78,
        viewportSize.width * 0.96 - 500 - 20 - 104,
      ),
    ),
  );
  const squarePanelSize = squarePreviewSize;
  const detailPanelHeight = isSquarePreview
    ? squarePanelSize
    : Math.round(Math.max(560, Math.min(860, viewportSize.height * 0.82)));
  const nonSquareMaxPreviewWidth = Math.max(
    1,
    Math.min(1180, viewportSize.width * 0.96 - 500 - 20 - 104, viewportSize.width * 0.92),
  );
  const nonSquarePreviewWidth = Math.round(
    Math.max(1, Math.min(nonSquareMaxPreviewWidth, detailPanelHeight * previewAspectRatio)),
  );
  const nonSquarePreviewHeight = Math.round(nonSquarePreviewWidth / previewAspectRatio);
  const previewFrameStyle = isSquarePreview
    ? {
        width: `${squarePreviewSize}px`,
        height: `${squarePreviewSize}px`,
        minHeight: `${squarePreviewSize}px`,
        maxHeight: `${squarePreviewSize}px`,
      }
    : {
        width: `${nonSquarePreviewWidth}px`,
        height: `${nonSquarePreviewHeight}px`,
        minHeight: `${nonSquarePreviewHeight}px`,
        maxHeight: `${nonSquarePreviewHeight}px`,
      };
  const previewShellStyle = isSquarePreview
    ? {
        width: `${squarePanelSize}px`,
        height: `${squarePanelSize}px`,
        minHeight: `${squarePanelSize}px`,
        maxHeight: `${squarePanelSize}px`,
      }
    : {
        width: `${nonSquarePreviewWidth}px`,
        height: `${detailPanelHeight}px`,
        minHeight: `${detailPanelHeight}px`,
        maxHeight: `${detailPanelHeight}px`,
      };
  const contentPanelStyle = {
    height: `${detailPanelHeight}px`,
    minHeight: `${detailPanelHeight}px`,
    maxHeight: `${detailPanelHeight}px`,
  };
  const detailLayoutStyle = {
    height: `${detailPanelHeight}px`,
    minHeight: `${detailPanelHeight}px`,
    maxHeight: `${detailPanelHeight}px`,
  };
  const detailLayoutClassName = isSquarePreview
    ? 'mt-2 flex min-w-0 items-start gap-5 overflow-hidden'
    : 'mt-2 grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,auto)_500px]';
  const previewShellClassName = isSquarePreview
    ? 'mx-auto box-border flex max-w-full min-w-0 self-start flex-col items-center justify-start overflow-visible'
    : 'mx-auto box-border flex max-w-full min-w-0 self-start flex-col items-center justify-center space-y-4 overflow-visible';
  const contentPanelClassName = `flex min-w-0 self-start flex-col overflow-hidden rounded-xl border border-border bg-card/40 p-4 ${
    isSquarePreview ? '' : ''
  }`;
  const displayCreatedAt = new Date(record.createdAt).toLocaleString('zh-CN');
  const displayAspectRatio =
    configuredAspectRatioText ||
    (mediaAspectRatio ? formatAspectRatio(mediaAspectRatio, 1) : null) ||
    '-';
  const displayResolution =
    record.params?.resolution !== undefined && record.params.resolution !== null && String(record.params.resolution).trim()
      ? String(record.params.resolution)
      : '-';
  const styleLabel = typeof record.params?.styleLabel === 'string' && record.params.styleLabel.trim()
    ? record.params.styleLabel.trim()
    : '';
  const visibleParamEntries = Object.entries(record.params).filter(
    ([key]) => !['aspectRatio', 'aspect_ratio', 'ratio', 'imageRatio', 'videoRatio', 'resolution', 'styleLabel'].includes(key),
  );

  return (
    <>
      <Dialog open={open && !fullscreenSrc} onOpenChange={(v) => !v && onClose()}>
        <DialogContent
          className="!w-fit !max-w-[96vw] max-h-[94vh] overflow-hidden"
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {record.type === 'image' ? (
                <ImageIcon className="h-5 w-5" />
              ) : (
                <Film className="h-5 w-5" />
              )}
              创作详情
            </DialogTitle>
          </DialogHeader>

          <div className={detailLayoutClassName} style={detailLayoutStyle}>
            <div
              className={previewShellClassName}
              style={previewShellStyle}
            >
            {/* Media Preview */}
            <div
              className="group relative flex max-w-full shrink-0 items-center justify-center overflow-hidden rounded-lg"
              style={previewFrameStyle}
            >
              {isPlaceholderUrl ? (
                <div className="flex h-full w-full flex-col items-center justify-center py-16 text-muted-foreground">
                  <ImageOff className="h-12 w-12 mb-3 opacity-30" />
                  <p className="text-sm">图片链接已过期</p>
                </div>
              ) : record.type === 'image' ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={record.thumbnailUrl || record.url}
                  alt={record.prompt}
                  className="h-full w-full cursor-zoom-in object-contain"
                  onLoad={(event) => {
                    const img = event.currentTarget;
                    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                      setMediaAspectRatio(img.naturalWidth / img.naturalHeight);
                    }
                  }}
                  onClick={() => openFullscreenPreview(record.url, record.thumbnailUrl)}
                  onContextMenu={(event) => openImageMenu(event, record.url)}
                />
              ) : (
                <video
                  src={record.url}
                  controls
                  playsInline
                  preload="metadata"
                  className="h-full w-full object-contain"
                  onLoadedMetadata={(event) => {
                    const video = event.currentTarget;
                    if (video.videoWidth > 0 && video.videoHeight > 0) {
                      setMediaAspectRatio(video.videoWidth / video.videoHeight);
                    }
                  }}
                />
              )}
              {/* Fullscreen button */}
              {!isPlaceholderUrl && record.type === 'image' && (
                <ImageMetadataBadge
                  src={record.url}
                  width={record.width}
                  height={record.height}
                  loadMetadata={false}
                  className="absolute right-3 top-3 z-20"
                />
              )}
              {!isPlaceholderUrl && record.type === 'image' && (
                <button
                  onClick={() => openFullscreenPreview(record.url, record.thumbnailUrl)}
                  className="absolute bottom-3 right-3 h-9 w-9 rounded-full bg-black/40 hover:bg-black/60 flex items-center justify-center transition-colors opacity-0 group-hover:opacity-100"
                >
                  <Maximize2 className="h-4 w-4 text-white" />
                </button>
              )}
            </div>

            {/* Reference Images */}
            {referenceImages.length > 0 && (
              <div className="w-full space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-muted-foreground">参考图</p>
                  <span className="text-xs text-muted-foreground">{referenceImages.length} 张</span>
                </div>
                <div className="grid max-h-[190px] grid-cols-3 gap-2 overflow-y-auto pr-1">
                  {referenceImages.map((url, index) => (
                    <div key={`${url}-${index}`} className="group relative overflow-hidden rounded-lg border border-border bg-muted">
                      <ReferencePreviewImage
                        thumbnailSrc={referenceImageThumbnails[index]}
                        src={url}
                        alt={`参考图 ${index + 1}`}
                        className="aspect-square w-full cursor-zoom-in object-cover"
                        onClick={() => openFullscreenPreview(url)}
                        onContextMenu={(event) => openImageMenu(event, url)}
                      />
                      <div className="absolute inset-x-0 bottom-0 flex justify-end gap-1 bg-black/35 p-1 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100">
                        <button
                          onClick={() => openFullscreenPreview(url)}
                          className="flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-black"
                        >
                          <Maximize2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            </div>

            <div
              className={`${contentPanelClassName} ${isSquarePreview ? 'w-[500px] flex-none' : ''}`}
              style={contentPanelStyle}
            >
              <div className="flex min-h-0 flex-1 flex-col space-y-4 overflow-hidden pr-1">

            {/* Prompt */}
            <div className="flex min-h-0 flex-1 flex-col space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-muted-foreground">提示词</p>
                <Button variant="ghost" size="sm" className="h-6 px-2 text-xs gap-1" onClick={handleCopyPrompt}>
                  <Copy className="h-3 w-3" />复制
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto rounded-md bg-muted/50 border border-border p-3">
                <p className="text-sm leading-6 whitespace-pre-wrap break-words">{record.prompt || '（无提示词）'}</p>
              </div>
            </div>

            {/* Negative Prompt */}
            {record.negativePrompt && (
              <div className="shrink-0 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-muted-foreground">负面提示词</p>
                  <Button variant="ghost" size="sm" className="h-6 px-2 text-xs gap-1" onClick={handleCopyNegativePrompt}>
                    <Copy className="h-3 w-3" />复制
                  </Button>
                </div>
                <div className="max-h-28 overflow-y-auto rounded-md bg-muted/50 border border-border p-3">
                  <p className="text-sm leading-6 whitespace-pre-wrap break-words">{record.negativePrompt}</p>
                </div>
              </div>
            )}
              </div>

              <div className="mt-auto shrink-0 space-y-3 border-t border-border pt-4">

            {/* Meta Info */}
            <div className="flex max-h-28 flex-wrap items-center justify-start gap-2 overflow-y-auto">
              <Badge variant="outline">
                {record.type === 'image' ? '图片' : '视频'}
              </Badge>
              <Badge variant="secondary">
                {record.modelLabel}
              </Badge>
              {record.isCustomModel && (
                <Badge variant="outline" className="border-dashed text-xs">
                  自定义模型
                </Badge>
              )}
              {styleLabel && (
                <Badge variant="outline" className="text-xs">
                  风格：{styleLabel}
                </Badge>
              )}
              {isPublished && (
                <Badge variant="default" className="gap-1">
                  <CheckCircle2 className="h-3 w-3" />已分享
                </Badge>
              )}
              {visibleParamEntries.map(([k, v]) => (
                <Badge key={k} variant="outline" className="text-xs">
                  {k}={String(v)}
                </Badge>
              ))}
            </div>

            {/* Actions */}
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3 pt-1">
              <div className="min-w-0 space-y-1 text-sm leading-5 text-muted-foreground">
                <div className="whitespace-nowrap">时间：{displayCreatedAt}</div>
                <div className="flex flex-nowrap gap-x-4 whitespace-nowrap">
                  <span>尺寸：{displayAspectRatio}</span>
                  <span>分辨率：{displayResolution}</span>
                </div>
              </div>
              <div className="flex max-w-[500px] shrink-0 flex-wrap justify-end gap-2">
                <Button
                  variant="secondary"
                  className="h-10 min-w-[102px] gap-1.5 px-3 text-sm font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-300"
                  onClick={handleReuseConfig}
                  disabled={!getReuseTarget(record)}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  复用配置
                </Button>
                <Button
                  variant="secondary"
                  className="h-10 min-w-[102px] gap-1.5 px-3 text-sm font-semibold text-emerald-600 hover:text-emerald-700 dark:text-emerald-300"
                  onClick={handleEditOutput}
                  disabled={record.type !== 'image' || isPlaceholderUrl}
                >
                  <PencilLine className="h-3.5 w-3.5" />
                  编辑输出
                </Button>
                <Button
                  variant="destructive"
                  className="h-10 min-w-[102px] gap-1.5 px-3 text-sm font-semibold"
                  onClick={() => setDeleteConfirmOpen(true)}
                  disabled={deleting}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {deleting ? '删除中' : '删除作品'}
                </Button>
                <Button className="h-10 min-w-[102px] gap-1.5 px-3 text-sm font-semibold" onClick={handleDownload} disabled={isPlaceholderUrl}>
                  <Download className="h-3.5 w-3.5" />
                  下载{record.type === 'image' ? '图片' : '视频'}
                </Button>
                <Button
                  variant={isPublished ? 'secondary' : 'outline'}
                  className="h-10 min-w-[102px] gap-1.5 px-3 text-sm font-semibold"
                  onClick={handleShareToGallery}
                  disabled={isPublished}
                >
                  {isPublished ? (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      已分享
                    </>
                  ) : (
                    <>
                      <Share2 className="h-3.5 w-3.5" />
                      分享到画廊
                    </>
                  )}
                </Button>
              </div>
            </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
      {ImageActionsContextMenu}
      {deleteConfirmDialog}
    </>
  );
}
