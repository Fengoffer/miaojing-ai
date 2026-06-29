'use client';

import { useEffect, useMemo, useState, type MouseEventHandler } from 'react';

type ReferencePreviewImageProps = {
  src: string;
  thumbnailSrc?: string | null;
  alt: string;
  className?: string;
  onClick?: () => void;
  onContextMenu?: MouseEventHandler<HTMLImageElement>;
};

const MAX_EDGE = 360;
const QUALITY = 0.7;

function isLocalOrDataUrl(src: string): boolean {
  if (src.startsWith('data:image/')) return true;
  if (src.startsWith('/')) return true;
  if (typeof window === 'undefined') return true;
  try {
    return new URL(src, window.location.href).origin === window.location.origin;
  } catch {
    return true;
  }
}

function getDisplaySource(src: string): string {
  if (isLocalOrDataUrl(src)) return src;
  return `/api/download?url=${encodeURIComponent(src)}&filename=reference-preview.jpg&disposition=inline`;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('参考图预览加载失败'));
    image.src = src;
  });
}

function canvasToDataUrl(image: HTMLImageElement): string {
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!width || !height) return image.src;
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return image.src;
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/webp', QUALITY);
}

export function ReferencePreviewImage({
  src,
  thumbnailSrc,
  alt,
  className,
  onClick,
  onContextMenu,
}: ReferencePreviewImageProps) {
  const [previewSrc, setPreviewSrc] = useState('');
  const [failed, setFailed] = useState(false);
  const fallbackSrc = useMemo(() => getDisplaySource(src), [src]);

  useEffect(() => {
    if (!src) {
      setPreviewSrc('');
      setFailed(false);
      return;
    }
    setFailed(false);
    if (thumbnailSrc) {
      setPreviewSrc(thumbnailSrc);
      return;
    }

    let cancelled = false;
    setPreviewSrc('');
    loadImage(getDisplaySource(src))
      .then(image => {
        if (cancelled) return;
        setPreviewSrc(canvasToDataUrl(image));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [src, thumbnailSrc]);

  const displaySrc = previewSrc || (failed ? fallbackSrc : '');
  if (!displaySrc) {
    return <div className={`animate-pulse bg-muted/70 ${className || ''}`} aria-label={alt} />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={displaySrc}
      alt={alt}
      className={className}
      onClick={onClick}
      onContextMenu={onContextMenu}
      loading="lazy"
      decoding="async"
    />
  );
}
