'use client';

import { useEffect, useMemo, useState } from 'react';

type ImageMetadataBadgeProps = {
  src: string;
  width?: number | null;
  height?: number | null;
  loadMetadata?: boolean;
  className?: string;
};

type ImageSize = {
  width: number;
  height: number;
};

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x || 1;
}

function getAspectLabel(width: number, height: number) {
  if (!width || !height) return '';
  const divisor = gcd(width, height);
  const ratioWidth = Math.round(width / divisor);
  const ratioHeight = Math.round(height / divisor);

  if (ratioWidth > 60 || ratioHeight > 60) {
    const decimal = width / height;
    if (decimal >= 0.98 && decimal <= 1.02) return '1:1';
    if (decimal > 1) return `${decimal.toFixed(2)}:1`;
    return `1:${(height / width).toFixed(2)}`;
  }

  return `${ratioWidth}:${ratioHeight}`;
}

function isValidSize(width: number | null | undefined, height: number | null | undefined): boolean {
  return typeof width === 'number' && Number.isFinite(width) && width > 0
    && typeof height === 'number' && Number.isFinite(height) && height > 0;
}

export function ImageMetadataBadge({
  src,
  width,
  height,
  loadMetadata = true,
  className = '',
}: ImageMetadataBadgeProps) {
  const [size, setSize] = useState<ImageSize | null>(null);

  useEffect(() => {
    if (isValidSize(width, height)) {
      setSize({ width: width as number, height: height as number });
      return;
    }

    if (!src || !loadMetadata) {
      setSize(null);
      return;
    }

    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        setSize({ width: image.naturalWidth, height: image.naturalHeight });
      }
    };
    image.onerror = () => {
      if (!cancelled) setSize(null);
    };
    image.src = src;

    return () => {
      cancelled = true;
    };
  }, [height, loadMetadata, src, width]);

  const label = useMemo(() => {
    if (!size) return '';
    return `${getAspectLabel(size.width, size.height)} · ${size.width}×${size.height}`;
  }, [size]);

  if (!label) return null;

  return (
    <div
      className={`rounded-full border border-white/24 bg-black/48 px-3 py-1.5 text-xs font-semibold text-white shadow-[0_10px_32px_rgba(0,0,0,0.35)] backdrop-blur-md light:border-amber-900/18 light:bg-white/60 light:text-foreground light:shadow-[0_10px_32px_rgba(83,61,27,0.14)] ${className}`}
    >
      {label}
    </div>
  );
}
