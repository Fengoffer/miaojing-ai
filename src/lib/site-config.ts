'use client';

import { useState, useEffect, useCallback } from 'react';
import { getClientAuthToken } from '@/lib/client-auth';
import { DEFAULT_ABOUT_US, DEFAULT_HELP_CENTER, DEFAULT_PRIVACY_POLICY, DEFAULT_TERMS_OF_SERVICE } from '@/lib/site-policy-defaults';

export interface SiteConfig {
  siteName: string;
  siteTabTitle: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  membershipEnabled: boolean;
  termsOfService: string;
  privacyPolicy: string;
  aboutUs: string;
  helpCenter: string;
  filingInfo: string;
  filingUrl: string;
  publicSecurityFilingInfo: string;
  publicSecurityFilingUrl: string;
  redeemCodeMallUrl: string;
  logRetentionDays: number;
  imageCompositionSkillEnabled: boolean;
}

const DEFAULT_SITE_CONFIG: SiteConfig = {
  siteName: '妙境',
  siteTabTitle: '妙境 - AI创作平台',
  logoUrl: null,
  faviconUrl: null,
  membershipEnabled: true,
  termsOfService: DEFAULT_TERMS_OF_SERVICE,
  privacyPolicy: DEFAULT_PRIVACY_POLICY,
  aboutUs: DEFAULT_ABOUT_US,
  helpCenter: DEFAULT_HELP_CENTER,
  filingInfo: '',
  filingUrl: '',
  publicSecurityFilingInfo: '',
  publicSecurityFilingUrl: '',
  redeemCodeMallUrl: '',
  logRetentionDays: 30,
  imageCompositionSkillEnabled: false,
};

const CACHE_KEY = 'miaojing_site_config_cache';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const EVENT_KEY = 'miaojing_site_config_updated';

interface CachedConfig {
  data: Partial<SiteConfig>;
  timestamp: number;
}

let siteConfigSnapshot: SiteConfig | null = null;
let siteConfigSnapshotTimestamp = 0;
let inFlightSiteConfigRequest: Promise<SiteConfig | null> | null = null;

function normalizeSiteConfig(data?: Partial<SiteConfig> | null): SiteConfig {
  return {
    siteName: data?.siteName || DEFAULT_SITE_CONFIG.siteName,
    siteTabTitle: data?.siteTabTitle || DEFAULT_SITE_CONFIG.siteTabTitle,
    logoUrl: data?.logoUrl || null,
    faviconUrl: data?.faviconUrl || null,
    membershipEnabled: data?.membershipEnabled !== false,
    termsOfService: data?.termsOfService?.trim() ? data.termsOfService : DEFAULT_TERMS_OF_SERVICE,
    privacyPolicy: data?.privacyPolicy?.trim() ? data.privacyPolicy : DEFAULT_PRIVACY_POLICY,
    aboutUs: data?.aboutUs?.trim() ? data.aboutUs : DEFAULT_ABOUT_US,
    helpCenter: data?.helpCenter?.trim() ? data.helpCenter : DEFAULT_HELP_CENTER,
    filingInfo: data?.filingInfo?.trim() || '',
    filingUrl: data?.filingUrl?.trim() || '',
    publicSecurityFilingInfo: data?.publicSecurityFilingInfo?.trim() || '',
    publicSecurityFilingUrl: data?.publicSecurityFilingUrl?.trim() || '',
    redeemCodeMallUrl: data?.redeemCodeMallUrl?.trim() || '',
    logRetentionDays: Math.min(90, Math.max(1, Number(data?.logRetentionDays || DEFAULT_SITE_CONFIG.logRetentionDays))),
    imageCompositionSkillEnabled: data?.imageCompositionSkillEnabled === true,
  };
}

function getCachedConfig(): SiteConfig | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cached: CachedConfig = JSON.parse(raw);
    if (Date.now() - cached.timestamp < CACHE_TTL) {
      siteConfigSnapshotTimestamp = cached.timestamp;
      return normalizeSiteConfig(cached.data);
    }
  } catch { /* ignore */ }
  return null;
}

function setCachedConfig(config: SiteConfig) {
  try {
    const cached: CachedConfig = { data: config, timestamp: Date.now() };
    localStorage.setItem(CACHE_KEY, JSON.stringify(cached));
  } catch { /* ignore */ }
}

function publishConfig(config: SiteConfig) {
  siteConfigSnapshot = config;
  siteConfigSnapshotTimestamp = Date.now();
  setCachedConfig(config);
  window.dispatchEvent(new CustomEvent(EVENT_KEY, { detail: config }));
}

function isSiteConfigSnapshotFresh(): boolean {
  return Boolean(siteConfigSnapshot) && Date.now() - siteConfigSnapshotTimestamp < CACHE_TTL;
}

function getInitialSiteConfig(): { config: SiteConfig; loaded: boolean } {
  if (siteConfigSnapshot) return { config: siteConfigSnapshot, loaded: true };
  const cached = getCachedConfig();
  if (cached) {
    siteConfigSnapshot = cached;
    return { config: cached, loaded: true };
  }
  return { config: DEFAULT_SITE_CONFIG, loaded: false };
}

function fetchFreshSiteConfig(): Promise<SiteConfig | null> {
  if (isSiteConfigSnapshotFresh()) {
    return Promise.resolve(siteConfigSnapshot);
  }
  if (inFlightSiteConfigRequest) return inFlightSiteConfigRequest;
  inFlightSiteConfigRequest = fetch('/api/site-config')
    .then(res => res.ok ? res.json() : null)
    .then((data: SiteConfig | null) => {
      if (!data) return null;
      const merged = normalizeSiteConfig(data);
      publishConfig(merged);
      return merged;
    })
    .finally(() => {
      inFlightSiteConfigRequest = null;
    });
  return inFlightSiteConfigRequest;
}

/**
 * Fetches site config from the server API.
 * Falls back to localStorage cache, then defaults.
 */
export function useSiteConfig() {
  const [config, setConfig] = useState<SiteConfig>(() => getInitialSiteConfig().config);
  const [loaded, setLoaded] = useState(() => getInitialSiteConfig().loaded);

  useEffect(() => {
    let cancelled = false;
    fetchFreshSiteConfig()
      .then((data) => {
        if (cancelled) return;
        if (data) setConfig(data);
        setLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handleConfigUpdate = (event: Event) => {
      setConfig((event as CustomEvent<SiteConfig>).detail);
      setLoaded(true);
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === CACHE_KEY) {
        const cached = getCachedConfig();
        if (cached) {
          setConfig(cached);
          setLoaded(true);
        }
      }
    };
    window.addEventListener(EVENT_KEY, handleConfigUpdate);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(EVENT_KEY, handleConfigUpdate);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  /** Save site config to server */
  const saveSiteConfig = useCallback(async (updates: {
    siteName?: string;
    siteTabTitle?: string;
    logoBase64?: string;
    faviconBase64?: string;
    membershipEnabled?: boolean;
    termsOfService?: string;
    privacyPolicy?: string;
    aboutUs?: string;
    helpCenter?: string;
    filingInfo?: string;
    filingUrl?: string;
    publicSecurityFilingInfo?: string;
    publicSecurityFilingUrl?: string;
    redeemCodeMallUrl?: string;
    logRetentionDays?: number;
    imageCompositionSkillEnabled?: boolean;
  }): Promise<SiteConfig | null> => {
    try {
      const token = getClientAuthToken();
      const res = await fetch('/api/site-config', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(updates),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: '保存失败' }));
        throw new Error(err.error || '保存失败');
      }

      const data: SiteConfig = await res.json();
      const merged = normalizeSiteConfig(data);
      setConfig(merged);
      publishConfig(merged);
      return merged;
    } catch (err) {
      console.error('[useSiteConfig] Save failed:', err);
      throw err;
    }
  }, []);

  return { config, loaded, saveSiteConfig };
}
