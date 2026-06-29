'use client';

import { useState, useCallback, useEffect, useRef, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { X, ZoomIn, ZoomOut, ChevronLeft, ChevronRight } from 'lucide-react';
import { ImageMetadataBadge } from '@/components/image-metadata-badge';
import { useImageActionsContextMenu } from '@/components/image-actions-context-menu';

interface FullscreenPreviewProps {
  src: string;
  fallbackSrc?: string | null;
  alt?: string;
  images?: string[];
  initialIndex?: number;
  open: boolean;
  onClose: () => void;
  disableContextMenu?: boolean;
}

const MIN_SCALE = 1;
const MAX_SCALE = 6;
const WHEEL_STEP = 0.18;
const inverseControlClass =
  'border border-white/35 bg-black/48 text-white shadow-[0_8px_30px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.20)] backdrop-blur-md';
const inverseIconClass = 'text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.95)]';

export function FullscreenPreview({ src, fallbackSrc, alt, images, initialIndex = 0, open, onClose, disableContextMenu = false }: FullscreenPreviewProps) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const { openImageMenu, ImageActionsContextMenu } = useImageActionsContextMenu();
  const dragRef = useRef({
    pointerId: -1,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
  });

  const currentSrc = images?.length ? images[currentIndex] : src;
  const canPan = scale > 1;

  const resetView = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setDragging(false);
  }, []);

  const zoomTo = useCallback((nextScale: number, anchor?: { x: number; y: number }) => {
    setScale(prevScale => {
      const clamped = Math.max(MIN_SCALE, Math.min(MAX_SCALE, nextScale));
      if (clamped === MIN_SCALE) {
        setOffset({ x: 0, y: 0 });
        return MIN_SCALE;
      }

      if (anchor) {
        const ratio = clamped / prevScale;
        setOffset(prev => ({
          x: anchor.x - (anchor.x - prev.x) * ratio,
          y: anchor.y - (anchor.y - prev.y) * ratio,
        }));
      }

      return clamped;
    });
  }, []);

  const zoomBy = useCallback((delta: number) => {
    setScale(prev => {
      const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, prev + delta));
      if (next === MIN_SCALE) setOffset({ x: 0, y: 0 });
      return next;
    });
  }, []);

  const zoomFromWheel = useCallback((event: WheelEvent) => {
    const overlay = overlayRef.current;
    if (!overlay) return;

    event.preventDefault();
    event.stopPropagation();

    const rect = overlay.getBoundingClientRect();
    const anchor = {
      x: event.clientX - rect.left - rect.width / 2,
      y: event.clientY - rect.top - rect.height / 2,
    };

    setScale(prev => {
      const next = Math.max(
        MIN_SCALE,
        Math.min(MAX_SCALE, prev + (event.deltaY < 0 ? WHEEL_STEP : -WHEEL_STEP)),
      );
      if (next === MIN_SCALE) {
        setOffset({ x: 0, y: 0 });
        return MIN_SCALE;
      }

      const ratio = next / prev;
      setOffset(current => ({
        x: anchor.x - (anchor.x - current.x) * ratio,
        y: anchor.y - (anchor.y - current.y) * ratio,
      }));
      return next;
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    resetView();
    setCurrentIndex(initialIndex);
  }, [open, initialIndex, resetView]);

  useEffect(() => {
    resetView();
    setImageLoaded(false);
    setImageFailed(false);
  }, [currentSrc, resetView]);

  const goToPrev = useCallback(() => {
    if (!images?.length) return;
    setCurrentIndex(prev => (prev > 0 ? prev - 1 : images.length - 1));
  }, [images]);

  const goToNext = useCallback(() => {
    if (!images?.length) return;
    setCurrentIndex(prev => (prev < images.length - 1 ? prev + 1 : 0));
  }, [images]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft') goToPrev();
      if (event.key === 'ArrowRight') goToNext();
      if (event.key === '+' || event.key === '=') zoomBy(0.25);
      if (event.key === '-') zoomBy(-0.25);
      if (event.key === '0') resetView();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose, goToPrev, goToNext, zoomBy, resetView]);

  useEffect(() => {
    if (!open) return;
    const overlay = overlayRef.current;
    if (!overlay) return;

    overlay.addEventListener('wheel', zoomFromWheel, { passive: false });
    window.addEventListener('wheel', zoomFromWheel, { passive: false, capture: true });
    return () => {
      overlay.removeEventListener('wheel', zoomFromWheel);
      window.removeEventListener('wheel', zoomFromWheel, true);
    };
  }, [open, zoomFromWheel]);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  const overlay = (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[1000] flex items-center justify-center overflow-hidden bg-black/92 backdrop-blur-xl light:bg-white/72 light:backdrop-blur-2xl"
      style={{ pointerEvents: 'auto' }}
      onWheelCapture={(event) => {
        event.preventDefault();
        event.stopPropagation();
        zoomFromWheel(event.nativeEvent);
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <button
        onClick={onClose}
        onPointerDown={(event) => event.stopPropagation()}
        className={`absolute top-4 right-4 z-10 flex h-10 w-10 items-center justify-center rounded-full ${inverseControlClass}`}
        aria-label="Close preview"
      >
        <X className={`h-5 w-5 ${inverseIconClass}`} />
      </button>

      <div className="absolute top-4 right-16 z-10 flex gap-2">
        <button
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            zoomBy(0.25);
          }}
          className={`flex h-10 w-10 items-center justify-center rounded-full ${inverseControlClass}`}
          aria-label="Zoom in"
        >
          <ZoomIn className={`h-5 w-5 ${inverseIconClass}`} />
        </button>
        <button
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            zoomBy(-0.25);
          }}
          className={`flex h-10 w-10 items-center justify-center rounded-full ${inverseControlClass}`}
          aria-label="Zoom out"
        >
          <ZoomOut className={`h-5 w-5 ${inverseIconClass}`} />
        </button>
      </div>

      {imageLoaded && <ImageMetadataBadge src={currentSrc} className="absolute right-4 top-16 z-10" />}

      {images && images.length > 1 && (
        <div className={`absolute top-4 left-4 z-10 rounded-full px-3 py-1.5 text-sm font-medium ${inverseControlClass}`}>
          {currentIndex + 1} / {images.length}
        </div>
      )}

      {images && images.length > 1 && (
        <>
          <button
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              goToPrev();
            }}
            className={`absolute left-4 top-1/2 z-10 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full ${inverseControlClass}`}
            aria-label="Previous image"
          >
            <ChevronLeft className={`h-6 w-6 ${inverseIconClass}`} />
          </button>
          <button
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              goToNext();
            }}
            className={`absolute right-4 top-1/2 z-10 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full ${inverseControlClass}`}
            aria-label="Next image"
          >
            <ChevronRight className={`h-6 w-6 ${inverseIconClass}`} />
          </button>
        </>
      )}

      <div className={`absolute bottom-4 left-4 z-10 rounded-full px-3 py-1.5 text-xs font-medium ${inverseControlClass}`}>
        {Math.round(scale * 100)}% · 滚轮/双击缩放 · 放大后拖动 · 点击空白关闭
      </div>

      {!imageLoaded && !imageFailed && (
        <div className={`absolute bottom-14 left-1/2 z-10 -translate-x-1/2 rounded-full px-3 py-1.5 text-xs font-medium ${inverseControlClass}`}>
          原图加载中
        </div>
      )}

      {imageFailed && (
        <div className={`absolute bottom-14 left-1/2 z-10 -translate-x-1/2 rounded-full px-3 py-1.5 text-xs font-medium ${inverseControlClass}`}>
          原图暂时加载失败
        </div>
      )}

      {fallbackSrc && !imageLoaded && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={fallbackSrc}
          alt={alt || 'Preview'}
          draggable={false}
          className="max-h-[90vh] max-w-[90vw] select-none object-contain"
        />
      )}

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={currentSrc}
        alt={alt || 'Preview'}
        draggable={false}
        className={`max-w-[90vw] max-h-[90vh] select-none object-contain will-change-transform ${
          dragging ? 'cursor-grabbing' : canPan ? 'cursor-grab' : 'cursor-zoom-in'
        } ${!imageLoaded && fallbackSrc ? 'absolute opacity-0' : ''}`}
        style={{
          transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`,
          transition: dragging ? 'none' : 'transform 120ms ease-out',
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
        onClick={(event) => event.stopPropagation()}
        onContextMenu={(event) => {
          if (disableContextMenu) {
            event.preventDefault();
            return;
          }
          openImageMenu(event, currentSrc);
        }}
        onWheel={(event) => {
          zoomFromWheel(event.nativeEvent);
        }}
        onDoubleClick={(event) => {
          event.stopPropagation();
          if (scale > 1) {
            resetView();
          } else {
            zoomTo(2);
          }
        }}
        onPointerDown={(event) => {
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
        }}
        onPointerMove={(event) => {
          if (!dragging || dragRef.current.pointerId !== event.pointerId) return;
          event.stopPropagation();
          setOffset({
            x: dragRef.current.originX + event.clientX - dragRef.current.startX,
            y: dragRef.current.originY + event.clientY - dragRef.current.startY,
          });
        }}
        onPointerUp={(event) => {
          if (dragRef.current.pointerId === event.pointerId) {
            event.currentTarget.releasePointerCapture(event.pointerId);
            setDragging(false);
          }
        }}
        onPointerCancel={() => setDragging(false)}
      />
      {!disableContextMenu && ImageActionsContextMenu}
    </div>
  );

  return createPortal(overlay, document.body);
}

export function useFullscreenPreview() {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewSrc, setPreviewSrc] = useState('');
  const [previewAlt, setPreviewAlt] = useState('');

  const openPreview = useCallback((src: string, alt?: string) => {
    setPreviewSrc(src);
    setPreviewAlt(alt || '');
    setPreviewOpen(true);
  }, []);

  const closePreview = useCallback(() => {
    setPreviewOpen(false);
  }, []);

  const getClickProps = useCallback((src: string, alt?: string) => ({
    onClick: (event: MouseEvent) => {
      event.stopPropagation();
      openPreview(src, alt);
    },
    className: 'cursor-zoom-in',
  }), [openPreview]);

  return {
    previewOpen,
    previewSrc,
    previewAlt,
    openPreview,
    closePreview,
    getDoubleClickProps: getClickProps,
    getClickProps,
    FullscreenPreviewComponent: previewOpen ? (
      <FullscreenPreview
        src={previewSrc}
        alt={previewAlt}
        open={previewOpen}
        onClose={closePreview}
      />
    ) : null,
  };
}

