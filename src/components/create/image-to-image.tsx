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
  IMG2IMG_ASPECT_RATIOS,
  IMAGE_OUTPUT_FORMAT_OPTIONS,
  IMAGE_QUALITY_OPTIONS,
  RESOLUTION_OPTIONS,
  IMG2IMG_STYLE_PRESETS,
  isCustomModel,
  isSystemModel,
  getCustomKeyId,
  getSystemApiId,
  buildCustomModelId,
  buildSystemModelId,
  inferImageParamsFromPrompt,
  resolveImageSize,
  resolveCustomApiImageSize,
  resolveImageSizeFromDimensions,
  type ImageOutputFormat,
  type ImageQuality,
} from '@/lib/model-config';
import { getImageCapabilityOptions, keepSelectedOptionVisible } from '@/lib/model-capabilities';
import { getCustomApiModelLabel, getSystemApiModelLabel } from '@/lib/model-display';
import { getAgnesPromptOptimizationTarget, isAgnesPromptOptimizerModel } from '@/lib/agnes-model-templates';
import { GroupedModelSelectItems } from '@/components/create/grouped-model-select-items';
import { useModelSelection } from '@/components/create/use-model-selection';
import { Sparkles, Loader2, Download, Upload, Wand2, Image as ImageIcon, History, ChevronDown, ChevronUp, Plus, X, KeyRound, Share2 } from 'lucide-react';
import { useCreationHistory, getCreationMode, isPlaceholder, shareToGallery, isUrlPublished, type CreationRecord } from '@/lib/creation-history-store';
import { downloadFile, getImageDownloadExtension } from '@/lib/utils';
import { cancelGenerationJob, GenerationJobCancelledError, GenerationJobStillRunningError, runGenerationFinalCountdown, runGenerationJob, type GenerationJobStatus } from '@/lib/generation-job-client';
import { toast } from 'sonner';
import Link from 'next/link';
import { BareImagePreview, ImageLightbox } from '@/components/lightbox';
import { CreationDetailDialog } from '@/components/creation-detail-dialog';
import { GenerationErrorPanel, createGenerationError, type GenerationErrorState } from '@/components/create/generation-error-panel';
import { ExpandablePromptTextarea } from '@/components/create/expandable-prompt-textarea';
import { ReferenceImageMentionControls, buildReferenceImageAnnotations } from '@/components/create/reference-image-mention-controls';
import { compressImageFileForUpload } from '@/lib/browser-image-compression';
import { ImageCountCombobox } from '@/components/create/image-count-combobox';
import { StylePresetSelector } from '@/components/create/style-preset-selector';
import { useImageStylePresets } from '@/lib/style-presets-client';
import { GenerationTaskList, type ActiveGenerationTask } from '@/components/create/generation-task-list';
import { useGenerationJobRecovery } from '@/components/create/use-generation-job-recovery';
import { useActiveGenerationTaskStatusReconciliation } from '@/components/create/use-active-generation-task-status-reconciliation';
import { CachedPreviewImage } from '@/components/create/cached-preview-image';
import { InspirationGalleryDialog } from '@/components/create/inspiration-gallery-dialog';
import { MobileCreationComposer } from '@/components/create/mobile-creation-composer';
import { MobileCreateEmptyState } from '@/components/create/mobile-create-empty-state';
import { IMAGE_TO_IMAGE_DRAFT_EVENT, IMAGE_TO_IMAGE_DRAFT_KEY, type ImageCreationReuseDraft } from '@/lib/creation-reuse';
import { ReferencePreviewImage } from '@/components/reference-preview-image';
import { useIsMobile } from '@/hooks/use-mobile';
import { getClientAuthHeaders, getRequiredClientAuthToken, handleClientAuthFailure } from '@/lib/client-auth';

const STREAM_UNSUPPORTED_SYNC_CONFIRM_PREFIX = 'MIAOJING_STREAM_UNSUPPORTED_SYNC_CONFIRM:';
const IMAGE_TO_IMAGE_SELECTED_MODEL_KEY = 'miaojing_create_image_to_image_selected_model';
const IMAGE_TO_IMAGE_MODEL_TOUCHED_KEY = 'miaojing_create_image_to_image_model_touched';

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

interface RefImage {
  id: string;
  dataUrl: string;
  name: string;
  width?: number;
  height?: number;
}

export function ImageToImagePanel() {
  const { user, accessToken, updateProfile } = useAuth();
  const { imageKeys, textKeys } = useCustomApiKeys();
  const managedSystemApis = useManagedSystemApis();
  const isMobileViewport = useIsMobile();

  // Form state
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState('original');
  const [resolution, setResolution] = useState('1080P');
  const [strength, setStrength] = useState(0.5);
  const [count, setCount] = useState('1');
  const [outputFormat, setOutputFormat] = useState<ImageOutputFormat>('png');
  const [imageQuality, setImageQuality] = useState<ImageQuality>('auto');
  const [selectedStyleLabel, setSelectedStyleLabel] = useState('');
  const [refImages, setRefImages] = useState<RefImage[]>([]);

  // Generation state
  const [activeTasks, setActiveTasks] = useState<ActiveGenerationTask[]>([]);
  const [results, setResults] = useState<string[]>([]);
  const [resultThumbnails, setResultThumbnails] = useState<Record<string, string>>({});
  const [resultDimensions, setResultDimensions] = useState<Record<string, { width: number; height: number }>>({});
  const [resultCredits, setResultCredits] = useState<Record<string, number>>({});
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

  // History
  const { records, add: addRecord, remove: removeRecord } = useCreationHistory({ mode: 'img2img', limit: 60 });
  const [showHistory, setShowHistory] = useState(false);
  const imageHistory = records.filter(r => getCreationMode(r) === 'img2img');
  const mobileImageHistory = useMemo(
    () => [...imageHistory].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    [imageHistory],
  );

  // Lightbox state
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [referencePreviewSrc, setReferencePreviewSrc] = useState<string | null>(null);
  const mobileHistoryEndRef = useRef<HTMLDivElement | null>(null);

  // History detail dialog
  const [selectedHistoryRecord, setSelectedHistoryRecord] = useState<CreationRecord | null>(null);
  const stylePresets = useImageStylePresets(IMG2IMG_STYLE_PRESETS);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isMobileViewport) return;
    window.requestAnimationFrame(() => {
      mobileHistoryEndRef.current?.scrollIntoView({ block: 'end' });
    });
  }, [isMobileViewport, mobileImageHistory.length, activeTasks.length, generationError]);

  const applyImageToImageDraft = useCallback((draft: unknown) => {
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
    if (typeof data.strength === 'number' && Number.isFinite(data.strength)) {
      setStrength(Math.min(1, Math.max(0, data.strength)));
    }

    const rawReferences = Array.isArray(data.referenceImages)
      ? data.referenceImages
      : typeof data.referenceImage === 'string'
        ? [data.referenceImage]
        : [];
    const references = rawReferences.filter((item): item is string => (
      typeof item === 'string' && (
        item.startsWith('data:image/') ||
        /^https?:\/\/\S+/i.test(item) ||
        item.startsWith('/api/local-storage/')
      )
    ));

    if (references.length > 0) {
      setRefImages(references.map((dataUrl, index) => ({
        id: `draft-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`,
        dataUrl,
        name: index === 0 ? '复用参考图' : `复用参考图 ${index + 1}`,
      })));
    }
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(IMAGE_TO_IMAGE_DRAFT_KEY);
      if (raw) applyImageToImageDraft(JSON.parse(raw));
    } catch {
      // Ignore malformed local draft data.
    }

    const handleDraft = (event: Event) => {
      applyImageToImageDraft((event as CustomEvent).detail);
    };
    window.addEventListener(IMAGE_TO_IMAGE_DRAFT_EVENT, handleDraft);
    return () => window.removeEventListener(IMAGE_TO_IMAGE_DRAFT_EVENT, handleDraft);
  }, [applyImageToImageDraft]);

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
    IMAGE_TO_IMAGE_SELECTED_MODEL_KEY,
    IMAGE_TO_IMAGE_MODEL_TOUCHED_KEY,
  );

  const selectedSystemApi = useMemo(() => (
    isSystemModel(selectedModel)
      ? systemImageApis.find(api => api.id === getSystemApiId(selectedModel))
      : undefined
  ), [selectedModel, systemImageApis]);

  // Text model options
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
    aspectRatios: IMG2IMG_ASPECT_RATIOS,
    resolutions: RESOLUTION_OPTIONS,
    qualities: IMAGE_QUALITY_OPTIONS,
    outputFormats: IMAGE_OUTPUT_FORMAT_OPTIONS,
  }, { keepOriginalAspectRatio: true }), [selectedModelCapabilities]);

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
      setAspectRatio(prev => resolveImageOptionValue(prev, manualImageParamOptions.aspectRatios, 'original'));
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

  const addRefImageFiles = useCallback((files: File[]) => {
    const imageFiles = files.filter(file => file.type.startsWith('image/'));
    if (imageFiles.length === 0) {
      toast.error('请上传图片文件');
      return;
    }
    void (async () => {
      const refs: RefImage[] = [];

      for (const file of imageFiles) {
        try {
          const result = await compressImageFileForUpload(file);
          refs.push({
            id: `ref-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            dataUrl: result.dataUrl,
            name: result.name,
            width: result.width,
            height: result.height,
          });
        } catch (err) {
          toast.error(err instanceof Error ? err.message : '图片读取失败');
        }
      }

      if (refs.length > 0) {
        setRefImages(prev => [...prev, ...refs]);
      }
    })();
  }, []);

  const addRefImageUrl = useCallback((value: string) => {
    const url = value.trim();
    if (!/^https?:\/\/\S+/i.test(url)) {
      toast.error('请粘贴有效的图片 URL');
      return false;
    }
    setRefImages(prev => [...prev, { id: `ref-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, dataUrl: url, name: '图片 URL' }]);
    toast.success('已添加图片 URL');
    return true;
  }, []);

  // Multi-image upload handler
  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    addRefImageFiles(Array.from(files));
    // Reset input so same file can be re-selected
    e.target.value = '';
  }, [addRefImageFiles]);

  const handleUploadDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) {
      addRefImageFiles(files);
      return;
    }
    const url = event.dataTransfer.getData('text/uri-list') || event.dataTransfer.getData('text/plain');
    if (url) addRefImageUrl(url);
  }, [addRefImageFiles, addRefImageUrl]);

  const handleUploadPaste = useCallback((event: React.ClipboardEvent<HTMLDivElement>) => {
    const files = Array.from(event.clipboardData.files);
    if (files.length > 0) {
      event.preventDefault();
      addRefImageFiles(files);
      return;
    }
    const text = event.clipboardData.getData('text/plain');
    if (/^https?:\/\/\S+/i.test(text.trim())) {
      event.preventDefault();
      addRefImageUrl(text);
    }
  }, [addRefImageFiles, addRefImageUrl]);

  const removeRefImage = useCallback((id: string) => {
    setRefImages(prev => prev.filter(img => img.id !== id));
  }, []);

  const inferredImageParams = useMemo(
    () => inferImageParamsFromPrompt(prompt, { allowOriginalAspectRatio: true }),
    [prompt],
  );
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
      : (resolutionAspectRatio || (aspectRatio === 'auto' ? inferredImageParams.aspectRatio : aspectRatio) || 'original');
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
    if (!prompt.trim()) { toast.error('请输入创作描述'); return; }
    if (!user) { toast.error('请先登录'); return; }
    if (refImages.length === 0) { toast.error('请至少上传一张参考图片'); return; }

    setGenerationError(null);
    const taskId = `img2img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    let submissionSignature: string | null = null;
    try {
      const resolvedParams = resolveGenerationParams();
      if (!resolvedParams) return;
      // Send first reference image as primary, others as additional context
      const primaryImage = refImages[0].dataUrl;
      // Keep the outgoing API size aligned with the selected resolution.
      const useCustomApiSize = isCustomModel(selectedModel) || isSystemModel(selectedModel);
      const resolvedSize = resolvedParams.aspectRatio === 'original'
        ? resolveImageSizeFromDimensions(refImages[0].width, refImages[0].height, resolvedParams.resolution)
        : useCustomApiSize
          ? resolveCustomApiImageSize(resolvedParams.aspectRatio, resolvedParams.resolution)
          : resolveImageSize(resolvedParams.aspectRatio, resolvedParams.resolution);

      let requestBody: Record<string, unknown> = {
        prompt: prompt.trim(),
        negativePrompt: negativePrompt.trim() || undefined,
        model: selectedModel,
        aspectRatio: resolvedParams.aspectRatio,
        resolution: resolvedParams.resolution,
        size: resolvedSize,
        count: resolvedParams.count,
        outputFormat,
        imageQuality,
        styleLabel: selectedStylePreset?.label,
        stylePrompt: selectedStylePreset?.prompt,
        strength,
        image: primaryImage,
        // Additional reference images
        extraImages: refImages.length > 1 ? refImages.slice(1).map(img => img.dataUrl) : undefined,
        referenceImageAnnotations: buildReferenceImageAnnotations(refImages),
      };

      if (isCustomModel(selectedModel)) {
        const key = imageKeys.find(k => k.id === getCustomKeyId(selectedModel));
        if (key) {
          requestBody = { ...requestBody, model: key.modelName, customApiConfig: { customApiKeyId: key.id, modelName: key.modelName } };
        }
      } else if (isSystemModel(selectedModel)) {
        const api = systemImageApis.find(a => a.id === getSystemApiId(selectedModel));
        if (api) {
          requestBody = { ...requestBody, model: api.modelName, customApiConfig: { systemApiId: api.id, modelName: api.modelName } };
        }
      }
      submissionSignature = JSON.stringify({
        prompt: prompt.trim(),
        negativePrompt: negativePrompt.trim(),
        model: selectedModel,
        aspectRatio: resolvedParams.aspectRatio,
        resolution: resolvedParams.resolution,
        count: resolvedParams.count,
        outputFormat,
        imageQuality,
        styleLabel: selectedStylePreset?.label || '',
        strength,
        references: refImages.map(img => img.dataUrl),
        referenceImageAnnotations: buildReferenceImageAnnotations(refImages),
      });
      if (activeSubmissionSignaturesRef.current.has(submissionSignature)) {
        toast.info('相同任务正在生成中，请勿重复提交');
        return;
      }
      activeSubmissionSignaturesRef.current.add(submissionSignature);
      setActiveTasks(prev => [
        ...prev,
        {
          id: taskId,
          clientRequestId: taskId,
          title: '正在生成图片',
          startedAt: Date.now(),
          estimateSeconds: 90,
          jobStatus: null,
          finalCountdownSeconds: null,
        },
      ]);
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
        data = await runJob({ ...requestBody, clientRequestId: taskId, stream: true });
      } catch (error) {
        const confirmationMessage = parseStreamUnsupportedSyncMessage(error);
        if (!confirmationMessage) throw error;
        const confirmed = await requestSyncConfirmation(taskId, confirmationMessage);
        if (!confirmed) return;
        updateActiveTask(taskId, {
          title: '正在同步生成图片',
          startedAt: Date.now(),
          jobStatus: null,
          finalCountdownSeconds: null,
          syncConfirmation: undefined,
        });
        data = await runJob({
          ...requestBody,
          clientRequestId: taskId,
          stream: false,
        });
      }
	      if (cancelledTaskIdsRef.current.has(taskId)) return;
	      if (data.images && data.images.length > 0) {
	        if (!reserveCompletedTaskPreview(taskId)) return;
	        updateActiveTask(taskId, { completedResult: previewCompletedImageResult(data), finalCountdownSeconds: 3 });
	        await runGenerationFinalCountdown((seconds) => updateActiveTask(taskId, { finalCountdownSeconds: seconds }), 3);
	        if (cancelledTaskIdsRef.current.has(taskId)) return;
	        const thumbnails = Object.fromEntries(data.images.map((url, imageIndex) => [
	          url,
	          data.thumbnails?.[url] || data.thumbnailUrls?.[imageIndex] || url,
        ]));
        const taskImages = applyCompletedImageResult(data);
        const creditsCost = Math.max(0, Number(data.creditsCost || 0));
        const creditsPerImage = creditsCost > 0 ? Math.ceil(creditsCost / Math.max(1, taskImages.length)) : 0;
        setGenerationError(null);
        for (const url of taskImages) {
          addRecord({
            type: 'image', url, prompt: prompt.trim(),
            thumbnailUrl: thumbnails[url],
            width: data.dimensions?.[url]?.width,
            height: data.dimensions?.[url]?.height,
            negativePrompt: negativePrompt.trim() || undefined,
            model: selectedModel,
            modelLabel: getCurrentModelLabel(),
            isCustomModel: isCustomModel(selectedModel) || isSystemModel(selectedModel),
            referenceImage: primaryImage,
            referenceImages: refImages.map(img => img.dataUrl),
            params: {
              creationMode: 'img2img',
              aspectRatio: resolvedParams.aspectRatio,
              resolution: resolvedParams.resolution,
              count: resolvedParams.count,
              outputFormat,
              imageQuality,
              styleLabel: selectedStylePreset?.label,
              strength,
              refImageCount: refImages.length,
              referenceImageAnnotations: buildReferenceImageAnnotations(refImages),
            },
            creditsCost: creditsPerImage,
          });
        }
        toast.success(`生成 ${taskImages.length} 张图片`);
      } else {
        setGenerationError(createGenerationError(data.error || '图片生成失败'));
      }
    } catch (err: unknown) {
      if (err instanceof GenerationJobStillRunningError) {
        setGenerationError(null);
        removeActiveTask(taskId);
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
      syncConfirmationResolversRef.current.delete(taskId);
      removeActiveTaskByIds(taskId);
    }
  }, [prompt, negativePrompt, selectedModel, outputFormat, imageQuality, selectedStylePreset, strength, refImages, user, imageKeys, systemImageApis, getCurrentModelLabel, addRecord, updateProfile, resolveGenerationParams, removeActiveTask, removeActiveTaskByIds, updateActiveTask, requestSyncConfirmation, applyCompletedImageResult]);

  const handleDownload = useCallback(async (url: string, index: number) => {
    const extension = getImageDownloadExtension(url, outputFormat);
    const result = await downloadFile(url, `miaojing-img2img-${Date.now()}-${index}.${extension}`);
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
        referenceImage: refImages[0]?.dataUrl,
        referenceImages: refImages.map(img => img.dataUrl),
        params: {
          creationMode: 'img2img',
          styleLabel: selectedStylePreset?.label,
          referenceImage: refImages[0]?.dataUrl,
          referenceImages: refImages.map(img => img.dataUrl),
          refImageCount: refImages.length,
          referenceImageAnnotations: buildReferenceImageAnnotations(refImages),
        },
      });
      toast.success('已分享到画廊');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '分享失败，请重试');
    }
  }, [prompt, selectedModel, selectedStylePreset, getCurrentModelLabel, resultCredits, resultDimensions, resultThumbnails, refImages]);

  return (
    <>
    <InspirationGalleryDialog mode="img2img" open={inspirationOpen} onOpenChange={setInspirationOpen} />
    <div className="create-chat-layout grid min-h-[600px] grid-cols-1 gap-6 xl:grid-cols-[minmax(0,4fr)_minmax(0,6fr)]">
      <input type="file" ref={fileInputRef} className="hidden" accept="image/*" multiple onChange={handleFileChange} />
      {/* Left: Settings */}
      <div className="create-chat-composer min-w-0 space-y-5 pb-8 pr-2">
        {/* Reference Images Upload (Multi) */}
        <div className="space-y-2">
          <Label>参考图片 <span className="text-destructive">*</span> <span className="text-muted-foreground text-xs">至少1张，可上传多张</span></Label>
          <div
            tabIndex={0}
            className="flex min-h-[224px] items-center justify-center rounded-2xl border border-dashed border-border/80 bg-background/50 p-5 transition-colors hover:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/40"
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleUploadDrop}
            onPaste={handleUploadPaste}
          >
            {refImages.length > 0 ? (
              <div className="grid w-full grid-cols-3 gap-3">
                {refImages.map((img, index) => (
                  <div
                    key={img.id}
                    className="liquid-glass-soft relative group aspect-square cursor-zoom-in overflow-hidden rounded-2xl"
                    onClick={() => setReferencePreviewSrc(img.dataUrl)}
                  >
                    <ReferencePreviewImage src={img.dataUrl} alt={img.name} className="w-full h-full object-cover" />
                    <button
                      type="button"
                      className="absolute bottom-1 left-1 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-medium text-white shadow-sm backdrop-blur"
                      onClick={(event) => {
                        event.stopPropagation();
                        setPrompt(prev => `${prev}${prev.endsWith(' ') || prev.length === 0 ? '' : ' '}@参考图${index + 1} `);
                      }}
                      title={`插入 @参考图${index + 1}`}
                    >
                      @参考图{index + 1}
                    </button>
                    <button
                      className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(event) => {
                        event.stopPropagation();
                        removeRefImage(img.id);
                      }}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                <button
                  className="flex aspect-square flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border text-muted-foreground transition-colors hover:border-primary/60 hover:text-primary"
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Plus className="h-6 w-6" />
                  <span className="text-xs">添加</span>
                </button>
              </div>
            ) : (
              <button
                className="flex min-h-[189px] w-full flex-col items-center justify-center gap-2 text-center text-muted-foreground"
                type="button"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-14 w-14 opacity-30" />
                <span className="text-base font-semibold text-foreground">上传参考图片</span>
                <span className="text-sm">点击上传、拖入图片、Ctrl+V 粘贴图片或图片 URL</span>
              </button>
            )}
          </div>
        </div>

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
          <div className="flex items-center justify-between">
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
          <ReferenceImageMentionControls
            title="创作描述"
            placeholder="描述你想要的图片变化..."
            rows={3}
            className="h-32 resize-none overflow-y-auto"
            value={prompt}
            references={refImages}
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

        {/* Strength */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>重绘幅度</Label>
            <span className="text-xs text-muted-foreground">{strength.toFixed(2)}</span>
          </div>
          <Slider value={[strength]} onValueChange={([v]) => setStrength(v)} min={0} max={1} step={0.05} />
          <p className="text-xs text-muted-foreground">低=保留原图特征，高=更贴近提示词</p>
        </div>

        {/* Count */}
        <div className="space-y-2">
          <Label>生成数量</Label>
          <ImageCountCombobox value={count} onChange={setCount} />
        </div>

        {/* Generate */}
        <Button className="w-full gap-2" size="lg" onClick={handleGenerate} disabled={!hasModels}>
          <Sparkles className="h-4 w-4" />生成图片
        </Button>
      </div>

      {/* Right: Results + History */}
      <div className="create-chat-thread min-w-0 space-y-4">
        <div className="create-desktop-results space-y-4">
          {generating && (
            <GenerationTaskList tasks={activeTasks} onConfirmSync={handleConfirmSync} onCancelSync={handleCancelSync} onCancelTask={handleCancelTask} />
          )}
          {!generating && generationError && (
            <GenerationErrorPanel error={generationError} />
          )}
          {results.length > 0 ? (
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
          ) : !generating && !generationError ? (
            <div className="liquid-glass flex min-h-[300px] flex-col items-center justify-center rounded-2xl border-dashed py-24 text-muted-foreground">
              <ImageIcon className="h-14 w-14 mb-3 opacity-20" />
              <p className="text-sm">生成结果将显示在这里</p>
            </div>
          ) : null}
        </div>

        {imageHistory.length > 0 && (
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
        )}
        {isMobileViewport && (
          <div className="create-mobile-history-flow">
            {mobileImageHistory.length === 0 && !generating && !generationError && (
              <MobileCreateEmptyState
                title="上传参考图，再描述变化"
                description="参考图会保留在底部输入区，结果和任务状态会在这里显示。"
                chips={['换风格', '改场景', '保留人物']}
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
                <p className="create-mobile-conversation-prompt">{prompt || '正在生成图片'}</p>
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
        placeholder="描述你想要的图片变化"
        onPromptChange={setPrompt}
        onGenerate={handleGenerate}
        disabled={!hasModels}
        generating={generating}
        prefix={(
          <div className="create-mobile-reference-strip">
            <button
              type="button"
              className="create-mobile-upload-button"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-4 w-4" />
              <span>{refImages.length > 0 ? '添加参考图' : '上传参考图'}</span>
            </button>
            {refImages.length > 0 && (
              <div className="create-mobile-reference-list">
                {refImages.map((img, index) => (
                  <div key={img.id} className="create-mobile-reference-thumb-wrap">
                    <button
                      type="button"
                      className="create-mobile-reference-thumb"
                      onClick={() => setReferencePreviewSrc(img.dataUrl)}
                      aria-label={`预览参考图 ${index + 1}`}
                    >
                      <ReferencePreviewImage src={img.dataUrl} alt={img.name} className="h-full w-full object-cover" />
                    </button>
                    <button
                      type="button"
                      className="create-mobile-reference-token"
                      onClick={() => setPrompt(prev => `${prev}${prev.endsWith(' ') || prev.length === 0 ? '' : ' '}@参考图${index + 1} `)}
                    >
                      @{index + 1}
                    </button>
                    <button
                      type="button"
                      className="create-mobile-reference-remove"
                      onClick={() => removeRefImage(img.id)}
                      aria-label={`移除参考图 ${index + 1}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
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
            {imageParamOptions.supportsOutputFormat && (
              <div className="create-mobile-param-field">
                <Select value={outputFormat} onValueChange={v => setOutputFormat(v as ImageOutputFormat)}>
                  <SelectTrigger className="create-mobile-param-trigger"><SelectValue /></SelectTrigger>
                  <SelectContent className="create-mobile-param-select-content">
                    {visibleImageParamOptions.outputFormats.map(format => (
                      <SelectItem className="create-mobile-param-select-item" key={format.value} value={format.value}>{format.label}</SelectItem>
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
        input={(
          <ReferenceImageMentionControls
            title="创作描述"
            placeholder="描述你想要的图片变化"
            rows={2}
            className="create-mobile-prompt-input create-mobile-mention-input"
            value={prompt}
            references={refImages}
            onValueChange={setPrompt}
          />
        )}
      />

      {/* Lightbox */}
      <ImageLightbox
        src={lightboxSrc || ''}
        fallbackSrc={lightboxSrc ? resultThumbnails[lightboxSrc] : null}
        open={!!lightboxSrc}
        onClose={() => setLightboxSrc(null)}
      />
      <BareImagePreview src={referencePreviewSrc || ''} open={!!referencePreviewSrc} onClose={() => setReferencePreviewSrc(null)} />

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
