'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth-store';
import { useAdminConfig, type SystemApiConfig } from '@/lib/admin-store';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useSiteConfig } from '@/lib/site-config';
import type { ManagedApiProvider, ManagedModelRecommendation, ManagedModelType } from '@/lib/model-config-types';
import { Bot, Check, ClipboardPaste, Coins, Copy, Edit3, Film, Globe, Image, Key, Loader2, MessageSquare, Plus, Save, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

const MODEL_TYPE_LABELS: Record<ManagedModelType, string> = {
  image: '\u751f\u56fe\u6a21\u578b',
  video: '\u89c6\u9891\u6a21\u578b',
  text: '\u6587\u672c\u6a21\u578b',
};

type SystemApiBillingMode = 'free' | 'fixed' | 'ratio' | 'token' | 'duration';

const BILLING_MODE_LABELS: Record<SystemApiBillingMode, string> = {
  free: '免费模型',
  fixed: '按次计费',
  ratio: '倍率计费',
  token: 'Token 计费',
  duration: '按秒计费',
};

const POLLING_MODE_LABELS: Record<'sequential' | 'random' | 'custom', string> = {
  sequential: '顺序轮询',
  random: '随机轮询',
  custom: '自定义顺序',
};

const MEMBERSHIP_TIER_OPTIONS: Array<{ value: 'free' | 'pro' | 'max' | 'ultra'; label: string }> = [
  { value: 'free', label: '免费' },
  { value: 'pro', label: 'Pro' },
  { value: 'max', label: 'Max' },
  { value: 'ultra', label: 'Ultra' },
];

const SYSTEM_API_PROVIDER_OPTIONS = ['mozheAPI', 'New API', 'Agnes AI'] as const;

function formatSystemApiPricing(api: SystemApiConfig): string {
  const billingMode = api.billingMode || 'fixed';
  if (billingMode === 'free') {
    return '免费使用，不消耗积分';
  }
  if (billingMode === 'token') {
    return `输入 ${api.inputPricePer1K ?? 0} / 1M tokens，输出 ${api.outputPricePer1K ?? 0} / 1M tokens`;
  }
  if (billingMode === 'duration') {
    return `每秒 ${api.durationPricePerSecond ?? 0} 积分`;
  }
  if (billingMode === 'ratio') {
    return `倍率：模型 ${api.modelRatio ?? 1}x / 补全 ${api.completionRatio ?? 1}x / 分组 ${api.groupRatio ?? 1}x`;
  }
  return `每次 ${api.fixedPrice || api.creditsPerUse || 0} 积分`;
}

const SMART_IMPORT_DEFAULT_CONFIG = `{
  "customProviders": [
    {
      "id": "custom-image-provider",
      "name": "自定义图片服务商",
      "submit": {
        "path": "images/generations",
        "method": "POST",
        "contentType": "json",
        "body": {
          "model": "$profile.model",
          "prompt": "$prompt",
          "size": "$params.size",
          "quality": "$params.quality",
          "n": "$params.n"
        },
        "result": {
          "imageUrlPaths": ["data.*.url"],
          "b64JsonPaths": ["data.*.b64_json"]
        }
      }
    }
  ],
  "profiles": [
    {
      "name": "自定义图片模型",
      "provider": "custom-image-provider",
      "baseUrl": "https://api.example.com/v1",
      "model": "gpt-image-2",
      "apiMode": "images"
    }
  ]
}`;

const SMART_IMPORT_PROMPT = `你是 API 文档解析助手。请根据用户提供的图像、视频或文本生成 API 文档，输出妙境后台可导入的 JSON。

先解析文档。如果 API 文档或 API 文档链接里没有找到中转服务商的 API Base URL 或完整请求端点，不要输出 JSON；请提示用户去中转平台文档中找到 API Base URL 或完整请求端点后再发给你。不要把 OpenAI 官方默认地址当作中转地址，除非文档明确写的就是 OpenAI 官方域名。

信息完整时，只输出一个 json 代码块。JSON 顶层必须包含 customProviders 和 profiles。

customProviders 每项字段：
- id：服务商唯一标识。
- name：服务商名称。
- submit：提交接口，包含 path、method、contentType、query、body、taskIdPath、result。
- editSubmit：图生图/重绘接口，可选。
- poll：异步任务查询接口，可选，包含 path、method、intervalSeconds、statusPath、successValues、failureValues、errorPath、result。

result 支持：
- imageUrlPaths、b64JsonPaths、videoUrlPaths、b64VideoPaths，路径支持 * 通配数组。

模板变量支持：
- $profile.model、$prompt、$params.size、$params.quality、$params.output_format、$params.output_compression、$params.moderation、$params.n、$params.aspect_ratio
- $inputImages.dataUrls、$mask.dataUrl

profiles 每项字段：
- name：后台系统 API 显示名称。
- provider：customProviders 中对应 id。
- baseUrl：API Base URL，必须来自文档里的中转地址或用户补充的中转地址。
- model：模型 ID。
- apiMode：images、videos 或 text。
- capabilities：可选，描述该模型在创作窗口可选的参数。字段包含 aspectRatios、resolutions、qualities、outputFormats，每项是 [{"value":"...","label":"..."}]。常用 aspectRatios: 1:1、16:9、9:16、4:3、3:4；resolutions 可以使用 1080P、2K、4K 或文档明确支持的像素值如 1024x1024、1536x1024、1024x1536；qualities 按文档使用 high、medium、low、auto 或服务商自己的枚举值。

不要输出 API Key、Authorization header 或解释文字。`;

function authHeaders(accessToken: string | null): HeadersInit {
  return {
    'Content-Type': 'application/json',
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  };
}

function SectionMenu<T extends string>({
  items,
  activeValue,
  onChange,
}: {
  items: Array<{ value: T; label: string; description?: string }>;
  activeValue: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card p-1">
      <div className="flex min-w-max gap-1">
        {items.map(item => {
          const active = activeValue === item.value;
          return (
            <button
              key={item.value}
              type="button"
              onClick={() => onChange(item.value)}
              className={`min-w-40 rounded-md px-4 py-3 text-left transition-colors ${
                active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
              }`}
            >
              <span className="block text-sm font-semibold">{item.label}</span>
              {item.description && <span className="mt-1 block text-xs opacity-75">{item.description}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

type SystemApiProviderGroup = {
  provider: string;
  apis: SystemApiConfig[];
};

type ApiManagementSection = 'providers' | 'recommendations' | 'system' | 'smart';
// ============================================================
// Tab 1: API Management
// ============================================================

export default function ApiManagementTab() {
  const { accessToken } = useAuth();
  const { config: siteConfig } = useSiteConfig();
  const { config, addSystemApi, updateSystemApi, removeSystemApi, toggleSystemApi, refreshSystemApis } = useAdminConfig();
  const membershipEnabled = siteConfig.membershipEnabled !== false;
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [providers, setProviders] = useState<ManagedApiProvider[]>([]);
  const [recommendations, setRecommendations] = useState<ManagedModelRecommendation[]>([]);
  const [modelConfigLoading, setModelConfigLoading] = useState(false);
  const [providerSearch, setProviderSearch] = useState('');
  const [providerPage, setProviderPage] = useState(1);
  const [providerPageSize, setProviderPageSize] = useState(10);
  const [showProviderForm, setShowProviderForm] = useState(false);
  const [recommendationSearch, setRecommendationSearch] = useState('');
  const [recommendationPage, setRecommendationPage] = useState(1);
  const [recommendationPageSize, setRecommendationPageSize] = useState(10);
  const [showRecommendationForm, setShowRecommendationForm] = useState(false);
  const [activeSection, setActiveSection] = useState<ApiManagementSection>('providers');
  const [smartConfigText, setSmartConfigText] = useState(SMART_IMPORT_DEFAULT_CONFIG);
  const [smartImporting, setSmartImporting] = useState(false);
  const [agnesInstalling, setAgnesInstalling] = useState(false);
  const [systemProviderView, setSystemProviderView] = useState<string | null>(null);
  const [systemTypeView, setSystemTypeView] = useState<'image' | 'video' | 'text' | null>(null);

  const [providerEditingId, setProviderEditingId] = useState<string | null>(null);
  const [providerName, setProviderName] = useState('');
  const [providerUrl, setProviderUrl] = useState('');
  const [providerModel, setProviderModel] = useState('');
  const [providerType, setProviderType] = useState<ManagedModelType>('image');
  const [providerWebsite, setProviderWebsite] = useState('');
  const [providerSortOrder, setProviderSortOrder] = useState('0');
  const [providerActive, setProviderActive] = useState(true);

  const [recommendationEditingId, setRecommendationEditingId] = useState<string | null>(null);
  const [recommendationModelName, setRecommendationModelName] = useState('');
  const [recommendationDisplayName, setRecommendationDisplayName] = useState('');
  const [recommendationType, setRecommendationType] = useState<ManagedModelType>('image');
  const [recommendationProviderId, setRecommendationProviderId] = useState('');
  const [recommendationSortOrder, setRecommendationSortOrder] = useState('0');
  const [recommendationActive, setRecommendationActive] = useState(true);

  // Form state
  const [formName, setFormName] = useState('');
  const [formProvider, setFormProvider] = useState('');
  const [formApiUrl, setFormApiUrl] = useState('');
  const [formModelName, setFormModelName] = useState('');
  const [formModelGroup, setFormModelGroup] = useState('default');
  const [formNote, setFormNote] = useState('');
  const [formApiKey, setFormApiKey] = useState('');
  const [formType, setFormType] = useState<'image' | 'video' | 'text'>('image');
  const [formCredits, setFormCredits] = useState('10');
  const [formBillingMode, setFormBillingMode] = useState<SystemApiBillingMode>('fixed');
  const [formFixedPrice, setFormFixedPrice] = useState('0');
  const [formDurationPricePerSecond, setFormDurationPricePerSecond] = useState('0');
  const [formInputPricePer1K, setFormInputPricePer1K] = useState('0');
  const [formOutputPricePer1K, setFormOutputPricePer1K] = useState('0');
  const [formModelRatio, setFormModelRatio] = useState('1');
  const [formCompletionRatio, setFormCompletionRatio] = useState('1');
  const [formGroupRatio, setFormGroupRatio] = useState('1');
  const [formPriceNote, setFormPriceNote] = useState('');
  const [formIsDefault, setFormIsDefault] = useState(true);
  const [formAllowedTiers, setFormAllowedTiers] = useState<Array<'free' | 'pro' | 'max' | 'ultra'>>(['free', 'pro', 'max', 'ultra']);
  const [formPollingMode, setFormPollingMode] = useState<'sequential' | 'random' | 'custom'>('sequential');
  const [formPollingOrder, setFormPollingOrder] = useState('0');
  const [formVideoUsageModes, setFormVideoUsageModes] = useState<Array<'text-to-video' | 'image-to-video'>>(['text-to-video', 'image-to-video']);

  useEffect(() => {
    if (formType !== 'video' && formBillingMode === 'duration') setFormBillingMode('fixed');
  }, [formBillingMode, formType]);

  const providerSearchTerm = providerSearch.trim().toLowerCase();
  const filteredProviders = providerSearchTerm
    ? providers.filter(provider => [
        provider.name,
        provider.defaultApiUrl,
        provider.defaultModel,
        provider.website || '',
        MODEL_TYPE_LABELS[provider.type],
      ].join(' ').toLowerCase().includes(providerSearchTerm))
    : providers;
  const totalProviderPages = Math.max(1, Math.ceil(filteredProviders.length / providerPageSize));
  const visibleProviders = filteredProviders.slice(
    (providerPage - 1) * providerPageSize,
    providerPage * providerPageSize
  );
  const recommendationSearchTerm = recommendationSearch.trim().toLowerCase();
  const filteredRecommendations = recommendationSearchTerm
    ? recommendations.filter(recommendation => {
        const boundProvider = providers.find(provider => provider.id === recommendation.providerId);
        return [
          recommendation.modelName,
          recommendation.displayName,
          MODEL_TYPE_LABELS[recommendation.type],
          boundProvider?.name || '全部供应商',
        ].join(' ').toLowerCase().includes(recommendationSearchTerm);
      })
    : recommendations;
  const totalRecommendationPages = Math.max(1, Math.ceil(filteredRecommendations.length / recommendationPageSize));
  const visibleRecommendations = filteredRecommendations.slice(
    (recommendationPage - 1) * recommendationPageSize,
    recommendationPage * recommendationPageSize
  );

  const isSmartConfigJson = (value: string) => {
    try {
      const trimmed = value.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1').trim();
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      return !!parsed && typeof parsed === 'object' && (
        Array.isArray(parsed.customProviders) ||
        !!parsed.submit ||
        !!parsed.editSubmit
      );
    } catch {
      return false;
    }
  };

  const fetchModelConfig = useCallback(async () => {
    setModelConfigLoading(true);
    try {
      const [providersRes, recommendationsRes] = await Promise.all([
        fetch('/api/admin/providers', { headers: authHeaders(accessToken) }),
        fetch('/api/admin/model-recommendations', { headers: authHeaders(accessToken) }),
      ]);
      const providersData = await providersRes.json();
      const recommendationsData = await recommendationsRes.json();
      if (!providersRes.ok) throw new Error(providersData.error || '供应商配置加载失败');
      if (!recommendationsRes.ok) throw new Error(recommendationsData.error || '推荐模型加载失败');
      setProviders(providersData.providers || []);
      setRecommendations(recommendationsData.recommendations || []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '模型配置加载失败');
    } finally {
      setModelConfigLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    fetchModelConfig();
  }, [fetchModelConfig]);

  useEffect(() => {
    setProviderPage(page => Math.min(page, totalProviderPages));
  }, [totalProviderPages]);

  useEffect(() => {
    setRecommendationPage(page => Math.min(page, totalRecommendationPages));
  }, [totalRecommendationPages]);

  const resetProviderForm = () => {
    setProviderEditingId(null);
    setProviderName('');
    setProviderUrl('');
    setProviderModel('');
    setProviderType('image');
    setProviderWebsite('');
    setProviderSortOrder('0');
    setProviderActive(true);
  };

  const startProviderEdit = (provider: ManagedApiProvider) => {
    setProviderEditingId(provider.id);
    setProviderName(provider.name);
    setProviderUrl(provider.defaultApiUrl);
    setProviderModel(provider.defaultModel);
    setProviderType(provider.type);
    setProviderWebsite(provider.website || '');
    setProviderSortOrder(String(provider.sortOrder));
    setProviderActive(provider.isActive);
  };

  const saveProvider = async () => {
    if (!providerName.trim()) {
      toast.error('请填写供应商名称');
      return;
    }
    try {
      const res = await fetch('/api/admin/providers', {
        method: providerEditingId ? 'PUT' : 'POST',
        headers: authHeaders(accessToken),
        body: JSON.stringify({
          id: providerEditingId,
          name: providerName,
          defaultApiUrl: providerUrl,
          defaultModel: providerModel,
          type: providerType,
          website: providerWebsite,
          isActive: providerActive,
          sortOrder: Number(providerSortOrder) || 0,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || '保存失败');
      toast.success(providerEditingId ? '供应商已更新' : '供应商已添加');
      resetProviderForm();
      setShowProviderForm(false);
      fetchModelConfig();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    }
  };

  const toggleProvider = async (provider: ManagedApiProvider) => {
    try {
      const res = await fetch('/api/admin/providers', {
        method: 'PUT',
        headers: authHeaders(accessToken),
        body: JSON.stringify({ ...provider, isActive: !provider.isActive }),
      });
      if (!res.ok) throw new Error((await res.json()).error || '操作失败');
      fetchModelConfig();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  const deleteProvider = async (id: string) => {
    try {
      const res = await fetch('/api/admin/providers', {
        method: 'DELETE',
        headers: authHeaders(accessToken),
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error((await res.json()).error || '删除失败');
      toast.success('供应商已删除');
      fetchModelConfig();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  const resetRecommendationForm = () => {
    setRecommendationEditingId(null);
    setRecommendationModelName('');
    setRecommendationDisplayName('');
    setRecommendationType('image');
    setRecommendationProviderId('');
    setRecommendationSortOrder('0');
    setRecommendationActive(true);
  };

  const startRecommendationEdit = (recommendation: ManagedModelRecommendation) => {
    setRecommendationEditingId(recommendation.id);
    setRecommendationModelName(recommendation.modelName);
    setRecommendationDisplayName(recommendation.displayName);
    setRecommendationType(recommendation.type);
    setRecommendationProviderId(recommendation.providerId || '');
    setRecommendationSortOrder(String(recommendation.sortOrder));
    setRecommendationActive(recommendation.isActive);
  };

  const saveRecommendation = async () => {
    if (!recommendationModelName.trim()) {
      toast.error('请填写模型名称');
      return;
    }
    try {
      const res = await fetch('/api/admin/model-recommendations', {
        method: recommendationEditingId ? 'PUT' : 'POST',
        headers: authHeaders(accessToken),
        body: JSON.stringify({
          id: recommendationEditingId,
          modelName: recommendationModelName,
          displayName: recommendationDisplayName || recommendationModelName,
          type: recommendationType,
          providerId: recommendationProviderId || null,
          isActive: recommendationActive,
          sortOrder: Number(recommendationSortOrder) || 0,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || '保存失败');
      toast.success(recommendationEditingId ? '推荐模型已更新' : '推荐模型已添加');
      resetRecommendationForm();
      setShowRecommendationForm(false);
      fetchModelConfig();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    }
  };

  const toggleRecommendation = async (recommendation: ManagedModelRecommendation) => {
    try {
      const res = await fetch('/api/admin/model-recommendations', {
        method: 'PUT',
        headers: authHeaders(accessToken),
        body: JSON.stringify({ ...recommendation, isActive: !recommendation.isActive }),
      });
      if (!res.ok) throw new Error((await res.json()).error || '操作失败');
      fetchModelConfig();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  const deleteRecommendation = async (id: string) => {
    try {
      const res = await fetch('/api/admin/model-recommendations', {
        method: 'DELETE',
        headers: authHeaders(accessToken),
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error((await res.json()).error || '删除失败');
      toast.success('推荐模型已删除');
      fetchModelConfig();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  const copySmartPrompt = async () => {
    try {
      await navigator.clipboard.writeText(SMART_IMPORT_PROMPT);
      toast.success('生成提示词已复制');
    } catch {
      toast.error('复制失败，请检查浏览器剪贴板权限');
    }
  };

  const pasteSmartConfig = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        toast.error('剪贴板为空');
        return;
      }
      setSmartConfigText(text.trim());
      toast.success('已从剪贴板粘贴配置');
    } catch {
      toast.error('无法读取剪贴板，请手动粘贴配置');
    }
  };

  const importSmartConfig = async (configText = smartConfigText) => {
    const trimmedConfig = configText.trim();
    if (!trimmedConfig) {
      toast.error('请先填写 JSON 配置');
      return;
    }
    if (!isSmartConfigJson(trimmedConfig)) {
      toast.error('配置不是可导入的 API Manifest JSON');
      return;
    }
    setSmartImporting(true);
    try {
      const res = await fetch('/api/admin/system-apis/smart-import', {
        method: 'POST',
        headers: authHeaders(accessToken),
        body: JSON.stringify({ configText: trimmedConfig }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '导入失败');
      await refreshSystemApis();
      toast.success(data.message || '系统 API 配置已导入');
      setActiveSection('system');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导入失败');
    } finally {
      setSmartImporting(false);
    }
  };

  const pasteAndImportSmartConfig = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const trimmed = text.trim();
      if (!trimmed) {
        toast.error('剪贴板为空');
        return;
      }
      setSmartConfigText(trimmed);
      await importSmartConfig(trimmed);
    } catch {
      toast.error('无法读取剪贴板，请手动粘贴配置');
    }
  };

  const installAgnesTemplates = async () => {
    setAgnesInstalling(true);
    try {
      const res = await fetch('/api/admin/system-apis/agnes-capabilities', {
        method: 'POST',
        headers: authHeaders(accessToken),
        body: JSON.stringify({
          syncImageModels: true,
          syncVideoModels: true,
          syncTextModels: true,
          allowedMembershipTiers: ['free', 'pro', 'max', 'ultra'],
          isDefault: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '安装 Agnes 免费模型失败');
      await refreshSystemApis();
      setSystemProviderView('Agnes AI');
      setSystemTypeView(null);
      toast.success(data.message || '已安装 Agnes 免费模型，请填写 API Key 后启用');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '安装 Agnes 免费模型失败');
    } finally {
      setAgnesInstalling(false);
    }
  };

  const toggleAllowedTier = (tier: 'free' | 'pro' | 'max' | 'ultra', checked: boolean) => {
    setFormAllowedTiers(prev => {
      const next = checked ? [...prev, tier] : prev.filter(item => item !== tier);
      return next.length > 0 ? next : prev;
    });
  };

  const toggleVideoUsageMode = (mode: 'text-to-video' | 'image-to-video', checked: boolean) => {
    setFormVideoUsageModes(prev => {
      const next = checked ? [...prev, mode] : prev.filter(item => item !== mode);
      return next.length > 0 ? Array.from(new Set(next)) : prev;
    });
  };

  const resetForm = () => {
    setFormName(''); setFormProvider(''); setFormApiUrl(''); setFormModelName(''); setFormModelGroup('default'); setFormNote(''); setFormApiKey('');
    setFormType('image'); setFormCredits('10'); setFormBillingMode('fixed'); setFormFixedPrice('0'); setFormDurationPricePerSecond('0'); setFormInputPricePer1K('0'); setFormOutputPricePer1K('0');
    setFormModelRatio('1'); setFormCompletionRatio('1'); setFormGroupRatio('1'); setFormPriceNote('');
    setFormIsDefault(true); setFormAllowedTiers(['free', 'pro', 'max', 'ultra']); setFormPollingMode('sequential'); setFormPollingOrder('0'); setFormVideoUsageModes(['text-to-video', 'image-to-video']); setEditingId(null); setShowForm(false);
  };

  const startEdit = (api: SystemApiConfig) => {
    setFormName(api.name); setFormProvider(api.provider || ''); setFormApiUrl(api.apiUrl); setFormModelName(api.modelName); setFormNote(api.note || '');
    setFormModelGroup(api.modelGroup || 'default'); setFormApiKey(''); setFormType(api.type); setFormCredits(String(api.creditsPerUse));
    setFormBillingMode(api.billingMode || 'fixed'); setFormFixedPrice(String(api.fixedPrice ?? 0));
    setFormDurationPricePerSecond(String(api.durationPricePerSecond ?? 0));
    setFormInputPricePer1K(String(api.inputPricePer1K ?? 0)); setFormOutputPricePer1K(String(api.outputPricePer1K ?? 0));
    setFormModelRatio(String(api.modelRatio ?? 1)); setFormCompletionRatio(String(api.completionRatio ?? 1));
    setFormGroupRatio(String(api.groupRatio ?? 1)); setFormPriceNote(api.priceNote || '');
    setFormIsDefault(api.isDefault !== false);
    setFormAllowedTiers(api.allowedMembershipTiers?.length ? api.allowedMembershipTiers : ['free', 'pro', 'max', 'ultra']);
    setFormPollingMode(api.pollingMode === 'random' || api.pollingMode === 'custom' ? api.pollingMode : 'sequential');
    setFormPollingOrder(String(api.pollingOrder ?? api.sortOrder ?? 0));
    setFormVideoUsageModes(api.videoUsageModes?.length ? api.videoUsageModes : ['text-to-video', 'image-to-video']);
    setEditingId(api.id); setShowForm(true);
  };

  const handleSave = async () => {
    if (!formName || !formModelName) {
      toast.error('请填写模型名称和显示名称');
      return;
    }
    const existingSystemApi = editingId ? config.systemApis.find(api => api.id === editingId) : null;
    const shouldActivateAfterSave = editingId
      ? Boolean(existingSystemApi?.isActive || formApiKey.trim())
      : true;
    const data = {
      name: formName,
      provider: formProvider,
      apiUrl: formApiUrl,
      modelName: formModelName,
      modelGroup: formModelGroup || 'default',
      note: formNote,
      apiKey: formApiKey,
      type: formType,
      creditsPerUse: formBillingMode === 'free' ? 0 : Number(formCredits) || 10,
      billingMode: formBillingMode,
      fixedPrice: formBillingMode === 'free' ? 0 : Number(formFixedPrice) || 0,
      durationPricePerSecond: formBillingMode === 'free' ? 0 : Number(formDurationPricePerSecond) || 0,
      inputPricePer1K: formBillingMode === 'free' ? 0 : Number(formInputPricePer1K) || 0,
      outputPricePer1K: formBillingMode === 'free' ? 0 : Number(formOutputPricePer1K) || 0,
      modelRatio: Number(formModelRatio) || 1,
      completionRatio: Number(formCompletionRatio) || 1,
      groupRatio: Number(formGroupRatio) || 1,
      priceNote: formPriceNote,
      isDefault: formIsDefault,
      allowedMembershipTiers: formAllowedTiers,
      pollingMode: formPollingMode,
      pollingOrder: Number(formPollingOrder) || 0,
      videoUsageModes: formVideoUsageModes,
      isActive: shouldActivateAfterSave,
    };

    try {
      if (editingId) {
        await updateSystemApi(editingId, data);
        toast.success('API 已更新');
      } else {
        await addSystemApi(data);
        toast.success('API 已添加');
      }
      resetForm();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    }
  };

  const systemProviderGroups: SystemApiProviderGroup[] = Object.values(config.systemApis.reduce<Record<string, SystemApiProviderGroup>>((acc, api) => {
    const providerName = api.provider || '未命名供应商';
    if (!acc[providerName]) acc[providerName] = { provider: providerName, apis: [] };
    acc[providerName].apis.push(api);
    return acc;
  }, {})).sort((a, b) => a.provider.localeCompare(b.provider));
  const selectedSystemProviderGroup = systemProviderGroups.find(group => group.provider === systemProviderView) || null;
  const selectedSystemTypeApis = selectedSystemProviderGroup?.apis.filter(api => api.type === systemTypeView) || [];

  const startAddSystemApiForProvider = (group: { provider: string; apis: SystemApiConfig[] }, type?: 'image' | 'video' | 'text') => {
    const seed = type ? group.apis.find(api => api.type === type) || group.apis[0] : group.apis[0];
    resetForm();
    setFormProvider(group.provider);
    setFormModelGroup(seed?.modelGroup || 'default');
    setFormApiUrl(seed?.apiUrl || '');
    setFormApiKey('');
    setFormType(type || seed?.type || 'image');
    setShowForm(true);
  };

  const renderSystemProviderField = () => (
    <div className="space-y-2">
      <Label>供应商</Label>
      <Input placeholder="如: mozheAPI / New API" value={formProvider} onChange={e => setFormProvider(e.target.value)} />
      <div className="flex flex-wrap gap-2">
        {SYSTEM_API_PROVIDER_OPTIONS.map(providerName => (
          <Button
            key={providerName}
            type="button"
            variant={formProvider === providerName ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFormProvider(providerName)}
          >
            {providerName}
          </Button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">只有选择 New API 时才会启用 NewAPI 兼容参数；mozheAPI 和其他供应商保持原调用参数。</p>
    </div>
  );

  const renderAvailabilityFields = () => (
    <div className="space-y-4 rounded-lg border border-border/70 bg-muted/20 p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold">平台开放范围</h4>
          <p className="text-xs text-muted-foreground">控制该模型是否出现在创作端，以及哪些会员等级可以使用。</p>
        </div>
        <Switch checked={formIsDefault} onCheckedChange={setFormIsDefault} />
      </div>
      <div className="space-y-2">
        <Label>允许使用的会员等级</Label>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {MEMBERSHIP_TIER_OPTIONS.map(tier => (
            <label key={tier.value} className="flex items-center gap-2 rounded-md border border-border/60 bg-background/70 px-3 py-2 text-sm">
              <Checkbox
                checked={formAllowedTiers.includes(tier.value)}
                onCheckedChange={checked => toggleAllowedTier(tier.value, checked === true)}
              />
              {tier.label}
            </label>
          ))}
        </div>
      </div>
    </div>
  );

  const renderPollingFields = () => (
    <div className="space-y-4 rounded-lg border border-border/70 bg-muted/20 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold">默认模型轮询</h4>
          <p className="text-xs text-muted-foreground">同一类型、同一模型名称下的系统默认 API 会按这里的策略依次尝试；用户自定义 API 不受影响。</p>
        </div>
        <Badge variant="outline">{POLLING_MODE_LABELS[formPollingMode]}</Badge>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label>轮询模式</Label>
          <Select value={formPollingMode} onValueChange={v => setFormPollingMode(v as 'sequential' | 'random' | 'custom')}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="sequential">顺序轮询（按列表排序）</SelectItem>
              <SelectItem value="random">随机轮询</SelectItem>
              <SelectItem value="custom">自定义顺序（按轮询序号）</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>轮询序号</Label>
          <Input type="number" value={formPollingOrder} onChange={e => setFormPollingOrder(e.target.value)} />
          <p className="text-xs text-muted-foreground">自定义顺序越小越先调用；失败或没有结果时自动尝试下一个供应商。</p>
        </div>
      </div>
    </div>
  );

  const renderVideoUsageFields = () => {
    if (formType !== 'video') return null;
    return (
      <div className="space-y-3 rounded-lg border border-border/70 bg-muted/20 p-4">
        <div>
          <h4 className="text-sm font-semibold">视频模型适用入口</h4>
          <p className="text-xs text-muted-foreground">控制该视频模型在前端文生视频、图生视频哪个入口显示；两个都选则两个入口都可用。</p>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="flex items-center gap-2 rounded-md border border-border/60 bg-background/70 px-3 py-2 text-sm">
            <Checkbox
              checked={formVideoUsageModes.includes('text-to-video')}
              onCheckedChange={checked => toggleVideoUsageMode('text-to-video', checked === true)}
            />
            文生视频
          </label>
          <label className="flex items-center gap-2 rounded-md border border-border/60 bg-background/70 px-3 py-2 text-sm">
            <Checkbox
              checked={formVideoUsageModes.includes('image-to-video')}
              onCheckedChange={checked => toggleVideoUsageMode('image-to-video', checked === true)}
            />
            图生视频
          </label>
        </div>
      </div>
    );
  };

  const renderPricingFields = () => (
    <div className="space-y-4 rounded-lg border border-border/70 bg-muted/20 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold">模型分组与定价</h4>
          <p className="text-xs text-muted-foreground">参考 New API 的模型分组和倍率设置；这里配置的是平台全局积分定价。</p>
        </div>
        <Badge variant="outline">{BILLING_MODE_LABELS[formBillingMode]}</Badge>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="space-y-2">
          <Label>模型分组</Label>
          <Input placeholder="default / vip / image" value={formModelGroup} onChange={e => setFormModelGroup(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>计费模式</Label>
          <Select value={formBillingMode} onValueChange={v => setFormBillingMode(v as SystemApiBillingMode)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="free">免费模型</SelectItem>
              <SelectItem value="fixed">按次计费</SelectItem>
              {formType === 'video' && <SelectItem value="duration">按秒计费</SelectItem>}
              <SelectItem value="ratio">倍率计费</SelectItem>
              <SelectItem value="token">Token 计费</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {formBillingMode !== 'free' && (
          <div className="space-y-2">
            <Label>每次积分</Label>
            <Input type="number" step="0.0001" value={formFixedPrice} onChange={e => setFormFixedPrice(e.target.value)} />
          </div>
        )}
      </div>
      {formType === 'video' && formBillingMode === 'duration' && (
        <div className="space-y-2">
          <Label>每秒积分</Label>
          <Input type="number" step="0.000001" value={formDurationPricePerSecond} onChange={e => setFormDurationPricePerSecond(e.target.value)} />
          <p className="text-xs text-muted-foreground">按秒计费会按前端用户选择的视频时长计算：视频秒数 x 每秒积分。</p>
        </div>
      )}
      {formBillingMode !== 'free' && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>模型倍率</Label>
              <Input type="number" step="0.000001" value={formModelRatio} onChange={e => setFormModelRatio(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>补全倍率</Label>
              <Input type="number" step="0.000001" value={formCompletionRatio} onChange={e => setFormCompletionRatio(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>分组倍率</Label>
              <Input type="number" step="0.000001" value={formGroupRatio} onChange={e => setFormGroupRatio(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>输入积分 / 1M tokens</Label>
              <Input type="number" step="0.000001" value={formInputPricePer1K} onChange={e => setFormInputPricePer1K(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>输出积分 / 1M tokens</Label>
              <Input type="number" step="0.000001" value={formOutputPricePer1K} onChange={e => setFormOutputPricePer1K(e.target.value)} />
            </div>
          </div>
        </>
      )}
      {formBillingMode === 'free' && (
        <p className="text-xs text-muted-foreground">免费模型不会预占或扣除用户积分，适合 Agnes 这类上游免费额度模型。</p>
      )}
      {formBillingMode === 'token' && (
        <p className="text-xs text-muted-foreground">
          Token 计费按每 1,000,000 tokens 填写积分价格；内部兼容旧字段名，实际含义以 1M tokens 为准。
        </p>
      )}
      <div className="space-y-2">
        <Label>价格备注</Label>
        <Input placeholder="例如：全局基础价 10 积分，VIP 分组 0.8x" value={formPriceNote} onChange={e => setFormPriceNote(e.target.value)} />
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <SectionMenu
        items={[
          { value: 'providers', label: '供应商管理', description: `${providers.length} 个供应商` },
          { value: 'recommendations', label: '推荐模型管理', description: `${recommendations.length} 个模型` },
          { value: 'system', label: '系统默认模型', description: membershipEnabled ? `${config.systemApis.length} 个模型配置` : '会员功能关闭' },
          { value: 'smart', label: '智能配置 API', description: '管理员导入' },
        ]}
        activeValue={activeSection}
        onChange={setActiveSection}
      />

      {activeSection === 'smart' && (
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg"><Bot className="h-5 w-5" />智能配置 API</CardTitle>
              <CardDescription>通用 Manifest 导入；每个模型会生成独立系统 API 配置。</CardDescription>
            </div>
            <Badge variant={isSmartConfigJson(smartConfigText) ? 'default' : 'outline'}>
              {isSmartConfigJson(smartConfigText) ? '可导入' : '待检查'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {!membershipEnabled && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-700 dark:text-amber-300">
              会员和积分功能关闭时，系统默认 API 不在创作端展示；导入前请先确认平台配置。
            </div>
          )}
          <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
            <div className="space-y-4">
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
                <div className="mb-3 flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  <h3 className="font-medium">AI 一键生成</h3>
                </div>
                <Button variant="outline" className="w-full justify-start gap-2" onClick={copySmartPrompt}>
                  <Copy className="h-4 w-4" />复制生成提示词
                </Button>
                <p className="mt-3 text-xs leading-5 text-muted-foreground">
                  复制提示词发送给对话AI，可根据API文档自动生成完整的配置（包含提供商、模型、URL等）。复制对话AI输出的JSON后，点击“粘贴并导入”接口一键生效。
                </p>
              </div>
              <div className="rounded-lg border border-border/60 bg-muted/20 p-4">
                <div className="mb-3 flex items-center gap-2">
                  <ClipboardPaste className="h-4 w-4 text-primary" />
                  <h3 className="font-medium">剪贴板导入</h3>
                </div>
                <div className="space-y-3">
                  <Button variant="outline" className="w-full justify-start gap-2" onClick={pasteSmartConfig} disabled={smartImporting}>
                    <ClipboardPaste className="h-4 w-4" />只粘贴配置
                  </Button>
                  <Button className="w-full justify-start gap-2" onClick={pasteAndImportSmartConfig} disabled={smartImporting}>
                    {smartImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    粘贴并导入
                  </Button>
                </div>
              </div>
              <div className="rounded-lg border border-border/60 bg-background/45 p-4 text-sm text-muted-foreground">
                <p className="leading-6">此处只用于导入通用 Manifest。系统默认模型请在“系统默认模型”页面按供应商、模型类型和模型列表逐级管理。</p>
              </div>
            </div>
            <div className="min-w-0 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <Label>JSON Manifest</Label>
                <Button variant="outline" size="sm" onClick={() => setSmartConfigText(SMART_IMPORT_DEFAULT_CONFIG)} disabled={smartImporting}>
                  恢复示例
                </Button>
              </div>
              <Textarea
                className="min-h-[520px] resize-y overflow-auto font-mono text-xs leading-relaxed md:text-xs"
                value={smartConfigText}
                onChange={event => setSmartConfigText(event.target.value)}
                spellCheck={false}
              />
              <div className="flex flex-wrap justify-end gap-3">
                <Button variant="outline" onClick={pasteSmartConfig} disabled={smartImporting}>
                  从剪贴板粘贴
                </Button>
                <Button className="gap-2" onClick={() => importSmartConfig()} disabled={smartImporting || !membershipEnabled}>
                  {smartImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  导入为系统 API
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
      )}

      {activeSection === 'providers' && (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">供应商管理</CardTitle>
              <CardDescription>维护个人中心 API 管理里的供应商列表、默认地址和默认模型</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={fetchModelConfig} disabled={modelConfigLoading}>
              {modelConfigLoading ? '刷新中...' : '刷新'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                className="sm:w-[420px]"
                value={providerSearch}
                onChange={event => {
                  setProviderSearch(event.target.value);
                  setProviderPage(1);
                }}
                placeholder="搜索供应商名称、模型、API 地址、官网"
              />
              <Button
                className="gap-1.5"
                onClick={() => {
                  resetProviderForm();
                  setShowProviderForm(true);
                }}
              >
                <Plus className="h-4 w-4" />添加供应商
              </Button>
            </div>
            <div className="text-xs text-muted-foreground">
              共 {providers.length} 个供应商，当前显示 {filteredProviders.length} 个
            </div>
          </div>
          <div className="space-y-2">
            {providers.length === 0 ? (
              <div className="text-center py-6 text-sm text-muted-foreground border rounded-lg">暂无供应商</div>
            ) : filteredProviders.length === 0 ? (
              <div className="text-center py-6 text-sm text-muted-foreground border rounded-lg">没有匹配的供应商</div>
            ) : visibleProviders.map(provider => (
              <div key={provider.id} className="flex items-center gap-3 p-3 rounded-lg border border-border">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{provider.name}</span>
                    <Badge variant={provider.isActive ? 'default' : 'secondary'}>{provider.isActive ? '已启用' : '已停用'}</Badge>
                    <Badge variant="outline">{MODEL_TYPE_LABELS[provider.type]}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 truncate">
                    {provider.defaultModel || '无默认模型'} · {provider.defaultApiUrl || '无默认地址'}
                  </div>
                </div>
                <Switch checked={provider.isActive} onCheckedChange={() => toggleProvider(provider)} />
                <Button variant="ghost" size="sm" onClick={() => startProviderEdit(provider)}><Edit3 className="h-4 w-4" /></Button>
                <Button variant="ghost" size="sm" className="text-destructive" onClick={() => deleteProvider(provider.id)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
          </div>
          {filteredProviders.length > 0 && (
            <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>第 {providerPage} / {totalProviderPages} 页</span>
                <Select
                  value={String(providerPageSize)}
                  onValueChange={value => {
                    setProviderPageSize(Number(value));
                    setProviderPage(1);
                  }}
                >
                  <SelectTrigger className="h-11 w-[112px] px-4 text-base leading-none [&_[data-slot=select-value]]:leading-none">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent side="top" align="start" sideOffset={8}>
                    <SelectItem value="10">10/页</SelectItem>
                    <SelectItem value="20">20/页</SelectItem>
                    <SelectItem value="50">50/页</SelectItem>
                  </SelectContent>
                </Select>
                <span>共 {filteredProviders.length} 个供应商</span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={providerPage <= 1 || modelConfigLoading}
                  onClick={() => setProviderPage(page => Math.max(1, page - 1))}
                >
                  上一页
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={providerPage >= totalProviderPages || modelConfigLoading}
                  onClick={() => setProviderPage(page => Math.min(totalProviderPages, page + 1))}
                >
                  下一页
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      )}

      {activeSection === 'recommendations' && (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">推荐模型管理</CardTitle>
          <CardDescription>维护模型名称输入框的下拉推荐项；未绑定供应商的推荐会对同类型所有供应商显示</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                className="sm:w-[420px]"
                value={recommendationSearch}
                onChange={event => {
                  setRecommendationSearch(event.target.value);
                  setRecommendationPage(1);
                }}
                placeholder="搜索模型名称、显示名称、类型、绑定供应商"
              />
              <Button
                className="gap-1.5"
                onClick={() => {
                  resetRecommendationForm();
                  setShowRecommendationForm(true);
                }}
              >
                <Plus className="h-4 w-4" />添加推荐模型
              </Button>
            </div>
            <div className="text-xs text-muted-foreground">
              共 {recommendations.length} 个推荐模型，当前显示 {filteredRecommendations.length} 个
            </div>
          </div>
          <div className="space-y-2">
            {recommendations.length === 0 ? (
              <div className="text-center py-6 text-sm text-muted-foreground border rounded-lg">暂无推荐模型</div>
            ) : filteredRecommendations.length === 0 ? (
              <div className="text-center py-6 text-sm text-muted-foreground border rounded-lg">没有匹配的推荐模型</div>
            ) : visibleRecommendations.map(recommendation => {
              const boundProvider = providers.find(provider => provider.id === recommendation.providerId);
              return (
                <div key={recommendation.id} className="flex items-center gap-3 p-3 rounded-lg border border-border">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{recommendation.modelName}</span>
                      <Badge variant={recommendation.isActive ? 'default' : 'secondary'}>{recommendation.isActive ? '已启用' : '已停用'}</Badge>
                      <Badge variant="outline">{MODEL_TYPE_LABELS[recommendation.type]}</Badge>
                      <Badge variant="outline">{boundProvider?.name || '全部供应商'}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {recommendation.displayName || recommendation.modelName}
                    </div>
                  </div>
                  <Switch checked={recommendation.isActive} onCheckedChange={() => toggleRecommendation(recommendation)} />
                  <Button variant="ghost" size="sm" onClick={() => startRecommendationEdit(recommendation)}><Edit3 className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => deleteRecommendation(recommendation.id)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              );
            })}
          </div>
          {filteredRecommendations.length > 0 && (
            <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>第 {recommendationPage} / {totalRecommendationPages} 页</span>
                <Select
                  value={String(recommendationPageSize)}
                  onValueChange={value => {
                    setRecommendationPageSize(Number(value));
                    setRecommendationPage(1);
                  }}
                >
                  <SelectTrigger className="h-11 w-[112px] px-4 text-base leading-none [&_[data-slot=select-value]]:leading-none">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent side="top" align="start" sideOffset={8}>
                    <SelectItem value="10">10/页</SelectItem>
                    <SelectItem value="20">20/页</SelectItem>
                    <SelectItem value="50">50/页</SelectItem>
                  </SelectContent>
                </Select>
                <span>共 {filteredRecommendations.length} 个推荐模型</span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={recommendationPage <= 1 || modelConfigLoading}
                  onClick={() => setRecommendationPage(page => Math.max(1, page - 1))}
                >
                  上一页
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={recommendationPage >= totalRecommendationPages || modelConfigLoading}
                  onClick={() => setRecommendationPage(page => Math.min(totalRecommendationPages, page + 1))}
                >
                  下一页
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      )}

      {activeSection === 'system' && (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">系统默认 API</CardTitle>
              <CardDescription>{membershipEnabled ? '配置所有用户可使用的内置模型 API、全局积分价格和模型分组' : '会员功能已关闭，系统默认 API 设置不可用'}</CardDescription>
            </div>
            {membershipEnabled && (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => installAgnesTemplates()}
                  disabled={agnesInstalling}
                >
                  {agnesInstalling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  安装 Agnes 免费模型
                </Button>
                <Button size="sm" className="gap-1.5" onClick={() => { resetForm(); setShowForm(true); }}>
                  <Plus className="h-4 w-4" />添加 API
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {/* API List */}
          {!membershipEnabled ? (
            <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
              当前平台不显示会员、积分和额度信息，用户创作时也不会显示积分消耗，因此后台暂不允许配置系统默认 API。
            </div>
          ) : config.systemApis.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Key className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>暂无系统默认模型，请添加</p>
            </div>
          ) : !systemProviderView ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {systemProviderGroups.map(group => (
                <button
                  key={group.provider}
                  type="button"
                  className="rounded-lg border border-border p-4 text-left transition hover:border-primary/60 hover:bg-muted/30"
                  onClick={() => {
                    setSystemProviderView(group.provider);
                    setSystemTypeView(null);
                  }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">{group.provider}</span>
                    <Badge variant="secondary" className="text-xs">{group.apis.length} 个模型</Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    {(['image', 'video', 'text'] as const).map(type => {
                      const count = group.apis.filter(api => api.type === type).length;
                      if (count === 0) return null;
                      return (
                        <Badge key={type} variant="outline" className="text-xs">
                          {type === 'image' ? '图片' : type === 'video' ? '视频' : '文本'} {count}
                        </Badge>
                      );
                    })}
                  </div>
                  <p className="mt-3 truncate text-xs text-muted-foreground">{group.apis[0]?.apiUrl || '未设置默认 API 地址'}</p>
                </button>
              ))}
            </div>
          ) : !systemTypeView ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm text-muted-foreground">模型供应商</div>
                  <div className="text-lg font-semibold">{systemProviderView}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => setSystemProviderView(null)}>返回供应商</Button>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                {(['image', 'video', 'text'] as const).map(type => {
                  const apis = selectedSystemProviderGroup?.apis.filter(api => api.type === type) || [];
                  if (apis.length === 0) return null;
                  return (
                    <button
                      key={type}
                      type="button"
                      className="rounded-lg border border-border p-4 text-left transition hover:border-primary/60 hover:bg-muted/30"
                      onClick={() => setSystemTypeView(type)}
                    >
                      <div className="flex items-center gap-2 font-medium">
                        {type === 'image' ? <Image className="h-4 w-4" /> : type === 'video' ? <Film className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
                        {type === 'image' ? '图片模型' : type === 'video' ? '视频模型' : '文本模型'}
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">{apis.length} 个模型</p>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm text-muted-foreground">{systemProviderView}</div>
                  <div className="text-lg font-semibold">
                    {systemTypeView === 'image' ? '图片模型' : systemTypeView === 'video' ? '视频模型' : '文本模型'}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setSystemTypeView(null)}>返回类型</Button>
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => selectedSystemProviderGroup && startAddSystemApiForProvider(selectedSystemProviderGroup, systemTypeView)}>
                    <Plus className="h-3.5 w-3.5" />加模型
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                {selectedSystemTypeApis.map(api => (
                  <div key={api.id} className={`flex flex-col gap-2 rounded-md border border-border/70 px-3 py-3 sm:flex-row sm:items-center sm:justify-between ${api.isActive ? 'bg-background/70' : 'bg-muted/40 opacity-70'}`}>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{api.modelName || api.name}</span>
                        <Badge variant={api.isActive ? 'default' : 'secondary'} className="text-xs">{api.isActive ? '已启用' : '未启用'}</Badge>
                        {api.name && api.name !== api.modelName && <span className="text-xs text-muted-foreground">{api.name}</span>}
                        <span className="text-xs text-muted-foreground">
                          <Coins className="mr-1 inline h-3 w-3" />
                          {(api.billingMode || 'fixed') === 'free' ? '免费' : `${api.creditsPerUse} 积分/次`}
                        </span>
                        <Badge variant="outline" className="text-xs">{BILLING_MODE_LABELS[api.billingMode || 'fixed']}</Badge>
                        <Badge variant={api.isDefault !== false ? 'outline' : 'secondary'} className="text-xs">{api.isDefault !== false ? '平台默认' : '不展示'}</Badge>
                        <Badge variant="outline" className="text-xs">
                          {POLLING_MODE_LABELS[api.pollingMode || 'sequential']} #{api.pollingOrder ?? 0}
                        </Badge>
                        {api.type === 'video' && (
                          <Badge variant="outline" className="text-xs">
                            {(api.videoUsageModes || ['text-to-video', 'image-to-video']).includes('text-to-video') ? '文生' : ''}
                            {(api.videoUsageModes || ['text-to-video', 'image-to-video']).length > 1 ? '/' : ''}
                            {(api.videoUsageModes || ['text-to-video', 'image-to-video']).includes('image-to-video') ? '图生' : ''}
                          </Badge>
                        )}
                        {api.manifestPath && <Badge variant="outline" className="text-xs">Manifest</Badge>}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        {api.apiUrl && <span className="truncate"><Globe className="mr-1 inline h-3 w-3" />{api.apiUrl.slice(0, 64)}...</span>}
                        <span>{formatSystemApiPricing(api)}</span>
                        <span>会员：{MEMBERSHIP_TIER_OPTIONS
                          .filter(tier => (api.allowedMembershipTiers || []).includes(tier.value))
                          .map(tier => tier.label)
                          .join('、') || '全部'}</span>
                        {api.priceNote && <span>{api.priceNote}</span>}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Switch
                        checked={api.isActive}
                        onCheckedChange={() => {
                          toggleSystemApi(api.id).catch(err => {
                            toast.error(err instanceof Error ? err.message : '操作失败');
                          });
                        }}
                      />
                      <Button variant="ghost" size="sm" onClick={() => startEdit(api)}><Edit3 className="h-4 w-4" /></Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => {
                          removeSystemApi(api.id)
                            .then(() => toast.success('已删除'))
                            .catch(err => toast.error(err instanceof Error ? err.message : '删除失败'));
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      )}

      {/* Add API Dialog */}
      {membershipEnabled && activeSection === 'system' && showForm && (
        <Dialog open={showForm} onOpenChange={(open) => { setShowForm(open); if (!open) resetForm(); }}>
          <DialogContent className="max-h-[92vh] w-[min(96vw,1120px)] max-w-none overflow-y-auto border-white/15 bg-background/85 backdrop-blur-2xl sm:max-w-none">
            <DialogHeader>
              <DialogTitle>{editingId ? '编辑 API' : '添加 API'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>显示名称</Label>
                <Input placeholder="如: See Dream v5.0" value={formName} onChange={e => setFormName(e.target.value)} />
              </div>
              {renderSystemProviderField()}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>类型</Label>
                <Select value={formType} onValueChange={v => setFormType(v as 'image' | 'video' | 'text')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="image">图片生成</SelectItem>
                    <SelectItem value="video">视频生成</SelectItem>
                    <SelectItem value="text">文本生成</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>模型备注</Label>
              <Input placeholder="例如：高速生图、写实人像、视频主模型" value={formNote} onChange={e => setFormNote(e.target.value)} />
              <p className="text-xs text-muted-foreground">创作界面选择模型时会优先显示备注，留空则显示模型名称</p>
            </div>
            <div className="space-y-2">
              <Label>API 请求地址</Label>
              <Input placeholder="https://api.example.com/v1/images/generations" value={formApiUrl} onChange={e => setFormApiUrl(e.target.value)} />
              <p className="text-xs text-muted-foreground">留空则使用平台内置 SDK</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>模型名称 (model)</Label>
                <Input placeholder="如: gpt-image-2" value={formModelName} onChange={e => setFormModelName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>每次消耗积分</Label>
                <Input type="number" value={formCredits} onChange={e => setFormCredits(e.target.value)} />
              </div>
            </div>
            {renderAvailabilityFields()}
            {renderVideoUsageFields()}
            {renderPollingFields()}
            {renderPricingFields()}
            <div className="space-y-2">
              <Label>API Key</Label>
              <Input type="password" placeholder="sk-..." value={formApiKey} onChange={e => setFormApiKey(e.target.value)} />
            </div>
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={resetForm}>取消</Button>
              <Button className="gap-1.5" onClick={handleSave}>
                <Save className="h-4 w-4" />{editingId ? '保存' : '添加'}
              </Button>
            </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      <Dialog open={showProviderForm} onOpenChange={(open) => { setShowProviderForm(open); if (!open) resetProviderForm(); }}>
        <DialogContent className="max-h-[92vh] w-[min(96vw,1120px)] max-w-none overflow-y-auto border-white/15 bg-background/85 backdrop-blur-2xl sm:max-w-none">
          <DialogHeader>
            <DialogTitle>添加供应商</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>名称</Label>
                <Input value={providerName} onChange={e => setProviderName(e.target.value)} placeholder="mozheAPI" />
              </div>
              <div className="space-y-2">
                <Label>类型</Label>
                <Select value={providerType} onValueChange={v => setProviderType(v as ManagedModelType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="image">生图</SelectItem>
                    <SelectItem value="video">视频</SelectItem>
                    <SelectItem value="text">文本</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>默认 API 地址</Label>
              <Input value={providerUrl} onChange={e => setProviderUrl(e.target.value)} placeholder="https://..." />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>默认模型</Label>
                <Input value={providerModel} onChange={e => setProviderModel(e.target.value)} placeholder="gpt-image-2" />
              </div>
              <div className="space-y-2">
                <Label>排序</Label>
                <Input type="number" value={providerSortOrder} onChange={e => setProviderSortOrder(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>官网</Label>
              <Input value={providerWebsite} onChange={e => setProviderWebsite(e.target.value)} placeholder="https://..." />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={providerActive} onCheckedChange={setProviderActive} />
              <Label>启用</Label>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => { setShowProviderForm(false); resetProviderForm(); }}>取消</Button>
              <Button className="gap-1.5" onClick={saveProvider}>
                <Save className="h-4 w-4" />添加
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!providerEditingId} onOpenChange={(open) => { if (!open) resetProviderForm(); }}>
        <DialogContent className="max-h-[92vh] w-[min(96vw,1120px)] max-w-none overflow-y-auto border-white/15 bg-background/85 backdrop-blur-2xl sm:max-w-none">
          <DialogHeader>
            <DialogTitle>编辑供应商</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>名称</Label>
                <Input value={providerName} onChange={e => setProviderName(e.target.value)} placeholder="mozheAPI" />
              </div>
              <div className="space-y-2">
                <Label>类型</Label>
                <Select value={providerType} onValueChange={v => setProviderType(v as ManagedModelType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="image">生图</SelectItem>
                    <SelectItem value="video">视频</SelectItem>
                    <SelectItem value="text">文本</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>默认 API 地址</Label>
              <Input value={providerUrl} onChange={e => setProviderUrl(e.target.value)} placeholder="https://..." />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>默认模型</Label>
                <Input value={providerModel} onChange={e => setProviderModel(e.target.value)} placeholder="gpt-image-2" />
              </div>
              <div className="space-y-2">
                <Label>排序</Label>
                <Input type="number" value={providerSortOrder} onChange={e => setProviderSortOrder(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>官网</Label>
              <Input value={providerWebsite} onChange={e => setProviderWebsite(e.target.value)} placeholder="https://..." />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={providerActive} onCheckedChange={setProviderActive} />
              <Label>启用</Label>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={resetProviderForm}>取消</Button>
              <Button className="gap-1.5" onClick={saveProvider}>
                <Save className="h-4 w-4" />保存
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showRecommendationForm} onOpenChange={(open) => { setShowRecommendationForm(open); if (!open) resetRecommendationForm(); }}>
        <DialogContent className="max-h-[92vh] w-[min(96vw,1120px)] max-w-none overflow-y-auto border-white/15 bg-background/85 backdrop-blur-2xl sm:max-w-none">
          <DialogHeader>
            <DialogTitle>添加推荐模型</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>模型名称</Label>
                <Input value={recommendationModelName} onChange={e => setRecommendationModelName(e.target.value)} placeholder="gpt-image-2" />
              </div>
              <div className="space-y-2">
                <Label>显示名称</Label>
                <Input value={recommendationDisplayName} onChange={e => setRecommendationDisplayName(e.target.value)} placeholder="留空则使用模型名称" />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>类型</Label>
                <Select value={recommendationType} onValueChange={v => setRecommendationType(v as ManagedModelType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="image">生图</SelectItem>
                    <SelectItem value="video">视频</SelectItem>
                    <SelectItem value="text">文本</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>排序</Label>
                <Input type="number" value={recommendationSortOrder} onChange={e => setRecommendationSortOrder(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>绑定供应商</Label>
              <Select
                value={recommendationProviderId || '__global__'}
                onValueChange={v => setRecommendationProviderId(v === '__global__' ? '' : v)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__global__">全部同类型供应商</SelectItem>
                  {providers.map(provider => (
                    <SelectItem key={provider.id} value={provider.id}>{provider.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={recommendationActive} onCheckedChange={setRecommendationActive} />
              <Label>启用</Label>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => { setShowRecommendationForm(false); resetRecommendationForm(); }}>取消</Button>
              <Button className="gap-1.5" onClick={saveRecommendation}>
                <Save className="h-4 w-4" />添加
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!recommendationEditingId} onOpenChange={(open) => { if (!open) resetRecommendationForm(); }}>
        <DialogContent className="max-h-[92vh] w-[min(96vw,1120px)] max-w-none overflow-y-auto border-white/15 bg-background/85 backdrop-blur-2xl sm:max-w-none">
          <DialogHeader>
            <DialogTitle>编辑推荐模型</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>模型名称</Label>
                <Input value={recommendationModelName} onChange={e => setRecommendationModelName(e.target.value)} placeholder="gpt-image-2" />
              </div>
              <div className="space-y-2">
                <Label>显示名称</Label>
                <Input value={recommendationDisplayName} onChange={e => setRecommendationDisplayName(e.target.value)} placeholder="留空则使用模型名称" />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>类型</Label>
                <Select value={recommendationType} onValueChange={v => setRecommendationType(v as ManagedModelType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="image">生图</SelectItem>
                    <SelectItem value="video">视频</SelectItem>
                    <SelectItem value="text">文本</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>排序</Label>
                <Input type="number" value={recommendationSortOrder} onChange={e => setRecommendationSortOrder(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>绑定供应商</Label>
              <Select
                value={recommendationProviderId || '__global__'}
                onValueChange={v => setRecommendationProviderId(v === '__global__' ? '' : v)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__global__">全部同类型供应商</SelectItem>
                  {providers.map(provider => (
                    <SelectItem key={provider.id} value={provider.id}>{provider.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={recommendationActive} onCheckedChange={setRecommendationActive} />
              <Label>启用</Label>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={resetRecommendationForm}>取消</Button>
              <Button className="gap-1.5" onClick={saveRecommendation}>
                <Save className="h-4 w-4" />保存
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingId} onOpenChange={(open) => { if (!open) resetForm(); }}>
        <DialogContent className="max-h-[92vh] w-[min(96vw,1120px)] max-w-none overflow-y-auto border-white/15 bg-background/85 backdrop-blur-2xl sm:max-w-none">
          <DialogHeader>
            <DialogTitle>编辑 API</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>显示名称</Label>
                <Input placeholder="如: See Dream v5.0" value={formName} onChange={e => setFormName(e.target.value)} />
              </div>
              {renderSystemProviderField()}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>类型</Label>
                <Select value={formType} onValueChange={v => setFormType(v as 'image' | 'video' | 'text')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="image">图片生成</SelectItem>
                    <SelectItem value="video">视频生成</SelectItem>
                    <SelectItem value="text">文本生成</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>API 请求地址</Label>
              <Input placeholder="https://api.example.com/v1/images/generations" value={formApiUrl} onChange={e => setFormApiUrl(e.target.value)} />
              <p className="text-xs text-muted-foreground">留空则使用平台内置 SDK</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>模型名称 (model)</Label>
                <Input placeholder="如: gpt-image-2" value={formModelName} onChange={e => setFormModelName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>每次消耗积分</Label>
                <Input type="number" value={formCredits} onChange={e => setFormCredits(e.target.value)} />
              </div>
            </div>
            {renderAvailabilityFields()}
            {renderPricingFields()}
            <div className="space-y-2">
              <Label>模型备注</Label>
              <Input placeholder="例如：高速生图、写实人像、视频主模型" value={formNote} onChange={e => setFormNote(e.target.value)} />
              <p className="text-xs text-muted-foreground">创作界面选择模型时会优先显示备注，留空则显示模型名称</p>
            </div>
            <div className="space-y-2">
              <Label>API Key</Label>
              <Input type="password" placeholder="留空则不修改已保存密钥" value={formApiKey} onChange={e => setFormApiKey(e.target.value)} />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={resetForm}>取消</Button>
              <Button className="gap-1.5" onClick={handleSave}>
                <Save className="h-4 w-4" />保存
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
