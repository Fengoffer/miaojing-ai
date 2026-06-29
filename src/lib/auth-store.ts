import React, { useCallback, useRef } from 'react';
import { clearClientAuth, getClientAuthHeaders, getClientAuthToken } from '@/lib/client-auth';

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  nickname: string;
  avatarUrl: string | null;
  role: 'guest' | 'user' | 'vip' | 'admin' | 'enterprise_admin' | 'enterprise_member';
  membershipTier: 'free' | 'basic' | 'pro' | 'max' | 'ultra' | 'enterprise';
  creditsBalance: number;
  dailyQuotaUsed: number;
  dailyQuotaLimit: number;
  phone: string | null;
  createdAt: string | null;
  emailVerified: boolean;
  emailVerifiedAt: string | null;
  preferredTheme: 'dark' | 'light';
  watermarkDisabled: boolean;
}

export interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  isLoggedIn: boolean;
}

const STORAGE_KEY = 'miaojing_auth';
const EVENT_KEY = 'miaojing_auth_updated';

export function readStoredAuth(): AuthState {
  if (typeof window === 'undefined') {
    return { user: null, accessToken: null, isLoggedIn: false };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { user: null, accessToken: null, isLoggedIn: false };
    const parsed = JSON.parse(raw) as Partial<AuthState> & { session?: { access_token?: unknown } };
    const accessToken = typeof parsed.accessToken === 'string' && parsed.accessToken
      ? parsed.accessToken
      : typeof parsed.session?.access_token === 'string'
        ? parsed.session.access_token
        : null;
    if (!parsed.user || !accessToken) {
      return { user: null, accessToken: null, isLoggedIn: false };
    }
    if (!getClientAuthToken()) {
      return { user: null, accessToken: null, isLoggedIn: false };
    }
    return {
      user: parsed.user,
      accessToken,
      isLoggedIn: true,
    };
  } catch {
    return { user: null, accessToken: null, isLoggedIn: false };
  }
}

function getStoredAuth(): AuthState {
  return readStoredAuth();
}

function setStoredAuth(state: AuthState): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent(EVENT_KEY, { detail: state }));
}

function clearStoredAuth(): void {
  if (typeof window === 'undefined') return;
  clearClientAuth();
}

export function parseApiUser(apiUser: Record<string, unknown>): AuthUser {
  return {
    id: (apiUser.id as string) || '',
    email: (apiUser.email as string) || '',
    username: (apiUser.username as string) || (apiUser.user_name as string) || (apiUser.nickname as string) || ((apiUser.email as string) || '').split('@')[0],
    nickname: (apiUser.display_nickname as string) || (apiUser.nickname as string) || (apiUser.username as string) || ((apiUser.email as string) || '').split('@')[0],
    avatarUrl: (apiUser.avatar_url as string | null) ?? null,
    role: (apiUser.role as AuthUser['role']) || 'user',
    membershipTier: (apiUser.membership_tier as AuthUser['membershipTier']) || 'free',
    creditsBalance: (apiUser.credits_balance as number) ?? 0,
    dailyQuotaUsed: (apiUser.daily_quota_used as number) ?? 0,
    dailyQuotaLimit: (apiUser.daily_quota_limit as number) ?? 5,
    phone: (apiUser.phone as string | null) ?? null,
    createdAt: (apiUser.created_at as string | null) ?? null,
    emailVerified: apiUser.email_verified === true,
    emailVerifiedAt: (apiUser.email_verified_at as string | null) ?? null,
    preferredTheme: apiUser.preferred_theme === 'light' ? 'light' : 'dark',
    watermarkDisabled: apiUser.watermark_disabled === true,
  };
}

export function useAuth() {
  const [authState, setAuthState] = React.useState<AuthState>(getStoredAuth);

  const userIdRef = useRef<string | null>(null);
  React.useEffect(() => {
    userIdRef.current = authState.user?.id ?? null;
  }, [authState.user?.id]);

  React.useEffect(() => {
    const handleCustomEvent = (e: Event) => {
      const detail = (e as CustomEvent<AuthState>).detail;
      setAuthState(detail);
    };

    const handleStorageEvent = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        setAuthState(getStoredAuth());
      }
    };

    window.addEventListener(EVENT_KEY, handleCustomEvent);
    window.addEventListener('storage', handleStorageEvent);

    return () => {
      window.removeEventListener(EVENT_KEY, handleCustomEvent);
      window.removeEventListener('storage', handleStorageEvent);
    };
  }, []);

  const login = (user: AuthUser, accessToken: string) => {
    const state: AuthState = { user, accessToken, isLoggedIn: true };
    setStoredAuth(state);
    setAuthState(state);
  };

  const logout = () => {
    clearStoredAuth();
    setAuthState({ user: null, accessToken: null, isLoggedIn: false });
  };

  const updateProfile = (updates: Partial<AuthUser>) => {
    if (!authState.user) return;
    const updatedUser = { ...authState.user, ...updates };
    const state: AuthState = { ...authState, user: updatedUser };
    setStoredAuth(state);
    setAuthState(state);
  };

  const isAdmin = authState.user?.role === 'admin' || authState.user?.role === 'enterprise_admin';
  const isVip = authState.user?.role === 'vip' || (
    !!authState.user?.membershipTier &&
    authState.user.membershipTier !== 'free'
  );

  const refreshProfile = useCallback(async () => {
    const userId = userIdRef.current;
    if (!userId) return;
    try {
      const token = getClientAuthToken();
      if (!token) return;
      const res = await fetch('/api/profile', {
        headers: getClientAuthHeaders(token),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.profile) {
          const previousTheme = getStoredAuth().user?.preferredTheme;
          const updatedUser = parseApiUser({
            id: userId,
            email: data.profile.email,
            ...data.profile,
          });
          if (previousTheme && !data.profile.preferred_theme) {
            updatedUser.preferredTheme = previousTheme;
          }
          // Preserve admin role: if current user is admin, never downgrade
          const currentState = getStoredAuth();
          if (currentState.user?.role === 'admin') {
            updatedUser.role = 'admin';
            updatedUser.membershipTier = 'ultra';
            updatedUser.creditsBalance = 9999;
            updatedUser.dailyQuotaLimit = 999;
          }
          const state: AuthState = { ...currentState, user: updatedUser };
          setStoredAuth(state);
          setAuthState(state);
        }
      } else if (res.status === 401) {
        clearStoredAuth();
        setAuthState({ user: null, accessToken: null, isLoggedIn: false });
      }
    } catch { /* non-critical */ }
  }, []);

  React.useEffect(() => {
    if (!authState.isLoggedIn) return;
    let lastRefreshAt = 0;
    const refreshIfNeeded = () => {
      const now = Date.now();
      if (now - lastRefreshAt < 3000) return;
      lastRefreshAt = now;
      refreshProfile();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshIfNeeded();
    };

    window.addEventListener('focus', refreshIfNeeded);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('focus', refreshIfNeeded);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [authState.isLoggedIn, refreshProfile]);

  return {
    ...authState,
    login,
    logout,
    updateProfile,
    refreshProfile,
    isAdmin,
    isVip,
  };
}
