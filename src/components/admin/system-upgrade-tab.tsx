'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  FileArchive,
  Flame,
  History,
  Loader2,
  RefreshCw,
  RotateCcw,
  ServerCog,
  ShieldCheck,
  UploadCloud,
  XCircle,
  SearchCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { getClientAuthHeaders } from '@/lib/client-auth';
import { cn } from '@/lib/utils';

type UpgradeMode = 'hot' | 'cold';
type UpgradeStatus =
  | 'queued'
  | 'running'
  | 'rolling_back'
  | 'succeeded'
  | 'failed'
  | 'rolled_back'
  | 'rollback_failed';

type UpgradeJob = {
  id: string;
  mode: UpgradeMode;
  status: UpgradeStatus;
  step: string;
  message: string;
  progress: number;
  packageName: string;
  packageHash?: string;
  backupFile?: string;
  backupHash?: string;
  sourceBackupFile?: string;
  sourceBackupHash?: string;
  restartRequired?: boolean;
  changedFiles?: string[];
  extractedFileCount?: number;
  extractedBytes?: number;
  largestFileBytes?: number;
  diskChecks?: DiskCheck[];
  preExistingFiles?: string[];
  error?: string;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  logs: string[];
  dryRun?: boolean;
  stale?: boolean;
  staleAt?: string;
};

type UpgradeResponse = {
  latest: UpgradeJob | null;
  latestUpgrade: UpgradeJob | null;
  latestPreflight: UpgradeJob | null;
  history: UpgradeJob[];
  running: boolean;
  stateDir: string;
  historyLimit?: number;
  runtime?: RuntimeStatus;
};

type RuntimeStatus = {
  projectRoot: string;
  stateDir: string;
  nodeVersion: string;
  pm2Enabled: boolean;
  pm2SystemdEnabled: string | null;
  disks?: DiskCheck[];
  processes: Array<{ name: string; status: string; uptime?: number; restarts?: number }>;
};

type DiskCheck = {
  label: string;
  path: string;
  mountPath?: string;
  totalBytes: number;
  availableBytes: number;
  requiredBytes?: number;
  usedPercent: number | null;
};

const RUNNING_STATUSES = new Set<UpgradeStatus>(['queued', 'running', 'rolling_back']);
const FINAL_STATUSES = new Set<UpgradeStatus>(['succeeded', 'failed', 'rolled_back', 'rollback_failed']);

function getAdminAuthHeaders(): HeadersInit {
  return getClientAuthHeaders();
}

export default function SystemUpgradeTab() {
  const [mode, setMode] = useState<UpgradeMode>('hot');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [prechecking, setPrechecking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [upgradeData, setUpgradeData] = useState<UpgradeResponse>({
    latest: null,
    latestUpgrade: null,
    latestPreflight: null,
    history: [],
    running: false,
    stateDir: '',
  });
  const [currentLogJobIds, setCurrentLogJobIds] = useState<Set<string>>(new Set());
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const latest = upgradeData.latestUpgrade;
  const latestPreflight = upgradeData.latestPreflight;
  const latestIsRunning = latest ? RUNNING_STATUSES.has(latest.status) : false;

  const loadStatus = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch('/api/admin/upgrade', {
        headers: getAdminAuthHeaders(),
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '读取升级状态失败');
      const latestJob = data.latest || null;
      if (latestJob && RUNNING_STATUSES.has(latestJob.status)) {
        setCurrentLogJobIds(previous => new Set(previous).add(latestJob.id));
      }
      setUpgradeData({
        latest: latestJob,
        latestUpgrade: data.latestUpgrade || null,
        latestPreflight: data.latestPreflight || null,
        history: Array.isArray(data.history) ? data.history : [],
        running: data.running === true,
        stateDir: data.stateDir || '',
        historyLimit: typeof data.historyLimit === 'number' ? data.historyLimit : undefined,
        runtime: data.runtime,
      });
    } catch (error) {
      if (!silent) toast.error(error instanceof Error ? error.message : '读取升级状态失败');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (!upgradeData.running) return;
    const timer = window.setInterval(() => loadStatus({ silent: true }), 2500);
    return () => window.clearInterval(timer);
  }, [upgradeData.running, loadStatus]);

  useEffect(() => {
    if (!latest || !FINAL_STATUSES.has(latest.status)) return;
    const timer = window.setTimeout(() => loadStatus({ silent: true }), 1200);
    return () => window.clearTimeout(timer);
  }, [latest?.id, latest?.status, latest, loadStatus]);

  const canSubmit = useMemo(
    () => Boolean(selectedFile) && !submitting && !prechecking && !upgradeData.running,
    [selectedFile, submitting, prechecking, upgradeData.running],
  );

  async function handleSubmit(dryRun = false) {
    if (!selectedFile) {
      toast.error('请选择升级包');
      return;
    }
    if (!/\.(tar|tgz|tar\.gz)$/i.test(selectedFile.name)) {
      toast.error('仅支持 .tar、.tar.gz、.tgz 升级包');
      return;
    }

    if (dryRun) {
      setPrechecking(true);
    } else {
      setSubmitting(true);
    }
    try {
      const form = new FormData();
      form.set('mode', mode);
      form.set('package', selectedFile);
      if (dryRun) form.set('dryRun', 'true');

      const res = await fetch('/api/admin/upgrade', {
        method: 'POST',
        headers: getAdminAuthHeaders(),
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '创建升级任务失败');

      if (data.job?.id) {
        setCurrentLogJobIds(previous => new Set(previous).add(data.job.id));
      }
      toast.success(dryRun ? '升级包预检已启动' : mode === 'hot' ? '热更新任务已启动' : '冷更新任务已启动');
      if (!dryRun) {
        setSelectedFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
      await loadStatus({ silent: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : dryRun ? '启动预检失败' : '创建升级任务失败');
    } finally {
      if (dryRun) {
        setPrechecking(false);
      } else {
        setSubmitting(false);
      }
    }
  }

  return (
    <div className="space-y-6">
      <Alert className="border-amber-500/30 bg-amber-500/5">
        <ShieldCheck className="h-4 w-4 text-amber-600" />
        <AlertTitle>升级保护策略</AlertTitle>
        <AlertDescription>
          每次升级都会先创建数据库、存储、环境配置备份和源码快照；任务失败会自动回滚到升级开始前的源码与数据状态。
        </AlertDescription>
      </Alert>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(21rem,0.9fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <UploadCloud className="h-5 w-5 text-primary" />
              上传升级包
            </CardTitle>
            <CardDescription>支持 tar、tar.gz、tgz 格式；热更新不重启平台，冷更新会构建并重启平台进程。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <ModeCard
                active={mode === 'hot'}
                icon={<Flame className="h-5 w-5" />}
                title="热更新"
                description="只允许 public 静态资源等不影响运行时代码的补丁，应用后不重启。"
                onClick={() => setMode('hot')}
              />
              <ModeCard
                active={mode === 'cold'}
                icon={<ServerCog className="h-5 w-5" />}
                title="冷更新"
                description="适合代码、依赖、脚本等较大变更，会校验、构建、重启并健康检查。"
                onClick={() => setMode('cold')}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="upgrade-package">升级包</Label>
              <Input
                ref={fileInputRef}
                id="upgrade-package"
                type="file"
                accept=".tar,.tgz,.tar.gz,application/gzip,application/x-tar"
                disabled={submitting || prechecking || upgradeData.running}
                onChange={event => setSelectedFile(event.target.files?.[0] || null)}
              />
              <p className="text-xs text-muted-foreground">
                热更新包如包含 src、package.json、脚本或锁文件会被拒绝，请改用冷更新。
              </p>
            </div>

            {selectedFile && (
              <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/35 px-3 py-2 text-sm">
                <div className="flex min-w-0 items-center gap-2">
                  <FileArchive className="h-4 w-4 shrink-0 text-primary" />
                  <span className="truncate">{selectedFile.name}</span>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(selectedFile.size)}</span>
              </div>
            )}

            <div className="rounded-md border border-border bg-background/50 p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                升级前确认
              </div>
              <ul className="ml-5 list-disc space-y-1 text-sm text-muted-foreground">
                <li>升级包不能包含 .env、node_modules、.git、backups、local-storage 等敏感目录。</li>
                <li>失败回滚会恢复源码快照、数据库备份、存储目录和环境配置。</li>
                <li>冷更新完成后会自动重启平台进程，并以 /api/health 作为成功判定。</li>
              </ul>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button variant="outline" onClick={() => handleSubmit(true)} disabled={!canSubmit} className="gap-2">
                {prechecking ? <Loader2 className="h-4 w-4 animate-spin" /> : <SearchCheck className="h-4 w-4" />}
                {prechecking ? '正在预检...' : '先预检升级包'}
              </Button>
              <Button onClick={() => handleSubmit(false)} disabled={!canSubmit} className="gap-2">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                {submitting ? '正在上传...' : mode === 'hot' ? '启动热更新' : '启动冷更新'}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-3 text-lg">
              <span className="flex items-center gap-2">
                <ServerCog className="h-5 w-5 text-primary" />
                当前状态
              </span>
              <Button variant="outline" size="sm" onClick={() => loadStatus()} disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                刷新
              </Button>
            </CardTitle>
            <CardDescription>冷更新重启后也会从磁盘续上这里的任务状态。</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex h-44 items-center justify-center text-muted-foreground">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                正在加载升级状态
              </div>
            ) : latest ? (
              <UpgradeStatusPanel
                job={latest}
                showLogs={latestIsRunning || currentLogJobIds.has(latest.id)}
                logTitle={latestIsRunning ? '实时升级日志' : '本次升级日志'}
              />
            ) : (
              <div className="flex h-44 flex-col items-center justify-center rounded-md border border-dashed border-border text-center">
                <History className="mb-2 h-8 w-8 text-muted-foreground" />
                <div className="text-sm font-medium">暂无升级记录</div>
                <div className="mt-1 text-xs text-muted-foreground">上传升级包后会在这里显示进度和回滚结果</div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(21rem,0.9fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <SearchCheck className="h-5 w-5 text-primary" />
              最近预检
            </CardTitle>
            <CardDescription>预检只校验升级包，不创建备份、不覆盖文件，也不会触发重启。</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex h-32 items-center justify-center text-muted-foreground">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                正在加载预检状态
              </div>
            ) : latestPreflight ? (
              <UpgradeStatusPanel
                job={latestPreflight}
                showLogs={RUNNING_STATUSES.has(latestPreflight.status) || currentLogJobIds.has(latestPreflight.id)}
                logTitle={RUNNING_STATUSES.has(latestPreflight.status) ? '实时预检日志' : '预检日志'}
                compact
              />
            ) : (
              <div className="flex h-32 flex-col items-center justify-center rounded-md border border-dashed border-border text-center">
                <SearchCheck className="mb-2 h-7 w-7 text-muted-foreground" />
                <div className="text-sm font-medium">暂无预检记录</div>
                <div className="mt-1 text-xs text-muted-foreground">选择升级包后可先预检再正式执行</div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <ServerCog className="h-5 w-5 text-primary" />
              运行环境
            </CardTitle>
            <CardDescription>展示升级任务实际读取到的运行目录、状态目录和进程状态。</CardDescription>
          </CardHeader>
          <CardContent>
            <RuntimeStatusPanel runtime={upgradeData.runtime} fallbackStateDir={upgradeData.stateDir} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <History className="h-5 w-5 text-primary" />
            升级历史
          </CardTitle>
          <CardDescription>保留全部升级任务，便于随时查看升级内容、执行日志、失败原因与回滚记录。</CardDescription>
          {upgradeData.historyLimit && (
            <CardDescription>
              已结束任务默认保留最近 {upgradeData.historyLimit} 个，运行中的任务不会被自动清理。
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {upgradeData.history.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">暂无历史记录</div>
          ) : (
            <div className="space-y-3">
              {upgradeData.history.map(job => (
                <div key={job.id} className="rounded-md border border-border p-3 text-sm">
                  <div className="grid gap-3 md:grid-cols-[9rem_1fr_auto] md:items-center">
                    <div className="flex items-center gap-2">
                      <StatusIcon status={job.status} />
                      <Badge variant="secondary">{job.dryRun ? '预检' : job.mode === 'hot' ? '热更新' : '冷更新'}</Badge>
                      {job.dryRun && <Badge className="bg-sky-500/15 text-sky-600 hover:bg-sky-500/15">未覆盖</Badge>}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate font-medium">{job.packageName}</div>
                      <div className="truncate text-xs text-muted-foreground">{job.message}</div>
                    </div>
                    <div className="flex items-center justify-between gap-3 md:justify-end">
                      <div className="text-xs text-muted-foreground md:text-right">{formatDate(job.updatedAt)}</div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setExpandedHistoryId(expandedHistoryId === job.id ? null : job.id)}
                      >
                        {expandedHistoryId === job.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        {expandedHistoryId === job.id ? '收起详情' : '查看详情'}
                      </Button>
                    </div>
                  </div>
                  {expandedHistoryId === job.id && (
                    <div className="mt-4">
                      <UpgradeStatusPanel job={job} showLogs logTitle="历史升级日志" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ModeCard({
  active,
  icon,
  title,
  description,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'min-h-32 rounded-md border p-4 text-left transition-colors',
        active ? 'border-primary bg-primary/10 text-foreground' : 'border-border bg-background hover:bg-muted/50',
      )}
    >
      <div className="mb-3 flex items-center gap-2 font-semibold">
        <span className={cn('flex h-9 w-9 items-center justify-center rounded-md', active ? 'bg-primary text-zinc-950' : 'bg-muted text-muted-foreground')}>
          {icon}
        </span>
        {title}
      </div>
      <p className="text-sm leading-6 text-muted-foreground">{description}</p>
    </button>
  );
}

function UpgradeStatusPanel({
  job,
  showLogs,
  logTitle = '执行日志',
  compact = false,
}: {
  job: UpgradeJob;
  showLogs: boolean;
  logTitle?: string;
  compact?: boolean;
}) {
  const changedFiles = job.changedFiles || [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <StatusIcon status={job.status} />
          <Badge variant="secondary">{job.dryRun ? '预检' : job.mode === 'hot' ? '热更新' : '冷更新'}</Badge>
          {job.dryRun && <Badge className="bg-sky-500/15 text-sky-600 hover:bg-sky-500/15">未覆盖文件</Badge>}
          {job.stale && <Badge className="bg-amber-500/15 text-amber-600 hover:bg-amber-500/15">超时解锁</Badge>}
          <Badge className={statusBadgeClass(job.status)}>{statusLabel(job.status)}</Badge>
        </div>
        <div className="text-xs text-muted-foreground">{formatDate(job.updatedAt)}</div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-3 text-sm">
          <span className="font-medium">{job.message}</span>
          <span className="text-muted-foreground">{Math.max(0, Math.min(100, job.progress || 0))}%</span>
        </div>
        <Progress value={Math.max(0, Math.min(100, job.progress || 0))} />
      </div>

      <div className="grid gap-2 text-sm">
        <InfoRow label="任务 ID" value={job.id} />
        <InfoRow label="升级包" value={job.packageName} />
        <InfoRow label="当前步骤" value={job.step} />
        <InfoRow label="文件数量" value={`${job.extractedFileCount ?? changedFiles.length} 个文件`} />
        {typeof job.extractedBytes === 'number' && <InfoRow label="解压大小" value={formatBytes(job.extractedBytes)} />}
        {typeof job.largestFileBytes === 'number' && <InfoRow label="最大文件" value={formatBytes(job.largestFileBytes)} />}
        <InfoRow label="需要重启" value={job.restartRequired ? '是' : '否'} />
        {job.staleAt && <InfoRow label="超时标记" value={formatDate(job.staleAt)} />}
        {job.backupFile && <InfoRow label="数据备份" value={job.backupFile} />}
        {job.backupHash && <InfoRow label="备份校验" value={job.backupHash} />}
        {job.sourceBackupFile && <InfoRow label="源码快照" value={job.sourceBackupFile} />}
        {job.sourceBackupHash && <InfoRow label="快照校验" value={job.sourceBackupHash} />}
      </div>

      {job.diskChecks && job.diskChecks.length > 0 && (
        <div className="rounded-md border border-border bg-muted/25 p-3">
          <div className="mb-2 text-sm font-medium">磁盘校验</div>
          <DiskCheckList checks={job.diskChecks} showRequired />
        </div>
      )}

      {!compact && changedFiles.length > 0 && (
        <div className="rounded-md border border-border bg-muted/25 p-3">
          <div className="mb-2 text-sm font-medium">升级内容</div>
          <div className="max-h-40 overflow-auto rounded bg-background/70 p-2 font-mono text-xs leading-5 text-muted-foreground">
            {changedFiles.map(file => (
              <div key={file} className="truncate" title={file}>{file}</div>
            ))}
          </div>
        </div>
      )}

      {job.error && (
        <Alert variant={job.status === 'rollback_failed' ? 'destructive' : 'default'} className="border-amber-500/30 bg-amber-500/5">
          <RotateCcw className="h-4 w-4" />
          <AlertTitle>{job.status === 'rolled_back' ? '已自动回滚' : '升级错误'}</AlertTitle>
          <AlertDescription>{job.error}</AlertDescription>
        </Alert>
      )}

      {showLogs && job.logs?.length > 0 && (
        <>
          <Separator />
          <div>
            <div className="mb-2 flex items-center justify-between gap-3 text-sm">
              <span className="font-medium">{logTitle}</span>
              <span className="text-xs text-muted-foreground">{job.logs.length} 行</span>
            </div>
            <pre className="max-h-72 overflow-auto rounded-md bg-zinc-950 p-3 text-xs leading-5 text-zinc-100">
              {job.logs.join('\n')}
            </pre>
          </div>
        </>
      )}
    </div>
  );
}

function RuntimeStatusPanel({ runtime, fallbackStateDir }: { runtime?: RuntimeStatus; fallbackStateDir: string }) {
  const processes = runtime?.processes || [];
  const disks = runtime?.disks || [];
  return (
    <div className="space-y-4">
      <div className="grid gap-2 text-sm">
        <InfoRow label="项目目录" value={runtime?.projectRoot || '未知'} />
        <InfoRow label="状态目录" value={runtime?.stateDir || fallbackStateDir || '未知'} />
        <InfoRow label="Node" value={runtime?.nodeVersion || '未知'} />
        <InfoRow label="PM2" value={runtime?.pm2Enabled ? '可用' : '不可用'} />
        <InfoRow label="开机自启" value={runtime?.pm2SystemdEnabled || '未知'} />
      </div>

      <div className="rounded-md border border-border bg-muted/25 p-3">
        <div className="mb-2 text-sm font-medium">磁盘空间</div>
        {disks.length > 0 ? (
          <DiskCheckList checks={disks} />
        ) : (
          <div className="rounded bg-background/70 px-3 py-4 text-center text-sm text-muted-foreground">未读取到磁盘信息</div>
        )}
      </div>

      <div className="rounded-md border border-border bg-muted/25 p-3">
        <div className="mb-2 text-sm font-medium">进程状态</div>
        {processes.length > 0 ? (
          <div className="space-y-2">
            {processes.map(process => (
              <div key={process.name} className="grid grid-cols-[1fr_auto] gap-3 rounded bg-background/70 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-mono text-xs">{process.name}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {process.restarts == null ? '重启次数未知' : `重启 ${process.restarts} 次`}
                    {process.uptime ? ` · ${formatProcessUptime(process.uptime)}` : ''}
                  </div>
                </div>
                <Badge className={process.status === 'online' ? 'bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15' : 'bg-destructive/15 text-destructive hover:bg-destructive/15'}>
                  {process.status}
                </Badge>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded bg-background/70 px-3 py-4 text-center text-sm text-muted-foreground">未读取到 PM2 进程</div>
        )}
      </div>
    </div>
  );
}

function DiskCheckList({ checks, showRequired = false }: { checks: DiskCheck[]; showRequired?: boolean }) {
  return (
    <div className="space-y-2">
      {checks.map(check => (
        <div key={`${check.label}-${check.path}`} className="rounded bg-background/70 px-3 py-2 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium">{check.label}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {check.usedPercent == null ? '使用率未知' : `已用 ${check.usedPercent}%`}
            </span>
          </div>
          <div className="mt-1 truncate font-mono text-xs text-muted-foreground" title={check.path}>{check.path}</div>
          {check.mountPath && check.mountPath !== check.path && (
            <div className="mt-1 truncate text-xs text-muted-foreground" title={check.mountPath}>挂载点 {check.mountPath}</div>
          )}
          <div className="mt-2 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
            <span>可用 {formatBytes(check.availableBytes)} / 总计 {formatBytes(check.totalBytes)}</span>
            {showRequired && typeof check.requiredBytes === 'number' && <span>本次至少需要 {formatBytes(check.requiredBytes)}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[5rem_1fr] gap-3 rounded-md bg-muted/35 px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate font-mono text-xs" title={value}>{value}</span>
    </div>
  );
}

function StatusIcon({ status }: { status: UpgradeStatus }) {
  if (status === 'succeeded') return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  if (status === 'rolled_back') return <RotateCcw className="h-4 w-4 text-amber-500" />;
  if (status === 'failed' || status === 'rollback_failed') return <XCircle className="h-4 w-4 text-destructive" />;
  return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
}

function statusLabel(status: UpgradeStatus): string {
  const labels: Record<UpgradeStatus, string> = {
    queued: '排队中',
    running: '执行中',
    rolling_back: '回滚中',
    succeeded: '成功',
    failed: '失败',
    rolled_back: '已回滚',
    rollback_failed: '回滚失败',
  };
  return labels[status] || status;
}

function statusBadgeClass(status: UpgradeStatus): string {
  if (status === 'succeeded') return 'bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15';
  if (status === 'rolled_back') return 'bg-amber-500/15 text-amber-600 hover:bg-amber-500/15';
  if (status === 'failed' || status === 'rollback_failed') return 'bg-destructive/15 text-destructive hover:bg-destructive/15';
  return 'bg-primary/15 text-primary hover:bg-primary/15';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
}

function formatProcessUptime(value: number): string {
  const durationMs = Date.now() - value;
  if (!Number.isFinite(durationMs) || durationMs < 0) return '运行时间未知';
  const minutes = Math.floor(durationMs / 60000);
  if (minutes < 1) return '刚刚启动';
  if (minutes < 60) return `运行 ${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `运行 ${hours} 小时`;
  return `运行 ${Math.floor(hours / 24)} 天`;
}
