'use client';

import { useEffect, useMemo, useRef } from 'react';
import type { ActiveGenerationTask } from '@/components/create/generation-task-list';
import {
  fetchGenerationJobByClientRequestId,
  fetchGenerationJobStatus,
  forgetPendingGenerationJob,
  type GenerationJobStatus,
  type GenerationJobType,
} from '@/lib/generation-job-client';

type UseActiveGenerationTaskStatusReconciliationOptions = {
  activeTasks: ActiveGenerationTask[];
  updateActiveTask: (taskId: string, update: Partial<ActiveGenerationTask>) => void;
  removeActiveTaskByIds: (...ids: Array<string | undefined | null>) => void;
  getGenerationJobClientRequestId: (job: GenerationJobStatus) => string | null;
  onTaskSucceeded: (task: ActiveGenerationTask, job: GenerationJobStatus) => void;
  onTaskFailed: (task: ActiveGenerationTask, error: string, job: GenerationJobStatus) => void;
  types?: GenerationJobType[];
  intervalMs?: number;
};

function isTerminalGenerationJobStatus(status: GenerationJobStatus['status']): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled';
}

function extractCompletedResultFromGenerationJob(status: GenerationJobStatus): ActiveGenerationTask['completedResult'] | undefined {
  const result = status.result || {};
  const images = Array.isArray(result.images)
    ? result.images.filter((url): url is string => typeof url === 'string' && url.trim().length > 0)
    : [];
  const videos = Array.isArray(result.videos)
    ? result.videos.filter((url): url is string => typeof url === 'string' && url.trim().length > 0)
    : [];
  if (images.length === 0 && videos.length === 0) return undefined;
  const thumbnails = result.thumbnails && typeof result.thumbnails === 'object' && !Array.isArray(result.thumbnails)
    ? result.thumbnails as Record<string, string>
    : undefined;
  const thumbnailUrls = Array.isArray(result.thumbnailUrls)
    ? result.thumbnailUrls.filter((url): url is string => typeof url === 'string' && url.trim().length > 0)
    : undefined;
  return {
    images: images.length > 0 ? images : undefined,
    videos: videos.length > 0 ? videos : undefined,
    thumbnails,
    thumbnailUrls,
  };
}

export function useActiveGenerationTaskStatusReconciliation({
  activeTasks,
  updateActiveTask,
  removeActiveTaskByIds,
  getGenerationJobClientRequestId,
  onTaskSucceeded,
  onTaskFailed,
  types,
  intervalMs = 2500,
}: UseActiveGenerationTaskStatusReconciliationOptions) {
  const activeTasksRef = useRef(activeTasks);
  const terminalTaskIdsRef = useRef(new Set<string>());
  const typesRef = useRef(types);
  const getGenerationJobClientRequestIdRef = useRef(getGenerationJobClientRequestId);
  const onTaskSucceededRef = useRef(onTaskSucceeded);
  const onTaskFailedRef = useRef(onTaskFailed);
  const activeTaskIdentityKey = useMemo(() => activeTasks
    .map(task => [task.id, task.jobId || '', task.clientRequestId || ''].join(':'))
    .sort()
    .join('|'), [activeTasks]);
  const normalizedTypes = useMemo(() => (types || []).slice().sort().join(','), [types]);

  useEffect(() => {
    activeTasksRef.current = activeTasks;
    if (activeTasks.length === 0) terminalTaskIdsRef.current.clear();
  }, [activeTasks]);
  useEffect(() => {
    typesRef.current = types;
  }, [normalizedTypes, types]);
  useEffect(() => {
    getGenerationJobClientRequestIdRef.current = getGenerationJobClientRequestId;
  }, [getGenerationJobClientRequestId]);
  useEffect(() => {
    onTaskSucceededRef.current = onTaskSucceeded;
  }, [onTaskSucceeded]);
  useEffect(() => {
    onTaskFailedRef.current = onTaskFailed;
  }, [onTaskFailed]);

  useEffect(() => {
    if (!activeTasksRef.current.some(task => task.jobId || task.clientRequestId || task.id)) return;
    let cancelled = false;

    const reconcile = async () => {
      const tasks = activeTasksRef.current.filter(task => !task.completedResult && !terminalTaskIdsRef.current.has(task.id));
      await Promise.all(tasks.map(async task => {
        const jobId = task.jobId || '';
        const taskClientRequestId = task.clientRequestId || task.id;
        let status: GenerationJobStatus | null;
        try {
          status = jobId
            ? await fetchGenerationJobStatus(jobId)
            : await fetchGenerationJobByClientRequestId(taskClientRequestId, typesRef.current);
          if (status && !isTerminalGenerationJobStatus(status.status) && taskClientRequestId) {
            const clientRequestStatus = await fetchGenerationJobByClientRequestId(taskClientRequestId, typesRef.current);
            if (clientRequestStatus && isTerminalGenerationJobStatus(clientRequestStatus.status)) {
              status = clientRequestStatus;
            }
          }
        } catch {
          return;
        }
        if (!status) return;
        if (cancelled) return;

        const statusJobId = typeof status.jobId === 'string' && status.jobId
          ? status.jobId
          : typeof status.id === 'string' && status.id
            ? status.id
            : jobId;
        const clientRequestId = getGenerationJobClientRequestIdRef.current(status);
        const identityIds = [
          task.id,
          task.jobId,
          task.clientRequestId,
          statusJobId,
          status.id,
          clientRequestId,
        ];

        if (!isTerminalGenerationJobStatus(status.status)) {
          updateActiveTask(task.id, { jobStatus: status, jobId: statusJobId });
          return;
        }

        terminalTaskIdsRef.current.add(task.id);
        for (const id of identityIds) {
          if (id) forgetPendingGenerationJob(id);
        }

        if (status.status === 'succeeded') {
          const completedResult = extractCompletedResultFromGenerationJob(status);
          const nextTask: ActiveGenerationTask = {
            ...task,
            jobStatus: status,
            jobId: statusJobId,
            completedResult: completedResult || task.completedResult,
            finalCountdownSeconds: completedResult ? 3 : task.finalCountdownSeconds,
          };
          updateActiveTask(task.id, {
            jobStatus: status,
            jobId: statusJobId,
            completedResult: nextTask.completedResult,
            finalCountdownSeconds: nextTask.finalCountdownSeconds,
          });
          onTaskSucceededRef.current(nextTask, status);
          return;
        }

        removeActiveTaskByIds(...identityIds);
        onTaskFailedRef.current(task, status.status === 'cancelled' ? '任务已取消' : status.error || '生成任务失败', status);
      }));
    };

    void reconcile();
    const timer = window.setInterval(() => {
      void reconcile();
    }, intervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    activeTaskIdentityKey,
    intervalMs,
    removeActiveTaskByIds,
    updateActiveTask,
  ]);
}
