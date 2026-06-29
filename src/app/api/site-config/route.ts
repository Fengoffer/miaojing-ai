import { NextRequest, NextResponse } from 'next/server';
import { getDbClient } from '@/storage/database/local-db';
import { localStorage } from '@/lib/local-storage';
import { requireAdmin } from '@/lib/admin-auth';
import { DEFAULT_ABOUT_US, DEFAULT_HELP_CENTER, DEFAULT_PRIVACY_POLICY, DEFAULT_TERMS_OF_SERVICE } from '@/lib/site-policy-defaults';
import { cleanupExpiredPlatformLogs, setPlatformLogRetentionDays, writePlatformLog } from '@/lib/platform-logs';
import { clearLayoutCompositionSkillCache } from '@/lib/layout-composition-skill';

const DEFAULT_RESPONSE = {
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

type SiteConfigRow = {
  site_name?: string;
  site_tab_title?: string;
  logo_url?: string | null;
  favicon_url?: string | null;
  membership_enabled?: boolean;
  terms_of_service?: string | null;
  privacy_policy?: string | null;
  about_us?: string | null;
  help_center?: string | null;
  filing_info?: string | null;
  filing_url?: string | null;
  public_security_filing_info?: string | null;
  public_security_filing_url?: string | null;
  redeem_code_mall_url?: string | null;
  log_retention_days?: number | null;
  image_composition_skill_enabled?: boolean | null;
};

let siteConfigColumnsReady = false;
let siteConfigColumnsPromise: Promise<void> | null = null;

async function ensureSiteConfigColumns(client: Awaited<ReturnType<typeof getDbClient>>) {
  await client.query('ALTER TABLE site_config ADD COLUMN IF NOT EXISTS membership_enabled BOOLEAN NOT NULL DEFAULT TRUE');
  await client.query("ALTER TABLE site_config ADD COLUMN IF NOT EXISTS terms_of_service TEXT NOT NULL DEFAULT ''");
  await client.query("ALTER TABLE site_config ADD COLUMN IF NOT EXISTS privacy_policy TEXT NOT NULL DEFAULT ''");
  await client.query("ALTER TABLE site_config ADD COLUMN IF NOT EXISTS about_us TEXT NOT NULL DEFAULT ''");
  await client.query("ALTER TABLE site_config ADD COLUMN IF NOT EXISTS help_center TEXT NOT NULL DEFAULT ''");
  await client.query("ALTER TABLE site_config ADD COLUMN IF NOT EXISTS filing_info TEXT NOT NULL DEFAULT ''");
  await client.query("ALTER TABLE site_config ADD COLUMN IF NOT EXISTS filing_url TEXT NOT NULL DEFAULT ''");
  await client.query("ALTER TABLE site_config ADD COLUMN IF NOT EXISTS public_security_filing_info TEXT NOT NULL DEFAULT ''");
  await client.query("ALTER TABLE site_config ADD COLUMN IF NOT EXISTS public_security_filing_url TEXT NOT NULL DEFAULT ''");
  await client.query("ALTER TABLE site_config ADD COLUMN IF NOT EXISTS redeem_code_mall_url TEXT NOT NULL DEFAULT ''");
  await client.query('ALTER TABLE site_config ADD COLUMN IF NOT EXISTS log_retention_days INTEGER NOT NULL DEFAULT 30');
  await client.query('ALTER TABLE site_config ADD COLUMN IF NOT EXISTS image_composition_skill_enabled BOOLEAN NOT NULL DEFAULT FALSE');
  await client.query('UPDATE site_config SET log_retention_days = LEAST(90, GREATEST(1, log_retention_days))');
  await client.query("UPDATE site_config SET terms_of_service = $1 WHERE terms_of_service = ''", [DEFAULT_TERMS_OF_SERVICE]);
  await client.query("UPDATE site_config SET privacy_policy = $1 WHERE privacy_policy = ''", [DEFAULT_PRIVACY_POLICY]);
  await client.query("UPDATE site_config SET about_us = $1 WHERE about_us = ''", [DEFAULT_ABOUT_US]);
  await client.query("UPDATE site_config SET help_center = $1 WHERE help_center = ''", [DEFAULT_HELP_CENTER]);
}

async function ensureSiteConfigColumnsOnce(client: Awaited<ReturnType<typeof getDbClient>>) {
  if (siteConfigColumnsReady) return;
  if (!siteConfigColumnsPromise) {
    siteConfigColumnsPromise = ensureSiteConfigColumns(client)
      .then(() => {
        siteConfigColumnsReady = true;
      })
      .finally(() => {
        siteConfigColumnsPromise = null;
      });
  }
  await siteConfigColumnsPromise;
}

function normalizeResponse(data?: SiteConfigRow | null) {
  return {
    siteName: data?.site_name || DEFAULT_RESPONSE.siteName,
    siteTabTitle: data?.site_tab_title || DEFAULT_RESPONSE.siteTabTitle,
    logoUrl: data?.logo_url || null,
    faviconUrl: data?.favicon_url || null,
    membershipEnabled: data?.membership_enabled !== false,
    termsOfService: data?.terms_of_service?.trim() ? data.terms_of_service : DEFAULT_TERMS_OF_SERVICE,
    privacyPolicy: data?.privacy_policy?.trim() ? data.privacy_policy : DEFAULT_PRIVACY_POLICY,
    aboutUs: data?.about_us?.trim() ? data.about_us : DEFAULT_ABOUT_US,
    helpCenter: data?.help_center?.trim() ? data.help_center : DEFAULT_HELP_CENTER,
    filingInfo: data?.filing_info?.trim() || '',
    filingUrl: data?.filing_url?.trim() || '',
    publicSecurityFilingInfo: data?.public_security_filing_info?.trim() || '',
    publicSecurityFilingUrl: data?.public_security_filing_url?.trim() || '',
    redeemCodeMallUrl: data?.redeem_code_mall_url?.trim() || '',
    logRetentionDays: Math.min(90, Math.max(1, Number(data?.log_retention_days || 30))),
    imageCompositionSkillEnabled: data?.image_composition_skill_enabled === true,
  };
}

function normalizeExternalUrl(value: unknown) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.toString();
  } catch {
    return '';
  }
}

function decodeDataImage(value: unknown): { buffer: Buffer; ext: string; contentType: string } | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,([a-z0-9+/=]+)$/i);
  if (!match) return null;
  const subtype = match[1].toLowerCase();
  const ext = subtype === 'jpeg' ? 'jpg' : subtype === 'svg+xml' ? 'svg' : subtype;
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length <= 0 || buffer.length > 3 * 1024 * 1024) return null;
  return { buffer, ext, contentType: `image/${subtype}` };
}

async function saveImageDataUrl(value: unknown, prefix: string): Promise<string | null> {
  const decoded = decodeDataImage(value);
  if (!decoded) return null;
  const key = `site-assets/${prefix}-${Date.now()}.${decoded.ext}`;
  const savedKey = await localStorage.uploadFile({
    fileContent: decoded.buffer,
    fileName: key,
    contentType: decoded.contentType,
  });
  return localStorage.generatePresignedUrl({ key: savedKey, expireTime: 31536000 });
}

export async function GET() {
  try {
    const client = await getDbClient();
    try {
      await ensureSiteConfigColumnsOnce(client);
      const result = await client.query(
        'SELECT site_name, site_tab_title, logo_url, favicon_url, membership_enabled, terms_of_service, privacy_policy, about_us, help_center, filing_info, filing_url, public_security_filing_info, public_security_filing_url, redeem_code_mall_url, log_retention_days, image_composition_skill_enabled FROM site_config WHERE id = 1'
      );

      if (result.rows.length === 0) {
        return NextResponse.json(DEFAULT_RESPONSE);
      }

      return NextResponse.json(normalizeResponse(result.rows[0]));
    } finally {
      client.release();
    }
  } catch {
    return NextResponse.json(DEFAULT_RESPONSE);
  }
}

export async function PUT(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    if (!body) {
      return NextResponse.json({ error: '无效的请求体' }, { status: 400 });
    }

    const { siteName, siteTabTitle, membershipEnabled, logoBase64, faviconBase64, termsOfService, privacyPolicy, aboutUs, helpCenter, filingInfo, filingUrl, publicSecurityFilingInfo, publicSecurityFilingUrl, redeemCodeMallUrl, logRetentionDays, imageCompositionSkillEnabled } = body as {
      siteName?: string;
      siteTabTitle?: string;
      membershipEnabled?: boolean;
      logoBase64?: string;
      faviconBase64?: string;
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
    };

    const client = await getDbClient();
    try {
      await ensureSiteConfigColumnsOnce(client);
      const updates: string[] = [];
      const params: unknown[] = [];
      let paramIdx = 1;

      if (typeof siteName === 'string') { updates.push(`site_name = $${paramIdx++}`); params.push(siteName); }
      if (typeof siteTabTitle === 'string') { updates.push(`site_tab_title = $${paramIdx++}`); params.push(siteTabTitle); }
      if (typeof membershipEnabled === 'boolean') { updates.push(`membership_enabled = $${paramIdx++}`); params.push(membershipEnabled); }
      if (typeof termsOfService === 'string') { updates.push(`terms_of_service = $${paramIdx++}`); params.push(termsOfService.trim() || DEFAULT_TERMS_OF_SERVICE); }
      if (typeof privacyPolicy === 'string') { updates.push(`privacy_policy = $${paramIdx++}`); params.push(privacyPolicy.trim() || DEFAULT_PRIVACY_POLICY); }
      if (typeof aboutUs === 'string') { updates.push(`about_us = $${paramIdx++}`); params.push(aboutUs.trim() || DEFAULT_ABOUT_US); }
      if (typeof helpCenter === 'string') { updates.push(`help_center = $${paramIdx++}`); params.push(helpCenter.trim() || DEFAULT_HELP_CENTER); }
      if (typeof filingInfo === 'string') { updates.push(`filing_info = $${paramIdx++}`); params.push(filingInfo.trim()); }
      if (typeof filingUrl === 'string') { updates.push(`filing_url = $${paramIdx++}`); params.push(filingUrl.trim()); }
      if (typeof publicSecurityFilingInfo === 'string') { updates.push(`public_security_filing_info = $${paramIdx++}`); params.push(publicSecurityFilingInfo.trim()); }
      if (typeof publicSecurityFilingUrl === 'string') { updates.push(`public_security_filing_url = $${paramIdx++}`); params.push(publicSecurityFilingUrl.trim()); }
      if (typeof redeemCodeMallUrl === 'string') {
        const normalizedMallUrl = normalizeExternalUrl(redeemCodeMallUrl);
        if (redeemCodeMallUrl.trim() && !normalizedMallUrl) {
          return NextResponse.json({ error: '商城链接必须是 http 或 https 开头的有效链接' }, { status: 400 });
        }
        updates.push(`redeem_code_mall_url = $${paramIdx++}`);
        params.push(normalizedMallUrl);
      }
      if (typeof logRetentionDays === 'number') {
        const safeLogRetentionDays = Math.min(90, Math.max(1, Math.floor(logRetentionDays)));
        updates.push(`log_retention_days = $${paramIdx++}`);
        params.push(safeLogRetentionDays);
        await setPlatformLogRetentionDays(client, safeLogRetentionDays);
        await cleanupExpiredPlatformLogs(client);
      }
      if (typeof imageCompositionSkillEnabled === 'boolean') {
        updates.push(`image_composition_skill_enabled = $${paramIdx++}`);
        params.push(imageCompositionSkillEnabled);
        clearLayoutCompositionSkillCache();
      }
      const logoUrl = await saveImageDataUrl(logoBase64, 'logo');
      const faviconUrl = await saveImageDataUrl(faviconBase64, 'favicon');
      if (logoUrl) { updates.push(`logo_url = $${paramIdx++}`); params.push(logoUrl); }
      if (faviconUrl) { updates.push(`favicon_url = $${paramIdx++}`); params.push(faviconUrl); }
      updates.push(`updated_at = NOW()`);

      if (updates.length > 1) {
        await client.query(
          "INSERT INTO site_config (id, site_name, site_tab_title) VALUES (1, '妙境', '妙境 - AI创作平台') ON CONFLICT (id) DO NOTHING"
        );
        await client.query(
          `UPDATE site_config SET ${updates.join(', ')} WHERE id = 1`,
          params
        );
      }

      const result = await client.query(
        'SELECT site_name, site_tab_title, logo_url, favicon_url, membership_enabled, terms_of_service, privacy_policy, about_us, help_center, filing_info, filing_url, public_security_filing_info, public_security_filing_url, redeem_code_mall_url, log_retention_days, image_composition_skill_enabled FROM site_config WHERE id = 1'
      );

      void writePlatformLog({
        type: 'admin',
        level: 'info',
        action: 'site_config_updated',
        message: '管理员更新了系统设置',
        targetType: 'site_config',
        targetId: '1',
        metadata: {
          fields: updates
            .filter(item => !item.startsWith('updated_at'))
            .map(item => item.split('=')[0]?.trim())
            .filter(Boolean),
        },
        request,
      });

      return NextResponse.json(normalizeResponse(result.rows[0]));
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[site-config] PUT error:', err);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
