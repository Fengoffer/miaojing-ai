import type { ModelCapabilityConfig } from '@/lib/model-config-types';
import { getClientAuthToken, getClientAuthUserId } from '@/lib/client-auth';

/**
 * 自定义 API 密钥共享存储
 *
 * 使用 localStorage 持久化用户的自定义 API 密钥配置，
 * 并提供 React Hook 供各组件（个人中心、创作中心）共享访问。
 */

export interface CustomApiKey {
  id: string;
  provider: string;
  supplierName: string;  // 供应商名称
  apiUrl: string;
  modelName: string;
  note?: string;         // 展示备注，创作页优先显示
  manifestPath?: string; // 独立的用户级 API Manifest 文件路径；每个模型配置单独关联一个文件
  capabilities?: ModelCapabilityConfig; // Optional per-model UI parameter capabilities parsed from Manifest
  apiKey: string;        // Only populated while editing before save; persisted data stays masked.
  apiKeyPreview: string; // 脱敏预览
  type: 'image' | 'video' | 'text'; // 模型类型：生图模型 / 视频模型 / 多模态模型
  isActive: boolean;
  createdAt: string;
}

const STORAGE_KEY = 'miaojing_custom_api_keys';
const MIGRATION_KEY = 'miaojing_custom_api_keys_migrated_user';
const AUTH_EVENT_KEY = 'miaojing_auth_updated';

function storageKeyForUser(userId = getClientAuthUserId()): string {
  return userId ? `${STORAGE_KEY}:${userId}` : STORAGE_KEY;
}

function loadKeys(): CustomApiKey[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(storageKeyForUser());
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.map((key: CustomApiKey) => ({ ...key, apiKey: '' }))
      : [];
  } catch {
    return [];
  }
}

function saveKeys(keys: CustomApiKey[], notify = true): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(storageKeyForUser(), JSON.stringify(keys.map(key => ({ ...key, apiKey: '' }))));
  // Dispatch custom event so other tabs/components can react
  if (notify) window.dispatchEvent(new CustomEvent('custom-api-keys-updated'));
}

async function fetchServerKeys(): Promise<CustomApiKey[] | null> {
  const token = getClientAuthToken();
  if (!token) return null;
  const res = await fetch('/api/user-api-keys', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return Array.isArray(data.keys) ? data.keys : [];
}

async function persistServerKey(key: Partial<CustomApiKey>): Promise<CustomApiKey[]> {
  const token = getClientAuthToken();
  if (!token) throw new Error('Not logged in');
  const res = await fetch('/api/user-api-keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(key),
  });
  if (!res.ok) throw new Error('Failed to save API key');
  const latest = await fetchServerKeys();
  if (latest) saveKeys(latest, false);
  return latest || loadKeys();
}

async function deleteServerKey(id: string): Promise<CustomApiKey[]> {
  const token = getClientAuthToken();
  if (!token) throw new Error('Not logged in');
  await fetch(`/api/user-api-keys?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  const latest = await fetchServerKeys();
  if (latest) saveKeys(latest, false);
  return latest || loadKeys();
}

async function migrateLocalKeysIfNeeded(): Promise<CustomApiKey[] | null> {
  const token = getClientAuthToken();
  const userId = getClientAuthUserId();
  if (!token || !userId) return null;
  if (localStorage.getItem(MIGRATION_KEY) === userId) return fetchServerKeys();
  const rawLocalKeys = (() => {
    try {
      const raw = localStorage.getItem(storageKeyForUser(userId)) || localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })();
  const migratableKeys = rawLocalKeys.filter((key: CustomApiKey) => typeof key.apiKey === 'string' && key.apiKey.trim());
  if (migratableKeys.length > 0) {
    await fetch('/api/user-api-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ keys: migratableKeys }),
    });
  }
  localStorage.setItem(MIGRATION_KEY, userId);
  return fetchServerKeys();
}

export function getCustomApiKeys(): CustomApiKey[] {
  return loadKeys().filter(k => k.isActive);
}

export function addCustomApiKey(entry: Omit<CustomApiKey, 'id' | 'apiKeyPreview' | 'createdAt'>): CustomApiKey {
  const keys = loadKeys();
  const newKey: CustomApiKey = {
    ...entry,
    type: entry.type || 'image', // Default to image for backward compat
    supplierName: entry.supplierName || entry.provider, // Default to provider if supplierName not provided
    note: entry.note || '',
    id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    apiKeyPreview: entry.apiKey.length > 4 ? `***${entry.apiKey.slice(-4)}` : '****',
    createdAt: new Date().toISOString().split('T')[0],
  };
  keys.push(newKey);
  saveKeys(keys);
  return newKey;
}

export function updateCustomApiKey(id: string, updates: Partial<Omit<CustomApiKey, 'id' | 'createdAt'>>): CustomApiKey | null {
  const keys = loadKeys();
  const idx = keys.findIndex(k => k.id === id);
  if (idx === -1) return null;
  keys[idx] = { ...keys[idx], ...updates };
  if (updates.apiKey) {
    keys[idx].apiKeyPreview = updates.apiKey.length > 4 ? `***${updates.apiKey.slice(-4)}` : '****';
  }
  if (updates.supplierName) {
    keys[idx].supplierName = updates.supplierName;
  }
  if (updates.note !== undefined) {
    keys[idx].note = updates.note;
  }
  saveKeys(keys);
  return keys[idx];
}

export function deleteCustomApiKey(id: string): void {
  const keys = loadKeys().filter(k => k.id !== id);
  saveKeys(keys);
}

export function getCustomApiKeyById(id: string): CustomApiKey | undefined {
  return loadKeys().find(k => k.id === id);
}

/**
 * React Hook - 订阅自定义 API 密钥变更
 */
import { useState, useEffect, useCallback } from 'react';

export function useCustomApiKeys() {
  const [keys, setKeys] = useState<CustomApiKey[]>([]);

  // Load on mount
  useEffect(() => {
    setKeys(loadKeys());
    migrateLocalKeysIfNeeded().then(serverKeys => {
      if (serverKeys) {
        saveKeys(serverKeys, false);
        setKeys(serverKeys);
      }
    }).catch(() => { /* keep local fallback */ });

    // Listen for changes from this or other components
    const handler = () => {
      fetchServerKeys().then(serverKeys => {
        if (serverKeys) saveKeys(serverKeys, false);
        setKeys(serverKeys || loadKeys());
      }).catch(() => setKeys(loadKeys()));
    };
    window.addEventListener('custom-api-keys-updated', handler);
    window.addEventListener(AUTH_EVENT_KEY, handler);
    window.addEventListener('storage', handler); // cross-tab

    return () => {
      window.removeEventListener('custom-api-keys-updated', handler);
      window.removeEventListener(AUTH_EVENT_KEY, handler);
      window.removeEventListener('storage', handler);
    };
  }, []);

  const add = useCallback((entry: Omit<CustomApiKey, 'id' | 'apiKeyPreview' | 'createdAt'>) => {
    const newKey = addCustomApiKey(entry);
    setKeys(loadKeys());
    persistServerKey(newKey).then(setKeys).catch(() => { /* local fallback */ });
    return newKey;
  }, []);

  const update = useCallback((id: string, updates: Partial<Omit<CustomApiKey, 'id' | 'createdAt'>>) => {
    const result = updateCustomApiKey(id, updates);
    setKeys(loadKeys());
    if (result) persistServerKey(result).then(setKeys).catch(() => { /* local fallback */ });
    return result;
  }, []);

  const remove = useCallback((id: string) => {
    deleteCustomApiKey(id);
    setKeys(loadKeys());
    deleteServerKey(id).then(setKeys).catch(() => { /* local fallback */ });
  }, []);

  const toggleActive = useCallback((id: string) => {
    const key = loadKeys().find(k => k.id === id);
    if (key) {
      const result = updateCustomApiKey(id, { isActive: !key.isActive });
      setKeys(loadKeys());
      if (result) persistServerKey(result).then(setKeys).catch(() => { /* local fallback */ });
    }
  }, []);

  const refresh = useCallback(() => {
    fetchServerKeys().then(serverKeys => {
      if (serverKeys) saveKeys(serverKeys, false);
      setKeys(serverKeys || loadKeys());
    }).catch(() => setKeys(loadKeys()));
  }, []);

  // Active keys for use in creation center
  const activeKeys = keys.filter(k => k.isActive);

  // Active keys that are image-capable (type === 'image')
  const imageKeys = activeKeys.filter(k => k.type === 'image');

  // Active keys that are video-capable (type === 'video')
  const videoKeys = activeKeys.filter(k => k.type === 'video');

  // Active keys that are multimodal-capable (stored as type === 'text' for compatibility)
  const textKeys = activeKeys.filter(k => k.type === 'text');

  return { keys, activeKeys, imageKeys, videoKeys, textKeys, add, update, remove, toggleActive, refresh };
}
