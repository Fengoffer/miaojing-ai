'use client';

import { useCallback, useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Copy, Download, PencilLine, Share2 } from 'lucide-react';
import { downloadFile, copyTextToClipboard, getImageDownloadExtension } from '@/lib/utils';
import { writeCreationReuseDraft } from '@/lib/creation-reuse';
import { toast } from 'sonner';

type MenuState = {
  src: string;
  x: number;
  y: number;
} | null;

function getAbsoluteImageUrl(src: string): string {
  const trimmed = src.trim();
  if (!trimmed) return trimmed;
  if (typeof window !== 'undefined' && trimmed.startsWith('/')) {
    return `${window.location.origin}${trimmed}`;
  }
  return trimmed;
}

function getImageViewerUrl(src: string): string {
  const absoluteUrl = getAbsoluteImageUrl(src);
  if (typeof window === 'undefined') return absoluteUrl;
  const viewerUrl = new URL('/image-viewer', window.location.origin);
  viewerUrl.searchParams.set('url', absoluteUrl);
  return viewerUrl.toString();
}

async function fetchOriginalImageBlob(src: string): Promise<Blob> {
  const absoluteUrl = getAbsoluteImageUrl(src);
  const response = await fetch(`/api/download?url=${encodeURIComponent(absoluteUrl)}&filename=image.${getImageDownloadExtension(src)}`, {
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error('原图获取失败');
  }
  const blob = await response.blob();
  if (!blob.type.startsWith('image/')) {
    throw new Error('当前资源不是可复制的图片');
  }
  return blob;
}

async function copyOriginalImageToClipboard(src: string): Promise<void> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined' || !window.isSecureContext) {
    throw new Error('当前浏览器环境不支持直接复制图片');
  }
  const blob = await fetchOriginalImageBlob(src);
  const type = blob.type || 'image/png';
  if (typeof ClipboardItem.supports === 'function' && !ClipboardItem.supports(type)) {
    throw new Error('当前浏览器不支持复制该图片格式');
  }
  await navigator.clipboard.write([new ClipboardItem({ [type]: blob })]);
}

function clampMenuPosition(x: number, y: number) {
  if (typeof window === 'undefined') return { x, y };
  return {
    x: Math.min(x, window.innerWidth - 188),
    y: Math.min(y, window.innerHeight - 184),
  };
}

export function useImageActionsContextMenu() {
  const router = useRouter();
  const [menu, setMenu] = useState<MenuState>(null);

  const closeImageMenu = useCallback(() => setMenu(null), []);

  const openImageMenu = useCallback((event: ReactMouseEvent, src: string) => {
    if (!src || src.startsWith('data:') || src.startsWith('[')) return;
    event.preventDefault();
    event.stopPropagation();
    setMenu({ src, ...clampMenuPosition(event.clientX, event.clientY) });
  }, []);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('keydown', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [menu]);

  const copyImage = useCallback(async () => {
    if (!menu) return;
    try {
      await copyOriginalImageToClipboard(menu.src);
      toast.success('原图已复制到剪贴板');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '复制失败');
    } finally {
      closeImageMenu();
    }
  }, [closeImageMenu, menu]);

  const downloadImage = useCallback(async () => {
    if (!menu) return;
    const result = await downloadFile(getAbsoluteImageUrl(menu.src), `miaojing-original-${Date.now()}.${getImageDownloadExtension(menu.src)}`);
    if (result.ok) {
      toast.success('原图下载已开始');
    } else {
      toast.error(result.error || '下载失败');
    }
    closeImageMenu();
  }, [closeImageMenu, menu]);

  const editImage = useCallback(() => {
    if (!menu) return;
    const originalUrl = getAbsoluteImageUrl(menu.src);
    writeCreationReuseDraft('img2img', {
      prompt: '',
      referenceImage: originalUrl,
      referenceImages: [originalUrl],
      source: 'creation-detail',
      updatedAt: Date.now(),
    });
    closeImageMenu();
    router.push('/create?type=img2img');
    toast.success('已带入图生图参考图');
  }, [closeImageMenu, menu, router]);

  const shareImage = useCallback(async () => {
    if (!menu) return;
    const url = getImageViewerUrl(menu.src);
    const result = await copyTextToClipboard(url);
    if (result === 'copied') {
      toast.success('原图全屏链接已复制');
    } else if (result === 'manual') {
      toast.info('已选中链接，请按 Ctrl+C 复制');
    } else {
      toast.error('链接复制失败');
    }
    closeImageMenu();
  }, [closeImageMenu, menu]);

  const ImageActionsContextMenu = menu ? (
    <div
      className="fixed z-[2147483646] min-w-44 overflow-hidden rounded-xl border border-white/18 bg-black/82 p-1.5 text-sm text-white shadow-[0_18px_48px_rgba(0,0,0,0.36)] backdrop-blur-xl light:border-amber-900/18 light:bg-white/94 light:text-foreground light:shadow-[0_18px_48px_rgba(83,61,27,0.18)]"
      style={{ left: menu.x, top: menu.y }}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <button className="flex h-9 w-full items-center gap-2 rounded-lg px-3 text-left hover:bg-white/12 light:hover:bg-amber-900/8" onClick={copyImage}>
        <Copy className="h-4 w-4" />
        复制
      </button>
      <button className="flex h-9 w-full items-center gap-2 rounded-lg px-3 text-left hover:bg-white/12 light:hover:bg-amber-900/8" onClick={downloadImage}>
        <Download className="h-4 w-4" />
        下载
      </button>
      <button className="flex h-9 w-full items-center gap-2 rounded-lg px-3 text-left hover:bg-white/12 light:hover:bg-amber-900/8" onClick={editImage}>
        <PencilLine className="h-4 w-4" />
        编辑
      </button>
      <button className="flex h-9 w-full items-center gap-2 rounded-lg px-3 text-left hover:bg-white/12 light:hover:bg-amber-900/8" onClick={shareImage}>
        <Share2 className="h-4 w-4" />
        分享
      </button>
    </div>
  ) : null;

  return { openImageMenu, ImageActionsContextMenu };
}
