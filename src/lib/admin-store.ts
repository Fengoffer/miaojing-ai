/**
 * Admin Store - manages system configuration for the admin panel
 *
 * Stores: system settings, user list, pricing, payment settings.
 * Storage: localStorage for non-secret UI config; system API secrets are
 * stored server-side and only masked metadata is cached in the browser.
 */

import { useState, useEffect, useCallback } from 'react';
import { getClientAuthToken } from '@/lib/client-auth';

// ---- Types ----

export interface SystemApiConfig {
  id: string;
  provider?: string;       // Provider name, multiple models can share one provider
  name: string;           // Display name, e.g. "See Dream v5.0"
  apiUrl: string;          // Full endpoint URL
  modelName: string;       // Model ID to send in request
  modelGroup?: string;     // New API-style model group, e.g. default / vip / image
  note?: string;           // Display note shown first in creation model selectors
  apiKey: '';             // Never expose server-side keys to the browser
  apiKeyPreview: string;   // e.g. "sk-...abc"
  type: 'image' | 'video' | 'text'; // What this API generates
  creditsPerUse: number;   // Credits consumed per generation
  billingMode?: 'free' | 'fixed' | 'ratio' | 'token' | 'duration';
  fixedPrice?: number;
  durationPricePerSecond?: number;
  inputPricePer1K?: number;
  outputPricePer1K?: number;
  modelRatio?: number;
  completionRatio?: number;
  groupRatio?: number;
  priceNote?: string;
  manifestPath?: string;
  isDefault?: boolean;
  allowedMembershipTiers?: Array<'free' | 'pro' | 'max' | 'ultra'>;
  pollingMode?: 'sequential' | 'random' | 'custom';
  pollingOrder?: number;
  videoUsageModes?: Array<'text-to-video' | 'image-to-video'>;
  isActive: boolean;
  sortOrder: number;
}

export interface ManagedUser {
  id: string;
  email: string;
  nickname: string;
  role: 'user' | 'vip' | 'admin' | 'enterprise_admin' | 'enterprise_member';
  membershipTier: 'free' | 'basic' | 'pro' | 'max' | 'ultra' | 'enterprise';
  creditsBalance: number;
  dailyQuotaLimit: number;
  dailyQuotaUsed: number;
  watermarkDisabled?: boolean;
  status: 'active' | 'suspended' | 'banned';
  createdAt: string;
}

export interface MembershipPlan {
  tier: 'free' | 'basic' | 'pro' | 'max' | 'ultra' | 'enterprise';
  name: string;
  price: number;        // Monthly price in CNY
  credits: number;      // Monthly included credits
  dailyQuota: number;   // Daily generation quota
  features: string[];   // Feature descriptions
}

export interface PaymentMethod {
  id: string;
  type: 'alipay' | 'wechat' | 'stripe' | 'manual';
  name: string;
  isActive: boolean;
  config: Record<string, string>; // e.g. { appId, merchantId, apiKey }
}

export interface CreditPricing {
  id: string;
  name: string;        // e.g. "100 积分包"
  credits: number;
  price: number;       // Price in CNY
  bonusCredits: number; // Bonus credits
  isPopular: boolean;
}

export interface CreditTransaction {
  id: string;
  userId: string;
  userEmail: string;
  type: 'topup' | 'deduct' | 'set' | 'grant' | 'consume' | 'refund';
  amount: number;        // Positive = credits added, Negative = credits removed
  balanceAfter: number;  // Balance after this transaction
  reason: string;        // e.g. "管理员手动充值", "系统赠送"
  operatorId: string;    // Who made the change (admin user id or 'system')
  createdAt: string;
}

export interface AdminConfig {
  showBillingPlan: boolean;
  systemApis: SystemApiConfig[];
  users: ManagedUser[];
  membershipPlans: MembershipPlan[];
  paymentMethods: PaymentMethod[];
  creditPricings: CreditPricing[];
  creditTransactions: CreditTransaction[];
}

// ---- Default Data ----

const DEFAULT_SYSTEM_APIS: SystemApiConfig[] = [
  {
    id: 'sys-api-1',
    provider: '系统默认',
    name: 'See Dream v5.0',
    apiUrl: '',
    modelName: 'doubao-seedream-5-0-260128',
    apiKey: '',
    apiKeyPreview: '',
    type: 'image',
    creditsPerUse: 10,
    isActive: false,
    sortOrder: 0,
  },
  {
    id: 'sys-api-2',
    provider: '系统默认',
    name: 'SeeDance Pro',
    apiUrl: '',
    modelName: 'doubao-seedance-1-5-pro-251215',
    apiKey: '',
    apiKeyPreview: '',
    type: 'video',
    creditsPerUse: 30,
    isActive: false,
    sortOrder: 1,
  },
];

const DEFAULT_USERS: ManagedUser[] = [];

const DEFAULT_MEMBERSHIP_PLANS: MembershipPlan[] = [
  {
    tier: 'free',
    name: '免费版',
    price: 0,
    credits: 10,
    dailyQuota: 5,
    features: ['每日5次生成', '10初始积分', '基础模型', '720p视频'],
  },
  {
    tier: 'pro',
    name: 'Pro版',
    price: 29,
    credits: 100,
    dailyQuota: 20,
    features: ['每日20次生成', '每月100积分', '全部图片模型', '720p视频', '创作历史'],
  },
  {
    tier: 'max',
    name: 'Max版',
    price: 99,
    credits: 500,
    dailyQuota: 50,
    features: ['每日50次生成', '每月500积分', '全部模型', '1080p视频', '优先队列', 'API接入'],
  },
  {
    tier: 'ultra',
    name: 'Ultra版',
    price: 299,
    credits: 9999,
    dailyQuota: 999,
    features: ['无限次生成', '充足积分', '全部模型+优先', '4K视频', '专属客服', '自定义模型'],
  },
];

const DEFAULT_PAYMENT_METHODS: PaymentMethod[] = [
  { id: 'pm-alipay', type: 'alipay', name: '支付宝', isActive: true, config: {} },
  { id: 'pm-wechat', type: 'wechat', name: '微信支付', isActive: false, config: {} },
  { id: 'pm-manual', type: 'manual', name: '手动转账', isActive: false, config: {} },
];

const DEFAULT_CREDIT_PRICINGS: CreditPricing[] = [
  { id: 'cp-100', name: '100 积分', credits: 100, price: 9.9, bonusCredits: 0, isPopular: false },
  { id: 'cp-500', name: '500 积分', credits: 500, price: 39.9, bonusCredits: 50, isPopular: true },
  { id: 'cp-1000', name: '1000 积分', credits: 1000, price: 69.9, bonusCredits: 150, isPopular: false },
  { id: 'cp-5000', name: '5000 积分', credits: 5000, price: 299, bonusCredits: 1000, isPopular: false },
];

const DEFAULT_CONFIG: AdminConfig = {
  showBillingPlan: false,
  systemApis: DEFAULT_SYSTEM_APIS,
  users: DEFAULT_USERS,
  membershipPlans: DEFAULT_MEMBERSHIP_PLANS,
  paymentMethods: DEFAULT_PAYMENT_METHODS,
  creditPricings: DEFAULT_CREDIT_PRICINGS,
  creditTransactions: [],
};

// ---- Storage ----

const STORAGE_KEY = 'miaojing_admin_config';
const EVENT_KEY = 'miaojing_admin_updated';
const SECRET_CONFIG_KEY_PATTERN = /(key|secret|private)/i;

type SystemApiInput = Omit<SystemApiConfig, 'id' | 'sortOrder' | 'apiKey' | 'apiKeyPreview'> & {
  apiKey?: string;
  apiKeyPreview?: string;
  sortOrder?: number;
};

function normalizeSystemApiMembershipTier(tier: unknown): 'free' | 'pro' | 'max' | 'ultra' {
  if (tier === 'basic') return 'pro';
  if (tier === 'enterprise') return 'ultra';
  if (tier === 'pro' || tier === 'max' || tier === 'ultra' || tier === 'free') return tier;
  return 'free';
}

function normalizeAllowedMembershipTiers(tiers: SystemApiConfig['allowedMembershipTiers'] | undefined): Array<'free' | 'pro' | 'max' | 'ultra'> {
  const normalized = (Array.isArray(tiers) ? tiers : [])
    .map(normalizeSystemApiMembershipTier)
    .filter((tier, index, arr) => arr.indexOf(tier) === index);
  return normalized.length > 0 ? normalized : ['free', 'pro', 'max', 'ultra'];
}

function normalizeVideoUsageModes(modes: SystemApiConfig['videoUsageModes'] | undefined): Array<'text-to-video' | 'image-to-video'> {
  const normalized = (Array.isArray(modes) ? modes : [])
    .filter((mode): mode is 'text-to-video' | 'image-to-video' => mode === 'text-to-video' || mode === 'image-to-video')
    .filter((mode, index, arr) => arr.indexOf(mode) === index);
  return normalized.length > 0 ? normalized : ['text-to-video', 'image-to-video'];
}

function sanitizeSystemApi(api: SystemApiConfig): SystemApiConfig {
  return {
    ...api,
    provider: api.provider || '',
    modelGroup: api.modelGroup || 'default',
    note: api.note || '',
    apiKey: '',
    apiKeyPreview: api.apiKeyPreview || '',
    billingMode: api.billingMode || 'fixed',
    fixedPrice: Number(api.fixedPrice || 0),
    durationPricePerSecond: Number(api.durationPricePerSecond || 0),
    inputPricePer1K: Number(api.inputPricePer1K || 0),
    outputPricePer1K: Number(api.outputPricePer1K || 0),
    modelRatio: Number(api.modelRatio || 1),
    completionRatio: Number(api.completionRatio || 1),
    groupRatio: Number(api.groupRatio || 1),
    priceNote: api.priceNote || '',
    manifestPath: api.manifestPath || '',
    isDefault: api.isDefault !== false,
    allowedMembershipTiers: normalizeAllowedMembershipTiers(api.allowedMembershipTiers),
    pollingMode: api.pollingMode === 'random' || api.pollingMode === 'custom' ? api.pollingMode : 'sequential',
    pollingOrder: Number(api.pollingOrder || 0),
    videoUsageModes: normalizeVideoUsageModes(api.videoUsageModes),
  };
}

function sanitizeConfig(config: AdminConfig): AdminConfig {
  return {
    ...config,
    systemApis: (config.systemApis || []).map(api => sanitizeSystemApi(api)),
    paymentMethods: (config.paymentMethods || []).map(method => ({
      ...method,
      config: Object.fromEntries(
        Object.entries(method.config || {}).map(([key, value]) => [
          key,
          SECRET_CONFIG_KEY_PATTERN.test(key) && value && !String(value).startsWith('***') ? '****' : String(value),
        ]),
      ),
    })),
  };
}

function normalizeMembershipTier(tier: string | undefined): MembershipPlan['tier'] {
  if (tier === 'basic') return 'pro';
  if (tier === 'enterprise') return 'ultra';
  if (tier === 'max' || tier === 'ultra' || tier === 'pro' || tier === 'free') return tier;
  return 'free';
}

function normalizeConfig(config: AdminConfig): AdminConfig {
  const storedPlans = Array.isArray(config.membershipPlans) ? config.membershipPlans : [];
  const plans = DEFAULT_MEMBERSHIP_PLANS.map(defaultPlan => {
    const legacyTier = defaultPlan.tier === 'pro' ? 'basic' : defaultPlan.tier === 'ultra' ? 'enterprise' : defaultPlan.tier;
    const stored = storedPlans.find(plan => normalizeMembershipTier(plan.tier) === defaultPlan.tier || plan.tier === legacyTier);
    return stored
      ? { ...defaultPlan, ...stored, tier: defaultPlan.tier, name: defaultPlan.name }
      : defaultPlan;
  });

  return sanitizeConfig({
    ...DEFAULT_CONFIG,
    ...config,
    membershipPlans: plans,
    users: (config.users || []).map(user => ({
      ...user,
      membershipTier: normalizeMembershipTier(user.membershipTier),
    })),
    systemApis: (config.systemApis || []).map(api => sanitizeSystemApi(api)),
  });
}

function getStoredConfig(): AdminConfig {
  if (typeof window === 'undefined') return DEFAULT_CONFIG;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    return normalizeConfig({ ...DEFAULT_CONFIG, ...JSON.parse(raw) });
  } catch {
    return DEFAULT_CONFIG;
  }
}

function setStoredConfig(config: AdminConfig): void {
  if (typeof window === 'undefined') return;
  const safeConfig = sanitizeConfig(config);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(safeConfig));
  } catch (e) {
    console.warn('[AdminStore] localStorage 写入失败:', e);
  }
  // 无论 localStorage 是否成功，都通知其他组件更新
  window.dispatchEvent(new CustomEvent(EVENT_KEY, { detail: safeConfig }));
}

function authHeaders(): HeadersInit {
  const token = getClientAuthToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function fetchSystemApis(): Promise<SystemApiConfig[] | null> {
  const token = getClientAuthToken();
  if (!token) return null;
  const res = await fetch('/api/admin/system-apis', {
    headers: authHeaders(),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return Array.isArray(data.apis) ? data.apis.map((api: SystemApiConfig) => sanitizeSystemApi(api)) : [];
}

async function saveSystemApi(
  api: Partial<Omit<SystemApiConfig, 'apiKey'>> & { id?: string; apiKey?: string },
  method: 'POST' | 'PUT',
) {
  const res = await fetch('/api/admin/system-apis', {
    method,
    headers: authHeaders(),
    body: JSON.stringify(api),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || '系统 API 保存失败');
  }
  return fetchSystemApis();
}

async function deleteSystemApi(id: string) {
  const res = await fetch(`/api/admin/system-apis?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || '系统 API 删除失败');
  }
  return fetchSystemApis();
}

async function fetchPaymentMethods(): Promise<PaymentMethod[] | null> {
  const token = getClientAuthToken();
  if (!token) return null;
  const res = await fetch('/api/admin/payment-methods', {
    headers: authHeaders(),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return Array.isArray(data.paymentMethods) ? data.paymentMethods : [];
}

async function savePaymentMethod(id: string, updates: Partial<PaymentMethod>) {
  const res = await fetch('/api/admin/payment-methods', {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ id, ...updates }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || '支付配置保存失败');
  }
  const data = await res.json();
  return Array.isArray(data.paymentMethods) ? data.paymentMethods as PaymentMethod[] : [];
}

// ---- Hook ----

export function useAdminConfig() {
  const [config, setConfig] = useState<AdminConfig>(DEFAULT_CONFIG);

  // Load from localStorage on mount (client-only)
  useEffect(() => {
    setConfig(getStoredConfig());
    fetchSystemApis().then(apis => {
      if (!apis) return;
      setConfig(prev => ({ ...prev, systemApis: apis }));
      Promise.resolve().then(() => setStoredConfig({ ...getStoredConfig(), systemApis: apis }));
    }).catch(() => undefined);
    fetchPaymentMethods().then(paymentMethods => {
      if (!paymentMethods) return;
      setConfig(prev => ({ ...prev, paymentMethods }));
      Promise.resolve().then(() => setStoredConfig({ ...getStoredConfig(), paymentMethods }));
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    const handleCustom = (e: Event) => setConfig((e as CustomEvent<AdminConfig>).detail);
    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setConfig(getStoredConfig());
    };
    window.addEventListener(EVENT_KEY, handleCustom);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(EVENT_KEY, handleCustom);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const update = useCallback((updater: (prev: AdminConfig) => AdminConfig) => {
    setConfig(prev => {
      const next = updater(prev);
      // Defer localStorage write and event dispatch to avoid triggering
      // event handlers during the state update cycle
      Promise.resolve().then(() => setStoredConfig(next));
      return next;
    });
  }, []);

  // ---- System API methods ----
  const replaceSystemApis = useCallback((apis: SystemApiConfig[]) => {
    const safeApis = apis.map(api => sanitizeSystemApi(api));
    setConfig(prev => {
      const next = { ...prev, systemApis: safeApis };
      Promise.resolve().then(() => setStoredConfig(next));
      return next;
    });
  }, []);

  const addSystemApi = useCallback(async (api: SystemApiInput) => {
    const apis = await saveSystemApi(api, 'POST');
    if (apis) replaceSystemApis(apis);
  }, [replaceSystemApis]);

  const updateSystemApi = useCallback(async (id: string, updates: Partial<SystemApiInput>) => {
    const current = config.systemApis.find(api => api.id === id);
    const apis = await saveSystemApi({ ...current, ...updates, id }, 'PUT');
    if (apis) replaceSystemApis(apis);
  }, [config.systemApis, replaceSystemApis]);

  const removeSystemApi = useCallback(async (id: string) => {
    const apis = await deleteSystemApi(id);
    if (apis) replaceSystemApis(apis);
  }, [replaceSystemApis]);

  const toggleSystemApi = useCallback(async (id: string) => {
    const current = config.systemApis.find(api => api.id === id);
    if (current) {
      const apis = await saveSystemApi({ ...current, id, isActive: !current.isActive }, 'PUT');
      if (apis) replaceSystemApis(apis);
    }
  }, [config.systemApis, replaceSystemApis]);

  const refreshSystemApis = useCallback(async () => {
    const apis = await fetchSystemApis();
    if (apis) replaceSystemApis(apis);
    return apis;
  }, [replaceSystemApis]);

  // ---- User management methods ----
  const addUser = useCallback((user: Omit<ManagedUser, 'id' | 'createdAt' | 'dailyQuotaUsed'>) => {
    update(prev => ({
      ...prev,
      users: [...prev.users, {
        ...user,
        id: `user-${Date.now()}`,
        dailyQuotaUsed: 0,
        createdAt: new Date().toISOString().split('T')[0],
      }],
    }));
  }, [update]);

  const updateUser = useCallback((id: string, updates: Partial<ManagedUser>) => {
    update(prev => ({
      ...prev,
      users: prev.users.map(u => u.id === id ? { ...u, ...updates } : u),
    }));
  }, [update]);

  const removeUser = useCallback((id: string) => {
    update(prev => ({
      ...prev,
      users: prev.users.filter(u => u.id !== id),
    }));
  }, [update]);

  // ---- Membership plan methods ----
  const updateMembershipPlan = useCallback((tier: string, updates: Partial<MembershipPlan>) => {
    update(prev => ({
      ...prev,
      membershipPlans: prev.membershipPlans.map(p => p.tier === tier ? { ...p, ...updates } : p),
    }));
  }, [update]);

  // ---- Payment method methods ----
  const replacePaymentMethods = useCallback((paymentMethods: PaymentMethod[]) => {
    setConfig(prev => {
      const next = { ...prev, paymentMethods };
      Promise.resolve().then(() => setStoredConfig(next));
      return next;
    });
  }, []);

  const togglePaymentMethod = useCallback(async (id: string) => {
    const current = config.paymentMethods.find(method => method.id === id);
    if (!current) return;
    const paymentMethods = await savePaymentMethod(id, { isActive: !current.isActive });
    replacePaymentMethods(paymentMethods);
  }, [config.paymentMethods, replacePaymentMethods]);

  const updatePaymentMethod = useCallback(async (id: string, updates: Partial<PaymentMethod>) => {
    const paymentMethods = await savePaymentMethod(id, updates);
    replacePaymentMethods(paymentMethods);
  }, [replacePaymentMethods]);

  // ---- Credit pricing methods ----
  const addCreditPricing = useCallback((pricing: Omit<CreditPricing, 'id'>) => {
    update(prev => ({
      ...prev,
      creditPricings: [...prev.creditPricings, { ...pricing, id: `cp-${Date.now()}` }],
    }));
  }, [update]);

  const updateCreditPricing = useCallback((id: string, updates: Partial<CreditPricing>) => {
    update(prev => ({
      ...prev,
      creditPricings: prev.creditPricings.map(p => p.id === id ? { ...p, ...updates } : p),
    }));
  }, [update]);

  const removeCreditPricing = useCallback((id: string) => {
    update(prev => ({
      ...prev,
      creditPricings: prev.creditPricings.filter(p => p.id !== id),
    }));
  }, [update]);

  // ---- Credit adjustment methods ----
  const adjustUserCredits = useCallback((params: {
    userId: string;
    type: CreditTransaction['type'];
    amount: number;
    reason: string;
    operatorId?: string;
  }) => {
    update(prev => {
      const user = prev.users.find(u => u.id === params.userId);
      if (!user) return prev;
      const newBalance = Math.max(0, user.creditsBalance + params.amount);
      const tx: CreditTransaction = {
        id: `tx-${Date.now()}`,
        userId: params.userId,
        userEmail: user.email,
        type: params.type,
        amount: params.amount,
        balanceAfter: newBalance,
        reason: params.reason,
        operatorId: params.operatorId || 'admin',
        createdAt: new Date().toISOString(),
      };
      return {
        ...prev,
        users: prev.users.map(u => u.id === params.userId ? { ...u, creditsBalance: newBalance } : u),
        creditTransactions: [tx, ...prev.creditTransactions].slice(0, 500), // keep last 500
      };
    });
  }, [update]);

  const setUserCredits = useCallback((params: {
    userId: string;
    balance: number;
    reason: string;
    operatorId?: string;
  }) => {
    update(prev => {
      const user = prev.users.find(u => u.id === params.userId);
      if (!user) return prev;
      const tx: CreditTransaction = {
        id: `tx-${Date.now()}`,
        userId: params.userId,
        userEmail: user.email,
        type: 'set',
        amount: params.balance - user.creditsBalance,
        balanceAfter: params.balance,
        reason: params.reason,
        operatorId: params.operatorId || 'admin',
        createdAt: new Date().toISOString(),
      };
      return {
        ...prev,
        users: prev.users.map(u => u.id === params.userId ? { ...u, creditsBalance: params.balance } : u),
        creditTransactions: [tx, ...prev.creditTransactions].slice(0, 500),
      };
    });
  }, [update]);

  // ---- Feature toggle methods ----
  const setShowBillingPlan = useCallback((show: boolean) => {
    update(prev => ({ ...prev, showBillingPlan: show }));
  }, [update]);

  return {
    config,
    // System APIs
    addSystemApi,
    updateSystemApi,
    removeSystemApi,
    toggleSystemApi,
    refreshSystemApis,
    // Users
    addUser,
    updateUser,
    removeUser,
    // Credits
    adjustUserCredits,
    setUserCredits,
    // Membership
    updateMembershipPlan,
    // Payments
    togglePaymentMethod,
    updatePaymentMethod,
    // Credits pricing
    addCreditPricing,
    updateCreditPricing,
    removeCreditPricing,
    // Feature toggles
    setShowBillingPlan,
  };
}
