import crypto from 'crypto';
import net from 'net';
import tls from 'tls';
import { marked, Renderer, type Tokens } from 'marked';
import type { PoolClient } from 'pg';
import { decryptSecret, encryptSecret, previewSecret } from '@/lib/server-crypto';
import { localStorage } from '@/lib/local-storage';

export type EmailCodeType = 'register' | 'verify_email' | 'reset_password';
export type EmailMessageType =
  | EmailCodeType
  | 'register_success'
  | 'email_verified'
  | 'password_reset_success'
  | 'security_login'
  | 'announcement'
  | 'order'
  | 'business';
export type EmailTemplateKind = 'notification' | 'admin' | 'reminder';
export type AdminEmailMode = 'selected' | 'all';

export interface AdminEmailSendFailure {
  id: string;
  email: string;
  recipientUserId: string | null;
  status: string;
  error: string | null;
  createdAt: string;
}

export interface AdminEmailSendBatch {
  id: string;
  mode: AdminEmailMode;
  mailKind: EmailTemplateKind;
  title: string;
  subject: string;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  status: string;
  createdAt: string;
  completedAt: string | null;
  failed: AdminEmailSendFailure[];
}

export interface AdminEmailRecipient {
  id: string;
  email: string;
}

export interface EmailInlineAttachment {
  contentId: string;
  content: Buffer;
  contentType: string;
  filename?: string;
}

export interface EmailSettings {
  enabled: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPassword: string;
  smtpPasswordPreview: string;
  fromEmail: string;
  fromName: string;
  replyTo: string;
  appName: string;
  appBaseUrl: string;
  logoUrl: string;
  contactEmail: string;
  copyright: string;
  codeLength: number;
  codeCharset: 'alphanumeric' | 'numeric' | 'letters';
  codeTtlMinutes: number;
}

const SYSTEM_EMAIL_SETTINGS_ID = 1;
const DEFAULT_CODE_TTL_MINUTES = 5;
const DEFAULT_CODE_LENGTH = 6;
const EMAIL_REGEX = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
let emailSchemaReady = false;
let emailSchemaWarned = false;

export function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function isValidEmail(value: string): boolean {
  return value.length > 3 && value.length <= 254 && EMAIL_REGEX.test(value);
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim().slice(0, 64);
  return (
    request.headers.get('x-real-ip')
    || request.headers.get('cf-connecting-ip')
    || 'unknown'
  ).slice(0, 64);
}

export async function ensureEmailSchema(client: PoolClient): Promise<void> {
  if (emailSchemaReady) return;
  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    await client.query(`
      ALTER TABLE profiles
        ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS email_bound_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS email_sender_domain VARCHAR(255)
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS email_settings (
        id INTEGER PRIMARY KEY DEFAULT 1,
        enabled BOOLEAN NOT NULL DEFAULT FALSE,
        smtp_host VARCHAR(255),
        smtp_port INTEGER NOT NULL DEFAULT 465,
        smtp_secure BOOLEAN NOT NULL DEFAULT TRUE,
        smtp_user VARCHAR(255),
        smtp_password_encrypted TEXT,
        smtp_password_preview VARCHAR(64),
        from_email VARCHAR(255),
        from_name VARCHAR(255),
        reply_to VARCHAR(255),
        app_name VARCHAR(120),
        app_base_url TEXT,
        logo_url TEXT,
        contact_email VARCHAR(255),
        copyright TEXT,
        code_length INTEGER NOT NULL DEFAULT 6,
        code_charset VARCHAR(32) NOT NULL DEFAULT 'alphanumeric',
        code_ttl_minutes INTEGER NOT NULL DEFAULT 5,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS email_verification_codes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) NOT NULL,
        code_hash TEXT NOT NULL,
        type VARCHAR(32) NOT NULL,
        user_id UUID,
        ip_address VARCHAR(64),
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 5,
        is_used BOOLEAN NOT NULL DEFAULT FALSE,
        locked_until TIMESTAMPTZ,
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_email_send_batches (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        mode VARCHAR(32) NOT NULL,
        mail_kind VARCHAR(32) NOT NULL,
        title VARCHAR(255) NOT NULL,
        subject VARCHAR(255) NOT NULL,
        recipient_count INTEGER NOT NULL DEFAULT 0,
        sent_count INTEGER NOT NULL DEFAULT 0,
        failed_count INTEGER NOT NULL DEFAULT 0,
        status VARCHAR(32) NOT NULL DEFAULT 'sending',
        created_by UUID,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS email_send_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        batch_id UUID,
        recipient_user_id UUID,
        email VARCHAR(255) NOT NULL,
        type VARCHAR(64) NOT NULL,
        subject TEXT,
        ip_address VARCHAR(64),
        status VARCHAR(32) NOT NULL,
        error_message TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      ALTER TABLE email_send_logs
        ADD COLUMN IF NOT EXISTS batch_id UUID,
        ADD COLUMN IF NOT EXISTS recipient_user_id UUID,
        ADD COLUMN IF NOT EXISTS subject TEXT
    `);
    await client.query('CREATE INDEX IF NOT EXISTS email_codes_email_type_idx ON email_verification_codes (LOWER(email), type, created_at DESC)');
    await client.query('CREATE INDEX IF NOT EXISTS email_codes_ip_created_idx ON email_verification_codes (ip_address, created_at DESC)');
    await client.query('CREATE INDEX IF NOT EXISTS email_send_logs_email_created_idx ON email_send_logs (LOWER(email), created_at DESC)');
    await client.query('CREATE INDEX IF NOT EXISTS email_send_logs_ip_created_idx ON email_send_logs (ip_address, created_at DESC)');
    await client.query('CREATE INDEX IF NOT EXISTS email_send_logs_batch_created_idx ON email_send_logs (batch_id, created_at DESC) WHERE batch_id IS NOT NULL');
    await client.query('CREATE INDEX IF NOT EXISTS admin_email_send_batches_created_idx ON admin_email_send_batches (created_at DESC)');
    emailSchemaReady = true;
  } catch (error) {
    if (error && typeof error === 'object' && (error as { code?: string }).code === '42501') {
      if (!emailSchemaWarned) {
        console.warn('[email-schema] skipped optional schema check because the database user is not the table owner');
        emailSchemaWarned = true;
      }
      emailSchemaReady = true;
      return;
    }
    throw error;
  }
}

function envBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === 'true' || value === '1';
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function normalizeCharset(value: unknown): EmailSettings['codeCharset'] {
  if (value === 'numeric' || value === 'letters' || value === 'alphanumeric') return value;
  return 'alphanumeric';
}

function getCodeSecret(): string {
  return process.env.EMAIL_CODE_SECRET
    || process.env.DATA_ENCRYPTION_KEY
    || process.env.JWT_SECRET
    || process.env.ADMIN_DEFAULT_PASSWORD
    || 'miaojing-email-code-secret';
}

function hashCode(email: string, type: EmailCodeType, code: string): string {
  return crypto
    .createHmac('sha256', getCodeSecret())
    .update(`${type}:${normalizeEmail(email)}:${code.toUpperCase()}`)
    .digest('hex');
}

function generateCode(length: number, charset: EmailSettings['codeCharset']): string {
  const chars = charset === 'numeric'
    ? '0123456789'
    : charset === 'letters'
      ? 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
      : 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += chars[crypto.randomInt(0, chars.length)];
  }
  return code;
}

export async function getEmailSettings(client: PoolClient): Promise<EmailSettings> {
  await ensureEmailSchema(client);
  const result = await client.query('SELECT * FROM email_settings WHERE id = $1', [SYSTEM_EMAIL_SETTINGS_ID]);
  const row = result.rows[0] || {};
  const siteResult = await client.query('SELECT site_name, logo_url FROM site_config WHERE id = 1').catch(() => ({ rows: [] }));
  const site = siteResult.rows[0] || {};
  const envPassword = process.env.EMAIL_SMTP_PASSWORD || process.env.SMTP_PASSWORD || '';
  const dbPassword = decryptSecret(row.smtp_password_encrypted);
  const appName = row.app_name || site.site_name || process.env.EMAIL_APP_NAME || '妙境';
  const configuredLogo = typeof row.logo_url === 'string' ? row.logo_url.trim() : '';
  const siteLogo = typeof site.logo_url === 'string' ? site.logo_url.trim() : '';
  const envLogo = process.env.EMAIL_LOGO_URL || '';
  const logoUrl = siteLogo || (configuredLogo && configuredLogo !== '/logo.png' ? configuredLogo : '') || envLogo || '/logo.png';

  return {
    enabled: row.enabled ?? envBool(process.env.EMAIL_ENABLED, false),
    smtpHost: row.smtp_host || process.env.EMAIL_SMTP_HOST || process.env.SMTP_HOST || '',
    smtpPort: clampInt(row.smtp_port || process.env.EMAIL_SMTP_PORT || process.env.SMTP_PORT, 465, 1, 65535),
    smtpSecure: row.smtp_secure ?? envBool(process.env.EMAIL_SMTP_SECURE || process.env.SMTP_SECURE, true),
    smtpUser: row.smtp_user || process.env.EMAIL_SMTP_USER || process.env.SMTP_USER || '',
    smtpPassword: dbPassword || envPassword,
    smtpPasswordPreview: row.smtp_password_preview || previewSecret(envPassword),
    fromEmail: row.from_email || process.env.EMAIL_FROM || process.env.SMTP_FROM || '',
    fromName: row.from_name || process.env.EMAIL_FROM_NAME || `${appName}官方通知`,
    replyTo: row.reply_to || process.env.EMAIL_REPLY_TO || '',
    appName,
    appBaseUrl: row.app_base_url || process.env.NEXT_PUBLIC_APP_URL || process.env.APP_BASE_URL || 'http://localhost:5000',
    logoUrl,
    contactEmail: row.contact_email || process.env.EMAIL_CONTACT || row.from_email || process.env.EMAIL_FROM || '',
    copyright: row.copyright || `© ${new Date().getFullYear()} ${appName}. All rights reserved.`,
    codeLength: clampInt(row.code_length, DEFAULT_CODE_LENGTH, 4, 10),
    codeCharset: normalizeCharset(row.code_charset),
    codeTtlMinutes: clampInt(row.code_ttl_minutes, DEFAULT_CODE_TTL_MINUTES, 1, 30),
  };
}

export function publicEmailSettings(settings: EmailSettings) {
  return {
    enabled: settings.enabled,
    smtpHost: settings.smtpHost,
    smtpPort: settings.smtpPort,
    smtpSecure: settings.smtpSecure,
    smtpUser: settings.smtpUser,
    smtpPasswordPreview: settings.smtpPasswordPreview,
    fromEmail: settings.fromEmail,
    fromName: settings.fromName,
    replyTo: settings.replyTo,
    appName: settings.appName,
    appBaseUrl: settings.appBaseUrl,
    logoUrl: settings.logoUrl,
    contactEmail: settings.contactEmail,
    copyright: settings.copyright,
    codeLength: settings.codeLength,
    codeCharset: settings.codeCharset,
    codeTtlMinutes: settings.codeTtlMinutes,
  };
}

export async function saveEmailSettings(client: PoolClient, updates: Record<string, unknown>) {
  await ensureEmailSchema(client);
  const fields: string[] = [];
  const params: unknown[] = [];
  let idx = 1;
  const add = (column: string, value: unknown) => {
    fields.push(`${column} = $${idx++}`);
    params.push(value);
  };

  if (typeof updates.enabled === 'boolean') add('enabled', updates.enabled);
  if (typeof updates.smtpHost === 'string') add('smtp_host', updates.smtpHost.trim());
  if (updates.smtpPort !== undefined) add('smtp_port', clampInt(updates.smtpPort, 465, 1, 65535));
  if (typeof updates.smtpSecure === 'boolean') add('smtp_secure', updates.smtpSecure);
  if (typeof updates.smtpUser === 'string') add('smtp_user', updates.smtpUser.trim());
  if (typeof updates.smtpPassword === 'string' && updates.smtpPassword.trim() && updates.smtpPassword !== '********') {
    add('smtp_password_encrypted', encryptSecret(updates.smtpPassword.trim()));
    add('smtp_password_preview', previewSecret(updates.smtpPassword.trim()));
  }
  if (updates.clearSmtpPassword === true) {
    add('smtp_password_encrypted', null);
    add('smtp_password_preview', null);
  }
  if (typeof updates.fromEmail === 'string') add('from_email', normalizeEmail(updates.fromEmail));
  if (typeof updates.fromName === 'string') add('from_name', updates.fromName.trim().slice(0, 120));
  if (typeof updates.replyTo === 'string') add('reply_to', normalizeEmail(updates.replyTo));
  if (typeof updates.appName === 'string') add('app_name', updates.appName.trim().slice(0, 120));
  if (typeof updates.appBaseUrl === 'string') add('app_base_url', updates.appBaseUrl.trim().slice(0, 500));
  if (typeof updates.logoUrl === 'string') add('logo_url', updates.logoUrl.trim().slice(0, 500));
  if (typeof updates.contactEmail === 'string') add('contact_email', normalizeEmail(updates.contactEmail));
  if (typeof updates.copyright === 'string') add('copyright', updates.copyright.trim().slice(0, 300));
  if (updates.codeLength !== undefined) add('code_length', clampInt(updates.codeLength, DEFAULT_CODE_LENGTH, 4, 10));
  if (updates.codeCharset !== undefined) add('code_charset', normalizeCharset(updates.codeCharset));
  if (updates.codeTtlMinutes !== undefined) add('code_ttl_minutes', clampInt(updates.codeTtlMinutes, DEFAULT_CODE_TTL_MINUTES, 1, 30));

  if (fields.length === 0) return publicEmailSettings(await getEmailSettings(client));

  fields.push('updated_at = NOW()');
  await client.query('INSERT INTO email_settings (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [SYSTEM_EMAIL_SETTINGS_ID]);
  await client.query(`UPDATE email_settings SET ${fields.join(', ')} WHERE id = $${idx}`, [...params, SYSTEM_EMAIL_SETTINGS_ID]);
  return publicEmailSettings(await getEmailSettings(client));
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function absolutizeUrl(url: string, baseUrl: string): string {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}${url.startsWith('/') ? '' : '/'}${url}`;
}

function normalizeMarkdownLinkUrl(value: unknown, baseUrl: string): string {
  const url = String(value || '').trim();
  if (!url) return '';
  if (/^(https?:|mailto:)/i.test(url)) return url;
  if (url.startsWith('/') || url.startsWith('#') || url.startsWith('?') || url.startsWith('./') || url.startsWith('../')) {
    return absolutizeUrl(url, baseUrl);
  }
  return '';
}

function normalizeMarkdownImageUrl(value: unknown, baseUrl: string): string {
  const url = String(value || '').trim();
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('/') || url.startsWith('./') || url.startsWith('../')) return absolutizeUrl(url, baseUrl);
  return '';
}

function styleAttr(style: Record<string, string | number>): string {
  return Object.entries(style)
    .map(([key, value]) => `${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}:${value}`)
    .join(';');
}

function renderInlineMarkdown(renderer: Renderer, tokens: Tokens.Generic[] | Tokens.TableCell['tokens']): string {
  return renderer.parser.parseInline(tokens);
}

function renderMarkdownEmailBody(markdown: string, baseUrl: string): string {
  const content = markdown.trim();
  if (!content) return '';

  const renderer = new Renderer();

  renderer.html = ({ text }) => escapeHtml(text);
  renderer.heading = ({ tokens, depth }) => {
    const level = Math.min(4, Math.max(1, depth));
    const fontSize = level === 1 ? '22px' : level === 2 ? '19px' : level === 3 ? '17px' : '15px';
    const color = level <= 2 ? '#ffffff' : '#f4f7fb';
    return `<h${level} style="${styleAttr({ margin: '18px 0 9px', fontSize, lineHeight: '1.4', color, fontWeight: level === 1 ? 850 : 800 })}">${renderInlineMarkdown(renderer, tokens)}</h${level}>`;
  };
  renderer.paragraph = ({ tokens }) => `<p style="${styleAttr({ margin: '0 0 13px', fontSize: '15px', lineHeight: '1.85', color: '#cbd5e1' })}">${renderInlineMarkdown(renderer, tokens)}</p>`;
  renderer.strong = ({ tokens }) => `<strong style="${styleAttr({ color: '#ffffff', fontWeight: 850 })}">${renderInlineMarkdown(renderer, tokens)}</strong>`;
  renderer.em = ({ tokens }) => `<em style="${styleAttr({ color: '#e5e7eb', fontStyle: 'italic' })}">${renderInlineMarkdown(renderer, tokens)}</em>`;
  renderer.del = ({ tokens }) => `<del style="${styleAttr({ color: '#94a3b8' })}">${renderInlineMarkdown(renderer, tokens)}</del>`;
  renderer.blockquote = ({ tokens }) => `<blockquote style="${styleAttr({ margin: '16px 0', padding: '12px 15px', borderLeft: '4px solid #f5b040', borderRadius: '0 14px 14px 0', background: 'rgba(245,176,64,.10)', color: '#d7dee9' })}">${renderer.parser.parse(tokens)}</blockquote>`;
  renderer.hr = () => `<hr style="${styleAttr({ border: 0, borderTop: '1px solid rgba(255,255,255,.14)', margin: '18px 0' })}">`;
  renderer.br = () => '<br>';
  renderer.checkbox = () => '';
  renderer.codespan = ({ text }) => `<code style="${styleAttr({ display: 'inline', padding: '2px 6px', borderRadius: '6px', background: 'rgba(8,11,16,.72)', color: '#f8fafc', fontSize: '13px', fontFamily: "ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,monospace" })}">${escapeHtml(text)}</code>`;
  renderer.code = ({ text }) => `<pre style="${styleAttr({ margin: '14px 0', padding: 0, overflow: 'auto' })}"><code style="${styleAttr({ display: 'block', padding: '12px 14px', borderRadius: '12px', background: 'rgba(8,11,16,.72)', color: '#f8fafc', fontSize: '13px', lineHeight: '1.7', fontFamily: "ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,monospace", whiteSpace: 'pre-wrap' })}">${escapeHtml(text)}</code></pre>`;
  renderer.list = ({ ordered, start, items }) => {
    const tag = ordered ? 'ol' : 'ul';
    const startAttr = ordered && start && start !== 1 ? ` start="${start}"` : '';
    const children = items.map(item => renderer.listitem(item)).join('');
    return `<${tag}${startAttr} style="${styleAttr({ margin: '0 0 14px 20px', padding: 0, color: '#cbd5e1', fontSize: '15px', lineHeight: '1.85' })}">${children}</${tag}>`;
  };
  renderer.listitem = (item) => {
    const checkbox = item.task ? `${item.checked ? '☑' : '☐'} ` : '';
    return `<li style="${styleAttr({ margin: '3px 0' })}">${checkbox}${renderer.parser.parse(item.tokens)}</li>`;
  };
  renderer.link = ({ href, title, tokens }) => {
    const safeHref = normalizeMarkdownLinkUrl(href, baseUrl);
    const label = renderInlineMarkdown(renderer, tokens);
    if (!safeHref) return label;
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
    return `<a href="${escapeHtml(safeHref)}"${titleAttr} style="${styleAttr({ color: '#f5b040', textDecoration: 'none', fontWeight: 740 })}" target="_blank" rel="noreferrer">${label}</a>`;
  };
  renderer.image = ({ href, title, text }) => {
    const safeSrc = normalizeMarkdownImageUrl(href, baseUrl);
    if (!safeSrc) return '';
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
    return `<img src="${escapeHtml(safeSrc)}" alt="${escapeHtml(text || '')}"${titleAttr} style="${styleAttr({ display: 'block', width: '100%', maxWidth: '100%', height: 'auto', margin: '16px 0', borderRadius: '18px', border: '1px solid rgba(255,255,255,.12)' })}">`;
  };
  renderer.table = (token) => {
    const header = token.header.map(cell => renderer.tablecell(cell)).join('');
    const rows = token.rows.map(row => `<tr>${row.map(cell => renderer.tablecell(cell)).join('')}</tr>`).join('');
    return `<table style="${styleAttr({ width: '100%', margin: '14px 0', borderCollapse: 'collapse', fontSize: '14px', color: '#cbd5e1' })}"><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table>`;
  };
  renderer.tablecell = (token) => {
    const tag = token.header ? 'th' : 'td';
    const align = token.align || 'left';
    const background = token.header ? 'rgba(255,255,255,.08)' : 'transparent';
    const color = token.header ? '#ffffff' : '#cbd5e1';
    return `<${tag} style="${styleAttr({ border: token.header ? '1px solid rgba(255,255,255,.16)' : '1px solid rgba(255,255,255,.13)', padding: '8px 10px', textAlign: align, color, background })}">${renderInlineMarkdown(renderer, token.tokens)}</${tag}>`;
  };

  return marked.parse(content, {
    async: false,
    gfm: true,
    breaks: false,
    renderer,
  });
}

export function getRequestBaseUrl(request: Request): string {
  const forwardedHost = request.headers.get('x-forwarded-host');
  const host = forwardedHost || request.headers.get('host') || '';
  if (!host) return '';
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const proto = forwardedProto || new URL(request.url).protocol.replace(':', '') || 'http';
  return `${proto}://${host}`.replace(/\/+$/, '');
}

export function renderEmailTemplate(settings: EmailSettings, input: {
  title: string;
  intro?: string;
  body?: string;
  bodyMode?: 'markdown' | 'image';
  imageUrl?: string;
  imageAlt?: string;
  buttonText?: string;
  buttonUrl?: string;
  note?: string;
  assetBaseUrl?: string;
  templateKind?: EmailTemplateKind;
  type?: EmailMessageType;
}) {
  const logo = absolutizeUrl(settings.logoUrl || '/logo.png', input.assetBaseUrl || settings.appBaseUrl);
  const markdownBaseUrl = input.assetBaseUrl || settings.appBaseUrl;
  const pureImageUrl = input.bodyMode === 'image' ? normalizeMarkdownImageUrl(input.imageUrl, markdownBaseUrl) : '';
  const pureImageHtml = pureImageUrl
    ? `<img src="${escapeHtml(pureImageUrl)}" alt="${escapeHtml(input.imageAlt || input.title)}" style="${styleAttr({ display: 'block', width: '100%', maxWidth: '100%', height: 'auto', margin: 0, borderRadius: '18px', border: '1px solid rgba(255,255,255,.12)' })}">`
    : '';
  const bodyHtml = input.bodyMode === 'image'
    ? pureImageHtml
    : input.body ? renderMarkdownEmailBody(input.body, markdownBaseUrl) : '';
  const showBodyTitle = input.bodyMode !== 'image';
  const brand = escapeHtml(settings.appName);
  const buttonUrl = input.buttonUrl ? escapeHtml(input.buttonUrl) : '';
  const templateKind = input.templateKind || getTemplateKindForType(input.type);
  const eyebrow = getTemplateKindLabel(templateKind);
  const preheader = input.intro || (bodyHtml ? plainTextFromHtml(bodyHtml) : '') || input.title;
  const button = buttonUrl
    ? `<a href="${buttonUrl}" style="display:inline-block;padding:13px 24px;border-radius:16px;background:#f5b040;color:#17120a;text-decoration:none;font-weight:850;font-size:14px;box-shadow:0 12px 30px rgba(245,176,64,.24);">${escapeHtml(input.buttonText || '进入妙境')}</a>`
    : '';

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(input.title)}</title>
</head>
<body style="margin:0;padding:0;background:#080b10;color:#e8ecf3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:radial-gradient(circle at 50% 0%,rgba(245,176,64,.16),transparent 32%),radial-gradient(circle at 12% 18%,rgba(255,255,255,.07),transparent 24%),#080b10;padding:30px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:660px;border-collapse:separate;border-spacing:0;">
          <tr>
            <td style="padding:24px 26px;border-radius:28px 28px 0 0;background:rgba(18,22,29,.9);border:1px solid rgba(255,255,255,.12);border-bottom:0;">
              <img src="${escapeHtml(logo)}" width="44" height="44" alt="${brand}" style="display:inline-block;vertical-align:middle;border-radius:14px;background:#111827;object-fit:contain;">
              <span style="display:inline-block;vertical-align:middle;margin-left:12px;font-size:21px;font-weight:850;color:#ffffff;">${brand}</span>
              <span style="display:inline-block;vertical-align:middle;margin-left:12px;padding:5px 10px;border-radius:999px;background:rgba(245,176,64,.14);border:1px solid rgba(245,176,64,.34);color:#f5b040;font-size:12px;font-weight:800;">${eyebrow}</span>
            </td>
          </tr>
          <tr>
            <td style="padding:30px 26px;background:rgba(18,22,29,.8);border-left:1px solid rgba(255,255,255,.12);border-right:1px solid rgba(255,255,255,.12);">
              <div style="padding:24px;border-radius:24px;background:linear-gradient(180deg,rgba(255,255,255,.075),rgba(255,255,255,.035));border:1px solid rgba(255,255,255,.12);box-shadow:inset 0 1px 0 rgba(255,255,255,.08);">
              ${showBodyTitle ? `<h1 style="margin:0 0 14px;font-size:25px;line-height:1.35;color:#ffffff;font-weight:850;">${escapeHtml(input.title)}</h1>` : ''}
              ${input.intro ? `<p style="margin:0 0 16px;font-size:15px;line-height:1.8;color:#cbd5e1;">${escapeHtml(input.intro)}</p>` : ''}
              ${bodyHtml}
              ${button ? `<div style="margin-top:24px;">${button}</div>` : ''}
              ${input.note ? `<p style="margin:22px 0 0;font-size:12px;line-height:1.7;color:#8f98aa;">${escapeHtml(input.note)}</p>` : ''}
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 26px 24px;border-radius:0 0 28px 28px;background:rgba(12,16,22,.96);border:1px solid rgba(255,255,255,.12);border-top:0;color:#8f98aa;font-size:12px;line-height:1.7;">
              <div>官方地址：<a href="${escapeHtml(settings.appBaseUrl)}" style="color:#f5b040;text-decoration:none;">${escapeHtml(settings.appBaseUrl)}</a></div>
              ${settings.contactEmail ? `<div>联系邮箱：<a href="mailto:${escapeHtml(settings.contactEmail)}" style="color:#f5b040;text-decoration:none;">${escapeHtml(settings.contactEmail)}</a></div>` : ''}
              <div style="margin-top:8px;">${escapeHtml(settings.copyright)}</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function getTemplateKindForType(type?: EmailMessageType): EmailTemplateKind {
  if (type === 'password_reset_success' || type === 'security_login') return 'reminder';
  if (type === 'business') return 'admin';
  return 'notification';
}

function getTemplateKindLabel(kind: EmailTemplateKind): string {
  if (kind === 'admin') return '管理员邮件';
  if (kind === 'reminder') return '提醒邮件';
  return '通知邮件';
}

export function renderVerificationEmailTemplate(settings: EmailSettings, input: {
  title: string;
  intro?: string;
  code: string;
  note?: string;
  assetBaseUrl?: string;
}) {
  const logo = absolutizeUrl(settings.logoUrl || '/logo.png', input.assetBaseUrl || settings.appBaseUrl);
  const brand = escapeHtml(settings.appName);
  const preheader = input.intro || input.title;

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(input.title)}</title>
</head>
<body style="margin:0;padding:0;background:#080b10;color:#e8ecf3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:radial-gradient(circle at 50% 0%,rgba(245,176,64,.18),transparent 32%),radial-gradient(circle at 16% 16%,rgba(255,255,255,.07),transparent 24%),#080b10;padding:30px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:660px;border-collapse:separate;border-spacing:0;">
          <tr>
            <td style="padding:24px 26px;border-radius:28px 28px 0 0;background:rgba(18,22,29,.9);border:1px solid rgba(255,255,255,.12);border-bottom:0;">
              <img src="${escapeHtml(logo)}" width="44" height="44" alt="${brand}" style="display:inline-block;vertical-align:middle;border-radius:14px;background:#111827;object-fit:contain;">
              <span style="display:inline-block;vertical-align:middle;margin-left:12px;font-size:21px;font-weight:850;color:#ffffff;">${brand}</span>
              <span style="display:inline-block;vertical-align:middle;margin-left:12px;padding:5px 10px;border-radius:999px;background:rgba(245,176,64,.14);border:1px solid rgba(245,176,64,.34);color:#f5b040;font-size:12px;font-weight:800;">安全验证</span>
            </td>
          </tr>
          <tr>
            <td style="padding:30px 26px;background:rgba(18,22,29,.8);border-left:1px solid rgba(255,255,255,.12);border-right:1px solid rgba(255,255,255,.12);">
              <div style="padding:24px;border-radius:24px;background:linear-gradient(180deg,rgba(255,255,255,.075),rgba(255,255,255,.035));border:1px solid rgba(255,255,255,.12);box-shadow:inset 0 1px 0 rgba(255,255,255,.08);">
                <h1 style="margin:0 0 14px;font-size:25px;line-height:1.35;color:#ffffff;font-weight:850;">${escapeHtml(input.title)}</h1>
                ${input.intro ? `<p style="margin:0 0 16px;font-size:15px;line-height:1.8;color:#cbd5e1;">${escapeHtml(input.intro)}</p>` : ''}
                <div style="margin:24px 0 20px;padding:20px 22px;border-radius:20px;background:linear-gradient(135deg,rgba(245,176,64,.2),rgba(255,255,255,.07));border:1px solid rgba(245,176,64,.45);text-align:center;">
                  <div style="font-size:12px;color:#d7aa62;letter-spacing:.08em;text-transform:uppercase;margin-bottom:9px;font-weight:700;">Verification Code</div>
                  <div style="font-size:34px;line-height:1;font-weight:850;letter-spacing:.18em;color:#f5b040;font-family:Arial,'Helvetica Neue',sans-serif;">${escapeHtml(input.code)}</div>
                </div>
                ${input.note ? `<p style="margin:22px 0 0;font-size:12px;line-height:1.7;color:#8f98aa;">${escapeHtml(input.note)}</p>` : ''}
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 26px 24px;border-radius:0 0 28px 28px;background:rgba(12,16,22,.96);border:1px solid rgba(255,255,255,.12);border-top:0;color:#8f98aa;font-size:12px;line-height:1.7;">
              <div>官方地址：<a href="${escapeHtml(settings.appBaseUrl)}" style="color:#f5b040;text-decoration:none;">${escapeHtml(settings.appBaseUrl)}</a></div>
              ${settings.contactEmail ? `<div>联系邮箱：<a href="mailto:${escapeHtml(settings.contactEmail)}" style="color:#f5b040;text-decoration:none;">${escapeHtml(settings.contactEmail)}</a></div>` : ''}
              <div style="margin-top:8px;">${escapeHtml(settings.copyright)}</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function stripHeader(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function encodeHeader(value: string): string {
  return `=?UTF-8?B?${Buffer.from(stripHeader(value), 'utf8').toString('base64')}?=`;
}

function plainTextFromHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function foldBase64(value: string): string {
  return value.match(/.{1,76}/g)?.join('\r\n') || '';
}

function encodeMimeBuffer(value: Buffer): string {
  return foldBase64(value.toString('base64'));
}

function encodeMimeBody(value: string): string {
  return foldBase64(Buffer.from(value, 'utf8').toString('base64'));
}

function contentTypeForStorageKey(key: string): string {
  const extension = key.split('?')[0]?.split('.').pop()?.toLowerCase();
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'gif') return 'image/gif';
  return 'application/octet-stream';
}

function getLocalStorageKeyFromImageSrc(src: string): string | null {
  const marker = '/api/local-storage/';
  const index = src.indexOf(marker);
  if (index === -1) return null;
  try {
    return decodeURIComponent(src.slice(index + marker.length).split(/[?#]/)[0] || '');
  } catch {
    return null;
  }
}

export async function rewriteHtmlImagesWithInlineAttachments(
  html: string,
  readStorageImage: (key: string) => Promise<{ content: Buffer; contentType?: string; filename?: string }>,
): Promise<{ html: string; attachments: EmailInlineAttachment[] }> {
  const attachments: EmailInlineAttachment[] = [];
  const replacements = new Map<string, string>();
  const imageSrcPattern = /<img\b[^>]*\bsrc=(["'])(.*?)\1[^>]*>/gi;
  const sources = [...html.matchAll(imageSrcPattern)]
    .map(match => match[2])
    .filter(Boolean);

  for (const src of sources) {
    if (replacements.has(src)) continue;
    const key = getLocalStorageKeyFromImageSrc(src);
    if (!key) continue;
    try {
      const image = await readStorageImage(key);
      const contentId = `mj-image-${crypto.randomUUID()}`;
      attachments.push({
        contentId,
        content: image.content,
        contentType: image.contentType || contentTypeForStorageKey(key),
        filename: image.filename || key.split('/').pop() || 'image',
      });
      replacements.set(src, `cid:${contentId}`);
    } catch (error) {
      console.warn('[email-inline-image] skipped image attachment:', key, error);
    }
  }

  if (replacements.size === 0) return { html, attachments };
  let rewritten = html;
  for (const [src, cid] of replacements) {
    rewritten = rewritten.split(src).join(cid);
  }
  return { html: rewritten, attachments };
}

export function buildSmtpMimeMessage(settings: EmailSettings, input: {
  to: string;
  subject: string;
  html: string;
  attachments?: EmailInlineAttachment[];
}): string {
  const text = plainTextFromHtml(input.html);
  if (!text || !input.html.trim()) {
    throw new Error('邮件正文为空，已取消发送');
  }

  const alternativeBoundary = `mj-alt-${crypto.randomUUID()}`;
  const relatedBoundary = `mj-rel-${crypto.randomUUID()}`;
  const attachments = input.attachments || [];
  const headers = [
    `From: ${encodeHeader(settings.fromName)} <${settings.fromEmail}>`,
    `To: <${input.to}>`,
    `Subject: ${encodeHeader(input.subject)}`,
    ...(settings.replyTo && isValidEmail(settings.replyTo) ? [`Reply-To: <${settings.replyTo}>`] : []),
    'MIME-Version: 1.0',
  ];

  const alternativePart = [
    `--${alternativeBoundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    encodeMimeBody(text),
    `--${alternativeBoundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    encodeMimeBody(input.html),
    `--${alternativeBoundary}--`,
  ];

  if (attachments.length === 0) {
    return [
      ...headers,
      `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`,
      '',
      ...alternativePart,
    ].join('\r\n');
  }

  const attachmentParts = attachments.map(attachment => [
    `--${relatedBoundary}`,
    `Content-Type: ${attachment.contentType}; name="${stripHeader(attachment.filename || 'image')}"`,
    'Content-Transfer-Encoding: base64',
    `Content-ID: <${attachment.contentId}>`,
    'Content-Disposition: inline',
    '',
    encodeMimeBuffer(attachment.content),
  ].join('\r\n'));

  return [
    ...headers,
    `Content-Type: multipart/related; boundary="${relatedBoundary}"`,
    '',
    `--${relatedBoundary}`,
    `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`,
    '',
    ...alternativePart,
    ...attachmentParts,
    `--${relatedBoundary}--`,
  ].join('\r\n');
}

type SmtpSocket = net.Socket | tls.TLSSocket;

function createSmtpReader(socket: SmtpSocket) {
  let buffer = '';
  const waiters: Array<() => void> = [];
  socket.on('data', chunk => {
    buffer += chunk.toString('utf8');
    while (waiters.length) waiters.shift()?.();
  });

  const waitForData = () => new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('SMTP 响应超时')), 30000);
    waiters.push(() => {
      clearTimeout(timer);
      resolve();
    });
  });

  const readResponse = async () => {
    for (;;) {
      const lines = buffer.split(/\r?\n/);
      for (let i = 0; i < lines.length - 1; i += 1) {
        const line = lines[i];
        if (/^\d{3} /.test(line)) {
          const responseLines = lines.slice(0, i + 1);
          buffer = lines.slice(i + 1).join('\n');
          const code = Number(line.slice(0, 3));
          return { code, text: responseLines.join('\n') };
        }
      }
      await waitForData();
    }
  };
  return { readResponse };
}

function writeLine(socket: SmtpSocket, line: string) {
  socket.write(`${line}\r\n`);
}

async function expectResponse(reader: ReturnType<typeof createSmtpReader>, expected: number[]) {
  const response = await reader.readResponse();
  if (!expected.includes(response.code)) {
    throw new Error(`SMTP ${response.code}: ${response.text}`);
  }
  return response;
}

async function waitForSocketConnect(socket: SmtpSocket, secure: boolean) {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const done = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.off('connect', onConnect);
      socket.off('secureConnect', onConnect);
      socket.off('error', onError);
      error ? reject(error) : resolve();
    };
    const onConnect = () => done();
    const onError = (error: Error) => done(error);
    const timer = setTimeout(() => done(new Error('SMTP 连接超时')), 30000);
    socket.once(secure ? 'secureConnect' : 'connect', onConnect);
    socket.once('error', onError);
  });
}

async function sendSmtpMailOnce(settings: EmailSettings, to: string, subject: string, html: string, attachments: EmailInlineAttachment[] = []) {
  if (!settings.enabled) throw new Error('邮箱服务未启用');
  if (!settings.smtpHost || !settings.fromEmail) throw new Error('SMTP 配置不完整');
  if (!isValidEmail(settings.fromEmail) || !isValidEmail(to)) throw new Error('邮箱地址格式不正确');

  const connectOptions = { host: settings.smtpHost, port: settings.smtpPort };
  let socket: SmtpSocket = settings.smtpSecure
    ? tls.connect({ ...connectOptions, servername: settings.smtpHost })
    : net.connect(connectOptions);

  try {
    await waitForSocketConnect(socket, settings.smtpSecure);
    let reader = createSmtpReader(socket);
    await expectResponse(reader, [220]);
    writeLine(socket, `EHLO ${settings.appBaseUrl.replace(/^https?:\/\//, '').split('/')[0] || 'localhost'}`);
    await expectResponse(reader, [250]);

    if (!settings.smtpSecure) {
      writeLine(socket, 'STARTTLS');
      const startTls = await reader.readResponse();
      if (startTls.code === 220) {
        socket.removeAllListeners('data');
        socket = tls.connect({ socket, servername: settings.smtpHost });
        await waitForSocketConnect(socket, true);
        reader = createSmtpReader(socket);
        writeLine(socket, `EHLO ${settings.appBaseUrl.replace(/^https?:\/\//, '').split('/')[0] || 'localhost'}`);
        await expectResponse(reader, [250]);
      } else if (settings.smtpPort === 587) {
        throw new Error(`SMTP STARTTLS 失败: ${startTls.text}`);
      }
    }

    if (settings.smtpUser && settings.smtpPassword) {
      const auth = Buffer.from(`\u0000${settings.smtpUser}\u0000${settings.smtpPassword}`, 'utf8').toString('base64');
      writeLine(socket, `AUTH PLAIN ${auth}`);
      await expectResponse(reader, [235]);
    }

    writeLine(socket, `MAIL FROM:<${settings.fromEmail}>`);
    await expectResponse(reader, [250]);
    writeLine(socket, `RCPT TO:<${to}>`);
    await expectResponse(reader, [250, 251]);
    writeLine(socket, 'DATA');
    await expectResponse(reader, [354]);

    const message = buildSmtpMimeMessage(settings, { to, subject, html, attachments });

    socket.write(`${message.replace(/^\./gm, '..')}\r\n.\r\n`);
    await expectResponse(reader, [250]);
    writeLine(socket, 'QUIT');
    socket.end();
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

async function sendSmtpMail(settings: EmailSettings, to: string, subject: string, html: string, attachments: EmailInlineAttachment[] = []) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await sendSmtpMailOnce(settings, to, subject, html, attachments);
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= 2) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError || '邮件发送失败'));
}

async function logSend(client: PoolClient, email: string, type: EmailMessageType, ip: string, status: string, error?: string, options?: {
  batchId?: string;
  recipientUserId?: string | null;
  subject?: string;
}) {
  await client.query(
    `INSERT INTO email_send_logs (batch_id, recipient_user_id, email, type, subject, ip_address, status, error_message)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      options?.batchId || null,
      options?.recipientUserId || null,
      email,
      type,
      options?.subject ? options.subject.slice(0, 255) : null,
      ip,
      status,
      error ? error.slice(0, 500) : null,
    ],
  ).catch(() => undefined);
}

function toIsoString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' ? value : '';
}

function mapEmailFailure(row: Record<string, unknown>): AdminEmailSendFailure {
  return {
    id: String(row.id || ''),
    email: normalizeEmail(row.email),
    recipientUserId: typeof row.recipient_user_id === 'string' ? row.recipient_user_id : null,
    status: typeof row.status === 'string' ? row.status : 'failed',
    error: typeof row.error_message === 'string' ? row.error_message : null,
    createdAt: toIsoString(row.created_at),
  };
}

export async function createAdminEmailSendBatch(client: PoolClient, input: {
  mode: AdminEmailMode;
  mailKind: EmailTemplateKind;
  title: string;
  subject: string;
  recipientCount: number;
  createdBy?: string | null;
}): Promise<string> {
  await ensureEmailSchema(client);
  const result = await client.query(
    `INSERT INTO admin_email_send_batches (mode, mail_kind, title, subject, recipient_count, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      input.mode,
      input.mailKind,
      input.title.slice(0, 255),
      input.subject.slice(0, 255),
      Math.max(0, Math.floor(input.recipientCount)),
      input.createdBy || null,
    ],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error('邮件发送批次创建失败');
  return String(id);
}

export async function finishAdminEmailSendBatch(client: PoolClient, batchId: string, input: {
  sentCount: number;
  failedCount: number;
}): Promise<void> {
  await ensureEmailSchema(client);
  const sentCount = Math.max(0, Math.floor(input.sentCount));
  const failedCount = Math.max(0, Math.floor(input.failedCount));
  const status = failedCount === 0 ? 'completed' : sentCount > 0 ? 'completed_with_errors' : 'failed';
  await client.query(
    `UPDATE admin_email_send_batches
     SET sent_count = $1, failed_count = $2, status = $3, completed_at = NOW()
     WHERE id = $4`,
    [sentCount, failedCount, status, batchId],
  );
}

async function updateAdminEmailSendBatchProgress(client: PoolClient, batchId: string, input: {
  sentCount: number;
  failedCount: number;
}): Promise<void> {
  await client.query(
    `UPDATE admin_email_send_batches
     SET sent_count = $1, failed_count = $2
     WHERE id = $3 AND status = 'sending'`,
    [
      Math.max(0, Math.floor(input.sentCount)),
      Math.max(0, Math.floor(input.failedCount)),
      batchId,
    ],
  ).catch(() => undefined);
}

export async function listAdminEmailSendBatches(client: PoolClient, options: {
  batchId?: string;
  limit?: number;
  logLimit?: number;
} = {}): Promise<{ batches: AdminEmailSendBatch[] }> {
  await ensureEmailSchema(client);
  const batchLimit = clampInt(options.limit, 20, 1, 50);
  const logLimit = clampInt(options.logLimit, options.batchId ? 1000 : 200, 1, 1000);
  const batchResult = options.batchId
    ? await client.query(
      `SELECT id, mode, mail_kind, title, subject, recipient_count, sent_count, failed_count, status, created_at, completed_at
       FROM admin_email_send_batches
       WHERE id = $1
       LIMIT 1`,
      [options.batchId],
    )
    : await client.query(
      `SELECT id, mode, mail_kind, title, subject, recipient_count, sent_count, failed_count, status, created_at, completed_at
       FROM admin_email_send_batches
       ORDER BY created_at DESC
       LIMIT $1`,
      [batchLimit],
    );

  const batchIds = batchResult.rows.map(row => String(row.id)).filter(Boolean);
  const failedByBatch = new Map<string, AdminEmailSendFailure[]>();
  if (batchIds.length > 0) {
    const logResult = await client.query(
      `SELECT id, batch_id, email, recipient_user_id, status, error_message, created_at
       FROM email_send_logs
       WHERE batch_id = ANY($1::uuid[])
         AND status = 'failed'
       ORDER BY created_at DESC
       LIMIT $2`,
      [batchIds, logLimit],
    );
    for (const row of logResult.rows) {
      const batchId = String(row.batch_id || '');
      if (!failedByBatch.has(batchId)) failedByBatch.set(batchId, []);
      failedByBatch.get(batchId)?.push(mapEmailFailure(row));
    }
  }

  return {
    batches: batchResult.rows.map(row => ({
      id: String(row.id),
      mode: row.mode === 'all' ? 'all' : 'selected',
      mailKind: row.mail_kind === 'admin' ? 'admin' : 'notification',
      title: String(row.title || ''),
      subject: String(row.subject || ''),
      recipientCount: Number(row.recipient_count || 0),
      sentCount: Number(row.sent_count || 0),
      failedCount: Number(row.failed_count || 0),
      status: String(row.status || ''),
      createdAt: toIsoString(row.created_at),
      completedAt: row.completed_at ? toIsoString(row.completed_at) : null,
      failed: failedByBatch.get(String(row.id)) || [],
    })),
  };
}

export async function sendAdminEmailBatchInBackground(input: {
  client: PoolClient & { release?: () => void };
  batchId: string;
  recipients: AdminEmailRecipient[];
  mailKind: EmailTemplateKind;
  mailKindLabel: string;
  subject: string;
  title: string;
  content?: string;
  contentMode: 'markdown' | 'image';
  imageUrl?: string;
  imageAlt?: string;
  buttonText?: string;
  buttonUrl?: string;
  assetBaseUrl?: string;
  mode: AdminEmailMode;
  sendEmail?: (message: { to: string; recipient: AdminEmailRecipient }) => Promise<void>;
}): Promise<void> {
  const {
    client,
    batchId,
    recipients,
    mailKind,
    mailKindLabel,
    subject,
    title,
    content,
    contentMode,
    imageUrl,
    imageAlt,
    buttonText,
    buttonUrl,
    assetBaseUrl,
    mode,
    sendEmail,
  } = input;

  let sent = 0;
  let failed = 0;

  try {
    for (const recipient of recipients) {
      try {
        if (sendEmail) {
          await sendEmail({ to: recipient.email, recipient });
          await logSend(client, recipient.email, mailKind === 'admin' ? 'business' : 'announcement', mode === 'all' ? 'admin-broadcast' : 'admin-targeted', 'sent', undefined, {
            batchId,
            recipientUserId: recipient.id,
            subject,
          });
        } else {
          await sendTemplatedEmail(client, {
            to: recipient.email,
            type: mailKind === 'admin' ? 'business' : 'announcement',
            subject,
            title,
            body: contentMode === 'markdown' ? content : undefined,
            bodyMode: contentMode === 'image' ? 'image' : 'markdown',
            imageUrl: contentMode === 'image' ? imageUrl : undefined,
            imageAlt: contentMode === 'image' ? imageAlt || title : undefined,
            buttonText: buttonText || undefined,
            buttonUrl: buttonUrl || undefined,
            note: `这是一封${mailKindLabel}，请勿直接回复。`,
            templateKind: mailKind,
            ipAddress: mode === 'all' ? 'admin-broadcast' : 'admin-targeted',
            assetBaseUrl,
            batchId,
            recipientUserId: recipient.id,
          });
        }
        sent += 1;
      } catch (error) {
        failed += 1;
        if (sendEmail) {
          await logSend(client, recipient.email, mailKind === 'admin' ? 'business' : 'announcement', mode === 'all' ? 'admin-broadcast' : 'admin-targeted', 'failed', error instanceof Error ? error.message : String(error), {
            batchId,
            recipientUserId: recipient.id,
            subject,
          });
        }
      }
      await updateAdminEmailSendBatchProgress(client, batchId, { sentCount: sent, failedCount: failed });
    }

    await finishAdminEmailSendBatch(client, batchId, {
      sentCount: sent,
      failedCount: failed,
    });
  } catch (error) {
    console.error('[admin-email-batch] failed:', error);
    await finishAdminEmailSendBatch(client, batchId, {
      sentCount: sent,
      failedCount: Math.max(failed, recipients.length - sent),
    }).catch(() => undefined);
  } finally {
    client.release?.();
  }
}

export async function sendTemplatedEmail(client: PoolClient, input: {
  to: string;
  type: EmailMessageType;
  subject: string;
  title: string;
  intro?: string;
  body?: string;
  bodyMode?: 'markdown' | 'image';
  imageUrl?: string;
  imageAlt?: string;
  code?: string;
  buttonText?: string;
  buttonUrl?: string;
  note?: string;
  ipAddress?: string;
  assetBaseUrl?: string;
  templateKind?: EmailTemplateKind;
  batchId?: string;
  recipientUserId?: string | null;
}) {
  await ensureEmailSchema(client);
  const email = normalizeEmail(input.to);
  if (!isValidEmail(email)) throw new Error('邮箱地址格式不正确');
  const settings = await getEmailSettings(client);
  const renderedHtml = input.code
    ? renderVerificationEmailTemplate(settings, {
      title: input.title,
      intro: input.intro,
      code: input.code,
      note: input.note,
      assetBaseUrl: input.assetBaseUrl,
    })
    : renderEmailTemplate(settings, input);
  const prepared = await rewriteHtmlImagesWithInlineAttachments(renderedHtml, async key => ({
    content: await localStorage.readFileAsync(key),
    contentType: contentTypeForStorageKey(key),
    filename: key.split('/').pop(),
  }));
  try {
    await sendSmtpMail(settings, email, input.subject, prepared.html, prepared.attachments);
    await logSend(client, email, input.type, input.ipAddress || 'system', 'sent', undefined, {
      batchId: input.batchId,
      recipientUserId: input.recipientUserId,
      subject: input.subject,
    });
  } catch (error) {
    await logSend(client, email, input.type, input.ipAddress || 'system', 'failed', error instanceof Error ? error.message : String(error), {
      batchId: input.batchId,
      recipientUserId: input.recipientUserId,
      subject: input.subject,
    });
    throw error;
  }
}

function codeTitle(type: EmailCodeType) {
  if (type === 'register') return '注册邮箱验证码';
  if (type === 'verify_email') return '验证邮箱验证码';
  return '重置密码验证码';
}

function codeIntro(type: EmailCodeType) {
  if (type === 'register') return '你正在注册妙境账号，请在页面中输入以下验证码完成注册。';
  if (type === 'verify_email') return '你正在验证账号邮箱，请在个人中心输入以下验证码完成绑定。';
  return '你正在重置妙境账号密码，请在页面中输入以下验证码完成身份确认。';
}

export async function sendVerificationCode(client: PoolClient, request: Request, input: {
  email: string;
  type: EmailCodeType;
  userId?: string | null;
}) {
  await ensureEmailSchema(client);
  const email = normalizeEmail(input.email);
  if (!isValidEmail(email)) throw new Error('请输入正确的邮箱地址');

  await client.query(
    `DELETE FROM email_verification_codes
     WHERE expires_at < NOW() - INTERVAL '1 day' OR (is_used = true AND created_at < NOW() - INTERVAL '1 day')`,
  ).catch(() => undefined);

  const ip = getClientIp(request);
  const locked = await client.query(
    `SELECT locked_until FROM email_verification_codes
     WHERE LOWER(email) = LOWER($1) AND locked_until IS NOT NULL AND locked_until > NOW()
     ORDER BY locked_until DESC LIMIT 1`,
    [email],
  );
  if (locked.rows[0]) throw new Error('验证码错误次数过多，请 10 分钟后再试');

  const emailRate = await client.query(
    `SELECT COUNT(*)::int AS count FROM email_verification_codes
     WHERE LOWER(email) = LOWER($1) AND created_at > NOW() - INTERVAL '1 minute'`,
    [email],
  );
  if (Number(emailRate.rows[0]?.count || 0) >= 1) throw new Error('发送过于频繁，请 60 秒后再试');

  const ipRate = await client.query(
    `SELECT COUNT(*)::int AS count FROM email_verification_codes
     WHERE ip_address = $1 AND created_at > NOW() - INTERVAL '1 minute'`,
    [ip],
  );
  if (Number(ipRate.rows[0]?.count || 0) >= 3) throw new Error('当前网络请求过于频繁，请稍后再试');

  const settings = await getEmailSettings(client);
  const code = generateCode(settings.codeLength, settings.codeCharset);
  const codeHash = hashCode(email, input.type, code);

  await client.query(
    `UPDATE email_verification_codes
     SET is_used = true
     WHERE LOWER(email) = LOWER($1) AND type = $2 AND is_used = false`,
    [email, input.type],
  );
  await client.query(
    `INSERT INTO email_verification_codes (email, code_hash, type, user_id, ip_address, expires_at)
     VALUES ($1, $2, $3, $4, $5, NOW() + ($6 || ' minutes')::interval)`,
    [email, codeHash, input.type, input.userId || null, ip, settings.codeTtlMinutes],
  );

  try {
    await sendTemplatedEmail(client, {
      to: email,
      type: input.type,
      subject: `【${settings.appName}】${codeTitle(input.type)}`,
      title: codeTitle(input.type),
      intro: codeIntro(input.type),
      code,
      note: `验证码 ${settings.codeTtlMinutes} 分钟内有效，请勿转发给他人。若非本人操作，请忽略本邮件。`,
      ipAddress: ip,
      assetBaseUrl: getRequestBaseUrl(request) || undefined,
    });
  } catch (error) {
    await client.query(
      `UPDATE email_verification_codes
       SET is_used = true
       WHERE LOWER(email) = LOWER($1) AND type = $2 AND code_hash = $3`,
      [email, input.type, codeHash],
    ).catch(() => undefined);
    throw error;
  }

  return { success: true, expiresIn: settings.codeTtlMinutes * 60, cooldown: 60 };
}

export async function verifyEmailCode(client: PoolClient, input: {
  email: string;
  type: EmailCodeType;
  code: string;
  consume?: boolean;
}) {
  await ensureEmailSchema(client);
  const email = normalizeEmail(input.email);
  const code = typeof input.code === 'string' ? input.code.trim().toUpperCase() : '';
  if (!isValidEmail(email) || !/^[A-Z0-9]{4,10}$/.test(code)) {
    throw new Error('验证码格式不正确');
  }

  const result = await client.query(
    `SELECT id, code_hash, attempts, max_attempts, locked_until, expires_at, is_used
     FROM email_verification_codes
     WHERE LOWER(email) = LOWER($1) AND type = $2 AND is_used = false
     ORDER BY created_at DESC
     LIMIT 1
     FOR UPDATE`,
    [email, input.type],
  );
  const row = result.rows[0];
  if (!row) throw new Error('验证码不存在或已失效');
  if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
    throw new Error('验证码错误次数过多，请 10 分钟后再试');
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    throw new Error('验证码已过期，请重新获取');
  }

  const ok = row.code_hash === hashCode(email, input.type, code);
  if (!ok) {
    const attempts = Number(row.attempts || 0) + 1;
    const shouldLock = attempts >= Number(row.max_attempts || 5);
    await client.query(
      `UPDATE email_verification_codes
       SET attempts = $1, locked_until = CASE WHEN $2 THEN NOW() + INTERVAL '10 minutes' ELSE locked_until END
       WHERE id = $3`,
      [attempts, shouldLock, row.id],
    );
    throw new Error(shouldLock ? '验证码错误次数过多，请 10 分钟后再试' : '验证码不正确');
  }

  if (input.consume !== false) {
    await client.query(
      `UPDATE email_verification_codes
       SET is_used = true, used_at = NOW()
       WHERE id = $1`,
      [row.id],
    );
  }
  return { success: true };
}
