'use client';

import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { useAuth } from '@/lib/auth-store';
import { useCustomApiKeys } from '@/lib/custom-api-store';
import { useManagedSystemApis } from '@/lib/managed-model-store';
import {
  ASPECT_RATIOS,
  IMAGE_OUTPUT_FORMAT_OPTIONS,
  IMAGE_QUALITY_OPTIONS,
  RESOLUTION_OPTIONS,
  STYLE_PRESETS,
  isCustomModel,
  isSystemModel,
  getCustomKeyId,
  getSystemApiId,
  buildCustomModelId,
  buildSystemModelId,
  inferImageParamsFromPrompt,
  resolveImageSize,
  resolveCustomApiImageSize,
  type ImageOutputFormat,
  type ImageQuality,
} from '@/lib/model-config';
import { getImageCapabilityOptions, keepSelectedOptionVisible } from '@/lib/model-capabilities';
import { getCustomApiModelLabel, getSystemApiModelLabel } from '@/lib/model-display';
import { getAgnesPromptOptimizationTarget, isAgnesPromptOptimizerModel } from '@/lib/agnes-model-templates';
import { GroupedModelSelectItems } from '@/components/create/grouped-model-select-items';
import { useModelSelection } from '@/components/create/use-model-selection';
import { Sparkles, Loader2, Download, Wand2, Image as ImageIcon, History, ChevronDown, ChevronUp, Plus, KeyRound, Share2 } from 'lucide-react';
import { useCreationHistory, getCreationMode, isPlaceholder, shareToGallery, isUrlPublished, type CreationRecord } from '@/lib/creation-history-store';
import { downloadFile, getImageDownloadExtension } from '@/lib/utils';
import { cancelGenerationJob, GenerationJobCancelledError, GenerationJobStillRunningError, runGenerationFinalCountdown, runGenerationJob, type GenerationJobStatus } from '@/lib/generation-job-client';
import { toast } from 'sonner';
import Link from 'next/link';
import { ImageLightbox } from '@/components/lightbox';
import { CreationDetailDialog } from '@/components/creation-detail-dialog';
import { GenerationErrorPanel, createGenerationError, type GenerationErrorState } from '@/components/create/generation-error-panel';
import { ExpandablePromptTextarea } from '@/components/create/expandable-prompt-textarea';
import { ImageCountCombobox } from '@/components/create/image-count-combobox';
import { StylePresetSelector } from '@/components/create/style-preset-selector';
import { useImageStylePresets } from '@/lib/style-presets-client';
import { GenerationTaskList, type ActiveGenerationTask } from '@/components/create/generation-task-list';
import { useGenerationJobRecovery } from '@/components/create/use-generation-job-recovery';
import { useActiveGenerationTaskStatusReconciliation } from '@/components/create/use-active-generation-task-status-reconciliation';
import { CachedPreviewImage } from '@/components/create/cached-preview-image';
import { InspirationGalleryDialog } from '@/components/create/inspiration-gallery-dialog';
import { TEXT_TO_IMAGE_DRAFT_EVENT, TEXT_TO_IMAGE_DRAFT_KEY, type ImageCreationReuseDraft } from '@/lib/creation-reuse';
import { MobileCreationComposer } from '@/components/create/mobile-creation-composer';
import { MobileCreateEmptyState } from '@/components/create/mobile-create-empty-state';
import { useIsMobile } from '@/hooks/use-mobile';
import { getClientAuthHeaders, getRequiredClientAuthToken, handleClientAuthFailure } from '@/lib/client-auth';

const STREAM_UNSUPPORTED_SYNC_CONFIRM_PREFIX = 'MIAOJING_STREAM_UNSUPPORTED_SYNC_CONFIRM:';
const TEXT_TO_IMAGE_SELECTED_MODEL_KEY = 'miaojing_create_text_to_image_selected_model';
const TEXT_TO_IMAGE_MODEL_TOUCHED_KEY = 'miaojing_create_text_to_image_model_touched';

function resolveImageOptionValue(selected: string, options: readonly { value: string; label: string }[], fallback = 'auto'): string {
  if (options.some(option => option.value === selected)) return selected;
  if (selected === '4K') return options.find(option => option.label.startsWith('4K 横版 (16:9)'))?.value || fallback;
  if (selected === '2K') return options.find(option => option.label.startsWith('2K 横版 (16:9)'))?.value || fallback;
  if (selected === '1080P') return options.find(option => option.value === '1920x1088')?.value || fallback;
  return options.find(option => option.value === fallback)?.value || options[0]?.value || selected;
}

function removeAutoOption<T extends { value: string }>(options: readonly T[]): T[] {
  return options.filter(option => option.value !== 'auto');
}

function getAspectRatioFromResolutionOption(
  resolution: string,
  options: readonly { value: string; label: string }[],
): string | undefined {
  const selected = options.find(option => option.value === resolution);
  const ratioFromLabel = selected?.label.match(/\((\d{1,2}:\d{1,2})\)/)?.[1];
  if (ratioFromLabel) return ratioFromLabel;

  const dimensionMatch = resolution.trim().match(/^(\d{2,5})x(\d{2,5})$/i);
  if (!dimensionMatch) return undefined;
  const width = Number(dimensionMatch[1]);
  const height = Number(dimensionMatch[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return undefined;

  const knownRatios = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '4:5', '5:4', '21:9'];
  const actual = width / height;
  const closest = knownRatios
    .map(value => {
      const [ratioWidth, ratioHeight] = value.split(':').map(Number);
      return { value, delta: Math.abs(actual - ratioWidth / ratioHeight) };
    })
    .sort((a, b) => a.delta - b.delta)[0];

  return closest && closest.delta < 0.02 ? closest.value : undefined;
}

function parseStreamUnsupportedSyncMessage(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error || '');
  if (!message.includes(STREAM_UNSUPPORTED_SYNC_CONFIRM_PREFIX)) return null;
  return message.split(STREAM_UNSUPPORTED_SYNC_CONFIRM_PREFIX).pop()?.trim()
    || '上游接口不支持流式生图请求。是否重新发起同步生图请求？';
}

type ImageGenerationResult = {
  images?: string[];
  thumbnails?: Record<string, string>;
  thumbnailUrls?: string[];
  dimensions?: Record<string, { width: number; height: number }>;
  error?: string;
  creditsCost?: number;
  creditsBalance?: number;
};

function getHistoryRecordClientRequestId(record: CreationRecord): string | null {
  const value = record.params?.clientRequestId;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function getGenerationJobClientRequestId(job: GenerationJobStatus): string | null {
  const value = job.payload?.clientRequestId || job.progress?.clientRequestId;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function previewCompletedImageResult(result?: ImageGenerationResult): ActiveGenerationTask['completedResult'] {
  const images = Array.isArray(result?.images) ? result.images.filter(url => typeof url === 'string' && url.trim()) : [];
  if (images.length === 0) return undefined;
  return {
    images,
    thumbnails: result?.thumbnails,
    thumbnailUrls: result?.thumbnailUrls,
  };
}

export function TextToImagePanel() {
  const { user, accessToken, updateProfile } = useAuth();
  const { imageKeys, textKeys } = useCustomApiKeys();
  const managedSystemApis = useManagedSystemApis();
  const isMobileViewport = useIsMobile();

  // Form state
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [resolution, setResolution] = useState('1080P');
  const [count, setCount] = useState('1');
  const [outputFormat, setOutputFormat] = useState<ImageOutputFormat>('png');
  const [imageQuality, setImageQuality] = useState<ImageQuality>('auto');
  const [selectedStyleLabel, setSelectedStyleLabel] = useState('');
  const [guidanceScale, setGuidanceScale] = useState(7);

  // Generation state
  const [activeTasks, setActiveTasks] = useState<ActiveGenerationTask[]>([]);
  const [results, setResults] = useState<string[]>([]);
  const [resultThumbnails, setResultThumbnails] = useState<Record<string, string>>({});
  const [resultDimensions, setResultDimensions] = useState<Record<string, { width: number; height: number }>>({});
  const [resultCredits, setResultCredits] = useState<Record<string, number>>({});
  const [activeGenerationPrompt, setActiveGenerationPrompt] = useState('');
  const [generationError, setGenerationError] = useState<GenerationErrorState | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [inspirationOpen, setInspirationOpen] = useState(false);
  const activeSubmissionSignaturesRef = useRef(new Set<string>());
  const cancelledTaskIdsRef = useRef(new Set<string>());
  const completedTaskIdentityIdsRef = useRef(new Set<string>());
  const syncConfirmationResolversRef = useRef(new Map<string, (confirmed: boolean) => void>());
  const generating = activeTasks.length > 0;
  const activeJobIds = useMemo(
    () => activeTasks.flatMap(task => [task.jobId, task.clientRequestId, task.id]).filter((id): id is string => Boolean(id)),
    [activeTasks],
  );

  // History state
  const { records, add: addRecord, remove: removeRecord } = useCreationHistory({ mode: 'text2img', limit: 60 });
  const [showHistory, setShowHistory] = useState(false);
  const imageHistory = records.filter(r => getCreationMode(r) === 'text2img');
  const mobileImageHistory = useMemo(
    () => [...imageHistory].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    [imageHistory],
  );

  // Lightbox state
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const mobileHistoryEndRef = useRef<HTMLDivElement | null>(null);

  // History detail dialog
  const [selectedHistoryRecord, setSelectedHistoryRecord] = useState<CreationRecord | null>(null);
  const stylePresets = useImageStylePresets(STYLE_PRESETS);

  const applyPromptDraft = useCallback((draft: unknown) => {
    if (!draft || typeof draft !== 'object') return;
    const data = draft as ImageCreationReuseDraft;
    if (typeof data.prompt === 'string') setPrompt(data.prompt);
    if (typeof data.negativePrompt === 'string') setNegativePrompt(data.negativePrompt);
    if (typeof data.model === 'string' && data.model.trim()) setSelectedModel(data.model.trim());
    if (typeof data.aspectRatio === 'string' && data.aspectRatio.trim()) setAspectRatio(data.aspectRatio.trim());
    if (typeof data.resolution === 'string' && data.resolution.trim()) setResolution(data.resolution.trim());
    if (typeof data.count === 'string' && data.count.trim()) setCount(data.count.trim());
    if (data.outputFormat) setOutputFormat(data.outputFormat);
    if (data.imageQuality) setImageQuality(data.imageQuality);
    if (typeof data.styleLabel === 'string') setSelectedStyleLabel(data.styleLabel);
    if (typeof data.guidanceScale === 'number' && Number.isFinite(data.guidanceScale)) {
      setGuidanceScale(Math.min(20, Math.max(1, data.guidanceScale)));
    }
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(TEXT_TO_IMAGE_DRAFT_KEY);
      if (raw) applyPromptDraft(JSON.parse(raw));
    } catch {
      // Ignore malformed local draft data.
    }

    const handleDraft = (event: Event) => {
      applyPromptDraft((event as CustomEvent).detail);
    };
    window.addEventListener(TEXT_TO_IMAGE_DRAFT_EVENT, handleDraft);
    return () => window.removeEventListener(TEXT_TO_IMAGE_DRAFT_EVENT, handleDraft);
  }, [applyPromptDraft]);

  useEffect(() => {
    const isMobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;
    if (!isMobile) return;
    window.requestAnimationFrame(() => {
      mobileHistoryEndRef.current?.scrollIntoView({ block: 'end' });
    });
  }, [mobileImageHistory.length, activeTasks.length, generationError]);

  // System APIs
  const systemImageApis = managedSystemApis.filter(api => api.type === 'image' && api.isActive);
  const systemTextApis = managedSystemApis.filter(api => api.type === 'text' && api.isActive);

  // Model options — only system + custom (no builtin)
  const modelOptions = useMemo(() => [
    ...systemImageApis.map(api => ({ id: buildSystemModelId(api.id), label: getSystemApiModelLabel(api), group: '默认模型' })),
    ...imageKeys.map(k => ({ id: buildCustomModelId(k.id), label: getCustomApiModelLabel(k), group: '自定义模型' })),
  ], [systemImageApis, imageKeys]);

  const hasModels = modelOptions.length > 0;

  const { selectedModel, setSelectedModel, handleSelectedModelChange } = useModelSelection(
    modelOptions,
    TEXT_TO_IMAGE_SELECTED_MODEL_KEY,
    TEXT_TO_IMAGE_MODEL_TOUCHED_KEY,
  );

  const selectedSystemApi = useMemo(() => (
    isSystemModel(selectedModel)
      ? systemImageApis.find(api => api.id === getSystemApiId(selectedModel))
      : undefined
  ), [selectedModel, systemImageApis]);

  // Text model options for prompt optimization — memoized
  const textModelOptions = useMemo(() => [
    ...textKeys.map(k => ({ id: buildCustomModelId(k.id), label: getCustomApiModelLabel(k), config: { customApiKeyId: k.id, modelName: k.modelName } })),
    ...systemTextApis.map(api => ({ id: buildSystemModelId(api.id), label: getSystemApiModelLabel(api), config: { systemApiId: api.id, modelName: api.modelName } })),
  ], [textKeys, systemTextApis]);
  const selectedAgnesPromptTarget = useMemo(() => getAgnesPromptOptimizationTarget(selectedSystemApi ? {
    modelName: selectedSystemApi.modelName,
    displayName: getSystemApiModelLabel(selectedSystemApi),
    mediaType: 'image',
  } : undefined), [selectedSystemApi]);
  const agnesOptimizerTextModel = useMemo(
    () => textModelOptions.find(item => isAgnesPromptOptimizerModel(item.config.modelName)),
    [textModelOptions],
  );
  const genericTextModelOptions = useMemo(
    () => textModelOptions.filter(item => !isAgnesPromptOptimizerModel(item.config.modelName)),
    [textModelOptions],
  );
  const canUseAgnesOptimizer = Boolean(selectedAgnesPromptTarget && agnesOptimizerTextModel);
  const canOptimizePrompt = genericTextModelOptions.length > 0 || canUseAgnesOptimizer;

  const getCurrentModelLabel = useCallback(() => {
    if (isCustomModel(selectedModel)) {
      const key = imageKeys.find(k => k.id === getCustomKeyId(selectedModel));
      return getCustomApiModelLabel(key);
    }
    if (isSystemModel(selectedModel)) {
      const api = systemImageApis.find(a => a.id === getSystemApiId(selectedModel));
      return getSystemApiModelLabel(api);
    }
    return 'AI模型';
  }, [selectedModel, imageKeys, systemImageApis]);
  const promptOptimizationTarget = useMemo(() => {
    if (isCustomModel(selectedModel)) {
      const key = imageKeys.find(k => k.id === getCustomKeyId(selectedModel));
      return {
        modelName: key?.modelName,
        displayName: getCurrentModelLabel(),
        mediaType: 'image' as const,
      };
    }
    if (isSystemModel(selectedModel)) {
      const api = systemImageApis.find(a => a.id === getSystemApiId(selectedModel));
      return {
        modelName: api?.modelName,
        displayName: getCurrentModelLabel(),
        mediaType: 'image' as const,
      };
    }
    return undefined;
  }, [selectedModel, imageKeys, systemImageApis, getCurrentModelLabel]);

  const selectedModelCapabilities = useMemo(() => {
    if (isCustomModel(selectedModel)) {
      return imageKeys.find(k => k.id === getCustomKeyId(selectedModel))?.capabilities;
    }
    if (isSystemModel(selectedModel)) {
      return selectedSystemApi?.capabilities;
    }
    return undefined;
  }, [selectedModel, imageKeys, selectedSystemApi]);

  const imageParamOptions = useMemo(() => getImageCapabilityOptions(selectedModelCapabilities, {
    aspectRatios: ASPECT_RATIOS,
    resolutions: RESOLUTION_OPTIONS,
    qualities: IMAGE_QUALITY_OPTIONS,
    outputFormats: IMAGE_OUTPUT_FORMAT_OPTIONS,
  }), [selectedModelCapabilities]);

  const manualImageParamOptions = useMemo(() => ({
    aspectRatios: removeAutoOption(imageParamOptions.aspectRatios),
    resolutions: removeAutoOption(imageParamOptions.resolutions),
  }), [imageParamOptions.aspectRatios, imageParamOptions.resolutions]);

  const visibleImageParamOptions = useMemo(() => ({
    aspectRatios: keepSelectedOptionVisible(manualImageParamOptions.aspectRatios, aspectRatio).filter(option => option.value !== 'auto'),
    resolutions: keepSelectedOptionVisible(manualImageParamOptions.resolutions, resolution).filter(option => option.value !== 'auto'),
    outputFormats: keepSelectedOptionVisible(imageParamOptions.outputFormats || IMAGE_OUTPUT_FORMAT_OPTIONS, outputFormat),
    qualities: keepSelectedOptionVisible(imageParamOptions.qualities, imageQuality),
  }), [aspectRatio, imageParamOptions, imageQuality, manualImageParamOptions, outputFormat, resolution]);
  const imageParamColumnCount = (imageParamOptions.supportsAspectRatio && visibleImageParamOptions.aspectRatios.length > 0 ? 1 : 0)
    + (imageParamOptions.supportsResolution && visibleImageParamOptions.resolutions.length > 0 ? 1 : 0)
    + (imageParamOptions.supportsOutputFormat ? 1 : 0)
    + (imageParamOptions.supportsQuality ? 1 : 0);
  useEffect(() => {
    if (count === 'auto') {
      setCount('1');
    }
    if (imageParamOptions.supportsAspectRatio) {
      setAspectRatio(prev => resolveImageOptionValue(prev, manualImageParamOptions.aspectRatios, '1:1'));
    }
    if (imageParamOptions.supportsResolution) {
      setResolution(prev => resolveImageOptionValue(prev, manualImageParamOptions.resolutions, '1080P'));
    }
    if (imageParamOptions.supportsQuality) {
      setImageQuality(prev => resolveImageOptionValue(prev, imageParamOptions.qualities) as ImageQuality);
    }
  }, [count, imageParamOptions, manualImageParamOptions]);

  // Prompt optimization
  const handleOptimizePrompt = useCallback(async () => {
    if (!prompt.trim()) { toast.error('请先输入创作描述'); return; }
    if (!user) { toast.error('请先登录后再优化提示词'); return; }
    if (!canOptimizePrompt) { toast.error('未配置适用于当前模型的提示词优化模型'); return; }

    setOptimizing(true);
    try {
      const authToken = getRequiredClientAuthToken();
      const textModel = canUseAgnesOptimizer ? agnesOptimizerTextModel : genericTextModelOptions[0];
      const modelLabel = getCurrentModelLabel();
      const res = await fetch('/api/generate/suggest-prompt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getClientAuthHeaders(authToken),
        },
        body: JSON.stringify({
          prompt: prompt.trim(),
          modelName: textModel?.config.modelName,
          customApiConfig: textModel?.config,
          systemPrefix: `针对${modelLabel}图片生成优化提示词`,
          targetGenerationModel: promptOptimizationTarget,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        if (data.prompt) {
          setPrompt(data.prompt);
          if (typeof data.negativePrompt === 'string' && data.negativePrompt.trim()) {
            setNegativePrompt(data.negativePrompt.trim());
          }
          toast.success('提示词已优化');
        }
        else toast.error(data.error || '优化失败');
      } else {
        handleClientAuthFailure(res.status, data.error);
        toast.error(data.error || '提示词优化请求失败');
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        toast.error('请求超时，请尝试减少生成数量或降低分辨率');
      } else {
        toast.error(err instanceof Error ? err.message : '网络错误，请重试');
      }
    }
    finally { setOptimizing(false); }
  }, [prompt, user, accessToken, canOptimizePrompt, canUseAgnesOptimizer, agnesOptimizerTextModel, genericTextModelOptions, promptOptimizationTarget, getCurrentModelLabel]);

  const inferredImageParams = useMemo(() => inferImageParamsFromPrompt(prompt), [prompt]);
  const selectedStylePreset = useMemo(
    () => stylePresets.find(preset => preset.label === selectedStyleLabel),
    [stylePresets, selectedStyleLabel],
  );
  const resolveGenerationParams = useCallback((): { aspectRatio: string; resolution: string; count: number } | null => {
    const resolvedResolution = resolution === 'auto' ? inferredImageParams.resolution : resolution;
    const resolutionAspectRatio = resolvedResolution
      ? getAspectRatioFromResolutionOption(resolvedResolution, visibleImageParamOptions.resolutions)
      : undefined;
    const resolvedAspectRatio = imageParamOptions.supportsAspectRatio
      ? (aspectRatio === 'auto' ? inferredImageParams.aspectRatio : aspectRatio)
      : (resolutionAspectRatio || (aspectRatio === 'auto' ? inferredImageParams.aspectRatio : aspectRatio) || '1:1');
    const parsedCount = count === 'auto' ? inferredImageParams.count : Number(count);
    const resolvedCount = Number.isFinite(parsedCount) ? Math.min(10, Math.max(1, Math.floor(Number(parsedCount)))) : undefined;
    const missing: string[] = [];
    if (!resolvedAspectRatio) missing.push('画面比例');
    if (!resolvedResolution) missing.push('分辨率');
    if (!resolvedCount) missing.push('生成数量');
    if (missing.length > 0) {
      toast.error(`请在提示词中写明${missing.join('、')}，或手动设置后再生成`);
      return null;
    }
    if (!resolvedAspectRatio || !resolvedResolution || !resolvedCount) return null;
    return { aspectRatio: resolvedAspectRatio, resolution: resolvedResolution, count: resolvedCount };
  }, [aspectRatio, count, imageParamOptions.supportsAspectRatio, inferredImageParams, resolution, visibleImageParamOptions.resolutions]);

  const updateActiveTask = useCallback((taskId: string, update: Partial<ActiveGenerationTask>) => {
    setActiveTasks(prev => prev.map(task => task.id === taskId ? { ...task, ...update } : task));
  }, []);

  const removeActiveTask = useCallback((taskId: string) => {
    setActiveTasks(prev => prev.filter(task => task.id !== taskId));
  }, []);

  const removeActiveTaskByIds = useCallback((...ids: Array<string | undefined | null>) => {
    const identityIds = new Set(ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0));
    if (identityIds.size === 0) return;
    setActiveTasks(prev => prev.filter(task => ![
      task.id,
      task.jobId,
      task.clientRequestId,
    ].some(id => id && identityIds.has(id))));
  }, []);

  const updateActiveTaskByIds = useCallback((ids: Array<string | undefined | null>, update: Partial<ActiveGenerationTask>) => {
    const identityIds = new Set(ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0));
    if (identityIds.size === 0) return;
    setActiveTasks(prev => prev.map(task => [
      task.id,
      task.jobId,
      task.clientRequestId,
    ].some(id => id && identityIds.has(id)) ? { ...task, ...update } : task));
  }, []);

  const reserveCompletedTaskPreview = useCallback((...ids: Array<string | undefined | null>) => {
    const identityIds = ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
    if (identityIds.length === 0) return true;
    if (identityIds.some(id => completedTaskIdentityIdsRef.current.has(id))) return false;
    for (const id of identityIds) completedTaskIdentityIdsRef.current.add(id);
    return true;
  }, []);

  const applyCompletedImageResult = useCallback((result?: ImageGenerationResult) => {
    const images = Array.isArray(result?.images) ? result.images.filter(url => typeof url === 'string' && url.trim()) : [];
    if (images.length === 0) return images;
    const thumbnails = Object.fromEntries(images.map((url, imageIndex) => [
      url,
      result?.thumbnails?.[url] || result?.thumbnailUrls?.[imageIndex] || url,
    ]));
    setResults(prev => [...images.filter(url => !prev.includes(url)), ...prev]);
    setResultThumbnails(prev => ({ ...prev, ...thumbnails }));
    if (result?.dimensions) setResultDimensions(prev => ({ ...prev, ...result.dimensions! }));
    const creditsCost = Math.max(0, Number(result?.creditsCost || 0));
    const creditsPerImage = creditsCost > 0 ? Math.ceil(creditsCost / Math.max(1, images.length)) : 0;
    if (creditsPerImage > 0) {
      setResultCredits(prev => Object.fromEntries([
        ...Object.entries(prev),
        ...images.map(url => [url, creditsPerImage] as const),
      ]));
    }
    if (typeof result?.creditsBalance === 'number') {
      updateProfile({ creditsBalance: result.creditsBalance });
    }
    return images;
  }, [updateProfile]);

  const previewAndFinalizeCompletedImageTask = useCallback((
    taskId: string,
    result: ImageGenerationResult | undefined,
    ids: Array<string | undefined | null>,
  ) => {
    const identityIds = [taskId, ...ids];
    if (!reserveCompletedTaskPreview(...identityIds)) return;
    const completedResult = previewCompletedImageResult(result);
    if (!completedResult) {
      removeActiveTaskByIds(...identityIds);
      return;
    }
    updateActiveTaskByIds(identityIds, { completedResult, finalCountdownSeconds: 3 });
    void (async () => {
      await runGenerationFinalCountdown((seconds) => updateActiveTaskByIds(identityIds, { finalCountdownSeconds: seconds }), 3);
      applyCompletedImageResult(result);
      window.dispatchEvent(new CustomEvent('creation-history-updated'));
      removeActiveTaskByIds(...identityIds);
    })();
  }, [applyCompletedImageResult, removeActiveTaskByIds, reserveCompletedTaskPreview, updateActiveTaskByIds]);

  useEffect(() => {
    if (activeTasks.length === 0 || records.length === 0) return;
    const recordsByClientRequestId = new Map<string, CreationRecord>();
    for (const record of records) {
      const clientRequestId = getHistoryRecordClientRequestId(record);
      if (clientRequestId && record.url && !isPlaceholder(record.url)) {
        recordsByClientRequestId.set(clientRequestId, record);
      }
    }
    if (recordsByClientRequestId.size === 0) return;
    for (const task of activeTasks) {
      const matchedRecord = task.clientRequestId ? recordsByClientRequestId.get(task.clientRequestId) : undefined;
      if (!matchedRecord) continue;
      const matchedResult = {
        images: [matchedRecord.url],
        thumbnails: matchedRecord.thumbnailUrl ? { [matchedRecord.url]: matchedRecord.thumbnailUrl } : undefined,
        thumbnailUrls: matchedRecord.thumbnailUrl ? [matchedRecord.thumbnailUrl] : undefined,
        dimensions: matchedRecord.width || matchedRecord.height
          ? { [matchedRecord.url]: { width: Number(matchedRecord.width || 0), height: Number(matchedRecord.height || 0) } }
          : undefined,
        creditsCost: matchedRecord.creditsCost,
      };
      if (!reserveCompletedTaskPreview(task.id, task.jobId, task.clientRequestId)) continue;
      updateActiveTaskByIds([task.id, task.jobId, task.clientRequestId], {
        completedResult: previewCompletedImageResult(matchedResult),
        finalCountdownSeconds: 3,
      });
      void (async () => {
        await runGenerationFinalCountdown((seconds) => updateActiveTaskByIds([task.id, task.jobId, task.clientRequestId], { finalCountdownSeconds: seconds }), 3);
        applyCompletedImageResult(matchedResult);
        removeActiveTaskByIds(task.id, task.jobId, task.clientRequestId);
      })();
    }
  }, [records, activeTasks, removeActiveTaskByIds, applyCompletedImageResult, reserveCompletedTaskPreview, updateActiveTaskByIds]);

  const handleCancelTask = useCallback((taskId: string) => {
    const task = activeTasks.find(item => item.id === taskId);
    cancelledTaskIdsRef.current.add(taskId);
    if (task?.clientRequestId) cancelledTaskIdsRef.current.add(task.clientRequestId);
    if (task?.jobId) cancelledTaskIdsRef.current.add(task.jobId);
    const resolve = syncConfirmationResolversRef.current.get(taskId);
    if (resolve) {
      syncConfirmationResolversRef.current.delete(taskId);
      resolve(false);
    }
    removeActiveTask(taskId);
    if (!task?.jobId) {
      toast.success('已取消任务');
      return;
    }
    void cancelGenerationJob(task.jobId)
      .then(() => toast.success('已取消任务'))
      .catch(error => toast.error(error instanceof Error ? error.message : '取消任务失败'));
  }, [activeTasks, removeActiveTask]);

  useGenerationJobRecovery({
    types: ['image'],
    knownJobIds: activeJobIds,
    onTaskRecovered: task => {
      setActiveTasks(prev => prev.some(item => item.id === task.id || item.jobId === task.jobId || (task.clientRequestId && item.clientRequestId === task.clientRequestId) || (task.clientRequestId && item.id === task.clientRequestId)) ? prev : [...prev, task]);
    },
    onTaskFinished: (taskId, job) => {
      previewAndFinalizeCompletedImageTask(taskId, job.result as ImageGenerationResult | undefined, [job.jobId, job.id, getGenerationJobClientRequestId(job)]);
    },
    onTaskFailed: (taskId, error, job) => {
      removeActiveTaskByIds(taskId, job?.jobId, job?.id, job ? getGenerationJobClientRequestId(job) : null);
      if (error === '任务已取消') return;
      setGenerationError(createGenerationError(error));
    },
  });

  useActiveGenerationTaskStatusReconciliation({
    types: ['image'],
    activeTasks,
    updateActiveTask,
    removeActiveTaskByIds,
    getGenerationJobClientRequestId,
    onTaskSucceeded: (_task, job) => {
      previewAndFinalizeCompletedImageTask(_task.id, job.result as ImageGenerationResult | undefined, [_task.jobId, _task.clientRequestId, job.jobId, job.id, getGenerationJobClientRequestId(job)]);
    },
    onTaskFailed: (_task, error) => {
      if (error === '任务已取消') return;
      setGenerationError(createGenerationError(error));
    },
  });

  const requestSyncConfirmation = useCallback((taskId: string, message: string) => new Promise<boolean>((resolve) => {
    syncConfirmationResolversRef.current.set(taskId, resolve);
    updateActiveTask(taskId, {
      syncConfirmation: {
        message,
      },
      jobStatus: null,
      finalCountdownSeconds: null,
    });
  }), [updateActiveTask]);

  const handleConfirmSync = useCallback((taskId: string) => {
    updateActiveTask(taskId, {
      syncConfirmation: {
        message: '已确认同步生图，正在重新提交请求。',
        confirming: true,
      },
    });
    const resolve = syncConfirmationResolversRef.current.get(taskId);
    syncConfirmationResolversRef.current.delete(taskId);
    resolve?.(true);
  }, [updateActiveTask]);

  const handleCancelSync = useCallback((taskId: string) => {
    const resolve = syncConfirmationResolversRef.current.get(taskId);
    syncConfirmationResolversRef.current.delete(taskId);
    resolve?.(false);
    removeActiveTask(taskId);
  }, [removeActiveTask]);

  // Generate
  const handleGenerate = useCallback(async () => {
    const submittedPrompt = prompt.trim();
    if (!submittedPrompt) { toast.error('请输入创作描述'); return; }
    if (!user) { toast.error('请先登录'); return; }

    setGenerationError(null);
    let submissionSignature: string | null = null;
    try {
      const resolvedParams = resolveGenerationParams();
      if (!resolvedParams) return;
      const taskCount = resolvedParams.count;

      // Keep custom/system API size aligned with the selected resolution.
      const useCustomApiSize = isCustomModel(selectedModel) || isSystemModel(selectedModel);
      const resolvedSize = useCustomApiSize
        ? resolveCustomApiImageSize(resolvedParams.aspectRatio, resolvedParams.resolution)
        : resolveImageSize(resolvedParams.aspectRatio, resolvedParams.resolution);

      let requestBodyBase: Record<string, unknown> = {
        prompt: submittedPrompt,
        negativePrompt: negativePrompt.trim() || undefined,
        model: selectedModel,
        aspectRatio: resolvedParams.aspectRatio,
        resolution: resolvedParams.resolution,
        size: resolvedSize,
        count: 1,
        outputFormat,
        imageQuality,
        styleLabel: selectedStylePreset?.label,
        stylePrompt: selectedStylePreset?.prompt,
        guidanceScale,
      };

      if (isCustomModel(selectedModel)) {
        const key = imageKeys.find(k => k.id === getCustomKeyId(selectedModel));
        if (key) {
          requestBodyBase = { ...requestBodyBase, model: key.modelName, customApiConfig: { customApiKeyId: key.id, modelName: key.modelName } };
        }
      } else if (isSystemModel(selectedModel)) {
        const api = systemImageApis.find(a => a.id === getSystemApiId(selectedModel));
        if (api) {
          requestBodyBase = { ...requestBodyBase, model: api.modelName, customApiConfig: { systemApiId: api.id, modelName: api.modelName } };
        }
      }

      submissionSignature = JSON.stringify({
        prompt: submittedPrompt,
        negativePrompt: negativePrompt.trim(),
        model: selectedModel,
        aspectRatio: resolvedParams.aspectRatio,
        resolution: resolvedParams.resolution,
        count: taskCount,
        outputFormat,
        imageQuality,
        styleLabel: selectedStylePreset?.label || '',
        guidanceScale,
      });
      if (activeSubmissionSignaturesRef.current.has(submissionSignature)) {
        toast.info('相同任务正在生成中，请勿重复提交');
        return;
      }
      activeSubmissionSignaturesRef.current.add(submissionSignature);

      const batchId = `text2img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const taskIds = Array.from({ length: taskCount }, (_, index) => `${batchId}-${index + 1}`);
      setActiveGenerationPrompt(submittedPrompt);
      setActiveTasks(prev => [
        ...prev,
        ...taskIds.map(taskId => ({
          id: taskId,
          clientRequestId: taskId,
          title: '正在生成图片',
          startedAt: Date.now(),
          estimateSeconds: 90,
          jobStatus: null,
          finalCountdownSeconds: null,
        })),
      ]);

      const runSingleTask = async (taskId: string, index: number) => {
        try {
          const runJob = (payload: Record<string, unknown>) => runGenerationJob<ImageGenerationResult>(
            'image',
            payload,
            {
              timeoutMs: 900_000,
	              onStatus: (status: GenerationJobStatus) => {
	                const statusJobId = status.jobId || status.id;
	                updateActiveTask(taskId, { jobStatus: status, jobId: statusJobId || undefined });
	                if (status.status === 'succeeded') {
	                  updateActiveTask(taskId, {
	                    completedResult: previewCompletedImageResult(status.result as ImageGenerationResult | undefined),
	                    finalCountdownSeconds: 3,
	                  });
	                }
	                if (statusJobId && cancelledTaskIdsRef.current.has(taskId)) {
	                  cancelledTaskIdsRef.current.add(statusJobId);
	                  void cancelGenerationJob(statusJobId).catch(() => undefined);
                }
              },
            },
          );
          let data: ImageGenerationResult;
          try {
            data = await runJob({ ...requestBodyBase, count: 1, clientRequestId: taskId, stream: true });
          } catch (error) {
            const confirmationMessage = parseStreamUnsupportedSyncMessage(error);
            if (!confirmationMessage) throw error;
            const confirmed = await requestSyncConfirmation(taskId, confirmationMessage);
            if (!confirmed) return [];
            updateActiveTask(taskId, {
              title: '正在同步生成图片',
              startedAt: Date.now(),
              jobStatus: null,
              finalCountdownSeconds: null,
              syncConfirmation: undefined,
            });
            data = await runJob({
              ...requestBodyBase,
              count: 1,
              clientRequestId: taskId,
              stream: false,
            });
          }
	          if (cancelledTaskIdsRef.current.has(taskId)) return [];
	          if (!data.images || data.images.length === 0) {
	            throw new Error(data.error || '图片生成失败');
	          }
	          if (!reserveCompletedTaskPreview(taskId)) return [];
	          updateActiveTask(taskId, { completedResult: previewCompletedImageResult(data), finalCountdownSeconds: 3 });
	          await runGenerationFinalCountdown((seconds) => updateActiveTask(taskId, { finalCountdownSeconds: seconds }), 3);
	          if (cancelledTaskIdsRef.current.has(taskId)) return [];
	          const taskImages = applyCompletedImageResult(data);
          const thumbnails = Object.fromEntries(taskImages.map((url, imageIndex) => [
            url,
            data.thumbnails?.[url] || data.thumbnailUrls?.[imageIndex] || url,
          ]));
          const creditsCost = Math.max(0, Number(data.creditsCost || 0));
          const creditsPerImage = creditsCost > 0 ? Math.ceil(creditsCost / Math.max(1, taskImages.length)) : 0;
          setGenerationError(null);
          for (const url of taskImages) {
            addRecord({
              type: 'image', url, prompt: submittedPrompt,
              thumbnailUrl: thumbnails[url],
              width: data.dimensions?.[url]?.width,
              height: data.dimensions?.[url]?.height,
              negativePrompt: negativePrompt.trim() || undefined,
              model: selectedModel,
              modelLabel: getCurrentModelLabel(),
              isCustomModel: isCustomModel(selectedModel) || isSystemModel(selectedModel),
              params: {
                creationMode: 'text2img',
                aspectRatio: resolvedParams.aspectRatio,
                resolution: resolvedParams.resolution,
                count: 1,
                batchCount: taskCount,
                outputFormat,
                imageQuality,
                styleLabel: selectedStylePreset?.label,
                guidanceScale,
              },
              creditsCost: creditsPerImage,
            });
          }
	          return taskImages;
	        } finally {
	          syncConfirmationResolversRef.current.delete(taskId);
	          removeActiveTaskByIds(taskId);
	        }
      };

      const settled = await Promise.allSettled(taskIds.map((taskId, index) => runSingleTask(taskId, index)));
      const generatedImages = settled.flatMap(result => result.status === 'fulfilled' ? result.value : []);
      const failedResults = settled.filter((result): result is PromiseRejectedResult => result.status === 'rejected');

      if (generatedImages.length > 0) {
        setGenerationError(null);
        toast.success(`生成 ${generatedImages.length} 张图片`);
      }

      if (failedResults.length > 0) {
        const stillRunning = failedResults.some(result => result.reason instanceof GenerationJobStillRunningError);
        const cancelledCount = failedResults.filter(result => result.reason instanceof GenerationJobCancelledError).length;
        const visibleFailedResults = failedResults.filter(result => !(result.reason instanceof GenerationJobCancelledError));
        if (generatedImages.length === 0) {
          const firstError = visibleFailedResults[0]?.reason;
          if (firstError) setGenerationError(createGenerationError(firstError instanceof Error ? firstError.message : '图片生成失败'));
        } else {
          if (visibleFailedResults.length > 0) toast.error(`${visibleFailedResults.length} 个生成任务失败`);
        }
        if (stillRunning) toast.info('部分生成任务仍在执行，可稍后在创作历史中查看');
        if (cancelledCount > 0 && visibleFailedResults.length === 0) toast.info('已取消任务');
      }
    } catch (err: unknown) {
      if (err instanceof GenerationJobStillRunningError) {
        setGenerationError(null);
        toast.info('生成任务仍在执行，可稍后在创作历史中查看');
      } else if (err instanceof GenerationJobCancelledError) {
        setGenerationError(null);
        toast.info('已取消任务');
      } else if (err instanceof DOMException && err.name === 'AbortError') {
        setGenerationError(createGenerationError('请求超时，请尝试减少生成数量或降低分辨率'));
      } else {
        setGenerationError(createGenerationError(err instanceof Error ? err.message : '网络错误，请重试'));
      }
    }
    finally {
      if (submissionSignature) activeSubmissionSignaturesRef.current.delete(submissionSignature);
    }
  }, [prompt, negativePrompt, selectedModel, outputFormat, imageQuality, selectedStylePreset, guidanceScale, user, imageKeys, systemImageApis, getCurrentModelLabel, addRecord, updateProfile, resolveGenerationParams, removeActiveTaskByIds, updateActiveTask, requestSyncConfirmation, applyCompletedImageResult]);

  // Download
  const handleDownload = useCallback(async (url: string, index: number) => {
    const extension = getImageDownloadExtension(url, outputFormat);
    const result = await downloadFile(url, `miaojing-${Date.now()}-${index}.${extension}`);
    if (!result.ok) toast.error(result.error || '下载失败');
  }, [outputFormat]);

  const handleShareToGallery = useCallback(async (url: string) => {
    if (isUrlPublished(url)) {
      toast.info('该作品已分享到画廊');
      return;
    }
    try {
      await shareToGallery({
        type: 'image',
        url,
        prompt: prompt.trim(),
        model: selectedModel,
        modelLabel: getCurrentModelLabel(),
        creditsCost: resultCredits[url] || 0,
        thumbnailUrl: resultThumbnails[url],
        width: resultDimensions[url]?.width,
        height: resultDimensions[url]?.height,
        params: {
          creationMode: 'text2img',
          styleLabel: selectedStylePreset?.label,
        },
      });
      toast.success('已分享到画廊');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '分享失败，请重试');
    }
  }, [prompt, selectedModel, selectedStylePreset, getCurrentModelLabel, resultCredits, resultDimensions, resultThumbnails]);

  return (
    <>
    <InspirationGalleryDialog mode="text2img" open={inspirationOpen} onOpenChange={setInspirationOpen} />
    <div className="create-chat-layout grid min-h-[600px] grid-cols-1 gap-6 xl:grid-cols-[minmax(0,4fr)_minmax(0,6fr)]">
      {/* Left: Settings (scrollable) */}
      <div className="create-chat-composer min-w-0 space-y-5 pb-8 pr-2">
        {/* Model Selection */}
        <div className="space-y-2">
          <Label>生成模型</Label>
          {hasModels ? (
            <Select value={selectedModel} onValueChange={handleSelectedModelChange}>
              <SelectTrigger><SelectValue placeholder="选择模型" /></SelectTrigger>
              <SelectContent>
                <GroupedModelSelectItems options={modelOptions} />
              </SelectContent>
            </Select>
          ) : (
            <div className="liquid-glass-soft rounded-2xl border-dashed p-4 text-center space-y-2">
              <KeyRound className="h-8 w-8 mx-auto text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">暂无可用模型</p>
              <Link href="/profile" className="text-sm text-primary hover:underline">
                前往 我的 → API 中添加API密钥
              </Link>
            </div>
          )}
        </div>

        {/* Prompt */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label>创作描述</Label>
            <div className="flex items-center gap-1.5">
              <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs text-primary hover:text-primary" onClick={() => setInspirationOpen(true)}>
                <Sparkles className="h-3 w-3" />
                获取灵感
              </Button>
              {canOptimizePrompt && (
                <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs text-primary hover:text-primary" onClick={handleOptimizePrompt} disabled={optimizing || !prompt.trim()}>
                  {optimizing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                  {optimizing ? '优化中...' : '优化提示词'}
                </Button>
              )}
            </div>
          </div>
          <ExpandablePromptTextarea
            title="创作描述"
            placeholder="描述你想要生成的图片，越详细效果越好..."
            rows={4}
            className="h-32 resize-none overflow-y-auto"
            value={prompt}
            onValueChange={setPrompt}
          />
          <StylePresetSelector
            presets={stylePresets}
            selectedLabel={selectedStyleLabel}
            onSelect={setSelectedStyleLabel}
          />
        </div>

        {/* Negative Prompt */}
        <div className="space-y-2">
          <Label>负面提示词 <span className="text-muted-foreground text-xs">(可选)</span></Label>
          <ExpandablePromptTextarea
            title="负面提示词"
            placeholder="不希望出现的元素..."
            rows={2}
            className="h-24 resize-none overflow-y-auto"
            value={negativePrompt}
            onValueChange={setNegativePrompt}
          />
        </div>

        {/* Image Params */}
        <div className={`grid grid-cols-2 gap-x-3 gap-y-3 ${imageParamColumnCount >= 4 ? 'lg:grid-cols-[minmax(7.75rem,1.2fr)_minmax(5.75rem,0.9fr)_minmax(5.75rem,0.9fr)_minmax(5.75rem,0.9fr)]' : imageParamColumnCount === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-2'}`}>
          {imageParamOptions.supportsAspectRatio && visibleImageParamOptions.aspectRatios.length > 0 && <div className="min-w-0 space-y-2">
            <Label>画面比例</Label>
            <Select value={aspectRatio} onValueChange={setAspectRatio}>
              <SelectTrigger className="w-full min-w-0 gap-1.5 px-3 [&_svg]:size-4"><SelectValue /></SelectTrigger>
              <SelectContent>
                {visibleImageParamOptions.aspectRatios.map(ar => (
                  <SelectItem key={ar.value} value={ar.value}>{ar.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>}
          {imageParamOptions.supportsResolution && visibleImageParamOptions.resolutions.length > 0 && <div className="min-w-0 space-y-2">
            <Label>分辨率</Label>
            <Select value={resolution} onValueChange={setResolution}>
              <SelectTrigger className="w-full min-w-0 gap-1.5 px-3 [&_svg]:size-4"><SelectValue /></SelectTrigger>
              <SelectContent>
                {visibleImageParamOptions.resolutions.map(r => (
                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>}
          {imageParamOptions.supportsOutputFormat && <div className="min-w-0 space-y-2">
            <Label>图片格式</Label>
            <Select value={outputFormat} onValueChange={v => setOutputFormat(v as ImageOutputFormat)}>
              <SelectTrigger className="w-full min-w-0 gap-1.5 px-3 [&_svg]:size-4"><SelectValue /></SelectTrigger>
              <SelectContent>
                {visibleImageParamOptions.outputFormats.map(format => (
                  <SelectItem key={format.value} value={format.value}>{format.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>}
          {imageParamOptions.supportsQuality && <div className="min-w-0 space-y-2">
            <Label>质量</Label>
            <Select value={imageQuality} onValueChange={v => setImageQuality(v as ImageQuality)}>
              <SelectTrigger className="w-full min-w-0 gap-1.5 px-3 [&_svg]:size-4"><SelectValue /></SelectTrigger>
              <SelectContent>
                {visibleImageParamOptions.qualities.map(option => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>}
        </div>

        {/* Guidance Scale */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label>引导系数</Label>
            <span className="text-xs text-muted-foreground">{guidanceScale}</span>
          </div>
          <Slider value={[guidanceScale]} onValueChange={([v]) => setGuidanceScale(v)} min={1} max={20} step={1} />
          <p className="text-xs text-muted-foreground">低=画面更自由自然，高=更严格贴合提示词</p>
        </div>

        {/* Count */}
        <div className="space-y-2">
          <Label>生成数量</Label>
          <ImageCountCombobox value={count} onChange={setCount} />
        </div>

        {/* Generate Button */}
        <Button className="w-full gap-2" size="lg" onClick={handleGenerate} disabled={!hasModels}>
          <Sparkles className="h-4 w-4" />生成图片
        </Button>
      </div>

      {/* Right: Results + History (flex-1, takes remaining space) */}
      <div className="create-chat-thread min-w-0 space-y-4">
        {/* Results area */}
        <div className="create-desktop-results">
          <div className="space-y-4">
            {generating && (
              <GenerationTaskList tasks={activeTasks} onConfirmSync={handleConfirmSync} onCancelSync={handleCancelSync} onCancelTask={handleCancelTask} />
            )}
            {!generating && generationError && (
              <GenerationErrorPanel error={generationError} />
            )}
            {results.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium"><ImageIcon className="h-4 w-4" />生成结果</div>
                <div className="grid grid-cols-2 gap-3">
                  {results.map((url, i) => (
                    <div key={url || i} className="liquid-glass-soft group relative overflow-hidden rounded-2xl">
                      {resultCredits[url] > 0 && (
                        <div className="absolute left-2 top-2 z-10 rounded-full border border-black/10 bg-black/70 px-2.5 py-1 text-xs font-medium text-white shadow-lg backdrop-blur-sm">
                          -{resultCredits[url]} 积分
                        </div>
                      )}
                      <CachedPreviewImage
                        src={resultThumbnails[url] || url}
                        alt={`生成结果 ${i + 1}`}
                        className="w-full aspect-square object-cover cursor-zoom-in"
                        onClick={() => setLightboxSrc(url)}
                      />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                        <Button size="sm" variant="secondary" className="gap-1 border-white/15 bg-black/70 text-white shadow-lg backdrop-blur-sm hover:border-white/25 hover:bg-black/85 hover:text-white [&_svg]:text-white" onClick={() => setLightboxSrc(url)}><ImageIcon className="h-3.5 w-3.5" />预览</Button>
                        <Button size="sm" variant="secondary" className="gap-1 border-white/15 bg-black/70 text-white shadow-lg backdrop-blur-sm hover:border-white/25 hover:bg-black/85 hover:text-white [&_svg]:text-white" onClick={() => handleShareToGallery(url)}><Share2 className="h-3.5 w-3.5" />分享</Button>
                        <Button size="sm" variant="secondary" className="gap-1 border-white/15 bg-black/70 text-white shadow-lg backdrop-blur-sm hover:border-white/25 hover:bg-black/85 hover:text-white [&_svg]:text-white" onClick={() => handleDownload(url, i)}><Download className="h-3.5 w-3.5" />下载</Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {!generating && !generationError && results.length === 0 && (
            <div className="create-empty-result liquid-glass flex min-h-[300px] flex-col items-center justify-center rounded-2xl border-dashed py-24 text-muted-foreground">
              <ImageIcon className="h-14 w-14 mb-3 opacity-20" />
              <p className="text-sm">生成结果将显示在这里</p>
            </div>
            )}
          </div>
        </div>

        {/* History */}
        {imageHistory.length > 0 && (
          <>
          <div className="create-desktop-history space-y-2">
            <button className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors" onClick={() => setShowHistory(!showHistory)}>
              <History className="h-4 w-4" />历史创作 ({imageHistory.length})
              {showHistory ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
            {showHistory && (
              <div className="grid grid-cols-3 gap-2 max-h-[400px] overflow-y-auto">
                {imageHistory.map(record => (
                  <div
                    key={record.id}
                    className="liquid-glass-soft group relative cursor-pointer overflow-hidden rounded-xl"
                    onClick={() => setSelectedHistoryRecord(record)}
                  >
                    {isPlaceholder(record.url) ? (
                      <div className="w-full aspect-square flex items-center justify-center"><ImageIcon className="h-6 w-6 text-muted-foreground/30" /></div>
                    ) : (
                      <CachedPreviewImage
                        src={record.thumbnailUrl || record.url}
                        alt={record.prompt?.slice(0, 20) || '历史记录'}
                        className="w-full aspect-square object-cover"
                        badgeClassName="absolute right-1.5 top-1.5 z-10 scale-75 origin-top-right"
                      />
                    )}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-end p-1.5 opacity-0 group-hover:opacity-100">
                      <p className="text-xs text-white line-clamp-2">{record.prompt}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          </>
        )}
        {isMobileViewport && (
          <div className="create-mobile-history-flow">
            {mobileImageHistory.length === 0 && !generating && !generationError && (
              <MobileCreateEmptyState
                title="从一句提示词开始"
                description="输入画面主体、风格和镜头细节，生成结果会在这里形成对话式记录。"
                chips={['写实照片', '动漫插画', '水墨国风']}
              />
            )}
            {mobileImageHistory.slice(-40).map(record => (
              <div key={record.id} className="create-mobile-conversation-card space-y-3">
                <p className="create-mobile-conversation-prompt">{record.prompt || '历史创作'}</p>
                {isPlaceholder(record.url) ? (
                  <button
                    type="button"
                    className="create-mobile-history-placeholder"
                    onClick={() => setSelectedHistoryRecord(record)}
                  >
                    <ImageIcon className="h-6 w-6" />
                  </button>
                ) : (
                  <CachedPreviewImage
                    src={record.thumbnailUrl || record.url}
                    alt={record.prompt?.slice(0, 20) || '历史记录'}
                    className="create-mobile-history-image cursor-zoom-in"
                    badgeClassName="absolute right-1.5 top-1.5 z-10 scale-75 origin-top-right"
                    onClick={() => setLightboxSrc(record.url)}
                  />
                )}
              </div>
            ))}
            {generating && (
              <div className="create-mobile-conversation-card create-mobile-active-task space-y-3">
                <p className="create-mobile-conversation-prompt">{activeGenerationPrompt || prompt || '正在生成图片'}</p>
                <GenerationTaskList tasks={activeTasks} onConfirmSync={handleConfirmSync} onCancelSync={handleCancelSync} onCancelTask={handleCancelTask} />
              </div>
            )}
            {!generating && generationError && (
              <div className="create-mobile-conversation-card">
                <GenerationErrorPanel error={generationError} />
              </div>
            )}
            <div ref={mobileHistoryEndRef} className="create-mobile-history-end" aria-hidden="true" />
          </div>
        )}
      </div>

      <MobileCreationComposer
        prompt={prompt}
        placeholder="请描述画面内容"
        onPromptChange={setPrompt}
        onGenerate={handleGenerate}
        disabled={!hasModels}
        generating={generating}
        styles={(
          <StylePresetSelector
            presets={stylePresets}
            selectedLabel={selectedStyleLabel}
            onSelect={setSelectedStyleLabel}
          />
        )}
        params={(
          <>
            {imageParamOptions.supportsAspectRatio && visibleImageParamOptions.aspectRatios.length > 0 && (
              <div className="create-mobile-param-field">
                <Select value={aspectRatio} onValueChange={setAspectRatio}>
                  <SelectTrigger className="create-mobile-param-trigger"><SelectValue /></SelectTrigger>
                  <SelectContent className="create-mobile-param-select-content">
                    {visibleImageParamOptions.aspectRatios.map(ar => (
                      <SelectItem className="create-mobile-param-select-item" key={ar.value} value={ar.value}>{ar.value}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {imageParamOptions.supportsResolution && visibleImageParamOptions.resolutions.length > 0 && (
              <div className="create-mobile-param-field">
                <Select value={resolution} onValueChange={setResolution}>
                  <SelectTrigger className="create-mobile-param-trigger"><SelectValue /></SelectTrigger>
                  <SelectContent className="create-mobile-param-select-content">
                    {visibleImageParamOptions.resolutions.map(r => (
                      <SelectItem className="create-mobile-param-select-item" key={r.value} value={r.value}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="create-mobile-param-field">
              <ImageCountCombobox
                value={count}
                onChange={setCount}
                className="create-mobile-count-combobox"
              />
            </div>
          </>
        )}
      />

      {/* Lightbox */}
      <ImageLightbox
        src={lightboxSrc || ''}
        fallbackSrc={lightboxSrc ? resultThumbnails[lightboxSrc] : null}
        open={!!lightboxSrc}
        onClose={() => setLightboxSrc(null)}
      />

      {/* History Detail Dialog */}
      <CreationDetailDialog
        record={selectedHistoryRecord}
        open={!!selectedHistoryRecord}
        onClose={() => setSelectedHistoryRecord(null)}
        onDelete={async (deletedRecord) => {
          await removeRecord(deletedRecord.id);
          setSelectedHistoryRecord(null);
        }}
      />
    </div>
    </>
  );
}
