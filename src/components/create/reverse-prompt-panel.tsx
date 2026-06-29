'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCreationHistory, getCreationMode, isPlaceholder, type CreationRecord } from '@/lib/creation-history-store';
import { toast } from 'sonner';
import { ChevronDown, ChevronUp, Copy, FileSearch, Grid3X3, History, Image as ImageIcon, Loader2, Sparkles, Wand2, X } from 'lucide-react';
import { GenerationLoadingPanel } from '@/components/create/generation-loading-panel';
import { CreationDetailDialog } from '@/components/creation-detail-dialog';
import { copyTextToClipboard } from '@/lib/utils';
import { compressImageFileForUpload } from '@/lib/browser-image-compression';
import { IMAGE_TO_IMAGE_DRAFT_EVENT, IMAGE_TO_IMAGE_DRAFT_KEY, TEXT_TO_IMAGE_DRAFT_EVENT, TEXT_TO_IMAGE_DRAFT_KEY } from '@/lib/creation-reuse';
import { GenerationJobStillRunningError, runGenerationJob, type GenerationJobStatus } from '@/lib/generation-job-client';
import { useGenerationJobRecovery } from '@/components/create/use-generation-job-recovery';
import { MobileCreationComposer } from '@/components/create/mobile-creation-composer';
import { MobileCreateEmptyState } from '@/components/create/mobile-create-empty-state';
import { useIsMobile } from '@/hooks/use-mobile';

type ReversePromptResult = {
  generalPrompt: string;
  structuredPrompt: string;
  negativePrompt: string;
  structuredSections?: {
    subject?: string;
    environment?: string;
    visualStyle?: string;
    lighting?: string;
    composition?: string;
    character?: string;
  };
};

const promptModes = [
  { value: 'general', label: '通用描述' },
  { value: 'structured', label: '结构化提示词' },
  { value: 'pixel', label: '像素级提示词' },
] as const;

const REVERSE_PROMPT_JOB_TIMEOUT_MS = 150_000;

const sectionLabels: Array<[keyof NonNullable<ReversePromptResult['structuredSections']>, string]> = [
  ['subject', '主题'],
  ['environment', '环境'],
  ['visualStyle', '视觉风格'],
  ['lighting', '光照'],
  ['composition', '构图'],
  ['character', '人物细节'],
];

async function copyText(value: string) {
  const text = value.trim();
  if (!text) return;
  const copyResult = await copyTextToClipboard(text);
  if (copyResult === 'copied') {
    toast.success('已复制');
  } else if (copyResult === 'manual') {
    toast.info('已选中文本，请按 Ctrl+C 复制');
  } else {
    toast.error('复制失败，请手动选择文本复制');
  }
}

interface ReversePromptPanelProps {
  onUseForTextToImage?: () => void;
  onUseForImageToImage?: () => void;
}

export default function ReversePromptPanel({ onUseForTextToImage, onUseForImageToImage }: ReversePromptPanelProps) {
  const { records } = useCreationHistory({ mode: 'reverse-prompt', limit: 60 });
  const isMobileViewport = useIsMobile();

  const [promptMode, setPromptMode] = useState<(typeof promptModes)[number]['value']>('structured');
  const [reverseImage, setReverseImage] = useState<string | null>(null);
  const [language, setLanguage] = useState<'zh' | 'en'>('zh');
  const [loading, setLoading] = useState(false);
  const [generationError, setGenerationError] = useState('');
  const [generationStartedAt, setGenerationStartedAt] = useState(() => Date.now());
  const [result, setResult] = useState<ReversePromptResult | null>(null);
  const [resultView, setResultView] = useState<'components' | 'full'>('components');
  const [showHistory, setShowHistory] = useState(false);
  const [selectedHistoryRecord, setSelectedHistoryRecord] = useState<CreationRecord | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mobileHistoryEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (promptMode !== 'structured' && resultView === 'components') {
      setResultView('full');
    }
  }, [promptMode, resultView]);

  const reversePromptHistory = records.filter(r => getCreationMode(r) === 'reverse-prompt');
  const mobileReversePromptHistory = useMemo(
    () => [...reversePromptHistory].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    [reversePromptHistory],
  );

  const selectedOutputMode = promptMode;
  const hasInput = !!reverseImage;

  useEffect(() => {
    if (!isMobileViewport) return;
    window.requestAnimationFrame(() => {
      mobileHistoryEndRef.current?.scrollIntoView({ block: 'end' });
    });
  }, [isMobileViewport, mobileReversePromptHistory.length, loading, result]);

  useGenerationJobRecovery({
    types: ['reverse-prompt'],
    knownJobIds: activeJobId ? [activeJobId] : [],
    onTaskRecovered: (task, job) => {
      setGenerationError('');
      setActiveJobId(task.jobId || task.id);
      setLoading(true);
      setGenerationStartedAt(task.startedAt);
      const outputMode = String((job.payload || {}).outputMode || promptMode);
      if (outputMode === 'general' || outputMode === 'structured' || outputMode === 'pixel') {
        setPromptMode(outputMode);
      }
    },
    onTaskFinished: (_taskId, job) => {
      const resultData = (job.result || {}) as ReversePromptResult & { referenceImage?: string };
      const next: ReversePromptResult = {
        generalPrompt: String(resultData.generalPrompt || resultData.structuredPrompt || '').trim(),
        structuredPrompt: String(resultData.structuredPrompt || resultData.generalPrompt || '').trim(),
        negativePrompt: String(resultData.negativePrompt || '').trim(),
        structuredSections: resultData.structuredSections || undefined,
      };
      setResult(next);
      const outputMode = String((job.payload || {}).outputMode || promptMode);
      if (outputMode === 'general' || outputMode === 'structured' || outputMode === 'pixel') {
        setPromptMode(outputMode);
        setResultView(outputMode === 'structured' ? 'components' : 'full');
      }
      setLoading(false);
      setGenerationError('');
      setActiveJobId(null);
      window.dispatchEvent(new CustomEvent('creation-history-updated'));
    },
    onTaskFailed: (_taskId, error) => {
      setLoading(false);
      setGenerationError(error || '生成提示词失败');
      setActiveJobId(null);
      toast.error(error);
    },
  });

  const applyImageFile = useCallback(async (file: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('请上传图片文件');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error('图片不能超过 8MB');
      return;
    }
    try {
      const result = await compressImageFileForUpload(file);
      setReverseImage(result.dataUrl);
      setResult(null);
      setGenerationError('');
      if (result.compressed) {
        toast.info('已按高清预览质量自动压缩图片');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '图片处理失败');
    }
  }, []);

  const applyImageUrl = useCallback((value: string) => {
    const url = value.trim();
    if (!/^https?:\/\/\S+/i.test(url)) {
      toast.error('请粘贴有效的图片 URL');
      return false;
    }
    setReverseImage(url);
    setResult(null);
    toast.success('已读取图片 URL');
    return true;
  }, []);

  const handleUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) await applyImageFile(file);
  }, [applyImageFile]);

  const handleDrop = useCallback(async (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    const file = Array.from(event.dataTransfer.files).find(item => item.type.startsWith('image/'));
    if (file) {
      await applyImageFile(file);
      return;
    }
    const url = event.dataTransfer.getData('text/uri-list') || event.dataTransfer.getData('text/plain');
    if (url) applyImageUrl(url);
  }, [applyImageFile, applyImageUrl]);

  const handlePaste = useCallback(async (event: React.ClipboardEvent<HTMLElement>) => {
    const file = Array.from(event.clipboardData.files).find(item => item.type.startsWith('image/'));
    if (file) {
      event.preventDefault();
      await applyImageFile(file);
      return;
    }
    const text = event.clipboardData.getData('text/plain');
    if (/^https?:\/\/\S+/i.test(text.trim())) {
      event.preventDefault();
      applyImageUrl(text);
    }
  }, [applyImageFile, applyImageUrl]);

  const handleGenerate = useCallback(async () => {
    if (!hasInput) {
      toast.error('请先上传图片');
      return;
    }
    setResult(null);
    setGenerationError('');
    setGenerationStartedAt(Date.now());
    setLoading(true);
    let keepTaskPending = false;
    try {
      const data = await runGenerationJob<ReversePromptResult & { referenceImage?: string }>(
        'reverse-prompt',
        { image: reverseImage, outputMode: selectedOutputMode, language },
        {
          timeoutMs: REVERSE_PROMPT_JOB_TIMEOUT_MS,
          onStatus: (status: GenerationJobStatus) => {
            if (status.status === 'running' || status.status === 'queued') {
              setGenerationStartedAt(prev => prev || Date.now());
            }
            if (status.jobId) setActiveJobId(status.jobId);
          },
        },
      );
      const next: ReversePromptResult = {
        generalPrompt: String(data.generalPrompt || data.structuredPrompt || '').trim(),
        structuredPrompt: String(data.structuredPrompt || data.generalPrompt || '').trim(),
        negativePrompt: String(data.negativePrompt || '').trim(),
        structuredSections: data.structuredSections || undefined,
      };
      setResult(next);
      setGenerationError('');
      setResultView(promptMode === 'structured' ? 'components' : 'full');
      toast.success('提示词生成完成');
    } catch (error) {
      if (error instanceof GenerationJobStillRunningError) {
        keepTaskPending = true;
        setLoading(false);
        setGenerationError('反推提示词仍在后台执行，稍后会自动同步结果。');
        setActiveJobId(null);
        toast.info('反推任务仍在执行，可稍后返回查看结果');
        return;
      }
      const message = error instanceof Error ? error.message : '生成提示词失败';
      setGenerationError(message);
      toast.error(message);
    } finally {
      if (!keepTaskPending) {
        setLoading(false);
        setActiveJobId(null);
      }
    }
  }, [hasInput, language, promptMode, reverseImage, selectedOutputMode]);

  const fullPrompt = result
    ? promptMode === 'general'
      ? result.generalPrompt
      : result.structuredPrompt
    : '';

  const handleUseForTextToImage = useCallback(() => {
    if (!result || !fullPrompt.trim()) {
      toast.error('请先生成提示词');
      return;
    }
    if (promptMode === 'pixel' && reverseImage) {
      const draft = {
        prompt: fullPrompt.trim(),
        negativePrompt: result.negativePrompt.trim(),
        referenceImages: [reverseImage],
        strength: 0.25,
        source: 'reverse-prompt',
        outputMode: promptMode,
        updatedAt: Date.now(),
      };
      try {
        window.localStorage.setItem(IMAGE_TO_IMAGE_DRAFT_KEY, JSON.stringify(draft));
      } catch {
        // The CustomEvent still transfers the draft for mounted tabs if localStorage quota is exceeded.
      }
      window.dispatchEvent(new CustomEvent(IMAGE_TO_IMAGE_DRAFT_EVENT, { detail: draft }));
      onUseForImageToImage?.();
      toast.success('已填入图生图');
      return;
    }
    const draft = {
      prompt: fullPrompt.trim(),
      negativePrompt: result.negativePrompt.trim(),
      source: 'reverse-prompt',
      updatedAt: Date.now(),
    };
    window.localStorage.setItem(TEXT_TO_IMAGE_DRAFT_KEY, JSON.stringify(draft));
    window.dispatchEvent(new CustomEvent(TEXT_TO_IMAGE_DRAFT_EVENT, { detail: draft }));
    onUseForTextToImage?.();
    toast.success('已填入文生图');
  }, [fullPrompt, onUseForImageToImage, onUseForTextToImage, promptMode, result, reverseImage]);

  return (
    <div className="create-chat-layout grid min-h-[600px] grid-cols-1 gap-6 xl:grid-cols-[minmax(0,4fr)_minmax(0,6fr)]">
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
      <div className="create-chat-composer min-w-0 space-y-5 pb-8 pl-1 pr-2 pt-1">
        <div className="space-y-2">
          <Label>参考图片 <span className="text-destructive">*</span></Label>
          <div
            tabIndex={0}
            role="button"
            className="box-border flex min-h-[224px] cursor-pointer items-center justify-center rounded-2xl border border-dashed border-border/80 bg-background/50 p-5 transition-colors hover:border-primary/60 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary/40"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDrop}
            onPaste={handlePaste}
          >
            {reverseImage ? (
              <div className="relative flex max-h-[210px] w-full items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={reverseImage} alt="待转换图片" className="max-h-[210px] max-w-full rounded-xl object-contain shadow-lg" />
                <button
                  className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full border bg-background/90 shadow backdrop-blur"
                  onClick={(event) => {
                    event.stopPropagation();
                    setReverseImage(null);
                  }}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center text-center text-muted-foreground">
                <ImageIcon className="mx-auto mb-4 h-14 w-14 opacity-30" />
                <p className="text-base font-semibold text-foreground">上传图片后开始反推提示词</p>
                <p className="mt-2 text-sm">点击上传、拖入图片、Ctrl+V 粘贴图片或图片 URL</p>
              </div>
            )}
          </div>
        </div>

          <div className="space-y-2">
            <Label>提示词类型</Label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {promptModes.map(item => (
              <button
                key={item.value}
                className={`relative flex h-12 items-center justify-center rounded-xl border bg-background px-4 text-center text-sm font-medium transition-colors ${promptMode === item.value ? 'border-primary bg-primary/10 text-foreground shadow-[0_0_0_1px_rgba(147,51,234,0.35)]' : 'border-border hover:border-primary/40'}`}
                onClick={() => setPromptMode(item.value)}
              >
                {item.label}
                {promptMode === item.value && <span className="absolute bottom-0 right-0 h-5 w-5 rounded-tl-md bg-primary text-center text-xs leading-5 text-primary-foreground">✓</span>}
              </button>
            ))}
          </div>
          </div>

          <div className="space-y-2">
            <Label>提示词语言</Label>
            <Select value={language} onValueChange={(value) => setLanguage(value as 'zh' | 'en')}>
              <SelectTrigger className="w-[220px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="zh">中文</SelectItem>
                <SelectItem value="en">English</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button className="w-full gap-2 shadow-none ring-0 drop-shadow-none hover:shadow-none focus-visible:ring-0" size="lg" onClick={handleGenerate} disabled={loading || !hasInput}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {loading ? '生成中...' : '生成提示词'}
          </Button>
        </div>

        <div className="create-chat-thread min-w-0 space-y-4">
          <div className="flex items-center gap-6 border-b border-border">
            {promptMode === 'structured' && (
              <button
                className={`flex h-10 items-center gap-2 border-b-2 px-2 text-sm font-medium transition-colors ${resultView === 'components' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
                onClick={() => setResultView('components')}
              >
                <Grid3X3 className="h-4 w-4" />
                组件
              </button>
            )}
            <button
              className={`flex h-10 items-center gap-2 border-b-2 px-2 text-sm font-medium transition-colors ${resultView === 'full' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
              onClick={() => setResultView('full')}
            >
              <FileSearch className="h-4 w-4" />
              {promptMode === 'general' ? '通用提示词' : '完整提示词'}
            </button>
          </div>

          <div className="liquid-glass min-h-[420px] overflow-hidden rounded-2xl border border-border/70 p-5">
            {loading ? (
              <GenerationLoadingPanel
                startedAt={generationStartedAt}
                estimateSeconds={60}
                title="正在反推提示词"
                className="-m-5 min-h-[420px]"
              />
            ) : generationError ? (
              <div className="flex min-h-[420px] flex-col items-center justify-center gap-3 px-6 text-center">
                <FileSearch className="h-14 w-14 text-destructive/50" />
                <div className="space-y-2">
                  <p className="text-base font-semibold text-foreground">反推提示词暂时失败</p>
                  <p className="max-w-xl break-words text-sm leading-6 text-muted-foreground">{generationError}</p>
                </div>
                <Button variant="outline" className="mt-2 h-9 rounded-xl px-4 text-sm" onClick={handleGenerate} disabled={!hasInput}>
                  重新生成
                </Button>
              </div>
            ) : result ? (
              resultView === 'components' ? (
                <div className="space-y-4">
                  {sectionLabels.map(([key, label]) => {
                    const value = result.structuredSections?.[key] || (key === 'subject' ? result.generalPrompt : '');
                    if (!value.trim()) return null;
                    return (
                      <div key={key} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-base font-semibold">{label}</Label>
                          <button className="text-muted-foreground hover:text-foreground" onClick={() => copyText(value)}>
                            <Copy className="h-4 w-4" />
                          </button>
                        </div>
                        <div className="max-h-28 overflow-y-auto rounded-lg border border-border/70 bg-background/70 p-3">
                          <p className="whitespace-pre-wrap break-words text-sm leading-6">{value}</p>
                        </div>
                      </div>
                    );
                  })}
                  <div className="space-y-2">
                    <div className="flex items-center">
                      <Label className="text-base font-semibold">反向提示词</Label>
                    </div>
                    <div className="max-h-28 overflow-y-auto rounded-lg border border-border/70 bg-background/70 p-3">
                      <p className="whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">{result.negativePrompt}</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <div className="flex items-center">
                      <Label className="text-sm font-semibold">正向提示词</Label>
                    </div>
                    <div className="max-h-[250px] overflow-y-auto rounded-lg border border-border/70 bg-background/70 p-4">
                      <p className="whitespace-pre-wrap break-words text-sm leading-7">{fullPrompt}</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center">
                      <Label className="text-sm font-semibold">反向提示词</Label>
                    </div>
                    <div className="max-h-[110px] overflow-y-auto rounded-lg border border-border/70 bg-background/70 p-3">
                      <p className="whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">{result.negativePrompt}</p>
                    </div>
                  </div>
                </div>
              )
            ) : (
              <div className="flex min-h-[420px] flex-col items-center justify-center text-center text-muted-foreground">
                <FileSearch className="mb-4 h-16 w-16 opacity-20" />
                <p className="text-sm">生成后的提示词会显示在这里</p>
              </div>
            )}
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <Button variant="outline" className="h-9 rounded-xl px-3.5 text-sm gap-1.5" onClick={handleUseForTextToImage} disabled={!result || !fullPrompt.trim()}>
              <Wand2 className="h-3.5 w-3.5" />
              生成图片
            </Button>
            <div className="flex justify-end gap-3">
              <Button variant="outline" className="h-9 rounded-xl px-3.5 text-sm gap-1.5" onClick={() => copyText(result?.negativePrompt || '')} disabled={!result?.negativePrompt}>
                <Copy className="h-3.5 w-3.5" />
                复制反向
              </Button>
              <Button variant="default" className="h-9 rounded-xl px-3.5 text-sm gap-1.5" onClick={() => copyText(fullPrompt)} disabled={!result || !fullPrompt.trim()}>
                <Copy className="h-3.5 w-3.5" />
                复制提示词
              </Button>
            </div>
          </div>

          {reversePromptHistory.length > 0 && (
            <div className="create-desktop-history mt-4 space-y-2">
              <button
                className="flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => setShowHistory(!showHistory)}
              >
                <History className="h-4 w-4" />
                历史反推 ({reversePromptHistory.length})
                {showHistory ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
              {showHistory && (
                <div className="grid max-h-[260px] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
                  {reversePromptHistory.map(record => (
                    <div
                      key={record.id}
                      className="liquid-glass-soft group relative cursor-pointer overflow-hidden rounded-xl"
                      onClick={() => setSelectedHistoryRecord(record)}
                    >
                      {record.referenceImage && !isPlaceholder(record.referenceImage) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={record.referenceImage} alt={record.prompt?.slice(0, 20) || '反推记录'} className="aspect-square w-full object-cover" />
                      ) : (
                        <div className="flex aspect-square w-full items-center justify-center">
                          <FileSearch className="h-7 w-7 text-muted-foreground/40" />
                        </div>
                      )}
                      <div className="absolute inset-0 flex items-end bg-black/0 p-1.5 opacity-0 transition-colors group-hover:bg-black/45 group-hover:opacity-100">
                        <p className="line-clamp-2 text-xs text-white">{record.prompt}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <CreationDetailDialog
          record={selectedHistoryRecord}
          open={!!selectedHistoryRecord}
          onClose={() => setSelectedHistoryRecord(null)}
        />
        {isMobileViewport && (
          <div className="create-mobile-history-flow">
            {mobileReversePromptHistory.length === 0 && !loading && !result && (
              <MobileCreateEmptyState
                title="上传图片，反推出提示词"
                description="选择描述模式和语言后开始分析，结果会在这里沉淀为可复用记录。"
                chips={['结构化', '像素级', '中英切换']}
              />
            )}
            {mobileReversePromptHistory.slice(-40).map(record => (
              <div key={record.id} className="create-mobile-conversation-card space-y-3">
                <p className="create-mobile-conversation-prompt">{record.prompt || '历史反推'}</p>
                {record.referenceImage && !isPlaceholder(record.referenceImage) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={record.referenceImage}
                    alt={record.prompt?.slice(0, 20) || '反推记录'}
                    className="create-mobile-history-image cursor-pointer"
                    loading="lazy"
                    decoding="async"
                    onClick={() => setSelectedHistoryRecord(record)}
                  />
                ) : (
                  <button
                    type="button"
                    className="create-mobile-history-placeholder"
                    onClick={() => setSelectedHistoryRecord(record)}
                  >
                    <FileSearch className="h-6 w-6" />
                  </button>
                )}
              </div>
            ))}
            {loading && (
              <div className="create-mobile-conversation-card create-mobile-active-task">
                <GenerationLoadingPanel
                  startedAt={generationStartedAt}
                  estimateSeconds={60}
                  title="正在反推提示词"
                  className="min-h-[13rem]"
                />
              </div>
            )}
            {!loading && generationError && (
              <div className="create-mobile-conversation-card space-y-3">
                <p className="create-mobile-conversation-prompt">反推提示词暂时失败</p>
                <p className="break-words text-sm leading-6 text-muted-foreground">{generationError}</p>
                <Button variant="outline" size="sm" className="h-9 rounded-xl px-3 text-sm" onClick={handleGenerate} disabled={!hasInput}>
                  重新生成
                </Button>
              </div>
            )}
            {!loading && result && (
              <div className="create-mobile-conversation-card space-y-3">
                <p className="create-mobile-conversation-prompt">{fullPrompt || '提示词已生成'}</p>
                {result.negativePrompt && (
                  <p className="text-sm leading-6 text-muted-foreground">反向：{result.negativePrompt}</p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" className="h-9 rounded-xl px-3 text-sm" onClick={handleUseForTextToImage}>
                    <Wand2 className="h-3.5 w-3.5" />
                    生成图片
                  </Button>
                  <Button variant="default" size="sm" className="h-9 rounded-xl px-3 text-sm" onClick={() => copyText(fullPrompt)}>
                    <Copy className="h-3.5 w-3.5" />
                    复制
                  </Button>
                </div>
              </div>
            )}
            <div ref={mobileHistoryEndRef} className="create-mobile-history-end" aria-hidden="true" />
          </div>
        )}
        <MobileCreationComposer
          prompt=""
          placeholder="上传图片后反推提示词"
          onPromptChange={() => undefined}
          onGenerate={handleGenerate}
          disabled={loading || !hasInput}
          generating={loading}
          input={(
            <div className="create-mobile-reverse-input">
              <button
                type="button"
                className="create-mobile-reverse-upload"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(event) => event.preventDefault()}
                onDrop={handleDrop}
                onPaste={handlePaste}
              >
                {reverseImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={reverseImage} alt="待转换图片" />
                ) : (
                  <span className="create-mobile-reverse-upload-placeholder">
                    <ImageIcon className="h-5 w-5" />
                    上传图片
                  </span>
                )}
              </button>
              <div className="create-mobile-reverse-controls">
                <div className="create-mobile-reverse-mode-list">
                  {promptModes.map(item => (
                    <button
                      key={item.value}
                      type="button"
                      className={`create-mobile-reverse-mode ${promptMode === item.value ? 'is-selected' : ''}`}
                      onClick={() => setPromptMode(item.value)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <Select value={language} onValueChange={(value) => setLanguage(value as 'zh' | 'en')}>
                  <SelectTrigger className="create-mobile-param-trigger create-mobile-reverse-language"><SelectValue /></SelectTrigger>
                  <SelectContent className="create-mobile-param-select-content">
                    <SelectItem className="create-mobile-param-select-item" value="zh">中文</SelectItem>
                    <SelectItem className="create-mobile-param-select-item" value="en">English</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        />
    </div>
  );
}
