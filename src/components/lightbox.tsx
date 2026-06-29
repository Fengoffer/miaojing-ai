'use client';

import { useState, useEffect, useCallback, useRef, type PointerEvent } from 'react';
import { X, Download, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { downloadFile, getImageDownloadExtension } from '@/lib/utils';
import { ImageMetadataBadge } from '@/components/image-metadata-badge';
import { useImageActionsContextMenu } from '@/components/image-actions-context-menu';

interface LightboxProps {
  /** Image URL to display */
  src: string;
  fallbackSrc?: string | null;
  /** Alt text */
  alt?: string;
  /** Whether the lightbox is open */
  open: boolean;
  /** Close handler */
  onClose: () => void;
}

export function ImageLightbox({ src, fallbackSrc, alt, open, onClose }: LightboxProps) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const dragRef = useRef({
    pointerId: -1,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
  });
  const { openImageMenu, ImageActionsContextMenu } = useImageActionsContextMenu();
  const canPan = zoom > 1;

  const setClampedZoom = useCallback((updater: number | ((current: number) => number)) => {
    setZoom(current => {
      const raw = typeof updater === 'function' ? updater(current) : updater;
      const next = Math.max(0.25, Math.min(4, raw));
      if (next <= 1) setOffset({ x: 0, y: 0 });
      return next;
    });
  }, []);

  const resetView = useCallback(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setDragging(false);
  }, []);

  const beginPan = useCallback((event: PointerEvent<HTMLElement>) => {
    event.stopPropagation();
    if (!canPan || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: offset.x,
      originY: offset.y,
    };
    setDragging(true);
  }, [canPan, offset.x, offset.y]);

  const movePan = useCallback((event: PointerEvent<HTMLElement>) => {
    if (!dragging || dragRef.current.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const nextX = dragRef.current.originX + event.clientX - dragRef.current.startX;
    const nextY = dragRef.current.originY + event.clientY - dragRef.current.startY;
    setOffset({ x: nextX, y: nextY });
  }, [dragging]);

  const endPan = useCallback((event: PointerEvent<HTMLElement>) => {
    if (dragRef.current.pointerId !== event.pointerId) return;
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(false);
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    if (e.key === '+' || e.key === '=') setClampedZoom(z => z + 0.5);
    if (e.key === '-') setClampedZoom(z => z - 0.5);
    if (e.key === '0') resetView();
  }, [onClose, resetView, setClampedZoom]);

  useEffect(() => {
    if (!open) return;
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [open, handleKeyDown]);

  useEffect(() => {
    resetView();
    setImageLoaded(false);
    setImageFailed(false);
  }, [src, resetView]);

  if (!open) return null;

  const handleDownload = async () => {
    const result = await downloadFile(src, `miaojing-${Date.now()}.${getImageDownloadExtension(src)}`);
    if (!result.ok) {
      // Fallback: open in new tab
      window.open(src, '_blank');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-xl light:bg-white/72 light:backdrop-blur-2xl"
      onClick={onClose}
    >
      {/* Toolbar */}
      <div className="absolute top-4 right-4 z-10 flex items-center gap-2" onClick={e => e.stopPropagation()}>
        <Button variant="secondary" size="sm" className="gap-1 border border-white/20 bg-black/45 text-white shadow-lg backdrop-blur-md hover:bg-black/60 light:border-amber-900/18 light:bg-white/52 light:text-foreground light:shadow-[0_10px_32px_rgba(83,61,27,0.14)] light:hover:bg-white/68" onClick={() => setClampedZoom(z => z + 0.5)}>
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button variant="secondary" size="sm" className="gap-1 border border-white/20 bg-black/45 text-white shadow-lg backdrop-blur-md hover:bg-black/60 light:border-amber-900/18 light:bg-white/52 light:text-foreground light:shadow-[0_10px_32px_rgba(83,61,27,0.14)] light:hover:bg-white/68" onClick={() => setClampedZoom(z => z - 0.5)}>
          <ZoomOut className="h-4 w-4" />
        </Button>
        <Button variant="secondary" size="sm" className="gap-1 border border-white/20 bg-black/45 text-white shadow-lg backdrop-blur-md hover:bg-black/60 light:border-amber-900/18 light:bg-white/52 light:text-foreground light:shadow-[0_10px_32px_rgba(83,61,27,0.14)] light:hover:bg-white/68" onClick={resetView}>
          1:1
        </Button>
        <Button variant="secondary" size="sm" className="gap-1 border border-white/20 bg-black/45 text-white shadow-lg backdrop-blur-md hover:bg-black/60 light:border-amber-900/18 light:bg-white/52 light:text-foreground light:shadow-[0_10px_32px_rgba(83,61,27,0.14)] light:hover:bg-white/68" onClick={handleDownload}>
          <Download className="h-4 w-4" />
        </Button>
        <Button variant="secondary" size="sm" className="border border-white/20 bg-black/45 text-white shadow-lg backdrop-blur-md hover:bg-black/60 light:border-amber-900/18 light:bg-white/52 light:text-foreground light:shadow-[0_10px_32px_rgba(83,61,27,0.14)] light:hover:bg-white/68" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {imageLoaded && <ImageMetadataBadge src={src} className="absolute right-4 top-16 z-10" />}

      {/* Info bar */}
      <div className="absolute bottom-4 left-4 z-10 rounded-full border border-white/20 bg-black/45 px-3 py-1.5 text-xs font-medium text-white/78 shadow-lg backdrop-blur-md light:border-amber-900/18 light:bg-white/52 light:text-foreground/70 light:shadow-[0_10px_32px_rgba(83,61,27,0.12)]" onClick={e => e.stopPropagation()}>
        {zoom !== 1 && <span>{Math.round(zoom * 100)}% {' | '} </span>}
        滚轮/双击缩放 | ESC 关闭 | 右键更多
      </div>

      {/* Image */}
      <div
        className={`flex h-full w-full items-center justify-center p-8 ${
          dragging ? 'cursor-grabbing' : canPan ? 'cursor-grab' : ''
        }`}
        onClick={e => e.stopPropagation()}
        onPointerDown={beginPan}
        onPointerMove={movePan}
        onPointerUp={endPan}
        onPointerCancel={endPan}
      >
        {!imageLoaded && !imageFailed && (
          <div className="absolute bottom-14 left-1/2 z-10 -translate-x-1/2 rounded-full border border-white/20 bg-black/45 px-3 py-1.5 text-xs font-medium text-white/78 shadow-lg backdrop-blur-md light:border-amber-900/18 light:bg-white/52 light:text-foreground/70">
            原图加载中
          </div>
        )}
        {imageFailed && (
          <div className="absolute bottom-14 left-1/2 z-10 -translate-x-1/2 rounded-full border border-white/20 bg-black/45 px-3 py-1.5 text-xs font-medium text-white/78 shadow-lg backdrop-blur-md light:border-amber-900/18 light:bg-white/52 light:text-foreground/70">
            原图暂时加载失败
          </div>
        )}
        {fallbackSrc && !imageLoaded && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={fallbackSrc}
            alt={alt || '预览图片'}
            draggable={false}
            className="max-h-full max-w-full select-none object-contain"
          />
        )}

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt || '预览图片'}
          draggable={false}
          className={`max-w-full max-h-full select-none object-contain will-change-transform ${
            dragging ? 'cursor-grabbing' : canPan ? 'cursor-grab' : 'cursor-zoom-in'
          } ${!imageLoaded && fallbackSrc ? 'absolute opacity-0' : ''}`}
          style={{
            transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${zoom})`,
            transition: dragging ? 'none' : 'transform 160ms ease-out',
            transformOrigin: 'center center',
            touchAction: 'none',
          }}
          onLoad={() => {
            setImageLoaded(true);
            setImageFailed(false);
          }}
          onError={() => {
            setImageLoaded(false);
            setImageFailed(true);
          }}
          onWheel={e => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            setClampedZoom(z => z + delta);
          }}
          onDoubleClick={e => {
            e.stopPropagation();
            if (zoom > 1) {
              resetView();
            } else {
              setClampedZoom(2);
            }
          }}
          onContextMenu={(event) => openImageMenu(event, src)}
          onPointerDown={e => {
            beginPan(e);
          }}
          onPointerMove={movePan}
          onPointerUp={endPan}
          onPointerCancel={endPan}
        />
      </div>
      {ImageActionsContextMenu}
    </div>
  );
}

export function BareImagePreview({ src, alt, open, onClose }: LightboxProps) {
  const { openImageMenu, ImageActionsContextMenu } = useImageActionsContextMenu();

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/88 p-6 backdrop-blur-xl light:bg-white/74"
      onClick={onClose}
    >
      <ImageMetadataBadge src={src} className="absolute right-4 top-4 z-10" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt || '参考图预览'}
        className="max-h-[94vh] max-w-[94vw] object-contain"
        onClick={(event) => event.stopPropagation()}
        onContextMenu={(event) => openImageMenu(event, src)}
      />
      {ImageActionsContextMenu}
    </div>
  );
}
