import path from 'path';
import { localStorage } from '@/lib/local-storage';
import type { ModelCapabilityConfig, ModelCapabilityOption } from '@/lib/model-config-types';

export type CustomProviderManifest = {
  id?: string;
  name?: string;
  submit?: ManifestEndpoint;
  editSubmit?: ManifestEndpoint;
  poll?: ManifestPollEndpoint;
};

export type ManifestEndpoint = {
  path: string;
  method?: string;
  contentType?: 'json' | 'multipart';
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  files?: Array<{ field: string; source: 'inputImages' | 'mask'; array?: boolean }>;
  taskIdPath?: string;
  result?: ManifestResultPaths;
};

export type ManifestPollEndpoint = Omit<ManifestEndpoint, 'contentType' | 'body' | 'files' | 'taskIdPath'> & {
  intervalSeconds?: number;
  statusPath?: string;
  finalPath?: string;
  finalValues?: unknown[];
  successValues?: unknown[];
  failureValues?: unknown[];
  errorPath?: string;
};

export type ManifestResultPaths = {
  imageUrlPaths?: string[];
  b64JsonPaths?: string[];
  videoUrlPaths?: string[];
  b64VideoPaths?: string[];
};

export type ImportedManifestBundle = {
  customProviders: CustomProviderManifest[];
  profiles: Array<{
    name?: string;
    provider?: string;
    baseUrl?: string;
    model?: string;
    apiMode?: 'images' | 'videos' | 'text' | string;
    capabilities?: ModelCapabilityConfig;
  }>;
};

export type StoredUserApiManifest = {
  version: 1;
  provider: CustomProviderManifest;
  profile: ImportedManifestBundle['profiles'][number];
  source: ImportedManifestBundle;
  capabilities?: ModelCapabilityConfig;
  createdAt: string;
};

const MAX_MANIFEST_BYTES = 256 * 1024;

function stripJsonCodeFence(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || `custom-${Date.now()}`;
}

function normalizeEndpoint(endpoint: unknown, label: string): ManifestEndpoint | undefined {
  if (!endpoint || typeof endpoint !== 'object' || Array.isArray(endpoint)) return undefined;
  const data = endpoint as Record<string, unknown>;
  const endpointPath = typeof data.path === 'string' ? data.path.trim().replace(/^\/+/, '') : '';
  if (!endpointPath) throw new Error(`${label} 缺少 path`);
  const contentType = data.contentType === 'multipart' ? 'multipart' : 'json';
  return {
    path: endpointPath,
    method: typeof data.method === 'string' ? data.method.toUpperCase() : 'POST',
    contentType,
    query: data.query && typeof data.query === 'object' && !Array.isArray(data.query) ? data.query as Record<string, unknown> : undefined,
    body: data.body && typeof data.body === 'object' && !Array.isArray(data.body) ? data.body as Record<string, unknown> : {},
    files: Array.isArray(data.files)
      ? data.files
          .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
          .map(item => ({
            field: typeof item.field === 'string' ? item.field : 'image',
            source: item.source === 'mask' ? 'mask' : 'inputImages',
            array: item.array === true,
          }))
      : undefined,
    taskIdPath: typeof data.taskIdPath === 'string' ? data.taskIdPath : undefined,
    result: normalizeResult(data.result),
  };
}

function normalizePoll(endpoint: unknown): ManifestPollEndpoint | undefined {
  const normalized = normalizeEndpoint(endpoint, 'poll');
  if (!normalized) return undefined;
  const data = endpoint as Record<string, unknown>;
  return {
    path: normalized.path,
    method: normalized.method || 'GET',
    query: normalized.query,
    result: normalized.result,
    intervalSeconds: Number.isFinite(Number(data.intervalSeconds)) ? Math.max(1, Math.min(30, Number(data.intervalSeconds))) : 5,
    statusPath: typeof data.statusPath === 'string' ? data.statusPath : undefined,
    finalPath: typeof data.finalPath === 'string' ? data.finalPath : undefined,
    finalValues: Array.isArray(data.finalValues) ? data.finalValues : undefined,
    successValues: Array.isArray(data.successValues) ? data.successValues : undefined,
    failureValues: Array.isArray(data.failureValues) ? data.failureValues : undefined,
    errorPath: typeof data.errorPath === 'string' ? data.errorPath : undefined,
  };
}

function normalizeResult(value: unknown): ManifestResultPaths {
  const data = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const stringArray = (input: unknown): string[] => Array.isArray(input) ? input.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
  return {
    imageUrlPaths: stringArray(data.imageUrlPaths),
    b64JsonPaths: stringArray(data.b64JsonPaths),
    videoUrlPaths: stringArray(data.videoUrlPaths),
    b64VideoPaths: stringArray(data.b64VideoPaths),
  };
}

function normalizeCapabilityOptions(value: unknown): ModelCapabilityOption[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const options = value
    .map((item): ModelCapabilityOption | null => {
      if (typeof item === 'string') {
        const normalized = item.trim();
        return normalized ? { value: normalized, label: normalized } : null;
      }
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const data = item as Record<string, unknown>;
      const optionValue = typeof data.value === 'string' ? data.value.trim() : '';
      if (!optionValue) return null;
      return {
        value: optionValue,
        label: typeof data.label === 'string' && data.label.trim() ? data.label.trim() : optionValue,
      };
    })
    .filter((item): item is ModelCapabilityOption => !!item);
  return options.length > 0 ? options : undefined;
}

function normalizeCapabilities(value: unknown): ModelCapabilityConfig | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const data = value as Record<string, unknown>;
  const capabilities: ModelCapabilityConfig = {
    aspectRatios: normalizeCapabilityOptions(data.aspectRatios),
    resolutions: normalizeCapabilityOptions(data.resolutions),
    qualities: normalizeCapabilityOptions(data.qualities),
    outputFormats: normalizeCapabilityOptions(data.outputFormats),
    durations: normalizeCapabilityOptions(data.durations),
    supportsAspectRatio: typeof data.supportsAspectRatio === 'boolean' ? data.supportsAspectRatio : undefined,
    supportsResolution: typeof data.supportsResolution === 'boolean' ? data.supportsResolution : undefined,
    supportsQuality: typeof data.supportsQuality === 'boolean' ? data.supportsQuality : undefined,
    supportsOutputFormat: typeof data.supportsOutputFormat === 'boolean' ? data.supportsOutputFormat : undefined,
    supportsDuration: typeof data.supportsDuration === 'boolean' ? data.supportsDuration : undefined,
  };
  return Object.values(capabilities).some(Boolean) ? capabilities : undefined;
}

function normalizeProvider(value: unknown, index: number): CustomProviderManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`customProviders[${index}] 不是对象`);
  const data = value as Record<string, unknown>;
  const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : `自定义服务商 ${index + 1}`;
  const provider: CustomProviderManifest = {
    id: typeof data.id === 'string' && data.id.trim() ? data.id.trim() : `custom-${slugify(name)}`,
    name,
    submit: normalizeEndpoint(data.submit, `${name}.submit`),
    editSubmit: normalizeEndpoint(data.editSubmit, `${name}.editSubmit`),
    poll: normalizePoll(data.poll),
  };
  if (!provider.submit) throw new Error(`${name} 缺少 submit 配置`);
  return provider;
}

export function parseImportedManifestBundle(rawText: string): ImportedManifestBundle {
  if (!rawText || rawText.length > MAX_MANIFEST_BYTES) throw new Error('配置内容为空或过大');
  const parsed = JSON.parse(stripJsonCodeFence(rawText)) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('配置 JSON 顶层必须是对象');
  const data = parsed as Record<string, unknown>;

  if (Array.isArray(data.customProviders) || Array.isArray(data.profiles)) {
    const customProviders = Array.isArray(data.customProviders)
      ? data.customProviders.map(normalizeProvider)
      : [];
    if (customProviders.length === 0) throw new Error('customProviders 不能为空');
    const profiles = Array.isArray(data.profiles)
      ? data.profiles
          .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
          .map((item, index) => ({
            name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : customProviders[index]?.name || `自定义配置 ${index + 1}`,
            provider: typeof item.provider === 'string' && item.provider.trim() ? item.provider.trim() : customProviders[index]?.id,
            baseUrl: typeof item.baseUrl === 'string' ? item.baseUrl.trim() : '',
            model: typeof item.model === 'string' && item.model.trim() ? item.model.trim() : 'gpt-image-2',
            apiMode: typeof item.apiMode === 'string' ? item.apiMode : 'images',
            capabilities: normalizeCapabilities(item.capabilities),
          }))
      : [];
    if (profiles.length === 0) {
      profiles.push({
        name: customProviders[0].name || '自定义服务商',
        provider: customProviders[0].id,
        baseUrl: '',
        model: 'gpt-image-2',
        apiMode: 'images',
        capabilities: undefined,
      });
    }
    return { customProviders, profiles };
  }

  const provider = normalizeProvider(data, 0);
  return {
    customProviders: [provider],
    profiles: [{
      name: provider.name || '自定义服务商',
      provider: provider.id,
      baseUrl: '',
      model: 'gpt-image-2',
      apiMode: 'images',
      capabilities: undefined,
    }],
  };
}

export function getProfileProvider(bundle: ImportedManifestBundle, profile: ImportedManifestBundle['profiles'][number]): CustomProviderManifest {
  const matched = bundle.customProviders.find(provider => provider.id === profile.provider)
    || bundle.customProviders.find(provider => provider.name === profile.provider)
    || bundle.customProviders[0];
  if (!matched) throw new Error('找不到 profile 对应的 customProvider');
  return matched;
}

function stripSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, '');
}

export function resolveImportedProfileApiUrl(
  bundle: ImportedManifestBundle,
  profile: ImportedManifestBundle['profiles'][number],
): string {
  const baseUrl = (profile.baseUrl || '').trim();
  const provider = getProfileProvider(bundle, profile);
  const submitPath = (provider.submit?.path || '').trim();
  if (/^https?:\/\//i.test(submitPath)) return submitPath;
  if (!baseUrl) return '';
  if (provider.poll) return baseUrl;
  try {
    const url = new URL(baseUrl);
    const basePath = stripSlashes(url.pathname);
    const endpointPath = stripSlashes(submitPath);
    if (endpointPath && !basePath.endsWith(endpointPath)) {
      url.pathname = `/${[basePath, endpointPath].filter(Boolean).join('/')}`;
    }
    return url.toString();
  } catch {
    return baseUrl;
  }
}

export async function saveUserApiManifestFile(input: {
  userId: string;
  keyId: string;
  bundle: ImportedManifestBundle;
  profile: ImportedManifestBundle['profiles'][number];
}): Promise<string> {
  const provider = getProfileProvider(input.bundle, input.profile);
  const stored: StoredUserApiManifest = {
    version: 1,
    provider,
    profile: input.profile,
    source: input.bundle,
    capabilities: input.profile.capabilities,
    createdAt: new Date().toISOString(),
  };
  const key = path.posix.join('user-api-manifests', input.userId, `${input.keyId}.json`);
  await localStorage.uploadFile({
    fileName: key,
    fileContent: Buffer.from(JSON.stringify(stored, null, 2), 'utf8'),
    contentType: 'application/json',
  });
  return key;
}

export async function saveSystemApiManifestFile(input: {
  keyId: string;
  bundle: ImportedManifestBundle;
  profile: ImportedManifestBundle['profiles'][number];
}): Promise<string> {
  const provider = getProfileProvider(input.bundle, input.profile);
  const stored: StoredUserApiManifest = {
    version: 1,
    provider,
    profile: input.profile,
    source: input.bundle,
    capabilities: input.profile.capabilities,
    createdAt: new Date().toISOString(),
  };
  const key = path.posix.join('system-api-manifests', `${input.keyId}.json`);
  await localStorage.uploadFile({
    fileName: key,
    fileContent: Buffer.from(JSON.stringify(stored, null, 2), 'utf8'),
    contentType: 'application/json',
  });
  return key;
}

export function readUserApiManifestFile(manifestPath: string | null | undefined): StoredUserApiManifest | null {
  if (!manifestPath) return null;
  try {
    const raw = localStorage.readFile(manifestPath).toString('utf8');
    const parsed = JSON.parse(raw) as StoredUserApiManifest;
    if (!parsed || parsed.version !== 1 || !parsed.provider?.submit) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function readManifestCapabilities(manifestPath: string | null | undefined): ModelCapabilityConfig | undefined {
  return readUserApiManifestFile(manifestPath)?.capabilities;
}

export async function readUserApiManifestFileAsync(manifestPath: string | null | undefined): Promise<StoredUserApiManifest | null> {
  if (!manifestPath) return null;
  const localManifest = readUserApiManifestFile(manifestPath);
  if (localManifest) return localManifest;
  try {
    const raw = (await localStorage.readFileAsync(manifestPath)).toString('utf8');
    const parsed = JSON.parse(raw) as StoredUserApiManifest;
    if (!parsed || parsed.version !== 1 || !parsed.provider?.submit) return null;
    return parsed;
  } catch {
    return null;
  }
}
