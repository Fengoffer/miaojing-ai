'use client';

import { useEffect, useMemo, useState, type CSSProperties, type ReactEventHandler, type MouseEventHandler } from 'react';

type CachedPreviewImageProps = {
  src: string;
  alt: string;
  className?: string;
  style?: CSSProperties;
  badgeClassName?: string;
  onDoubleClick?: () => void;
  onClick?: () => void;
  onContextMenu?: MouseEventHandler<HTMLImageElement>;
  onLoad?: ReactEventHandler<HTMLImageElement>;
};

type CachedPreview = {
  blob: Blob;
  width: number;
  height: number;
  updatedAt: number;
};

const DB_NAME = 'miaojing-preview-cache';
const STORE_NAME = 'image-previews';
const DB_VERSION = 1;
const MAX_PREVIEW_EDGE = 720;
const PREVIEW_QUALITY = 0.72;
const MAX_CACHE_ITEMS = 180;

let dbPromise: Promise<IDBDatabase> | null = null;

function getImageExtension(src: string): string {
  try {
    const pathname = new URL(src, typeof window !== 'undefined' ? window.location.href : undefined).pathname;
    const extension = pathname.split('.').pop()?.toLowerCase() || '';
    return /^(jpe?g|png|webp|gif)$/.test(extension) ? extension : 'jpg';
  } catch {
    return 'jpg';
  }
}

function getPreviewSource(src: string): string {
  if (!/^https?:\/\//i.test(src) || typeof window === 'undefined') return src;
  try {
    const url = new URL(src);
    if (url.origin === window.location.origin) return src;
  } catch {
    return src;
  }
  return `/api/download?url=${encodeURIComponent(src)}&filename=${encodeURIComponent(`preview.${getImageExtension(src)}`)}&disposition=inline`;
}

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

function openPreviewDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB unavailable'));
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME);
          store.createIndex('updatedAt', 'updatedAt');
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Open preview cache failed'));
    });
  }
  return dbPromise;
}

async function getCachedPreview(key: string): Promise<CachedPreview | null> {
  const db = await openPreviewDb();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve((request.result as CachedPreview | undefined) || null);
    request.onerror = () => resolve(null);
  });
}

async function pruneCache(db: IDBDatabase) {
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  const keysRequest = store.getAllKeys();
  const valuesRequest = store.getAll();
  await new Promise<void>((resolve) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });

  const keys = keysRequest.result || [];
  const values = (valuesRequest.result || []) as CachedPreview[];
  if (keys.length <= MAX_CACHE_ITEMS) return;
  const entries = keys.map((key, index) => ({ key, updatedAt: values[index]?.updatedAt || 0 }))
    .sort((a, b) => a.updatedAt - b.updatedAt)
    .slice(0, keys.length - MAX_CACHE_ITEMS);

  const deleteTx = db.transaction(STORE_NAME, 'readwrite');
  const deleteStore = deleteTx.objectStore(STORE_NAME);
  entries.forEach(entry => deleteStore.delete(entry.key));
}

async function setCachedPreview(key: string, value: CachedPreview) {
  const db = await openPreviewDb();
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
  void pruneCache(db).catch(() => undefined);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片预览加载失败'));
    image.src = src;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(resolve, 'image/webp', PREVIEW_QUALITY));
}

async function createPreview(src: string): Promise<CachedPreview> {
  const image = await loadImage(src);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!width || !height) throw new Error('无法读取图片尺寸');

  const scale = Math.min(1, MAX_PREVIEW_EDGE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('浏览器不支持预览图生成');
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await canvasToBlob(canvas);
  if (!blob) throw new Error('预览图生成失败');
  return { blob, width, height, updatedAt: Date.now() };
}

export function CachedPreviewImage({
  src,
  alt,
  className = '',
  style,
  badgeClassName = 'absolute right-2 top-2 z-10',
  onDoubleClick,
  onClick,
  onContextMenu,
  onLoad,
}: CachedPreviewImageProps) {
  const [previewUrl, setPreviewUrl] = useState('');
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);

  useEffect(() => {
    if (!src) {
      setPreviewUrl('');
      setSize(null);
      setPreviewFailed(false);
      return;
    }

    let cancelled = false;
    let objectUrl = '';
    setSize(null);
    setPreviewFailed(false);

    const usePreview = (preview: CachedPreview) => {
      if (cancelled) return;
      setSize({ width: preview.width, height: preview.height });
      const blob = preview.blob;
      objectUrl = URL.createObjectURL(blob);
      setPreviewUrl(objectUrl);
    };

    async function loadPreview() {
      const cached = await getCachedPreview(src).catch(() => null);
      if (cancelled) return;
      if (cached?.blob) {
        usePreview(cached);
        return;
      }

      const created = await createPreview(getPreviewSource(src));
      if (cancelled) return;
      usePreview(created);
      void setCachedPreview(src, created).catch(() => undefined);
    }

    loadPreview()
      .catch(() => {
        if (cancelled) return;
        setPreviewUrl('');
        setPreviewFailed(true);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  const displaySrc = useMemo(() => previewUrl || (previewFailed ? getPreviewSource(src) : ''), [previewFailed, previewUrl, src]);
  const metadataLabel = useMemo(() => {
    if (!size) return '';
    return `${getAspectLabel(size.width, size.height)} · ${size.width}×${size.height}`;
  }, [size]);

  const handleLoad: ReactEventHandler<HTMLImageElement> = (event) => {
    if (!size && event.currentTarget.naturalWidth > 0 && event.currentTarget.naturalHeight > 0) {
      setSize({
        width: event.currentTarget.naturalWidth,
        height: event.currentTarget.naturalHeight,
      });
    }
    onLoad?.(event);
  };

  return (
    <>
      {displaySrc ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={displaySrc}
          alt={alt}
          className={className}
          style={style}
          onClick={onClick}
          onDoubleClick={onDoubleClick}
          onContextMenu={onContextMenu}
          onLoad={handleLoad}
          loading="lazy"
          decoding="async"
        />
      ) : (
        <div
          className={`animate-pulse bg-muted/60 ${className}`}
          style={style}
          aria-label={alt}
        />
      )}
      {metadataLabel && (
        <div
          className={`rounded-full border border-white/24 bg-black/48 px-3 py-1.5 text-xs font-semibold text-white shadow-[0_10px_32px_rgba(0,0,0,0.35)] backdrop-blur-md light:border-amber-900/18 light:bg-white/60 light:text-foreground light:shadow-[0_10px_32px_rgba(83,61,27,0.14)] ${badgeClassName}`}
        >
          {metadataLabel}
        </div>
      )}
    </>
  );
}
