'use client';

import { useEffect, useMemo, useRef } from 'react';
import type { ActiveGenerationTask } from '@/components/create/generation-task-list';
import {
  GenerationJobCancelledError,
  GenerationJobStillRunningError,
  continueGenerationJob,
  fetchRecoverableGenerationJobs,
  forgetPendingGenerationJob,
  type GenerationJobStatus,
  type GenerationJobType,
} from '@/lib/generation-job-client';

type RecoverGenerationTaskOptions = {
  types: GenerationJobType[];
  knownJobIds?: string[];
  onTaskRecovered: (task: ActiveGenerationTask, job: GenerationJobStatus) => void;
  onTaskFinished: (taskId: string, job: GenerationJobStatus) => void;
  onTaskFailed: (taskId: string, error: string, job?: GenerationJobStatus | null) => void;
  isEnabled?: boolean;
};

function toJobTaskTitle(type: GenerationJobType): string {
  if (type === 'video') return '正在生成视频';
  if (type === 'reverse-prompt') return '正在反推提示词';
  return '正在生成图片';
}

function toTaskEstimateSeconds(job: GenerationJobStatus): number {
  if (typeof job.estimateSeconds === 'number' && Number.isFinite(job.estimateSeconds) && job.estimateSeconds > 0) {
    return Math.ceil(job.estimateSeconds);
  }
  if (job.type === 'video') return 300;
  if (job.type === 'reverse-prompt') return 60;
  return 90;
}

function getGenerationJobClientRequestId(job: GenerationJobStatus): string | undefined {
  const value = job.payload?.clientRequestId || job.progress?.clientRequestId;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeJobTask(job: GenerationJobStatus): ActiveGenerationTask | null {
  const id = String(job.jobId || job.id || '');
  if (!id) return null;
  const type = job.type || 'image';
  const clientRequestId = getGenerationJobClientRequestId(job);
  return {
    id,
    jobId: id,
    clientRequestId,
    title: toJobTaskTitle(type),
    startedAt: job.started_at ? new Date(job.started_at).getTime() : Date.now(),
    estimateSeconds: toTaskEstimateSeconds(job),
    jobStatus: job,
    finalCountdownSeconds: null,
  };
}

function sleep(ms: number) {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

function getJobIdentityIds(job: GenerationJobStatus, task: ActiveGenerationTask): string[] {
  return Array.from(new Set([
    task.id,
    task.jobId,
    task.clientRequestId,
    getGenerationJobClientRequestId(job),
    typeof job.jobId === 'string' ? job.jobId : undefined,
    typeof job.id === 'string' ? job.id : undefined,
  ].filter((id): id is string => Boolean(id))));
}

function isTerminalGenerationJobStatus(status: GenerationJobStatus['status']): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled';
}

function getRecoveryPollingTimeoutMs(type: GenerationJobType | undefined): number {
  if (type === 'video') return 600_000;
  if (type === 'reverse-prompt') return 150_000;
  return 900_000;
}

export function useGenerationJobRecovery({
  types,
  knownJobIds = [],
  onTaskRecovered,
  onTaskFinished,
  onTaskFailed,
  isEnabled = true,
}: RecoverGenerationTaskOptions) {
  const activeJobIdsRef = useRef(new Set<string>());
  const inFlightRecoveryRef = useRef(false);
  const onTaskRecoveredRef = useRef(onTaskRecovered);
  const onTaskFinishedRef = useRef(onTaskFinished);
  const onTaskFailedRef = useRef(onTaskFailed);
  const typesRef = useRef(types);
  const knownJobIdsRef = useRef(new Set<string>());
  const normalizedTypes = useMemo(() => types.slice().sort().join(','), [types]);
  const normalizedKnownJobIds = useMemo(() => knownJobIds.map(id => id.trim()).filter(Boolean).sort().join(','), [knownJobIds]);

  useEffect(() => {
    typesRef.current = types;
  }, [normalizedTypes, types]);
  useEffect(() => {
    knownJobIdsRef.current = new Set(normalizedKnownJobIds ? normalizedKnownJobIds.split(',') : []);
  }, [normalizedKnownJobIds]);
  useEffect(() => {
    onTaskRecoveredRef.current = onTaskRecovered;
  }, [onTaskRecovered]);
  useEffect(() => {
    onTaskFinishedRef.current = onTaskFinished;
  }, [onTaskFinished]);
  useEffect(() => {
    onTaskFailedRef.current = onTaskFailed;
  }, [onTaskFailed]);

  useEffect(() => {
    if (!isEnabled) return;
    let cancelled = false;

    const recover = async () => {
      if (inFlightRecoveryRef.current) return;
      inFlightRecoveryRef.current = true;
      try {
        await new Promise(resolve => window.setTimeout(resolve, 800));
        if (cancelled) return;
        const jobs = await fetchRecoverableGenerationJobs(typesRef.current);
        if (cancelled) return;
        for (const job of jobs) {
          const task = normalizeJobTask(job);
          if (!task) continue;
          const identityIds = getJobIdentityIds(job, task);
          const isKnownJob = identityIds.some(id => activeJobIdsRef.current.has(id) || knownJobIdsRef.current.has(id));
          if (isKnownJob && !isTerminalGenerationJobStatus(job.status)) continue;
          for (const id of identityIds) activeJobIdsRef.current.add(id);
          if (!isKnownJob) onTaskRecoveredRef.current(task, job);
          if (isTerminalGenerationJobStatus(job.status)) {
            for (const id of identityIds) {
              activeJobIdsRef.current.delete(id);
              forgetPendingGenerationJob(id);
            }
            if (job.status === 'succeeded') {
              onTaskFinishedRef.current(task.id, job);
            } else {
              onTaskFailedRef.current(task.id, job.status === 'cancelled' ? '任务已取消' : job.error || '生成任务失败', job);
            }
            continue;
          }
          void (async () => {
            const timeoutMs = getRecoveryPollingTimeoutMs(job.type);
            const onStatus = (status: GenerationJobStatus) => {
              if (cancelled) return;
              if (status.status === 'failed' || status.status === 'cancelled') {
                for (const id of identityIds) {
                  activeJobIdsRef.current.delete(id);
                  forgetPendingGenerationJob(id);
                }
                onTaskFailedRef.current(task.id, status.status === 'cancelled' ? '任务已取消' : status.error || '生成任务失败', status);
                return;
              }
              if (status.status === 'succeeded') {
                for (const id of identityIds) {
                  activeJobIdsRef.current.delete(id);
                  forgetPendingGenerationJob(id);
                }
                onTaskFinishedRef.current(task.id, status);
              }
            };

            while (!cancelled && identityIds.some(id => activeJobIdsRef.current.has(id))) {
              try {
                await continueGenerationJob(task.id, {
                  timeoutMs,
                  onStatus,
                });
                return;
              } catch (error) {
                if (cancelled) return;
                if (error instanceof GenerationJobStillRunningError) {
                  await sleep(3000);
                  continue;
                }
                if (error instanceof GenerationJobCancelledError) {
                  for (const id of identityIds) {
                    activeJobIdsRef.current.delete(id);
                    forgetPendingGenerationJob(id);
                  }
                  onTaskFailedRef.current(task.id, '任务已取消', error.status);
                  return;
                }
                console.warn('[generation-job-recovery] polling retry after error:', error);
                await sleep(5000);
              }
            }
          })();
        }
      } catch {
        if (!cancelled) {
          window.setTimeout(() => {
            if (!cancelled) void recover();
          }, 5000);
        }
      } finally {
        inFlightRecoveryRef.current = false;
      }
    };

    void recover();
    const recoveryTimer = window.setInterval(() => {
      void recover();
    }, 5000);

    const handleAuthUpdated = () => {
      void recover();
    };
    window.addEventListener('miaojing_auth_updated', handleAuthUpdated);
    return () => {
      cancelled = true;
      window.clearInterval(recoveryTimer);
      window.removeEventListener('miaojing_auth_updated', handleAuthUpdated);
    };
  }, [isEnabled, normalizedTypes]);
}
