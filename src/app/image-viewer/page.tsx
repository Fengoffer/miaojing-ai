'use client';

import { Suspense, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';

function normalizeImageUrl(value: string | null): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('[')) return '';
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function ImageViewerContent() {
  const searchParams = useSearchParams();
  const imageUrl = useMemo(() => normalizeImageUrl(searchParams.get('url')), [searchParams]);

  if (!imageUrl) {
    return (
      <main className="fixed inset-0 z-[2147483000] flex items-center justify-center bg-black text-sm text-white/70">
        图片链接无效
      </main>
    );
  }

  return (
    <main className="fixed inset-0 z-[2147483000] flex items-center justify-center overflow-auto bg-black p-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageUrl}
        alt="原图预览"
        className="max-h-[calc(100vh-32px)] max-w-[calc(100vw-32px)] select-auto object-contain"
        draggable
      />
    </main>
  );
}

export default function ImageViewerPage() {
  return (
    <Suspense
      fallback={
        <main className="fixed inset-0 z-[2147483000] flex items-center justify-center bg-black text-sm text-white/70">
          正在打开原图
        </main>
      }
    >
      <ImageViewerContent />
    </Suspense>
  );
}
