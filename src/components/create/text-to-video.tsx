'use client';

import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/lib/auth-store';
import { useCustomApiKeys } from '@/lib/custom-api-store';
import { useManagedSystemApis } from '@/lib/managed-model-store';
import {
  VIDEO_ASPECT_RATIOS,
  VIDEO_DURATIONS,
  VIDEO_STYLES,
  CAMERA_MOVEMENTS,
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
import { Sparkles, Loader2, Download, Wand2, Video, Film, History, ChevronDown, ChevronUp, KeyRound, Share2 } from 'lucide-react';
import { useCreationHistory, getCreationMode, isPlaceholder, shareToGallery, isUrlPublished, type CreationRecord } from '@/lib/creation-history-store';
import { triggerDownloadFile } from '@/lib/utils';
import { cancelGenerationJob, GenerationJobCancelledError, runGenerationFinalCountdown, runGenerationJob, type GenerationJobStatus } from '@/lib/generation-job-client';
import { toast } from 'sonner';
import Link from 'next/link';
import { CreationDetailDialog } from '@/components/creation-detail-dialog';
import { GenerationErrorPanel, createGenerationError, type GenerationErrorState } from '@/components/create/generation-error-panel';
import { ExpandablePromptTextarea } from '@/components/create/expandable-prompt-textarea';
import { GenerationTaskList, type ActiveGenerationTask } from '@/components/create/generation-task-list';
import { useGenerationJobRecovery } from '@/components/create/use-generation-job-recovery';
import { InspirationGalleryDialog } from '@/components/create/inspiration-gallery-dialog';
import { MobileCreationComposer } from '@/components/create/mobile-creation-composer';
import { MobileCreateEmptyState } from '@/components/create/mobile-create-empty-state';
import { TEXT_TO_VIDEO_DRAFT_EVENT, TEXT_TO_VIDEO_DRAFT_KEY, type CreationReuseDraft } from '@/lib/creation-reuse';
import { useIsMobile } from '@/hooks/use-mobile';
import { getClientAuthHeaders, getRequiredClientAuthToken, handleClientAuthFailure } from '@/lib/client-auth';

const TEXT_TO_VIDEO_SELECTED_MODEL_KEY = 'miaojing_create_text_to_video_selected_model';
const TEXT_TO_VIDEO_MODEL_TOUCHED_KEY = 'miaojing_create_text_to_video_model_touched';

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

export function TextToVideoPanel() {
  const { user, accessToken, updateProfile } = useAuth();
  const { videoKeys, textKeys } = useCustomApiKeys();
  const managedSystemApis = useManagedSystemApis();
  const isMobileViewport = useIsMobile();

  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [duration, setDuration] = useState('6');
  const [resolution, setResolution] = useState('720p');
  const [cameraMovement, setCameraMovement] = useState(CAMERA_MOVEMENTS[0]);
  const [style, setStyle] = useState(VIDEO_STYLES[0]);

  const [activeTasks, setActiveTasks] = useState<ActiveGenerationTask[]>([]);
  const [results, setResults] = useState<string[]>([]);
  const [generationError, setGenerationError] = useState<GenerationErrorState | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [inspirationOpen, setInspirationOpen] = useState(false);
  const activeSubmissionSignaturesRef = useRef(new Set<string>());
  const cancelledTaskIdsRef = useRef(new Set<string>());
  const completedTaskIdentityIdsRef = useRef(new Set<string>());
  const generating = activeTasks.length > 0;
  const activeJobIds = useMemo(
    () => activeTasks.flatMap(task => [task.jobId, task.clientRequestId, task.id]).filter((id): id is string => Boolean(id)),
    [activeTasks],
  );

  const { records, add: addRecord } = useCreationHistory({ mode: 'text2video', limit: 60 });
  const [showHistory, setShowHistory] = useState(false);

  // History detail dialog
  const [selectedHistoryRecord, setSelectedHistoryRecord] = useState<CreationRecord | null>(null);
  const videoHistory = records.filter(r => getCreationMode(r) === 'text2video');
  const mobileVideoHistory = useMemo(
    () => [...videoHistory].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    [videoHistory],
  );
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
    && (api.videoUsageModes || ['text-to-video', 'image-to-video']).includes('text-to-video')
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
    TEXT_TO_VIDEO_SELECTED_MODEL_KEY,
    TEXT_TO_VIDEO_MODEL_TOUCHED_KEY,
  );
  const selectedSystemApi = useMemo(() => (
    isSystemModel(selectedModel)
      ? systemVideoApis.find(api => api.id === getSystemApiId(selectedModel))
      : undefined
  ), [selectedModel, systemVideoApis]);
  const videoParamOptions = useMemo(() => getVideoCapabilityOptions(selectedSystemApi?.capabilities, {
    aspectRatios: VIDEO_ASPECT_RATIOS,
    durations: VIDEO_DURATIONS,
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
    if (videoParamOptions.supportsDuration) setDuration(prev => ensureSelectedOption(prev, videoParamOptions.durations, '6'));
    if (videoParamOptions.supportsResolution) setResolution(prev => ensureSelectedOption(prev, videoParamOptions.resolutions, '720p'));
  }, [videoParamOptions]);

  const applyVideoDraft = useCallback((draft: unknown) => {
    if (!draft || typeof draft !== 'object') return;
    const data = draft as CreationReuseDraft;
    if (typeof data.prompt === 'string') setPrompt(data.prompt);
    if (typeof data.negativePrompt === 'string') setNegativePrompt(data.negativePrompt);
    if (typeof data.model === 'string' && data.model.trim()) setSelectedModel(data.model.trim());
    if (typeof data.aspectRatio === 'string' && data.aspectRatio.trim()) setAspectRatio(data.aspectRatio.trim());
    if (typeof data.duration === 'string' && data.duration.trim()) setDuration(data.duration.trim());
    if (typeof data.cameraMovement === 'string' && data.cameraMovement.trim()) setCameraMovement(data.cameraMovement.trim());
    if (typeof data.style === 'string' && data.style.trim()) setStyle(data.style.trim());
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(TEXT_TO_VIDEO_DRAFT_KEY);
      if (raw) applyVideoDraft(JSON.parse(raw));
    } catch {
      // Ignore malformed local draft data.
    }

    const handleDraft = (event: Event) => {
      applyVideoDraft((event as CustomEvent).detail);
    };
    window.addEventListener(TEXT_TO_VIDEO_DRAFT_EVENT, handleDraft);
    return () => window.removeEventListener(TEXT_TO_VIDEO_DRAFT_EVENT, handleDraft);
  }, [applyVideoDraft]);

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
    if (!prompt.trim()) { toast.error('请输入视频描述'); return; }
    if (!user) { toast.error('请先登录'); return; }

    setGenerationError(null);
    const taskId = `text2video-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    let submissionSignature: string | null = null;
    try {
      let requestBody: Record<string, unknown> = {
        prompt: prompt.trim(),
        negativePrompt: negativePrompt.trim() || undefined,
        model: selectedModel,
        aspectRatio,
        duration,
        resolution,
        fps: 30,
        clientRequestId: taskId,
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
        style,
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
            params: { creationMode: 'text2video', aspectRatio, duration, cameraMovement, style },
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
	  }, [prompt, negativePrompt, selectedModel, aspectRatio, duration, resolution, cameraMovement, style, user, videoKeys, systemVideoApis, getCurrentModelLabel, addRecord, removeActiveTaskByIds, updateActiveTask, reserveCompletedTaskPreview, applyCompletedVideoResult]);

  const handleDownload = useCallback(async (url: string, index: number) => {
    triggerDownloadFile(url, `miaojing-video-${Date.now()}-${index}.mp4`);
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
      });
      toast.success('已分享到画廊');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '分享失败，请重试');
    }
  }, [prompt, selectedModel, getCurrentModelLabel]);

  return (
    <>
    <InspirationGalleryDialog mode="text2video" open={inspirationOpen} onOpenChange={setInspirationOpen} />
    <div className="create-chat-layout grid min-h-[600px] grid-cols-1 gap-6 xl:grid-cols-[minmax(0,4fr)_minmax(0,6fr)]">
      {/* Left: Settings */}
      <div className="create-chat-composer min-w-0 space-y-5 pb-8 pr-2">
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
            <Label>视频描述</Label>
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
            title="视频描述"
            placeholder="描述你想要生成的视频画面..."
            rows={4}
            className="h-32 resize-none overflow-y-auto"
            value={prompt}
            onValueChange={setPrompt}
          />
          <div className="flex flex-wrap gap-1.5">
            {VIDEO_STYLES.map(s => (
              <Badge key={s} variant="outline" className="cursor-pointer hover:bg-primary/10 text-xs" onClick={() => setStyle(s)}>{s}</Badge>
            ))}
          </div>
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
              {CAMERA_MOVEMENTS.map(c => (
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
              <div className="flex items-center gap-2 text-sm font-medium"><Video className="h-4 w-4" />生成结果</div>
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
              <Video className="h-14 w-14 mb-3 opacity-20" />
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
                        <video src={record.url} className="w-full h-full object-cover" preload="metadata" />
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
                title="写下一个镜头"
                description="描述主体、动作、镜头运动和氛围，生成视频会在这里排队与回放。"
                chips={['产品展示', '电影镜头', '角色动作']}
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
        placeholder="描述你想要生成的视频画面"
        onPromptChange={setPrompt}
        onGenerate={handleGenerate}
        disabled={!hasModels}
        generating={generating}
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
                  {CAMERA_MOVEMENTS.map(c => (
                    <SelectItem className="create-mobile-param-select-item" key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </>
        )}
        styles={(
          <div className="create-mobile-video-style-strip">
            {VIDEO_STYLES.map(s => (
              <button
                key={s}
                type="button"
                className={`create-mobile-style-chip ${style === s ? 'is-selected' : ''}`}
                onClick={() => setStyle(s)}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      />

      {/* History Detail Dialog */}
      <CreationDetailDialog
        record={selectedHistoryRecord}
        open={!!selectedHistoryRecord}
        onClose={() => setSelectedHistoryRecord(null)}
      />
    </div>
    </>
  );
}
