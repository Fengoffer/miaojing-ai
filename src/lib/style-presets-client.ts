'use client';

import { useEffect, useState } from 'react';
import type { ImageStylePreset } from '@/lib/model-config';

export function useImageStylePresets(fallback: ImageStylePreset[]): ImageStylePreset[] {
  const [presets, setPresets] = useState<ImageStylePreset[]>(fallback);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/style-presets')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (cancelled || !Array.isArray(data?.presets)) return;
        const next = data.presets.filter((item: unknown): item is ImageStylePreset => {
          if (!item || typeof item !== 'object') return false;
          const preset = item as Partial<ImageStylePreset>;
          return typeof preset.label === 'string' && typeof preset.prompt === 'string';
        });
        if (next.length > 0) setPresets(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return presets;
}
