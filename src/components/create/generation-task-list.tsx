'use client';

import { CachedPreviewImage } from '@/components/create/cached-preview-image';
import { GenerationLoadingPanel } from '@/components/create/generation-loading-panel';
import { Button } from '@/components/ui/button';
import type { GenerationJobStatus } from '@/lib/generation-job-client';
import { AlertTriangle, Image as ImageIcon, Loader2, Video, X } from 'lucide-react';

export type ActiveGenerationTaskCompletedResult = {
  images?: string[];
  videos?: string[];
  thumbnails?: Record<string, string>;
  thumbnailUrls?: string[];
};

export type ActiveGenerationTask = {
  id: string;
  jobId?: string;
  clientRequestId?: string;
  title: string;
  startedAt: number;
  estimateSeconds: number;
  jobStatus: GenerationJobStatus | null;
  finalCountdownSeconds: number | null;
  completedResult?: ActiveGenerationTaskCompletedResult;
  syncConfirmation?: {
    message: string;
    confirming?: boolean;
  };
};

type GenerationTaskListProps = {
  tasks: ActiveGenerationTask[];
  onConfirmSync?: (taskId: string) => void;
  onCancelSync?: (taskId: string) => void;
  onCancelTask?: (taskId: string) => void;
};

function getCompletedImageUrls(result?: ActiveGenerationTaskCompletedResult): string[] {
  return Array.isArray(result?.images) ? result.images.filter(url => typeof url === 'string' && url.trim()) : [];
}

function getCompletedVideoUrls(result?: ActiveGenerationTaskCompletedResult): string[] {
  return Array.isArray(result?.videos) ? result.videos.filter(url => typeof url === 'string' && url.trim()) : [];
}

function formatCountdown(seconds: number | null): string {
  if (seconds === null) return '正在展示';
  const remaining = Math.max(0, Math.ceil(seconds));
  return remaining > 0 ? `00:${String(remaining).padStart(2, '0')}` : '即将完成';
}

function CompletedTaskPreview({
  task,
  title,
  className = '',
}: {
  task: ActiveGenerationTask;
  title: string;
  className?: string;
}) {
  const images = getCompletedImageUrls(task.completedResult);
  const videos = getCompletedVideoUrls(task.completedResult);
  const mediaCount = images.length + videos.length;
  const countdownSeconds = task.finalCountdownSeconds;
  const gridClassName = mediaCount > 1 ? 'grid grid-cols-2 gap-3' : 'grid grid-cols-1 gap-3';

  return (
    <div className={`relative flex min-h-[300px] w-full flex-col gap-4 px-5 py-5 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="mt-1 text-xs text-muted-foreground">生成结果已返回，正在完成展示</p>
        </div>
        <div className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
          展示倒计时 {formatCountdown(countdownSeconds)}
        </div>
      </div>

      <div className={`${gridClassName} min-h-0 flex-1`}>
        {images.map((url, index) => {
          const thumbnailUrl = task.completedResult?.thumbnails?.[url]
            || task.completedResult?.thumbnailUrls?.[index]
            || url;
          return (
            <div key={`image-${url}-${index}`} className="liquid-glass-soft relative overflow-hidden rounded-2xl">
              <CachedPreviewImage
                src={thumbnailUrl}
                alt={`生成结果 ${index + 1}`}
                className="h-full min-h-[220px] w-full object-cover"
              />
            </div>
          );
        })}
        {videos.map((url, index) => (
          <div key={`video-${url}-${index}`} className="liquid-glass-soft overflow-hidden rounded-2xl bg-black">
            <video
              src={url}
              controls
              playsInline
              className="h-full min-h-[220px] w-full object-contain"
            />
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {videos.length > 0 ? <Video className="h-3.5 w-3.5" /> : <ImageIcon className="h-3.5 w-3.5" />}
        <span>结果会在倒计时结束后进入生成结果和历史作品</span>
      </div>
    </div>
  );
}

function TaskContent({
  task,
  title,
  className = '',
  onConfirmSync,
  onCancelSync,
  onCancelTask,
}: {
  task: ActiveGenerationTask;
  title: string;
  className?: string;
  onConfirmSync?: (taskId: string) => void;
  onCancelSync?: (taskId: string) => void;
  onCancelTask?: (taskId: string) => void;
}) {
  if (task.syncConfirmation) {
    return (
      <div className={`flex min-h-[260px] w-full flex-col justify-center px-6 py-8 ${className}`}>
        <div className="mx-auto max-w-md space-y-4 text-left">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
            <div className="min-w-0">
              <p className="font-medium text-foreground">{title}</p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {task.syncConfirmation.message}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={task.syncConfirmation.confirming}
              onClick={() => onCancelSync?.(task.id)}
            >
              取消
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={task.syncConfirmation.confirming}
              onClick={() => onConfirmSync?.(task.id)}
            >
              {task.syncConfirmation.confirming ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              确认同步生成
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const hasCompletedResult = getCompletedImageUrls(task.completedResult).length > 0
    || getCompletedVideoUrls(task.completedResult).length > 0;
  if (hasCompletedResult) {
    return (
      <CompletedTaskPreview
        task={task}
        title={title}
        className={className}
      />
    );
  }

  return (
    <div className="relative">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="absolute right-3 top-3 z-20 h-8 gap-1.5 rounded-full border border-white/12 bg-black/35 px-3 text-xs text-white shadow-lg backdrop-blur-md hover:bg-black/55 hover:text-white light:border-amber-900/12 light:bg-white/70 light:text-foreground light:hover:bg-white/90"
        onClick={() => onCancelTask?.(task.id)}
        title="取消任务"
      >
        <X className="h-3.5 w-3.5" />
        取消任务
      </Button>
      <GenerationLoadingPanel
        startedAt={task.startedAt}
        estimateSeconds={task.estimateSeconds}
        jobStatus={task.jobStatus}
        finalCountdownSeconds={task.finalCountdownSeconds}
        title={title}
        className={className}
      />
    </div>
  );
}

export function GenerationTaskList({ tasks, onConfirmSync, onCancelSync, onCancelTask }: GenerationTaskListProps) {
  if (tasks.length === 0) return null;

  if (tasks.length === 1) {
    const task = tasks[0];

    return (
      <div className="liquid-glass min-h-[300px] overflow-hidden rounded-2xl border-dashed text-muted-foreground">
        <TaskContent
          task={task}
          title={task.title}
          onConfirmSync={onConfirmSync}
          onCancelSync={onCancelSync}
          onCancelTask={onCancelTask}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 text-sm font-medium">
        <span>生成任务</span>
        <span className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-xs text-primary">
          {tasks.length} 个进行中
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {tasks.map((task, index) => (
          <div
            key={task.id}
            className="liquid-glass min-h-[260px] overflow-hidden rounded-2xl border-dashed text-muted-foreground"
          >
            <TaskContent
              task={task}
              title={`${task.title} #${index + 1}`}
              className="min-h-[260px] px-5 py-10"
              onConfirmSync={onConfirmSync}
              onCancelSync={onCancelSync}
              onCancelTask={onCancelTask}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
