'use client';

import Link from 'next/link';
import { SiteLogo, SiteName } from '@/components/site-brand';
import { useSiteConfig } from '@/lib/site-config';

const footerLinks = [
  { href: '/about', label: '关于我们' },
  { href: '/terms', label: '使用条款' },
  { href: '/privacy', label: '隐私政策' },
  { href: '/help', label: '帮助中心' },
];

function normalizeExternalHref(value: string): string {
  const href = value.trim();
  if (!href) return '';
  if (/^https?:\/\//i.test(href)) return href;
  return `https://${href}`;
}

function resolveFilingHref(filingInfo: string, configuredUrl: string): string {
  if (!filingInfo.trim()) return '';
  return normalizeExternalHref(configuredUrl) || 'https://beian.miit.gov.cn/';
}

function resolvePublicSecurityFilingHref(filingInfo: string, configuredUrl: string): string {
  if (!filingInfo.trim()) return '';
  const normalized = normalizeExternalHref(configuredUrl);
  if (normalized) return normalized;
  const code = filingInfo.match(/\d{13,}/)?.[0];
  return code
    ? `https://beian.mps.gov.cn/#/query/webSearch?code=${code}`
    : 'https://beian.mps.gov.cn/#/query/webSearch';
}

export function SiteFooter() {
  const { config } = useSiteConfig();
  const filingHref = resolveFilingHref(config.filingInfo, config.filingUrl);
  const publicSecurityFilingHref = resolvePublicSecurityFilingHref(
    config.publicSecurityFilingInfo,
    config.publicSecurityFilingUrl,
  );

  return (
    <footer className="border-t border-border/50 py-12">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-2 text-center sm:text-left">
            <div className="flex items-center justify-center gap-2 sm:justify-start">
              <SiteLogo className="h-6 w-6 rounded" />
              <span className="font-serif font-bold"><SiteName /></span>
              <span className="text-sm text-muted-foreground">妙手丹青，境随心造</span>
            </div>
            {(config.filingInfo.trim() || config.publicSecurityFilingInfo.trim()) && (
              <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground sm:justify-start">
                {config.filingInfo.trim() && (
                  filingHref ? (
                    <a
                      href={filingHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="transition-colors hover:text-primary"
                    >
                      {config.filingInfo}
                    </a>
                  ) : (
                    <span>{config.filingInfo}</span>
                  )
                )}
                {config.publicSecurityFilingInfo.trim() && (
                  publicSecurityFilingHref ? (
                    <a
                      href={publicSecurityFilingHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="transition-colors hover:text-primary"
                    >
                      {config.publicSecurityFilingInfo}
                    </a>
                  ) : (
                    <span>{config.publicSecurityFilingInfo}</span>
                  )
                )}
              </div>
            )}
          </div>
          <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground sm:justify-end">
            {footerLinks.map(link => (
              <Link key={link.href} href={link.href} className="transition-colors hover:text-primary">
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </footer>
  );
}
