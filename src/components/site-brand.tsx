'use client';

import { useSiteConfig } from '@/lib/site-config';

/**
 * Renders the site name from server-side site config.
 */
export function SiteName({ fallback = '妙境' }: { fallback?: string }) {
  const { config, loaded } = useSiteConfig();
  return <>{loaded ? (config.siteName || fallback) : fallback}</>;
}

/**
 * Renders the site logo from server-side site config.
 */
export function SiteLogo({
  className = 'h-9 w-9 rounded-lg',
  fallback = '/logo.png',
}: {
  className?: string;
  fallback?: string;
}) {
  const { config, loaded } = useSiteConfig();
  return (
    <img
      src={loaded && config.logoUrl ? config.logoUrl : fallback}
      alt={loaded ? (config.siteName || '妙境') : '妙境'}
      className={className}
    />
  );
}
