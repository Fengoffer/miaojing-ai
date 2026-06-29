'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-store';
import { getClientAuthHeaders, handleClientAuthFailure } from '@/lib/client-auth';
import type { ManagedModelConfigResponse, ManagedSystemApi } from '@/lib/model-config-types';

export function buildModelConfigRequest(accessToken: string): { url: string; init: RequestInit } {
  const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const headers = new Headers(getClientAuthHeaders(accessToken));
  headers.set('Cache-Control', 'no-cache');
  headers.set('Pragma', 'no-cache');
  return {
    url: `/api/model-config?auth=1&nonce=${encodeURIComponent(nonce)}`,
    init: {
      headers,
      cache: 'no-store',
    },
  };
}

export function useManagedSystemApis() {
  const [systemApis, setSystemApis] = useState<ManagedSystemApi[]>([]);
  const { accessToken } = useAuth();

  useEffect(() => {
    if (!accessToken) {
      setSystemApis([]);
      return;
    }
    let cancelled = false;
    const request = buildModelConfigRequest(accessToken);
    fetch(request.url, request.init)
      .then(async res => {
        const data = await res.json().catch(() => null) as ManagedModelConfigResponse | { error?: string } | null;
        if (!res.ok) {
          const errorMessage = data && 'error' in data && typeof data.error === 'string' ? data.error : undefined;
          handleClientAuthFailure(res.status, errorMessage);
          return null;
        }
        return data as ManagedModelConfigResponse;
      })
      .then((data: ManagedModelConfigResponse | null) => {
        if (cancelled) return;
        setSystemApis((data?.systemApis || []).filter(api => api.isActive));
      })
      .catch(() => {
        if (!cancelled) setSystemApis([]);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  return systemApis;
}
