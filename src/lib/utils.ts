import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { getClientAuthToken } from '@/lib/client-auth';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type ClipboardCopyResult = 'copied' | 'manual' | 'failed';

function openManualCopyDialog(value: string): ClipboardCopyResult {
  const existing = document.getElementById('miaojing-manual-copy-dialog');
  existing?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'miaojing-manual-copy-dialog';
  overlay.style.position = 'fixed';
  overlay.style.inset = '0';
  overlay.style.zIndex = '2147483647';
  overlay.style.display = 'flex';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  overlay.style.padding = '24px';
  overlay.style.background = 'rgba(16, 12, 8, 0.52)';
  overlay.style.backdropFilter = 'blur(8px)';
  overlay.style.pointerEvents = 'auto';

  const panel = document.createElement('div');
  panel.style.width = 'min(720px, 100%)';
  panel.style.maxHeight = 'min(620px, 90vh)';
  panel.style.display = 'flex';
  panel.style.flexDirection = 'column';
  panel.style.gap = '12px';
  panel.style.padding = '18px';
  panel.style.borderRadius = '18px';
  panel.style.border = '1px solid rgba(120, 82, 38, 0.22)';
  panel.style.background = 'rgba(255, 252, 246, 0.98)';
  panel.style.boxShadow = '0 24px 80px rgba(0, 0, 0, 0.28)';
  panel.style.color = '#24170f';

  const title = document.createElement('div');
  title.textContent = '浏览器限制了自动复制';
  title.style.fontSize = '16px';
  title.style.fontWeight = '700';

  const help = document.createElement('div');
  help.textContent = '下面的提示词已自动选中，请按 Ctrl+C 复制；Mac 请按 Command+C。';
  help.style.fontSize = '13px';
  help.style.lineHeight = '1.6';
  help.style.color = '#6f5f4d';

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.readOnly = true;
  textarea.style.width = '100%';
  textarea.style.minHeight = '260px';
  textarea.style.maxHeight = '46vh';
  textarea.style.resize = 'vertical';
  textarea.style.padding = '12px';
  textarea.style.borderRadius = '12px';
  textarea.style.border = '1px solid rgba(120, 82, 38, 0.22)';
  textarea.style.background = '#fffaf2';
  textarea.style.color = '#24170f';
  textarea.style.fontSize = '13px';
  textarea.style.lineHeight = '1.65';
  textarea.style.outline = 'none';
  textarea.style.userSelect = 'text';
  textarea.style.webkitUserSelect = 'text';

  const actions = document.createElement('div');
  actions.style.display = 'flex';
  actions.style.justifyContent = 'flex-end';
  actions.style.gap = '10px';

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.textContent = '关闭';
  closeButton.style.height = '36px';
  closeButton.style.padding = '0 14px';
  closeButton.style.borderRadius = '10px';
  closeButton.style.border = '1px solid rgba(120, 82, 38, 0.22)';
  closeButton.style.background = '#ffffff';
  closeButton.style.color = '#24170f';
  closeButton.style.cursor = 'pointer';

  const stopDialogEvent = (event: Event) => {
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') {
      event.stopImmediatePropagation();
    }
  };
  const stopOverlayDoubleClick = (event: Event) => {
    stopDialogEvent(event);
    if (event.target === overlay) event.preventDefault();
  };
  const guardedEvents = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'touchstart', 'touchend'] as const;
  guardedEvents.forEach(eventName => {
    overlay.addEventListener(eventName, eventName === 'dblclick' ? stopOverlayDoubleClick : stopDialogEvent, true);
  });
  textarea.addEventListener('dblclick', stopDialogEvent, true);
  panel.addEventListener('dblclick', stopDialogEvent, true);

  const close = () => {
    window.removeEventListener('keydown', handleKeyDown, true);
    guardedEvents.forEach(eventName => {
      overlay.removeEventListener(eventName, eventName === 'dblclick' ? stopOverlayDoubleClick : stopDialogEvent, true);
    });
    textarea.removeEventListener('dblclick', stopDialogEvent, true);
    panel.removeEventListener('dblclick', stopDialogEvent, true);
    overlay.remove();
  };
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') close();
  };
  closeButton.addEventListener('click', close);
  window.addEventListener('keydown', handleKeyDown, true);

  actions.appendChild(closeButton);
  panel.append(title, help, textarea, actions);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  window.setTimeout(() => {
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, value.length);
  }, 0);

  return 'manual';
}

export async function copyTextToClipboard(text: string): Promise<ClipboardCopyResult> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return 'failed';

  const value = text.trim();
  if (!value) return 'failed';

  if (navigator.clipboard?.writeText && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(value);
      return 'copied';
    } catch {
      return openManualCopyDialog(value);
    }
  }

  return openManualCopyDialog(value);
}

/**
 * Download a file from a URL using the server-side proxy to bypass CORS.
 *
 * Why not fetch() directly? S3 presigned URLs and other remote URLs
 * often don't have CORS headers for the browser origin, causing
 * client-side fetch() to fail. The /api/download proxy fetches
 * server-side (no CORS restriction) and returns the file with
 * Content-Disposition header.
 */
export async function downloadFile(
  url: string,
  filename: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const token = getStoredAccessTokenForDownload();
    const proxyUrl = getDownloadProxyUrl(url, filename, { includeDownloadToken: false });
    const response = await fetch(proxyUrl, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({ error: '下载失败' }));
      return { ok: false, error: data.error || '下载失败' };
    }

    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(blobUrl);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : '下载失败';
    return { ok: false, error: msg };
  }
}

export function getImageDownloadExtension(url: string, preferredFormat?: string | null): string {
  const normalizedUrlExtension = normalizeImageDownloadExtension(getImageExtensionFromUrl(url));
  if (normalizedUrlExtension) return normalizedUrlExtension;

  const normalizedFormat = normalizeImageDownloadExtension(preferredFormat);
  if (normalizedFormat) return normalizedFormat;

  const normalizedDataUrlExtension = normalizeImageDownloadExtension(getImageExtensionFromDataUrl(url));
  return normalizedDataUrlExtension || 'png';
}

export function getDownloadProxyUrl(
  url: string,
  filename: string,
  options: { includeDownloadToken?: boolean } = {},
): string {
  const params = new URLSearchParams({
    url,
    filename,
  });
  if (options.includeDownloadToken !== false) {
    const token = getStoredAccessTokenForDownload();
    if (token) params.set('downloadToken', token);
  }
  return `/api/download?${params.toString()}`;
}

export function triggerDownloadFile(url: string, filename: string): void {
  const proxyUrl = getDownloadProxyUrl(url, filename);
  const link = document.createElement('a');
  link.href = proxyUrl;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function getStoredAccessTokenForDownload(): string | null {
  return getClientAuthToken();
}

function getImageExtensionFromUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith('data:')) return null;

  try {
    const base = typeof window !== 'undefined' ? window.location.href : 'http://localhost';
    const pathname = new URL(trimmed, base).pathname;
    return pathname.split('.').pop()?.toLowerCase() || null;
  } catch {
    const pathname = trimmed.split('?')[0].split('#')[0];
    return pathname.split('.').pop()?.toLowerCase() || null;
  }
}

function getImageExtensionFromDataUrl(url: string): string | null {
  const match = url.match(/^data:(image\/[^;,]+)/i);
  if (!match) return null;
  return match[1].split('/')[1]?.toLowerCase() || null;
}

function normalizeImageDownloadExtension(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'jpg' || normalized === 'jpeg') return 'jpg';
  if (normalized === 'png' || normalized === 'webp' || normalized === 'gif') return normalized;
  return null;
}

/**
 * Safely parse a fetch Response as JSON.
 * Handles empty bodies, HTML error pages, and non-JSON responses gracefully.
 * Returns { ok, data, error } instead of throwing.
 */
export async function safeParseJson<T = Record<string, unknown>>(res: Response): Promise<{
  ok: boolean;
  data: T | null;
  error: string | null;
}> {
  // Check Content-Type to detect HTML responses early
  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');

  if (!res.ok) {
    // Error response - try to extract meaningful message
    try {
      const text = await res.text();

      // HTML error page (Cloudflare, nginx, etc.)
      if (text.trim().startsWith('<!') || text.trim().startsWith('<html') || text.trim().startsWith('<HTML')) {
        return {
          ok: false,
          data: null,
          error: `服务器返回错误页面 (HTTP ${res.status})，可能原因：API 服务异常或代理防火墙拦截了请求`,
        };
      }

      // Try parsing as JSON error
      try {
        const json = JSON.parse(text);
        const errorMsg = json.error || json.message || json.msg || `请求失败 (HTTP ${res.status})`;
        return { ok: false, data: null, error: typeof errorMsg === 'string' ? errorMsg : String(errorMsg) };
      } catch {
        // Plain text error
        return {
          ok: false,
          data: null,
          error: text.slice(0, 200) || `请求失败 (HTTP ${res.status})`,
        };
      }
    } catch {
      return { ok: false, data: null, error: `请求失败 (HTTP ${res.status})` };
    }
  }

  // Success response - parse JSON
  try {
    const text = await res.text();

    if (!text.trim()) {
      return { ok: false, data: null, error: '服务器返回了空响应' };
    }

    try {
      const data = JSON.parse(text) as T;
      return { ok: true, data, error: null };
    } catch {
      // Response is not JSON
      if (!isJson && (text.trim().startsWith('<!') || text.trim().startsWith('<html'))) {
        return { ok: false, data: null, error: '服务器返回了错误页面而非 JSON 数据，可能是代理防火墙拦截' };
      }
      return { ok: false, data: null, error: '服务器返回了无法解析的响应' };
    }
  } catch {
    return { ok: false, data: null, error: '读取响应失败' };
  }
}
