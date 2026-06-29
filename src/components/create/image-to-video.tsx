'use client';

import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/auth-store';
import { useCustomApiKeys } from '@/lib/custom-api-store';
import { useManagedSystemApis } from '@/lib/managed-model-store';
import {
  VIDEO_ASPECT_RATIOS,
  VIDEO_DURATIONS_SHORT,
  IMG2VIDEO_CAMERA_MOVEMENTS,
  isCustomModel,
  isSystemModel,
  getCustomKeyId,
  getSystemApiId,
  buildCustomModelId,
  buildSystemModelId,
} from '@/lib/model-config';
import { getCustomApiModelLabel, getSystemApiModelLabel } from '@/lib/model-display';
import { GroupedModelSelectItems } from '@/components/create/grouped-model-select-items';
import { useModelSelection } from '@/components/create/use-model-selection';
import { ensureSelectedOption, getVideoCapabilityOptions, keepSelectedOptionVisible } from '@/lib/model-capabilities';
import { getAgnesPromptOptimizationTarget, isAgnesPromptOptimizerModel } from '@/lib/agnes-model-templates';
import { Sparkles, Loader2, Download, Upload, Wand2, Film, History, ChevronDown, ChevronUp, Plus, X, KeyRound, Share2 } from 'lucide-react';
import { useCreationHistory, getCreationMode, isPlaceholder, shareToGallery, isUrlPublished, type CreationRecord } from '@/lib/creation-history-store';
import { triggerDownloadFile } from '@/lib/utils';
import { cancelGenerationJob, GenerationJobCancelledError, runGenerationFinalCountdown, runGenerationJob, type GenerationJobStatus } from '@/lib/generation-job-client';
import { toast } from 'sonner';
import Link from 'next/link';
import { CreationDetailDialog } from '@/components/creation-detail-dialog';
import { GenerationErrorPanel, createGenerationError, type GenerationErrorState } from '@/components/create/generation-error-panel';
import { ExpandablePromptTextarea } from '@/components/create/expandable-prompt-textarea';
import { ReferenceImageMentionControls, buildReferenceImageAnnotations } from '@/components/create/reference-image-mention-controls';
import { compressImageFileForUpload } from '@/lib/browser-image-compression';
import { BareImagePreview } from '@/components/lightbox';
import { GenerationTaskList, type ActiveGenerationTask } from '@/components/create/generation-task-list';
import { useGenerationJobRecovery } from '@/components/create/use-generation-job-recovery';
import { InspirationGalleryDialog } from '@/components/create/inspiration-gallery-dialog';
import { MobileCreationComposer } from '@/components/create/mobile-creation-composer';
import { MobileCreateEmptyState } from '@/components/create/mobile-create-empty-state';
import { IMAGE_TO_VIDEO_DRAFT_EVENT, IMAGE_TO_VIDEO_DRAFT_KEY, type CreationReuseDraft } from '@/lib/creation-reuse';
import { ReferencePreviewImage } from '@/components/reference-preview-image';
import { useIsMobile } from '@/hooks/use-mobile';
import { getClientAuthHeaders, getRequiredClientAuthToken, handleClientAuthFailure } from '@/lib/client-auth';

const IMAGE_TO_VIDEO_SELECTED_MODEL_KEY = 'miaojing_create_image_to_video_selected_model';
const IMAGE_TO_VIDEO_MODEL_TOUCHED_KEY = 'miaojing_create_image_to_video_model_touched';

type VideoGenerationResult = {
  videos?: string[];
  error?: string;
  creditsCost?: number;
  creditsBalance?: number;
};

const VIDEO_RESOLUTION_OPTIONS = [
  { value: '480p', label: '480p' },
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p' },
  { value: '720P', label: '720P' },
  { value: '1080P', label: '1080P' },
] as const;

function getGenerationJobClientRequestId(job: GenerationJobStatus): string | null {
  const value = job.payload?.clientRequestId || job.progress?.clientRequestId;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function previewCompletedVideoResult(result?: VideoGenerationResult): ActiveGenerationTask['completedResult'] {
  const videos = Array.isArray(result?.videos) ? result.videos.filter(url => typeof url === 'string' && url.trim()) : [];
  if (videos.length === 0) return undefined;
  return { videos };
}

interface RefImage {
  id: string;
  dataUrl: string;
  name: string;
  width?: number;
  height?: number;
}

export function ImageToVideoPanel() {
  const { user, accessToken, updateProfile } = useAuth();
  const { videoKeys, textKeys } = useCustomApiKeys();
  const managedSystemApis = useManagedSystemApis();
  const isMobileViewport = useIsMobile();

  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [duration, setDuration] = useState('4');
  const [resolution, setResolution] = useState('720p');
  const [cameraMovement, setCameraMovement] = useState(IMG2VIDEO_CAMERA_MOVEMENTS[0]);
  const [refImages, setRefImages] = useState<RefImage[]>([]);

  const [activeTasks, setActiveTasks] = useState<ActiveGenerationTask[]>([]);
  const [results, setResults] = useState<string[]>([]);
  const [generationError, setGenerationError] = useState<GenerationErrorState | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [inspirationOpen, setInspirationOpen] = useState(false);
  const [referencePreviewSrc, setReferencePreviewSrc] = useState<string | null>(null);
  const activeSubmissionSignaturesRef = useRef(new Set<string>());
  const cancelledTaskIdsRef = useRef(new Set<string>());
  const completedTaskIdentityIdsRef = useRef(new Set<string>());
  const generating = activeTasks.length > 0;
  const activeJobIds = useMemo(
    () => activeTasks.flatMap(task => [task.jobId, task.clientRequestId, task.id]).filter((id): id is string => Boolean(id)),
    [activeTasks],
  );

  const { records, add: addRecord } = useCreationHistory({ mode: 'img2video', limit: 60 });
  const [showHistory, setShowHistory] = useState(false);

  // History detail dialog
  const [selectedHistoryRecord, setSelectedHistoryRecord] = useState<CreationRecord | null>(null);
  const videoHistory = records.filter(r => getCreationMode(r) === 'img2video');
  const mobileVideoHistory = useMemo(
    () => [...videoHistory].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    [videoHistory],
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mobileHistoryEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isMobileViewport) return;
    window.requestAnimationFrame(() => {
      mobileHistoryEndRef.current?.scrollIntoView({ block: 'end' });
    });
  }, [isMobileViewport, mobileVideoHistory.length, activeTasks.length, generationError]);

  const systemVideoApis = managedSystemApis.filter(api => (
    api.type === 'video'
    && api.isActive
    && (api.videoUsageModes || ['text-to-video', 'image-to-video']).includes('image-to-video')
  ));
  const systemTextApis = managedSystemApis.filter(api => api.type === 'text' && api.isActive);

  // Model options — only system + custom (no builtin)
  const modelOptions = useMemo(() => [
    ...systemVideoApis.map(api => ({ id: buildSystemModelId(api.id), label: getSystemApiModelLabel(api), group: '默认模型' })),
    ...videoKeys.map(k => ({ id: buildCustomModelId(k.id), label: getCustomApiModelLabel(k), group: '自定义模型' })),
  ], [systemVideoApis, videoKeys]);

  const hasModels = modelOptions.length > 0;

  const { selectedModel, setSelectedModel, handleSelectedModelChange } = useModelSelection(
    modelOptions,
    IMAGE_TO_VIDEO_SELECTED_MODEL_KEY,
    IMAGE_TO_VIDEO_MODEL_TOUCHED_KEY,
  );
  const selectedSystemApi = useMemo(() => (
    isSystemModel(selectedModel)
      ? systemVideoApis.find(api => api.id === getSystemApiId(selectedModel))
      : undefined
  ), [selectedModel, systemVideoApis]);
  const videoParamOptions = useMemo(() => getVideoCapabilityOptions(selectedSystemApi?.capabilities, {
    aspectRatios: VIDEO_ASPECT_RATIOS,
    durations: VIDEO_DURATIONS_SHORT,
    resolutions: VIDEO_RESOLUTION_OPTIONS,
  }), [selectedSystemApi?.capabilities]);
  const visibleAspectRatios = useMemo(
    () => keepSelectedOptionVisible(videoParamOptions.aspectRatios, aspectRatio),
    [videoParamOptions.aspectRatios, aspectRatio],
  );
  const visibleDurations = useMemo(
    () => keepSelectedOptionVisible(videoParamOptions.durations, duration),
    [videoParamOptions.durations, duration],
  );
  const visibleResolutions = useMemo(
    () => keepSelectedOptionVisible(videoParamOptions.resolutions, resolution),
    [videoParamOptions.resolutions, resolution],
  );
  useEffect(() => {
    if (videoParamOptions.supportsAspectRatio) setAspectRatio(prev => ensureSelectedOption(prev, videoParamOptions.aspectRatios, '16:9'));
    if (videoParamOptions.supportsDuration) setDuration(prev => ensureSelectedOption(prev, videoParamOptions.durations, '4'));
    if (videoParamOptions.supportsResolution) setResolution(prev => ensureSelectedOption(prev, videoParamOptions.resolutions, '720p'));
  }, [videoParamOptions]);

  const applyImageToVideoDraft = useCallback((draft: unknown) => {
    if (!draft || typeof draft !== 'object') return;
    const data = draft as CreationReuseDraft;
    if (typeof data.prompt === 'string') setPrompt(data.prompt);
    if (typeof data.negativePrompt === 'string') setNegativePrompt(data.negativePrompt);
    if (typeof data.model === 'string' && data.model.trim()) setSelectedModel(data.model.trim());
    if (typeof data.aspectRatio === 'string' && data.aspectRatio.trim()) setAspectRatio(data.aspectRatio.trim());
    if (typeof data.duration === 'string' && data.duration.trim()) setDuration(data.duration.trim());
    if (typeof data.cameraMovement === 'string' && data.cameraMovement.trim()) setCameraMovement(data.cameraMovement.trim());

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
      const raw = window.localStorage.getItem(IMAGE_TO_VIDEO_DRAFT_KEY);
      if (raw) applyImageToVideoDraft(JSON.parse(raw));
    } catch {
      // Ignore malformed local draft data.
    }

    const handleDraft = (event: Event) => {
      applyImageToVideoDraft((event as CustomEvent).detail);
    };
    window.addEventListener(IMAGE_TO_VIDEO_DRAFT_EVENT, handleDraft);
    return () => window.removeEventListener(IMAGE_TO_VIDEO_DRAFT_EVENT, handleDraft);
  }, [applyImageToVideoDraft]);

  const textModelOptions = useMemo(() => [
    ...textKeys.map(k => ({ id: buildCustomModelId(k.id), label: `${k.modelName || k.provider} (自定义)`, config: { customApiKeyId: k.id, modelName: k.modelName } })),
    ...systemTextApis.map(api => ({ id: buildSystemModelId(api.id), label: `${api.name} (系统)`, config: { systemApiId: api.id, modelName: api.modelName } })),
  ], [textKeys, systemTextApis]);
  const selectedAgnesPromptTarget = useMemo(() => getAgnesPromptOptimizationTarget(selectedSystemApi ? {
    modelName: selectedSystemApi.modelName,
    displayName: getSystemApiModelLabel(selectedSystemApi),
    mediaType: 'video',
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
      const key = videoKeys.find(k => k.id === getCustomKeyId(selectedModel));
      return key?.modelName || key?.provider || '自定义模型';
    }
    if (isSystemModel(selectedModel)) {
      const api = systemVideoApis.find(a => a.id === getSystemApiId(selectedModel));
      return getSystemApiModelLabel(api);
    }
    return 'AI模型';
  }, [selectedModel, videoKeys, systemVideoApis]);
  const promptOptimizationTarget = useMemo(() => {
    if (isCustomModel(selectedModel)) {
      const key = videoKeys.find(k => k.id === getCustomKeyId(selectedModel));
      return {
        modelName: key?.modelName,
        displayName: getCurrentModelLabel(),
        mediaType: 'video' as const,
      };
    }
    if (isSystemModel(selectedModel)) {
      const api = systemVideoApis.find(a => a.id === getSystemApiId(selectedModel));
      return {
        modelName: api?.modelName,
        displayName: getCurrentModelLabel(),
        mediaType: 'video' as const,
      };
    }
    return undefined;
  }, [selectedModel, videoKeys, systemVideoApis, getCurrentModelLabel]);

  const handleOptimizePrompt = useCallback(async () => {
    if (!prompt.trim()) { toast.error('请先输入视频描述'); return; }
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
          systemPrefix: `针对${modelLabel}视频生成优化提示词`,
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
        toast.error('请求超时，视频生成可能需要更长时间');
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
      let compressedCount = 0;

      for (const file of imageFiles) {
        try {
          const result = await compressImageFileForUpload(file);
          if (result.compressed) compressedCount += 1;
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
      if (compressedCount > 0) {
        toast.info(`已自动压缩 ${compressedCount} 张参考图`);
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

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    addRefImageFiles(Array.from(files));
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

  const applyCompletedVideoResult = useCallback((result?: VideoGenerationResult) => {
    const videos = Array.isArray(result?.videos) ? result.videos.filter(url => typeof url === 'string' && url.trim()) : [];
    if (videos.length === 0) return videos;
    setResults(prev => [...videos.filter(url => !prev.includes(url)), ...prev]);
    setGenerationError(null);
    if (typeof result?.creditsBalance === 'number') {
      updateProfile({ creditsBalance: result.creditsBalance });
    }
    return videos;
  }, [updateProfile]);

  const previewAndFinalizeCompletedVideoTask = useCallback((
    taskId: string,
    result: VideoGenerationResult | undefined,
    ids: Array<string | undefined | null>,
  ) => {
    const identityIds = [taskId, ...ids];
    if (!reserveCompletedTaskPreview(...identityIds)) return;
    const completedResult = previewCompletedVideoResult(result);
    if (!completedResult) {
      removeActiveTaskByIds(...identityIds);
      return;
    }
    updateActiveTaskByIds(identityIds, { completedResult, finalCountdownSeconds: 3 });
    void (async () => {
      await runGenerationFinalCountdown((seconds) => updateActiveTaskByIds(identityIds, { finalCountdownSeconds: seconds }), 3);
      applyCompletedVideoResult(result);
      window.dispatchEvent(new CustomEvent('creation-history-updated'));
      removeActiveTaskByIds(...identityIds);
    })();
  }, [applyCompletedVideoResult, removeActiveTaskByIds, reserveCompletedTaskPreview, updateActiveTaskByIds]);

  const handleCancelTask = useCallback((taskId: string) => {
    const task = activeTasks.find(item => item.id === taskId);
    cancelledTaskIdsRef.current.add(taskId);
    if (task?.clientRequestId) cancelledTaskIdsRef.current.add(task.clientRequestId);
    if (task?.jobId) cancelledTaskIdsRef.current.add(task.jobId);
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
    types: ['video'],
    knownJobIds: activeJobIds,
    onTaskRecovered: task => {
      setActiveTasks(prev => prev.some(item => item.id === task.id || item.jobId === task.jobId || (task.clientRequestId && item.clientRequestId === task.clientRequestId) || (task.clientRequestId && item.id === task.clientRequestId)) ? prev : [...prev, task]);
    },
    onTaskFinished: (taskId, job) => {
      const result = job.result as VideoGenerationResult | undefined;
      if (Array.isArray(result?.videos) && result.videos.length > 0) {
        previewAndFinalizeCompletedVideoTask(taskId, result, [job.jobId, job.id, getGenerationJobClientRequestId(job)]);
        toast.success('视频生成成功');
      }
    },
    onTaskFailed: (taskId, error) => {
      removeActiveTaskByIds(taskId);
      if (error === '任务已取消') return;
      setGenerationError(createGenerationError(error));
    },
  });

  const handleGenerate = useCallback(async () => {
    if (!user) { toast.error('请先登录'); return; }
    if (refImages.length === 0 && !prompt.trim()) { toast.error('请上传参考图片或输入视频描述'); return; }

    setGenerationError(null);
    const taskId = `img2video-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    let submissionSignature: string | null = null;
    try {
      const primaryImage = refImages[0]?.dataUrl;
      let requestBody: Record<string, unknown> = {
        prompt: prompt.trim() || undefined,
        negativePrompt: negativePrompt.trim() || undefined,
        model: selectedModel,
        aspectRatio,
        duration,
        resolution,
        fps: 30,
        clientRequestId: taskId,
        image: primaryImage,
        extraImages: refImages.length > 1 ? refImages.slice(1).map(img => img.dataUrl) : undefined,
        images: refImages.length > 0 ? refImages.map(img => img.dataUrl) : undefined,
        referenceImageAnnotations: buildReferenceImageAnnotations(refImages),
      };

      if (isCustomModel(selectedModel)) {
        const key = videoKeys.find(k => k.id === getCustomKeyId(selectedModel));
        if (key) {
          requestBody = { ...requestBody, model: key.modelName, customApiConfig: { customApiKeyId: key.id, modelName: key.modelName } };
        }
      } else if (isSystemModel(selectedModel)) {
        const api = systemVideoApis.find(a => a.id === getSystemApiId(selectedModel));
        if (api) {
          requestBody = { ...requestBody, model: api.modelName, customApiConfig: { systemApiId: api.id, modelName: api.modelName } };
        }
      }
      submissionSignature = JSON.stringify({
        prompt: prompt.trim(),
        negativePrompt: negativePrompt.trim(),
        model: selectedModel,
        aspectRatio,
        duration,
        resolution,
        cameraMovement,
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
          title: '正在生成视频',
          startedAt: Date.now(),
          estimateSeconds: 300,
          jobStatus: null,
          finalCountdownSeconds: null,
        },
      ]);
	      const data = await runGenerationJob<VideoGenerationResult>(
	        'video',
	        requestBody,
	        {
	          timeoutMs: 600_000,
	          onStatus: (status: GenerationJobStatus) => {
	            const statusJobId = status.jobId || status.id;
	            updateActiveTask(taskId, { jobStatus: status, jobId: statusJobId || undefined });
	            if (status.status === 'succeeded') {
	              updateActiveTask(taskId, {
	                completedResult: previewCompletedVideoResult(status.result as VideoGenerationResult | undefined),
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
	      if (cancelledTaskIdsRef.current.has(taskId)) return;
	      if (data.videos && data.videos.length > 0) {
	        if (!reserveCompletedTaskPreview(taskId)) return;
	        updateActiveTask(taskId, { completedResult: previewCompletedVideoResult(data), finalCountdownSeconds: 3 });
	        await runGenerationFinalCountdown((seconds) => updateActiveTask(taskId, { finalCountdownSeconds: seconds }), 3);
	        if (cancelledTaskIdsRef.current.has(taskId)) return;
	        const taskVideos = applyCompletedVideoResult(data);
	        const creditsCost = Math.max(0, Number(data.creditsCost || 0));
	        const creditsPerVideo = creditsCost > 0 ? Math.ceil(creditsCost / Math.max(1, taskVideos.length)) : 0;
	        for (const url of taskVideos) {
	          addRecord({
            type: 'video', url, prompt: prompt.trim(),
            negativePrompt: negativePrompt.trim() || undefined,
            model: selectedModel,
            modelLabel: getCurrentModelLabel(),
            isCustomModel: isCustomModel(selectedModel) || isSystemModel(selectedModel),
            referenceImage: primaryImage,
            referenceImages: refImages.map(img => img.dataUrl),
            params: {
              creationMode: 'img2video',
              aspectRatio,
              duration,
              cameraMovement,
              refImageCount: refImages.length,
              referenceImageAnnotations: buildReferenceImageAnnotations(refImages),
            },
            creditsCost: creditsPerVideo,
          });
        }
        toast.success('视频生成成功');
      } else {
        setGenerationError(createGenerationError(data.error || '视频生成失败'));
      }
    } catch (err: unknown) {
      if (err instanceof GenerationJobCancelledError) {
        setGenerationError(null);
        toast.info('已取消任务');
      } else if (err instanceof DOMException && err.name === 'AbortError') {
        setGenerationError(createGenerationError('请求超时，视频生成可能需要更长时间'));
      } else {
        setGenerationError(createGenerationError(err instanceof Error ? err.message : '网络错误，请重试'));
      }
    }
	    finally {
	      if (submissionSignature) activeSubmissionSignaturesRef.current.delete(submissionSignature);
	      removeActiveTaskByIds(taskId);
	    }
	  }, [prompt, negativePrompt, selectedModel, aspectRatio, duration, resolution, cameraMovement, refImages, user, videoKeys, systemVideoApis, getCurrentModelLabel, addRecord, removeActiveTaskByIds, updateActiveTask, reserveCompletedTaskPreview, applyCompletedVideoResult]);

  const handleDownload = useCallback(async (url: string, index: number) => {
    triggerDownloadFile(url, `miaojing-img2vid-${Date.now()}-${index}.mp4`);
    toast.success('已开始下载');
  }, []);

  const handleShareToGallery = useCallback(async (url: string) => {
    if (isUrlPublished(url)) {
      toast.info('该作品已分享到画廊');
      return;
    }
    try {
      await shareToGallery({
        type: 'video',
        url,
        prompt: prompt.trim(),
        model: selectedModel,
        modelLabel: getCurrentModelLabel(),
        referenceImage: refImages[0]?.dataUrl,
        referenceImages: refImages.map(img => img.dataUrl),
        params: {
          creationMode: 'img2video',
          aspectRatio,
          duration,
          cameraMovement,
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
  }, [prompt, selectedModel, getCurrentModelLabel, refImages, aspectRatio, duration, cameraMovement]);

  return (
    <>
    <InspirationGalleryDialog mode="img2video" open={inspirationOpen} onOpenChange={setInspirationOpen} />
    <div className="create-chat-layout grid min-h-[600px] grid-cols-1 gap-6 xl:grid-cols-[minmax(0,4fr)_minmax(0,6fr)]">
      <input type="file" ref={fileInputRef} className="hidden" accept="image/*" multiple onChange={handleFileChange} />
      {/* Left: Settings */}
      <div className="create-chat-composer min-w-0 space-y-5 pb-8 pr-2">
        {/* Reference Image */}
        <div className="space-y-2">
          <Label>参考图片 <span className="text-destructive">*</span> <span className="text-muted-foreground text-xs">可上传多张</span></Label>
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
                    className="liquid-glass-soft relative aspect-square cursor-zoom-in overflow-hidden rounded-2xl"
                    onClick={() => setReferencePreviewSrc(img.dataUrl)}
                    >
                    <ReferencePreviewImage src={img.dataUrl} alt={img.name} className="h-full w-full object-cover" />
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
                      className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white"
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
                  <Plus className="h-5 w-5" />
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
          <Label>视频模型</Label>
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

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label>视频描述 <span className="text-muted-foreground text-xs">(可选)</span></Label>
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
            title="视频描述"
            placeholder="描述你想要的视频效果..."
            rows={3}
            className="h-32 resize-none overflow-y-auto"
            value={prompt}
            references={refImages}
            onValueChange={setPrompt}
          />
        </div>

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

        <div className="grid grid-cols-2 gap-3">
          {videoParamOptions.supportsAspectRatio && (
            <div className="space-y-2">
              <Label>画面比例</Label>
              <Select value={aspectRatio} onValueChange={setAspectRatio}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {visibleAspectRatios.map(ar => (
                    <SelectItem key={ar.value} value={ar.value}>{ar.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {videoParamOptions.supportsDuration && (
          <div className="create-desktop-history space-y-2">
            <Label>视频时长</Label>
            <Select value={duration} onValueChange={setDuration}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {visibleDurations.map(d => (
                  <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          )}
          {videoParamOptions.supportsResolution && (
            <div className="space-y-2">
              <Label>分辨率</Label>
              <Select value={resolution} onValueChange={setResolution}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {visibleResolutions.map(item => (
                    <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label>镜头运动</Label>
          <Select value={cameraMovement} onValueChange={setCameraMovement}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {IMG2VIDEO_CAMERA_MOVEMENTS.map(c => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button className="w-full gap-2" size="lg" onClick={handleGenerate} disabled={!hasModels}>
          <Sparkles className="h-4 w-4" />生成视频
        </Button>
      </div>

      {/* Right: Results + History */}
      <div className="create-chat-thread min-w-0 space-y-4">
        <div className="create-desktop-results space-y-4">
          {generating && (
            <GenerationTaskList tasks={activeTasks} onCancelTask={handleCancelTask} />
          )}
          {!generating && generationError && (
            <GenerationErrorPanel error={generationError} />
          )}
          {results.length > 0 ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium"><Film className="h-4 w-4" />生成结果</div>
              {results.map((url, i) => (
                <div key={i} className="liquid-glass-soft overflow-hidden rounded-2xl">
                  <video src={url} controls className="w-full" />
                  <div className="p-2 flex justify-end gap-2">
                    <Button size="sm" variant="outline" className="gap-1" onClick={() => handleShareToGallery(url)}><Share2 className="h-3.5 w-3.5" />分享</Button>
                    <Button size="sm" variant="outline" className="gap-1" onClick={() => handleDownload(url, i)}><Download className="h-3.5 w-3.5" />下载</Button>
                  </div>
                </div>
              ))}
            </div>
          ) : !generating && !generationError ? (
            <div className="liquid-glass flex min-h-[300px] flex-col items-center justify-center rounded-2xl border-dashed py-24 text-muted-foreground">
              <Film className="h-14 w-14 mb-3 opacity-20" />
              <p className="text-sm">生成结果将显示在这里</p>
            </div>
          ) : null}
        </div>

        {videoHistory.length > 0 && (
          <div className="space-y-2">
            <button className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors" onClick={() => setShowHistory(!showHistory)}>
              <History className="h-4 w-4" />历史创作 ({videoHistory.length})
              {showHistory ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
            {showHistory && (
              <div className="grid grid-cols-2 gap-2 max-h-[400px] overflow-y-auto">
                {videoHistory.map(record => (
                  <div
                    key={record.id}
                    className="liquid-glass-soft group relative cursor-pointer overflow-hidden rounded-xl"
                    onClick={() => setSelectedHistoryRecord(record)}
                  >
                    {isPlaceholder(record.url) ? (
                      <div className="w-full aspect-video flex items-center justify-center"><Film className="h-6 w-6 text-muted-foreground/30" /></div>
                    ) : (
                      <div className="w-full aspect-video relative overflow-hidden">
                        {record.thumbnailUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={record.thumbnailUrl} alt={record.prompt || '视频预览'} className="h-full w-full object-cover" loading="lazy" decoding="async" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-muted/60">
                            <Film className="h-6 w-6 text-muted-foreground/40" />
                          </div>
                        )}
                        <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity">
                          <div className="h-8 w-8 rounded-full bg-white/90 flex items-center justify-center">
                            <Film className="h-4 w-4 text-black ml-0.5" />
                          </div>
                        </div>
                      </div>
                    )}
                    <div className="p-1.5"><p className="text-xs text-muted-foreground line-clamp-1">{record.prompt}</p></div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {isMobileViewport && (
          <div className="create-mobile-history-flow">
            {mobileVideoHistory.length === 0 && !generating && !generationError && (
              <MobileCreateEmptyState
                title="让静态画面动起来"
                description="上传参考图后补充动作、镜头和时长，视频任务会在这里跟进。"
                chips={['推镜头', '轻微运镜', '照片动画']}
              />
            )}
            {mobileVideoHistory.slice(-40).map(record => (
              <div key={record.id} className="create-mobile-conversation-card space-y-3">
                <p className="create-mobile-conversation-prompt">{record.prompt || '历史创作'}</p>
                {isPlaceholder(record.url) ? (
                  <button
                    type="button"
                    className="create-mobile-history-placeholder create-mobile-video-placeholder"
                    onClick={() => setSelectedHistoryRecord(record)}
                  >
                    <Film className="h-6 w-6" />
                  </button>
                ) : record.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={record.thumbnailUrl}
                    alt={record.prompt?.slice(0, 20) || '历史记录'}
                    className="create-mobile-history-image create-mobile-video-history-image cursor-pointer"
                    loading="lazy"
                    decoding="async"
                    onClick={() => setSelectedHistoryRecord(record)}
                  />
                ) : (
                  <button
                    type="button"
                    className="create-mobile-history-placeholder create-mobile-video-placeholder"
                    onClick={() => setSelectedHistoryRecord(record)}
                  >
                    <Film className="h-6 w-6" />
                  </button>
                )}
              </div>
            ))}
            {generating && (
              <div className="create-mobile-conversation-card create-mobile-active-task space-y-3">
                <p className="create-mobile-conversation-prompt">{prompt || '正在生成视频'}</p>
                <GenerationTaskList tasks={activeTasks} onCancelTask={handleCancelTask} />
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
        placeholder="描述你想要的视频效果"
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
        params={(
          <>
            {videoParamOptions.supportsAspectRatio && (
              <div className="create-mobile-param-field">
                <Select value={aspectRatio} onValueChange={setAspectRatio}>
                  <SelectTrigger className="create-mobile-param-trigger"><SelectValue /></SelectTrigger>
                  <SelectContent className="create-mobile-param-select-content">
                    {visibleAspectRatios.map(ar => (
                      <SelectItem className="create-mobile-param-select-item" key={ar.value} value={ar.value}>{ar.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {videoParamOptions.supportsDuration && (
              <div className="create-mobile-param-field">
                <Select value={duration} onValueChange={setDuration}>
                  <SelectTrigger className="create-mobile-param-trigger"><SelectValue /></SelectTrigger>
                  <SelectContent className="create-mobile-param-select-content">
                    {visibleDurations.map(d => (
                      <SelectItem className="create-mobile-param-select-item" key={d.value} value={d.value}>{d.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {videoParamOptions.supportsResolution && (
              <div className="create-mobile-param-field">
                <Select value={resolution} onValueChange={setResolution}>
                  <SelectTrigger className="create-mobile-param-trigger"><SelectValue /></SelectTrigger>
                  <SelectContent className="create-mobile-param-select-content">
                    {visibleResolutions.map(item => (
                      <SelectItem className="create-mobile-param-select-item" key={item.value} value={item.value}>{item.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="create-mobile-param-field create-mobile-param-field-wide">
              <Select value={cameraMovement} onValueChange={setCameraMovement}>
                <SelectTrigger className="create-mobile-param-trigger create-mobile-param-trigger-wide"><SelectValue /></SelectTrigger>
                <SelectContent className="create-mobile-param-select-content">
                  {IMG2VIDEO_CAMERA_MOVEMENTS.map(c => (
                    <SelectItem className="create-mobile-param-select-item" key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </>
        )}
        input={(
          <ReferenceImageMentionControls
            title="视频描述"
            placeholder="描述你想要的视频效果"
            rows={2}
            className="create-mobile-prompt-input create-mobile-mention-input"
            value={prompt}
            references={refImages}
            onValueChange={setPrompt}
          />
        )}
      />

      {/* History Detail Dialog */}
      <CreationDetailDialog
        record={selectedHistoryRecord}
        open={!!selectedHistoryRecord}
        onClose={() => setSelectedHistoryRecord(null)}
      />
      <BareImagePreview src={referencePreviewSrc || ''} open={!!referencePreviewSrc} onClose={() => setReferencePreviewSrc(null)} />
    </div>
    </>
  );
}
