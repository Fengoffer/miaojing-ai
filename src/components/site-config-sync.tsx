'use client';

import { useEffect } from 'react';
import { useSiteConfig } from '@/lib/site-config';

/**
 * Syncs site config to browser-level elements:
 * - document.title (browser tab title)
 * - <link rel="icon"> (browser tab favicon)
 */
export function SiteConfigSync() {
  const { config } = useSiteConfig();

  useEffect(() => {
    if (config.siteTabTitle) {
      document.title = config.siteTabTitle;
    }
  }, [config.siteTabTitle]);

  useEffect(() => {
    if (config.faviconUrl) {
      // Remove existing favicon links and add new one
      document.querySelectorAll("link[rel*='icon']").forEach(el => el.remove());
      const link = document.createElement('link');
      link.rel = 'icon';
      link.href = config.faviconUrl;
      if (config.faviconUrl.includes('svg')) link.type = 'image/svg+xml';
      else if (config.faviconUrl.includes('png')) link.type = 'image/png';
      else if (config.faviconUrl.includes('jpg') || config.faviconUrl.includes('jpeg')) link.type = 'image/jpeg';
      document.head.appendChild(link);
    }
  }, [config.faviconUrl]);

  return null;
}
