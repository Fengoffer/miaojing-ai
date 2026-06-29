'use client';

export type StoredClientAuth = {
  user?: { id?: string } | null;
  accessToken?: unknown;
  session?: {
    access_token?: unknown;
  } | null;
};

const AUTH_STORAGE_KEY = 'miaojing_auth';
const AUTH_EVENT_KEY = 'miaojing_auth_updated';
const SESSION_TOKEN_PREFIX = 'mjst.v1';

function decodeBase64UrlJson(value: string): Record<string, unknown> | null {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return JSON.parse(window.atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isCurrentMiaojingSessionToken(token: string): boolean {
  const parts = token.split('.');
  if (parts.length !== 4 || `${parts[0]}.${parts[1]}` !== SESSION_TOKEN_PREFIX) return false;
  const payload = decodeBase64UrlJson(parts[2]);
  const exp = typeof payload?.exp === 'number' ? payload.exp : 0;
  if (!exp || exp < Date.now()) return false;
  return typeof payload?.sub === 'string' && /^[0-9a-fA-F-]{36}$/.test(payload.sub);
}

export function clearClientAuth(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
    window.dispatchEvent(new CustomEvent(AUTH_EVENT_KEY, {
      detail: { user: null, accessToken: null, isLoggedIn: false },
    }));
  } catch {
    // Best effort; callers still treat the session as unavailable.
  }
}

export function readClientAuth(): StoredClientAuth | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as StoredClientAuth : null;
  } catch {
    return null;
  }
}

export function getClientAuthToken(): string | null {
  const auth = readClientAuth();
  const token = typeof auth?.accessToken === 'string' && auth.accessToken.trim()
    ? auth.accessToken.trim()
    : typeof auth?.session?.access_token === 'string' && auth.session.access_token.trim()
      ? auth.session.access_token.trim()
      : '';
  if (token && !isCurrentMiaojingSessionToken(token)) {
    clearClientAuth();
    return null;
  }
  if (token) return token;
  return null;
}

export function getClientAuthUserId(): string | null {
  const userId = readClientAuth()?.user?.id;
  return typeof userId === 'string' && userId.trim() ? userId.trim() : null;
}

export function getClientAuthHeaders(token = getClientAuthToken()): HeadersInit {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function getRequiredClientAuthToken(): string {
  const token = getClientAuthToken();
  if (!token) {
    clearClientAuth();
    throw new Error('登录状态已过期，请重新登录');
  }
  return token;
}

export function handleClientAuthFailure(status: number, message?: string): void {
  if (status === 401 || /请先登录|登录状态|unauthorized|jwt|token/i.test(message || '')) {
    clearClientAuth();
  }
}
