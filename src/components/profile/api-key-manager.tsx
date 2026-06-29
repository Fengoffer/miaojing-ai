'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import type { ManagedModelConfigResponse, ManagedModelRecommendation, ManagedModelType } from '@/lib/model-config-types';
import { useCustomApiKeys } from '@/lib/custom-api-store';
import { getClientAuthToken } from '@/lib/client-auth';
import { buildModelConfigRequest } from '@/lib/managed-model-store';
import { getCustomApiModelLabel, isGenericApiKeyNote } from '@/lib/model-display';
import { Bot, Calendar, Check, ClipboardPaste, Copy, Cpu, ExternalLink, Eye, EyeOff, Film, Globe, Image, Key, Loader2, MessageSquare, Plus, Settings, Shield, Sparkles, Trash2, Zap } from 'lucide-react';
type ProviderPreset = {
  id?: string;
  name: string;
  defaultUrl: string;
  defaultModel: string;
  defaultType: ManagedModelType;
  website?: string | null;
};

type ApiProviderGroup = {
  name: string;
  provider: string;
  keys: ReturnType<typeof useCustomApiKeys>['keys'];
};

// Fallback provider presets used before the server-managed config loads.
const PROVIDER_PRESETS: ProviderPreset[] = [
  { name: '硅基流动', defaultUrl: 'https://api.siliconflow.cn/v1/images/generations', defaultModel: 'black-forest-labs/FLUX.1-schnell', defaultType: 'image' as const, website: 'https://cloud.siliconflow.cn' },
  { name: 'New API', defaultUrl: 'https://your-newapi-domain.com/v1/images/generations', defaultModel: 'gpt-image-1', defaultType: 'image' as const, website: 'https://docs.newapi.pro' },
  { name: 'mozheAPI', defaultUrl: 'https://openai.mozhevip.top/v1/images/generations', defaultModel: '', defaultType: 'image' as const, website: 'https://openai.mozhevip.top' },
  { name: 'OpenAI', defaultUrl: 'https://api.openai.com/v1/images/generations', defaultModel: 'dall-e-3', defaultType: 'image' as const },
  { name: 'Stability AI', defaultUrl: 'https://api.stability.ai/v1/generation/stable-diffusion-xl/text-to-image', defaultModel: 'stable-diffusion-xl', defaultType: 'image' as const },
  { name: 'Midjourney', defaultUrl: '', defaultModel: 'midjourney-v6', defaultType: 'image' as const },
  { name: 'Runway', defaultUrl: 'https://api.runwayml.com/v1/image_to_video', defaultModel: 'gen-3-alpha', defaultType: 'video' as const },
  { name: 'Pika', defaultUrl: '', defaultModel: 'pika-1.0', defaultType: 'video' as const },
  { name: 'Kling', defaultUrl: '', defaultModel: 'kling-v1', defaultType: 'video' as const },
  { name: 'DeepSeek', defaultUrl: 'https://api.deepseek.com/v1/chat/completions', defaultModel: 'deepseek-chat', defaultType: 'text' as const },
  { name: 'OpenAI GPT', defaultUrl: 'https://api.openai.com/v1/chat/completions', defaultModel: 'gpt-4o', defaultType: 'text' as const },
  { name: '自定义', defaultUrl: '', defaultModel: '', defaultType: 'image' as const },
];

const SMART_IMPORT_DEFAULT_CONFIG = `{
  "name": "自定义服务商",
  "submit": {
    "path": "images/generations",
    "method": "POST",
    "contentType": "json",
    "body": {
      "model": "$profile.model",
      "prompt": "$prompt",
      "size": "$params.size",
      "quality": "$params.quality",
      "output_format": "$params.output_format",
      "moderation": "$params.moderation",
      "output_compression": "$params.output_compression",
      "n": "$params.n"
    },
    "result": {
      "imageUrlPaths": [
        "data.*.url"
      ],
      "b64JsonPaths": [
        "data.*.b64_json"
      ]
    }
  },
  "editSubmit": {
    "path": "images/edits",
    "method": "POST",
    "contentType": "multipart",
    "body": {
      "model": "$profile.model",
      "prompt": "$prompt",
      "size": "$params.size",
      "quality": "$params.quality",
      "output_format": "$params.output_format",
      "moderation": "$params.moderation",
      "output_compression": "$params.output_compression",
      "n": "$params.n"
    },
    "files": [
      {
        "field": "image[]",
        "source": "inputImages",
        "array": true
      },
      {
        "field": "mask",
        "source": "mask"
      }
    ],
    "result": {
      "imageUrlPaths": [
        "data.*.url"
      ],
      "b64JsonPaths": [
        "data.*.b64_json"
      ]
    }
  }
}`;

const SMART_IMPORT_PROMPT = `# 角色
你是 API 文档解析助手。你的任务是根据用户提供的图像生成 API 文档，生成本应用可导入的自定义服务商配置 JSON。

# 工作流程
1. 先向用户索要 API 文档链接或完整文档文本。
2. 如果当前环境支持读取链接，主动读取；否则要求用户粘贴文档内容。
3. 在未获得文档前不要猜测，不要生成占位配置。
4. 从文档中判断提交接口、图生图接口、异步任务查询接口、状态值、结果图片路径。
5. 必须从 API 文档或 API 文档链接中找到中转服务商的 API Base URL 或完整请求地址，并写入 profiles.baseUrl 或 submit.path。不要把 OpenAI 官方默认地址当作中转地址，除非文档明确写的就是 OpenAI 官方域名。
6. 如果文档中没有找到中转 API 请求地址，不要输出 JSON。请回复用户：“当前文档里没有找到中转 API 请求地址，请在中转平台文档中找到 API Base URL 或完整请求端点后发给我，我再生成完整配置。”
7. 如果文档中明确了默认模型 ID，在 profiles.model 中填入；如果未明确模型 ID，model 使用 "gpt-image-2"。
8. 从文档中提取每个模型支持的画面比例、分辨率/尺寸、质量、输出格式，并写入 profiles.capabilities；如果文档没有明确说明某项能力，不要编造。
9. 输出最终 JSON；不要索要 API Key。

# 输出结构
输出 JSON 包含两个顶层字段：
- customProviders：自定义服务商 Manifest 数组，每项描述一个服务商的接口映射规则。
- profiles：API 配置数组，每项描述一个可直接使用的连接配置，引用 customProviders 中的服务商。

## customProviders 元素（Manifest）
每个元素的顶层字段：id、name、submit、editSubmit、poll。
id 是服务商的唯一标识，用于 profiles 中的 provider 字段引用，建议使用 custom-{英文短名} 格式。
submit 是文生图提交配置，必填。
editSubmit 是图生图或局部重绘提交配置，可选。如果文生图和图生图使用同一个 JSON 接口，可以省略 editSubmit，并在 submit.body 中加入 image_urls。
poll 是异步任务查询配置，可选；同步接口不要写 poll。

submit/editSubmit 字段：
- path：接口路径，不带开头斜杠，不带 /v1/ 前缀，例如 images/generations 或 tasks/{task_id}。
- method：GET 或 POST，默认 POST。
- contentType：json 或 multipart。
- query：提交 query 参数对象，可选，例如 {"async":"true"}。
- body：请求体模板对象。
- files：multipart 文件字段数组，仅 contentType=multipart 时使用。
- taskIdPath：提交响应里的任务 ID JSON 路径；同步接口不要写。
- result：同步响应图片提取规则。

poll 字段：
- path：任务查询路径，使用 {task_id} 占位，例如 images/tasks/{task_id} 或 tasks/{task_id}。
- method：GET 或 POST，默认 GET。
- query：查询 query 参数对象，可选。
- intervalSeconds：轮询间隔秒数。
- statusPath：查询响应状态字段路径。
- successValues：成功状态值数组。
- failureValues：失败状态值数组。
- errorPath：失败原因路径，可选。
- result：成功后图片提取规则。

result 字段：
- imageUrlPaths：图片 URL 路径数组，支持 * 通配数组。例如 data.*.url、data.result.images.*.url.*。
- b64JsonPaths：base64 图片路径数组，支持 * 通配数组。例如 data.*.b64_json。

body 模板变量：
- $profile.model：用户在设置里填写的模型 ID。
- $prompt：当前提示词。
- $params.size、$params.quality、$params.output_format、$params.output_compression、$params.moderation、$params.n：应用内参数。
- $inputImages.dataUrls：参考图 data URL 数组；没有参考图时会自动省略该字段。
- $mask.dataUrl：遮罩图 data URL；没有遮罩时会自动省略该字段。

multipart files 示例：
- {"field":"image[]","source":"inputImages","array":true}
- {"field":"mask","source":"mask"}

## profiles 元素
每个元素的字段：
- name：配置名称，方便用户识别。
- provider：对应 customProviders 中某个元素的 id。
- baseUrl：API Base URL。如果文档明确给出，填入完整基础地址；否则留空字符串 ""。
- model：模型 ID。如果 API 文档明确了默认模型，填入该值；否则使用 "gpt-image-2"。
- apiMode：固定为 "images"。
- capabilities：可选，描述该模型在创作窗口可选的参数。字段包含 aspectRatios、resolutions、qualities、outputFormats，每项是 [{"value":"...","label":"..."}]。常用 aspectRatios: 1:1、16:9、9:16、4:3、3:4；resolutions 可以使用 1080P、2K、4K 或文档明确支持的像素值如 1024x1024、1536x1024、1024x1536；qualities 按文档使用 high、medium、low、auto 或服务商自己的枚举值。

profiles 中不要包含 apiKey（用户导入后自行填写）。

# 输出要求
- 最终回复只包含一个 \`\`\`json 代码块，代码块内是 JSON 对象。
- JSON 对象必须包含 customProviders 和 profiles 两个顶层字段。
- 代码块外不要附加解释文字。
- 但如果缺少中转 API Base URL 或完整请求端点，禁止输出 JSON，只提示用户补充该地址。
- 不要输出 API Key、Authorization header。
- 如果文档返回 task_id，就必须配置 taskIdPath 和 poll。
- 如果结果 URL 是数组，路径必须写到数组元素，例如 data.result.images.*.url.*。

## 同步接口示例
{"customProviders":[{"id":"custom-example-sync","name":"示例同步服务商","submit":{"path":"images/generations","method":"POST","contentType":"json","body":{"model":"$profile.model","prompt":"$prompt","size":"$params.size","quality":"$params.quality","output_format":"$params.output_format","moderation":"$params.moderation","output_compression":"$params.output_compression","n":"$params.n"},"result":{"imageUrlPaths":["data.*.url"],"b64JsonPaths":["data.*.b64_json"]}},"editSubmit":{"path":"images/edits","method":"POST","contentType":"multipart","body":{"model":"$profile.model","prompt":"$prompt","size":"$params.size","quality":"$params.quality","output_format":"$params.output_format","moderation":"$params.moderation","output_compression":"$params.output_compression","n":"$params.n"},"files":[{"field":"image[]","source":"inputImages","array":true},{"field":"mask","source":"mask"}],"result":{"imageUrlPaths":["data.*.url"],"b64JsonPaths":["data.*.b64_json"]}}}],"profiles":[{"name":"示例同步服务商","provider":"custom-example-sync","baseUrl":"https://api.example.com/v1","model":"example-model-v1","apiMode":"images"}]}

## 异步接口示例
{"customProviders":[{"id":"custom-example-async","name":"示例异步服务商","submit":{"path":"images/generations","method":"POST","contentType":"json","query":{"async":"true"},"body":{"model":"$profile.model","prompt":"$prompt","size":"$params.size","n":"$params.n"},"taskIdPath":"data"},"editSubmit":{"path":"images/edits","method":"POST","contentType":"multipart","query":{"async":"true"},"body":{"model":"$profile.model","prompt":"$prompt","size":"$params.size","n":"$params.n"},"files":[{"field":"image[]","source":"inputImages","array":true}],"taskIdPath":"data"},"poll":{"path":"images/tasks/{task_id}","method":"GET","intervalSeconds":5,"statusPath":"data.status","successValues":["SUCCESS"],"failureValues":["FAILURE"],"errorPath":"data.fail_reason","result":{"imageUrlPaths":["data.data.data.*.url"],"b64JsonPaths":["data.data.data.*.b64_json"]}}}],"profiles":[{"name":"示例异步服务商","provider":"custom-example-async","baseUrl":"","model":"gpt-image-2","apiMode":"images"}]}

## 统一任务接口示例
{"customProviders":[{"id":"custom-example-task","name":"示例任务服务商","submit":{"path":"images/generations","method":"POST","contentType":"json","body":{"model":"$profile.model","prompt":"$prompt","n":"$params.n","size":"$params.size","resolution":"2k","quality":"$params.quality","image_urls":"$inputImages.dataUrls"},"taskIdPath":"data.0.task_id"},"poll":{"path":"tasks/{task_id}","method":"GET","query":{"language":"zh"},"intervalSeconds":5,"statusPath":"data.status","successValues":["completed"],"failureValues":["failed","cancelled"],"errorPath":"data.error.message","result":{"imageUrlPaths":["data.result.images.*.url.*"],"b64JsonPaths":[]}}}],"profiles":[{"name":"示例任务服务商","provider":"custom-example-task","baseUrl":"","model":"gpt-image-2","apiMode":"images"}]}`;

function getMozheApiUrl(providerName: string, type: ManagedModelType, model: string): string | null {
  if (providerName !== 'mozheAPI') return null;
  if (type === 'image' && model === 'gpt-image-2') {
    return 'https://openai.mozhevip.top/v1/images/generations';
  }
  if (type === 'text' && model === 'gpt-5.5') {
    return 'https://openai.mozhevip.top/v1/chat/completions';
  }
  return null;
}

export default function ApiKeyManager() {
  const { keys, add, update, remove, toggleActive, refresh } = useCustomApiKeys();
  const [showForm, setShowForm] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showSmartDialog, setShowSmartDialog] = useState(false);
  const [smartConfigText, setSmartConfigText] = useState(SMART_IMPORT_DEFAULT_CONFIG);
  const [smartImporting, setSmartImporting] = useState(false);

  // Form state
  const [provider, setProvider] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [apiUrl, setApiUrl] = useState('');
  const [modelName, setModelName] = useState('');
  const [modelNote, setModelNote] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [formType, setFormType] = useState<'image' | 'video' | 'text'>('image');
  const [showModelSuggestions, setShowModelSuggestions] = useState(false);

  // Test connection state
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [testingKeyId, setTestingKeyId] = useState<string | null>(null);
  const [keyTestResults, setKeyTestResults] = useState<Record<string, { success: boolean; message: string }>>({});

  // Fetch models state
  const [fetchingModels, setFetchingModels] = useState(false);
  const [models, setModels] = useState<Array<{ id: string; name: string; description: string; provider: string }>>([]);
  const [fetchModelsError, setFetchModelsError] = useState<string | null>(null);
  const [managedProviders, setManagedProviders] = useState<ProviderPreset[]>([]);
  const [modelRecommendations, setModelRecommendations] = useState<ManagedModelRecommendation[]>([]);

  // Edit state
  const [editingKeyId, setEditingKeyId] = useState<string | null>(null);
  const providerOptions = managedProviders.length > 0 ? managedProviders : PROVIDER_PRESETS;
  const providerSelectOptions = provider && !providerOptions.some(item => item.name === provider)
    ? [{ name: provider, defaultUrl: apiUrl, defaultModel: modelName, defaultType: formType }, ...providerOptions]
    : providerOptions;
  const groupedKeys: ApiProviderGroup[] = Object.values(keys.reduce<Record<string, ApiProviderGroup>>((acc, key) => {
    const groupName = key.supplierName || key.provider || '未命名供应商';
    if (!acc[groupName]) {
      acc[groupName] = { name: groupName, provider: key.provider, keys: [] };
    }
    acc[groupName].keys.push(key);
    return acc;
  }, {}));
  const selectedProvider = providerOptions.find(p => p.name === provider);
  const modelSuggestions = modelRecommendations.filter(item =>
    item.type === formType && (!selectedProvider?.id || !item.providerId || item.providerId === selectedProvider.id)
  );
  const fallbackModelSuggestions = managedProviders.length > 0
    ? []
    : formType === 'image'
      ? [{ modelName: 'gpt-image-2', displayName: 'gpt-image-2' }]
      : [];
  const fetchedModelSuggestions = models.filter(
    model => model.id &&
      !modelSuggestions.some(suggestion => suggestion.modelName === model.id) &&
      !fallbackModelSuggestions.some(suggestion => suggestion.modelName === model.id)
  );
  const modelSuggestionOptions = [
    ...modelSuggestions.map(model => ({
      key: model.id,
      value: model.modelName,
      label: model.displayName || model.modelName,
    })),
    ...fallbackModelSuggestions.map(model => ({
      key: `fallback-${model.modelName}`,
      value: model.modelName,
      label: model.displayName,
    })),
    ...fetchedModelSuggestions.map(model => ({
      key: `fetched-${model.id}`,
      value: model.id,
      label: model.name || model.description || model.id,
    })),
  ].filter((option, index, all) => all.findIndex(item => item.value === option.value) === index);

  useEffect(() => {
    const authToken = getClientAuthToken();
    if (!authToken) {
      setManagedProviders([]);
      setModelRecommendations([]);
      return;
    }
    const request = buildModelConfigRequest(authToken);
    fetch(request.url, request.init)
      .then(res => res.ok ? res.json() : null)
      .then((data: ManagedModelConfigResponse | null) => {
        if (!data) return;
        setManagedProviders((data.providers || []).map(p => ({
          id: p.id,
          name: p.name,
          defaultUrl: p.defaultApiUrl,
          defaultModel: p.defaultModel,
          defaultType: p.type,
          website: p.website,
        })));
        setModelRecommendations(data.recommendations || []);
      })
      .catch(() => {
        setManagedProviders([]);
        setModelRecommendations([]);
      });
  }, []);

  // Auto-fill URL and model when provider preset is selected
  const handleProviderInputChange = (value: string) => {
    setProvider(value);
    setSupplierName(current => (!current || current === provider ? value : current));
    setTestResult(null);
  };

  const handleProviderChange = (value: string) => {
    setProvider(value);
    setSupplierName(value); // Set supplier name to provider name by default
    const preset = providerOptions.find(p => p.name === value);
    if (preset) {
      const nextType = preset.defaultType;
      const nextModel = preset.defaultModel;
      const mozheUrl = getMozheApiUrl(value, nextType, nextModel);
      if (mozheUrl) {
        setApiUrl(mozheUrl);
      } else if (value === 'mozheAPI') {
        // For mozheAPI, always set default URL to https://openai.mozhevip.top
        setApiUrl('https://openai.mozhevip.top');
      } else {
        setApiUrl(preset.defaultUrl);
      }
      setModelName(nextModel);
      if (nextType) setFormType(nextType);
    }
    setTestResult(null);
  };

  const handleModelTypeChange = (value: 'image' | 'video' | 'text') => {
    setFormType(value);
    const mozheUrl = getMozheApiUrl(provider, value, modelName);
    if (mozheUrl) setApiUrl(mozheUrl);
  };

  // Handle model name change for multimodal and image models
  const handleModelNameChange = (value: string) => {
    setModelName(value);
    const mozheUrl = getMozheApiUrl(provider, formType, value);
    if (mozheUrl) setApiUrl(mozheUrl);
  };

  const handleAddKey = () => {
    if (!provider.trim() || (!editingKeyId && !apiKey.trim())) return;
    if (editingKeyId) {
      // Update existing key
      update(editingKeyId, {
        provider: provider.trim(),
        supplierName: supplierName.trim() || provider.trim(),
        apiUrl: apiUrl.trim(),
        modelName: modelName.trim(),
        note: modelNote.trim(),
        apiKey: apiKey.trim(),
        type: formType,
        isActive: true,
      });
      setEditingKeyId(null);
    } else {
      // Add new key
      add({
        provider: provider.trim(),
        supplierName: supplierName.trim() || provider.trim(),
        apiUrl: apiUrl.trim(),
        modelName: modelName.trim(),
        note: modelNote.trim(),
        apiKey: apiKey.trim(),
        type: formType,
        isActive: true,
      });
    }
    setProvider('');
    setSupplierName('');
    setApiUrl('');
    setModelName('');
    setModelNote('');
    setApiKey('');
    setFormType('image');
    setShowForm(false);
    setShowApiKey(false);
    setTestResult(null);
  };

  const handleEditKey = (keyId: string) => {
    const key = keys.find(k => k.id === keyId);
    if (!key) return;
    setEditingKeyId(keyId);
    setProvider(key.provider);
    setSupplierName(key.supplierName || key.provider);
    setApiUrl(key.apiUrl);
    setModelName(key.modelName);
    setModelNote(key.note || '');
    setApiKey('');
    setFormType(key.type || 'image');
    setShowForm(false);
    setShowApiKey(false);
    setTestResult(null);
  };

  const handleAddModelForProvider = (group: ApiProviderGroup) => {
    const seed = group.keys[0];
    setEditingKeyId(null);
    setProvider(seed?.provider || group.provider || group.name);
    setSupplierName(group.name);
    setApiUrl(seed?.apiUrl || '');
    setModelName('');
    setModelNote('');
    setApiKey('');
    setFormType('image');
    setShowForm(true);
    setShowApiKey(false);
    setTestResult(null);
  };

  const handleTestConnection = async () => {
    if (!apiUrl.trim() || !apiKey.trim()) {
      setTestResult({ success: false, message: '请先填写 API 请求地址和 API Key' });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/auth/test-api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiUrl: apiUrl.trim(),
          apiKey: apiKey.trim(),
          modelName: modelName.trim(),
          provider: provider.trim(),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setTestResult({ success: true, message: data.message });
      } else {
        const parts = [data.error];
        if (data.suggestion) parts.push(data.suggestion);
        setTestResult({ success: false, message: parts.join(' — ') });
      }
    } catch {
      setTestResult({ success: false, message: '测试请求发送失败，请检查网络' });
    } finally {
      setTesting(false);
    }
  };

  const handleFetchModels = async () => {
    if (!apiUrl.trim() || !apiKey.trim()) {
      setFetchModelsError('请先填写 API 请求地址和 API Key');
      return;
    }
    setFetchingModels(true);
    setFetchModelsError(null);
    setModels([]);
    try {
      const res = await fetch('/api/auth/fetch-models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiUrl: apiUrl.trim(),
          apiKey: apiKey.trim(),
          provider: provider.trim(),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setModels(data.models);
        setFetchModelsError(null);
      } else {
        const parts = [data.error];
        if (data.suggestion) parts.push(data.suggestion);
        setFetchModelsError(parts.join(' — '));
        setModels([]);
      }
    } catch {
      setFetchModelsError('获取模型列表失败，请检查网络');
      setModels([]);
    } finally {
      setFetchingModels(false);
    }
  };

  const resetForm = () => {
    setShowForm(false);
    setShowApiKey(false);
    setProvider('');
    setSupplierName('');
    setApiUrl('');
    setModelName('');
    setModelNote('');
    setApiKey('');
    setTestResult(null);
    setEditingKeyId(null);
  };

  const handleTestExistingKey = async (keyId: string) => {
    const key = keys.find(k => k.id === keyId);
    if (!key) return;
    if (!key.apiKey) {
      setKeyTestResults(prev => ({ ...prev, [keyId]: { success: false, message: '密钥已安全保存在服务端，请在编辑时输入新密钥后测试' } }));
      return;
    }
    setTestingKeyId(keyId);
    setKeyTestResults(prev => {
      const next = { ...prev };
      delete next[keyId];
      return next;
    });
    try {
      const res = await fetch('/api/auth/test-api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiUrl: key.apiUrl,
          apiKey: key.apiKey,
          modelName: key.modelName,
          provider: key.provider,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setKeyTestResults(prev => ({ ...prev, [keyId]: { success: true, message: data.message } }));
      } else {
        const parts = [data.error];
        if (data.suggestion) parts.push(data.suggestion);
        setKeyTestResults(prev => ({ ...prev, [keyId]: { success: false, message: parts.join(' — ') } }));
      }
    } catch {
      setKeyTestResults(prev => ({ ...prev, [keyId]: { success: false, message: '测试请求发送失败' } }));
    } finally {
      setTestingKeyId(null);
    }
  };

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

  const openSmartDialog = async () => {
    setSmartConfigText(SMART_IMPORT_DEFAULT_CONFIG);
    setShowSmartDialog(true);
    try {
      const text = await navigator.clipboard?.readText?.();
      if (text && isSmartConfigJson(text)) {
        const shouldFill = window.confirm('已读取到 API 配置，是否自动填充？');
        if (shouldFill) {
          setSmartConfigText(text.trim());
          toast.success('已从剪贴板读取 API 配置');
        }
      }
    } catch {
      // Browser permission can block clipboard reads before a user gesture.
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
    setSmartImporting(true);
    try {
      const token = getClientAuthToken();
      const res = await fetch('/api/user-api-keys/smart-import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ configText: trimmedConfig }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '导入失败');
      refresh();
      window.dispatchEvent(new CustomEvent('custom-api-keys-updated'));
      toast.success(data.message || 'API 配置已导入');
      setShowSmartDialog(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '导入失败');
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
      if (!isSmartConfigJson(trimmed)) {
        setSmartConfigText(trimmed);
        toast.error('剪贴板内容不是可导入的 API 配置 JSON');
        return;
      }
      setSmartConfigText(trimmed);
      await importSmartConfig(trimmed);
    } catch {
      toast.error('无法读取剪贴板，请手动粘贴配置');
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Key className="h-5 w-5" />API 管理</CardTitle>
          <CardDescription>配置第三方模型API，添加后可在创作中心直接选用</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Supported providers */}
          <div className="p-4 rounded-lg bg-muted/50 border border-border/50">
            <h3 className="font-medium mb-2">支持的模型供应商</h3>
            <div className="flex flex-wrap gap-2">
              {providerOptions.filter(p => p.name !== '自定义').map((p) => (
                <Badge key={p.name} variant="outline">{p.name}</Badge>
              ))}
              <Badge variant="outline" className="border-dashed">+ 自定义</Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              添加密钥后，创作中心的模型列表会自动出现你配置的自定义模型
            </p>
          </div>

          {/* Recommended API Platform */}
          <div className="p-4 rounded-lg border border-primary/20 bg-primary/5">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <h3 className="font-medium">推荐 API 平台</h3>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <img src="/icons/mozhe-api-logo.png" alt="mozheAPI" className="h-8 w-8 object-contain" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">mozheAPI</span>
                    <Badge variant="secondary" className="text-xs">推荐</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">兼容 OpenAI 格式的中转 API，生图模型开箱即用</p>
                </div>
              </div>
              <a
                href="https://openai.mozhevip.top"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline shrink-0 ml-4"
              >
                访问平台
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>

          <Separator />

          {/* Add key button / form */}
          {!showForm ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" className="gap-2" onClick={() => setShowForm(true)}>
                <Plus className="h-4 w-4" />添加 API 密钥
              </Button>
              <Button variant="outline" className="gap-2" onClick={openSmartDialog}>
                <Bot className="h-4 w-4" />智能配置 API
              </Button>
            </div>
          ) : (
            <div className="space-y-4 p-4 rounded-lg border border-primary/20 bg-primary/5">
              <h3 className="font-medium flex items-center gap-2">
                {editingKeyId ? (
                  <>
                    <Settings className="h-4 w-4 text-primary" />
                    编辑 API 密钥
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4 text-primary" />
                    添加 API 密钥
                  </>
                )}
              </h3>

              {/* Row 1: Provider + Supplier Name */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5">
                    <Shield className="h-3.5 w-3.5 text-muted-foreground" />
                    供应商 <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    list="custom-api-provider-options"
                    placeholder="输入供应商名称"
                    value={provider}
                    onChange={(e) => handleProviderInputChange(e.target.value)}
                  />
                  <datalist id="custom-api-provider-options">
                    {providerSelectOptions.map((p) => (
                      <option key={p.name} value={p.name} />
                    ))}
                  </datalist>
                  <div className="flex flex-wrap gap-2">
                    {providerSelectOptions.slice(0, 8).map((p) => (
                      <Button
                        key={p.name}
                        type="button"
                        variant={provider === p.name ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => handleProviderChange(p.name)}
                      >
                        {p.name}
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5">
                    <Shield className="h-3.5 w-3.5 text-muted-foreground" />
                    供应商名称
                  </Label>
                  <Input
                    placeholder="例如: 硅基流动, mozheAPI"
                    value={supplierName}
                    onChange={(e) => setSupplierName(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">自定义供应商的名称，默认为选择的供应商</p>
                </div>
              </div>

              {/* Row 2: Model Type + Model Name */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5">
                    <Cpu className="h-3.5 w-3.5 text-muted-foreground" />
                    模型类型 <span className="text-destructive">*</span>
                  </Label>
                  <Select value={formType} onValueChange={v => handleModelTypeChange(v as 'image' | 'video' | 'text')}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="image">
                        <span className="flex items-center gap-2">
                          <Image className="h-3.5 w-3.5" />
                          生图模型
                        </span>
                      </SelectItem>
                      <SelectItem value="video">
                        <span className="flex items-center gap-2">
                          <Film className="h-3.5 w-3.5" />
                          视频模型
                        </span>
                      </SelectItem>
                      <SelectItem value="text">
                        <span className="flex items-center gap-2">
                          <MessageSquare className="h-3.5 w-3.5" />
                          多模态模型
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">生图模型用于文生图/图生图，视频模型用于文生视频/图生视频，多模态模型用于图片反推提示词和提示词优化</p>
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5">
                    <Cpu className="h-3.5 w-3.5 text-muted-foreground" />
                    模型名称
                  </Label>
                  <div className="relative">
                    <Input
                      placeholder={formType === 'image' ? '选择或输入生图模型' : formType === 'video' ? '选择或输入视频模型' : '选择或输入多模态模型'}
                      value={modelName}
                      onChange={(e) => {
                        handleModelNameChange(e.target.value);
                        setShowModelSuggestions(true);
                      }}
                      onClick={() => setShowModelSuggestions(true)}
                      onFocus={() => setShowModelSuggestions(true)}
                      onBlur={() => window.setTimeout(() => setShowModelSuggestions(false), 120)}
                    />
                    {showModelSuggestions && modelSuggestionOptions.length > 0 && (
                      <div className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-popover text-popover-foreground shadow-md">
                        {modelSuggestionOptions.map((option) => (
                          <button
                            key={option.key}
                            type="button"
                            className="block w-full px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              handleModelNameChange(option.value);
                              setShowModelSuggestions(false);
                            }}
                          >
                            <span className="block font-medium">{option.value}</span>
                            {option.label !== option.value && (
                              <span className="block text-xs text-muted-foreground">{option.label}</span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">留空则使用平台默认模型</p>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">
                  <Settings className="h-3.5 w-3.5 text-muted-foreground" />
                  模型备注
                </Label>
                <Input
                  placeholder="例如：高速生图、写实人像、视频主模型"
                  value={modelNote}
                  onChange={(e) => setModelNote(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">创作界面选择模型时会优先显示备注，留空则显示模型名称</p>
              </div>

              {/* Row 3: API URL + API Key */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5">
                    <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                    API 请求地址
                  </Label>
                  <Input
                    placeholder="https://api.openai.com/v1/images/generations"
                    value={apiUrl}
                    onChange={(e) => setApiUrl(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">填写完整的 API 请求端点 URL</p>
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5">
                    <Key className="h-3.5 w-3.5 text-muted-foreground" />
                    API Key <span className="text-destructive">*</span>
                  </Label>
                  <div className="relative">
                    <Input
                      type={showApiKey ? 'text' : 'password'}
                      placeholder="sk-..."
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey(!showApiKey)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-col gap-3 pt-2">
                <div className="flex items-center gap-3 flex-wrap">
                  <Button
                    className="gap-2"
                    onClick={handleAddKey}
                    disabled={!provider.trim() || (!editingKeyId && !apiKey.trim())}
                  >
                    <Check className="h-4 w-4" />
                    {editingKeyId ? '保存修改' : '确认添加'}
                  </Button>
                  <Button
                    variant="outline"
                    className="gap-2"
                    onClick={handleTestConnection}
                    disabled={!apiUrl.trim() || !apiKey.trim() || testing}
                  >
                    {testing ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Zap className="h-4 w-4" />
                    )}
                    {testing ? '测试中...' : '测试连接'}
                  </Button>
                  <Button
                    variant="outline"
                    className="gap-2"
                    onClick={handleFetchModels}
                    disabled={!apiUrl.trim() || !apiKey.trim() || fetchingModels}
                  >
                    {fetchingModels ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Cpu className="h-4 w-4" />
                    )}
                    {fetchingModels ? '获取中...' : '获取模型'}
                  </Button>
                  <Button variant="ghost" onClick={resetForm}>
                    取消
                  </Button>
                </div>
                {/* Test result */}
                {testResult && (
                  <div
                    className={`flex items-start gap-2 rounded-md px-3 py-2 text-sm ${
                      testResult.success
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        : 'bg-destructive/10 text-destructive'
                    }`}
                  >
                    {testResult.success ? (
                      <Check className="h-4 w-4 mt-0.5 shrink-0" />
                    ) : (
                      <Shield className="h-4 w-4 mt-0.5 shrink-0" />
                    )}
                    <span>{testResult.message}</span>
                  </div>
                )}
                {/* Fetch models error */}
                {fetchModelsError && (
                  <div
                    className="flex items-start gap-2 rounded-md px-3 py-2 text-sm bg-destructive/10 text-destructive"
                  >
                    <Shield className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>{fetchModelsError}</span>
                  </div>
                )}
                {/* Models list */}
                {models.length > 0 && (
                  <div className="mt-4 space-y-2">
                    <h4 className="font-medium text-sm">可用模型列表</h4>
                    <div className="border rounded-md p-3 max-h-60 overflow-y-auto">
                      {models.map((model) => (
                        <div
                          key={model.id}
                          className="p-2 rounded hover:bg-muted/50 cursor-pointer transition-colors"
                          onClick={() => setModelName(model.id)}
                        >
                          <div className="font-medium text-sm">{model.id}</div>
                          {model.description && (
                            <div className="text-xs text-muted-foreground mt-0.5">{model.description}</div>
                          )}
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">点击模型名称自动填充到模型名称输入框</p>
                  </div>
                )}
              </div>
            </div>
          )}

          <Separator />

          {/* Configured keys list */}
          <div>
            <h3 className="font-medium mb-3">已配置的密钥</h3>
            {keys.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Key className="h-8 w-8 mx-auto mb-2 opacity-20" />
                <p className="text-sm">暂无配置的API密钥</p>
                <p className="text-xs mt-1">点击上方按钮添加你的第一个密钥</p>
              </div>
            ) : (
              <div className="space-y-3">
                {groupedKeys.map((group) => (
                  <div
                    key={group.name}
                    className="p-4 rounded-lg border border-border/80 bg-card transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0 space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          {group.provider === 'mozheAPI' && (
                            <div className="flex h-6 w-6 items-center justify-center rounded bg-primary/10 mr-1">
                              <img src="/icons/mozhe-api-logo.png" alt="mozheAPI" className="h-4 w-4 object-contain" />
                            </div>
                          )}
                          <span className="font-medium">{group.name}</span>
                          <Badge variant="outline" className="text-xs">{group.provider}</Badge>
                          <Badge variant="secondary" className="text-xs">{group.keys.length} 个模型</Badge>
                        </div>

                        <div className="space-y-2 pt-1">
                          {(['image', 'video', 'text'] as const).map(type => {
                            const typeKeys = group.keys.filter(key => key.type === type);
                            if (typeKeys.length === 0) return null;
                            return (
                              <div key={type} className="rounded-md border border-border/60 bg-muted/20 p-2">
                                <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                                  {type === 'image' ? <Image className="h-3.5 w-3.5" /> : type === 'video' ? <Film className="h-3.5 w-3.5" /> : <MessageSquare className="h-3.5 w-3.5" />}
                                  {type === 'image' ? '生图模型' : type === 'video' ? '视频模型' : '多模态模型'}
                                </div>
                                <div className="space-y-1.5">
                                  {typeKeys.map(key => (
                                    <div key={key.id} className={`flex flex-col gap-2 rounded-md px-2 py-2 sm:flex-row sm:items-center sm:justify-between ${key.isActive ? 'bg-background/70' : 'bg-muted/40 opacity-70'}`}>
                                      <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <span className="font-medium">{getCustomApiModelLabel(key)}</span>
                                          {key.note && !isGenericApiKeyNote(key.note) && key.note !== key.modelName && <span className="text-xs text-muted-foreground">{key.modelName}</span>}
                                          <Badge variant="outline" className="font-mono text-xs">{key.apiKeyPreview}</Badge>
                                          {!key.isActive && <Badge variant="outline" className="text-muted-foreground">已禁用</Badge>}
                                        </div>
                                        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                          {key.apiUrl && <span className="truncate"><Globe className="mr-1 inline h-3 w-3" />{key.apiUrl}</span>}
                                          <span><Calendar className="mr-1 inline h-3 w-3" />{key.createdAt}</span>
                                        </div>
                                      </div>
                                      <div className="flex shrink-0 items-center gap-1">
                                        <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => handleTestExistingKey(key.id)} disabled={testingKeyId === key.id} title="测试连接">
                                          {testingKeyId === key.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                                        </Button>
                                        <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => handleEditKey(key.id)} title="编辑">
                                          <Settings className="h-4 w-4" />
                                        </Button>
                                        <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => toggleActive(key.id)} title={key.isActive ? '禁用' : '启用'}>
                                          {key.isActive ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                                        </Button>
                                        <Button variant="ghost" size="sm" className="h-8 px-2 text-destructive hover:text-destructive" onClick={() => remove(key.id)} title="删除">
                                          <Trash2 className="h-4 w-4" />
                                        </Button>
                                      </div>
                                      {keyTestResults[key.id] && (
                                        <div className={`sm:hidden flex items-start gap-2 rounded-md px-3 py-1.5 text-xs ${keyTestResults[key.id].success ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-destructive/10 text-destructive'}`}>
                                          {keyTestResults[key.id].success ? <Check className="h-3 w-3 mt-0.5 shrink-0" /> : <Shield className="h-3 w-3 mt-0.5 shrink-0" />}
                                          <span>{keyTestResults[key.id].message}</span>
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => handleAddModelForProvider(group)}>
                          <Plus className="h-3.5 w-3.5" />加模型
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!editingKeyId} onOpenChange={(open) => { if (!open) resetForm(); }}>
        <DialogContent className="max-w-3xl border-white/15 bg-background/85 backdrop-blur-2xl">
          <DialogHeader>
            <DialogTitle>编辑 API 密钥</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">
                  <Shield className="h-3.5 w-3.5 text-muted-foreground" />
                  供应商 <span className="text-destructive">*</span>
                </Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  value={provider}
                  onChange={(e) => handleProviderChange(e.target.value)}
                >
                  <option value="">选择供应商...</option>
                  {providerSelectOptions.map((p) => (
                    <option key={p.name} value={p.name}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>供应商名称</Label>
                <Input
                  placeholder="例如: 硅基流动, mozheAPI"
                  value={supplierName}
                  onChange={(e) => setSupplierName(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>模型类型</Label>
                <Select value={formType} onValueChange={v => handleModelTypeChange(v as 'image' | 'video' | 'text')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="image">生图模型</SelectItem>
                    <SelectItem value="video">视频模型</SelectItem>
                    <SelectItem value="text">多模态模型</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>模型名称</Label>
                <div className="relative">
                  <Input
                    placeholder={formType === 'image' ? '选择或输入生图模型' : formType === 'video' ? '选择或输入视频模型' : '选择或输入多模态模型'}
                    value={modelName}
                    onChange={(e) => {
                      handleModelNameChange(e.target.value);
                      setShowModelSuggestions(true);
                    }}
                    onClick={() => setShowModelSuggestions(true)}
                    onFocus={() => setShowModelSuggestions(true)}
                    onBlur={() => window.setTimeout(() => setShowModelSuggestions(false), 120)}
                  />
                  {showModelSuggestions && modelSuggestionOptions.length > 0 && (
                    <div className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-popover text-popover-foreground shadow-md">
                      {modelSuggestionOptions.map((option) => (
                        <button
                          key={option.key}
                          type="button"
                          className="block w-full px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            handleModelNameChange(option.value);
                            setShowModelSuggestions(false);
                          }}
                        >
                          <span className="block font-medium">{option.value}</span>
                          {option.label !== option.value && (
                            <span className="block text-xs text-muted-foreground">{option.label}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>模型备注</Label>
              <Input
                placeholder="例如：高速生图、写实人像、视频主模型"
                value={modelNote}
                onChange={(e) => setModelNote(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>API 请求地址</Label>
              <Input
                placeholder="https://api.openai.com/v1/images/generations"
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>API Key <span className="text-destructive">*</span></Label>
              <div className="relative">
                <Input
                  type={showApiKey ? 'text' : 'password'}
                  placeholder="sk-..."
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {testResult && (
              <div className={`flex items-start gap-2 rounded-md px-3 py-2 text-sm ${
                testResult.success ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-destructive/10 text-destructive'
              }`}>
                {testResult.success ? <Check className="h-4 w-4 mt-0.5 shrink-0" /> : <Shield className="h-4 w-4 mt-0.5 shrink-0" />}
                <span>{testResult.message}</span>
              </div>
            )}

            <div className="flex flex-wrap justify-end gap-3 pt-2">
              <Button variant="outline" className="gap-2" onClick={handleTestConnection} disabled={!apiUrl.trim() || !apiKey.trim() || testing}>
                {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                {testing ? '测试中...' : '测试连接'}
              </Button>
              <Button variant="outline" onClick={resetForm}>取消</Button>
              <Button className="gap-2" onClick={handleAddKey} disabled={!provider.trim() || (!editingKeyId && !apiKey.trim())}>
                <Check className="h-4 w-4" />保存修改
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showSmartDialog} onOpenChange={setShowSmartDialog}>
        <DialogContent className="flex max-h-[88vh] w-[min(1120px,calc(100vw-2rem))] max-w-none flex-col overflow-hidden border-white/15 bg-background/90 p-0 backdrop-blur-2xl sm:max-w-none">
          <DialogHeader className="border-b border-white/10 px-6 py-5 pr-12">
            <DialogTitle>智能配置 API</DialogTitle>
            <DialogDescription>
              导入 AI 生成的自定义服务商 Manifest，系统会为每个模型创建独立配置。
            </DialogDescription>
          </DialogHeader>
          <div className="grid min-h-0 flex-1 gap-0 overflow-hidden lg:grid-cols-[320px_minmax(0,1fr)]">
            <div className="space-y-4 border-b border-white/10 bg-muted/25 p-5 lg:border-b-0 lg:border-r">
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
              <div className="rounded-lg border border-border/60 bg-background/45 p-4">
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
                <Sparkles className="h-4 w-4 text-primary" />
                <p className="mt-2 leading-6">导入后 API Key 仍需在生成的配置项里单独填写，不会从剪贴板读取或保存密钥。</p>
              </div>
            </div>

            <div className="flex min-h-0 flex-col overflow-hidden p-5">
              <div className="mb-2 flex items-center justify-between gap-3">
                <Label>JSON Manifest</Label>
                <Badge variant={isSmartConfigJson(smartConfigText) ? 'default' : 'outline'}>
                  {isSmartConfigJson(smartConfigText) ? '可导入' : '待检查'}
                </Badge>
              </div>
              <Textarea
                className="min-h-[360px] flex-1 resize-none overflow-auto font-mono text-xs leading-relaxed md:text-xs"
                value={smartConfigText}
                onChange={(event) => setSmartConfigText(event.target.value)}
                spellCheck={false}
              />
              <div className="mt-4 flex flex-wrap justify-end gap-3">
                <Button variant="outline" onClick={() => setShowSmartDialog(false)} disabled={smartImporting}>取消</Button>
                <Button className="gap-2" onClick={() => importSmartConfig()} disabled={smartImporting}>
                  {smartImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  创建并使用
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
