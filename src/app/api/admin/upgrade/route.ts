import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type UpgradeMode = 'hot' | 'cold';
type UpgradeStatus =
  | 'queued'
  | 'running'
  | 'rolling_back'
  | 'succeeded'
  | 'failed'
  | 'rolled_back'
  | 'rollback_failed';

type UpgradeJobState = {
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

type DiskCheck = {
  label: string;
  path: string;
  mountPath?: string;
  totalBytes: number;
  availableBytes: number;
  requiredBytes?: number;
  usedPercent: number | null;
};

type RuntimeStatus = {
  projectRoot: string;
  stateDir: string;
  nodeVersion: string;
  pm2Enabled: boolean;
  pm2SystemdEnabled: string | null;
  disks: DiskCheck[];
  processes: Array<{ name: string; status: string; uptime?: number; restarts?: number }>;
};

const MAX_PACKAGE_BYTES = 300 * 1024 * 1024;
const RUNNING_STATUSES = new Set<UpgradeStatus>(['queued', 'running', 'rolling_back']);
const STALE_TIMEOUTS_MS: Record<string, number> = {
  queued: Number(process.env.UPGRADE_STALE_QUEUED_MS || 10 * 60 * 1000),
  running: Number(process.env.UPGRADE_STALE_RUNNING_MS || 2 * 60 * 60 * 1000),
  rolling_back: Number(process.env.UPGRADE_STALE_ROLLBACK_MS || 30 * 60 * 1000),
};
const HISTORY_LIMIT = Number(process.env.UPGRADE_HISTORY_LIMIT || 50);

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const states = await readStates();
    const latestUpgrade = states.find(job => !job.dryRun) || null;
    const latestPreflight = states.find(job => job.dryRun) || null;
    return NextResponse.json({
      latest: latestUpgrade || latestPreflight,
      latestUpgrade,
      latestPreflight,
      history: states,
      stateDir: getUpgradeStateRoot(),
      historyLimit: HISTORY_LIMIT,
      running: states.some(job => RUNNING_STATUSES.has(job.status)),
      runtime: getRuntimeStatus(),
    });
  } catch (error) {
    console.error('[admin/upgrade] failed to read state:', error);
    return NextResponse.json({ error: '读取升级状态失败' }, { status: 500 });
  }
}

function getRuntimeStatus(): RuntimeStatus {
  return {
    projectRoot: process.cwd(),
    stateDir: getUpgradeStateRoot(),
    nodeVersion: process.version,
    pm2Enabled: commandExists('pm2'),
    pm2SystemdEnabled: getCommandOutput('systemctl', ['is-enabled', 'pm2-root']),
    disks: getRuntimeDisks(process.cwd(), getUpgradeStateRoot()),
    processes: getPm2Processes(),
  };
}

function getRuntimeDisks(projectRoot: string, stateDir: string): DiskCheck[] {
  return [
    readDiskUsage('项目目录', projectRoot),
    readDiskUsage('升级状态目录', stateDir),
  ].filter((check): check is DiskCheck => Boolean(check));
}

function readDiskUsage(label: string, targetPath: string): DiskCheck | null {
  try {
    fsSync.mkdirSync(targetPath, { recursive: true, mode: 0o700 });
    const result = spawnSync('df', ['-Pk', targetPath], { encoding: 'utf8', timeout: 5000 });
    if (result.status !== 0 || !result.stdout) return null;
    const lines = result.stdout.trim().split(/\r?\n/);
    const row = lines[lines.length - 1]?.trim().split(/\s+/);
    if (!row || row.length < 6) return null;
    const totalBytes = Number(row[1]) * 1024;
    const availableBytes = Number(row[3]) * 1024;
    const usedPercent = Number(row[4].replace('%', ''));
    if (!Number.isFinite(totalBytes) || !Number.isFinite(availableBytes)) return null;
    return {
      label,
      path: path.resolve(targetPath),
      mountPath: row.slice(5).join(' ') || targetPath,
      totalBytes,
      availableBytes,
      usedPercent: Number.isFinite(usedPercent) ? usedPercent : null,
    };
  } catch {
    return null;
  }
}

function commandExists(command: string): boolean {
  return spawnSync('bash', ['-lc', `command -v ${command} >/dev/null 2>&1`], { encoding: 'utf8' }).status === 0;
}

function getCommandOutput(command: string, commandArgs: string[]): string | null {
  const result = spawnSync(command, commandArgs, { encoding: 'utf8', timeout: 3000 });
  const output = `${result.stdout || result.stderr || ''}`.trim();
  return output || null;
}

function getPm2Processes(): RuntimeStatus['processes'] {
  if (!commandExists('pm2')) return [];
  const result = spawnSync('pm2', ['jlist'], { encoding: 'utf8', timeout: 5000, maxBuffer: 5 * 1024 * 1024 });
  if (result.status !== 0 || !result.stdout) return [];
  try {
    const processes = JSON.parse(result.stdout) as Array<{
      name?: string;
      pm2_env?: { status?: string; pm_uptime?: number; restart_time?: number };
    }>;
    return processes.map(process => ({
      name: process.name || 'unknown',
      status: process.pm2_env?.status || 'unknown',
      uptime: process.pm2_env?.pm_uptime,
      restarts: process.pm2_env?.restart_time,
    }));
  } catch {
    return [];
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const states = await readStates();
    const runningJob = states.find(job => RUNNING_STATUSES.has(job.status));
    if (runningJob) {
      return NextResponse.json({ error: `已有升级任务正在执行：${runningJob.id}` }, { status: 409 });
    }

    const form = await request.formData();
    const modeValue = String(form.get('mode') || '');
    const mode = modeValue === 'hot' || modeValue === 'cold' ? modeValue : null;
    const dryRun = String(form.get('dryRun') || '') === 'true';
    if (!mode) {
      return NextResponse.json({ error: '请选择热更新或冷更新' }, { status: 400 });
    }

    const file = form.get('package');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: '请上传升级包' }, { status: 400 });
    }
    if (file.size <= 0) {
      return NextResponse.json({ error: '升级包为空' }, { status: 400 });
    }
    if (file.size > MAX_PACKAGE_BYTES) {
      return NextResponse.json({ error: '升级包不能超过 300MB' }, { status: 400 });
    }
    if (!isAllowedArchiveName(file.name)) {
      return NextResponse.json({ error: '仅支持 .tar、.tar.gz、.tgz 升级包' }, { status: 400 });
    }

    const stateRoot = getUpgradeStateRoot();
    const jobId = `${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;
    const jobDir = path.join(stateRoot, 'jobs', jobId);
    const uploadDir = path.join(jobDir, 'upload');
    await fs.mkdir(uploadDir, { recursive: true, mode: 0o700 });

    const safeName = sanitizeFileName(file.name);
    const packagePath = path.join(uploadDir, safeName);
    const bytes = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(packagePath, bytes, { mode: 0o600 });

    const now = new Date().toISOString();
    const initialState: UpgradeJobState = {
      id: jobId,
      mode,
      status: 'queued',
      step: 'queued',
      message: '升级包已上传，等待执行',
      progress: 0,
      packageName: file.name,
      packageHash: createHash('sha256').update(bytes).digest('hex'),
      startedAt: now,
      updatedAt: now,
      logs: [`[${now}] 上传升级包 ${file.name} (${file.size} bytes)`],
      dryRun,
    };
    if (dryRun) {
      initialState.message = '升级包已上传，正在执行预检';
    }
    await writeState(jobDir, initialState);

    const runnerArgs = [
      path.join(process.cwd(), 'scripts/admin-upgrade-runner.mjs'),
      '--job-id',
      jobId,
      '--mode',
      mode,
      '--package',
      packagePath,
      '--package-name',
      file.name,
      '--project',
      process.cwd(),
    ];
    if (dryRun) runnerArgs.push('--dry-run', 'true');

    const child = spawn(process.execPath, runnerArgs, {
      cwd: process.cwd(),
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        UPGRADE_STATE_DIR: stateRoot,
        COREPACK_HOME: process.env.COREPACK_HOME || '/tmp/corepack',
      },
    });
    child.unref();

    return NextResponse.json({ success: true, dryRun, job: initialState });
  } catch (error) {
    console.error('[admin/upgrade] failed to start upgrade:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '创建升级任务失败' }, { status: 500 });
  }
}

function getUpgradeStateRoot(): string {
  const configured = process.env.UPGRADE_STATE_DIR;
  if (configured) return path.resolve(configured);
  if (process.env.LOCAL_STORAGE_DIR) return path.join(path.dirname(process.env.LOCAL_STORAGE_DIR), 'upgrade');
  return path.join(process.cwd(), 'upgrade-state');
}

async function readStates(): Promise<UpgradeJobState[]> {
  const jobsRoot = path.join(getUpgradeStateRoot(), 'jobs');
  let jobNames: string[] = [];
  try {
    jobNames = await fs.readdir(jobsRoot);
  } catch {
    return [];
  }

  const loadedStates = await Promise.all(
    jobNames.map(async jobName => {
      try {
        const statePath = path.join(jobsRoot, jobName, 'state.json');
        const raw = await fs.readFile(statePath, 'utf8');
        return {
          jobName,
          state: await normalizeStaleState(JSON.parse(raw) as UpgradeJobState, statePath),
        };
      } catch {
        return null;
      }
    }),
  );

  const entries = loadedStates
    .filter((entry): entry is { jobName: string; state: UpgradeJobState } => Boolean(entry))
    .sort((a, b) => new Date(b.state.updatedAt).getTime() - new Date(a.state.updatedAt).getTime());
  const prunedJobNames = await pruneFinishedJobs(jobsRoot, entries);

  return entries
    .filter(entry => !prunedJobNames.has(entry.jobName))
    .map(entry => entry.state)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

async function pruneFinishedJobs(
  jobsRoot: string,
  entries: Array<{ jobName: string; state: UpgradeJobState }>,
): Promise<Set<string>> {
  const prunedJobNames = new Set<string>();
  if (!Number.isFinite(HISTORY_LIMIT) || HISTORY_LIMIT < 1) return prunedJobNames;
  const finished = entries.filter(entry => !RUNNING_STATUSES.has(entry.state.status));
  const staleFinished = finished.slice(HISTORY_LIMIT);
  if (staleFinished.length === 0) return prunedJobNames;

  await Promise.all(staleFinished.map(async entry => {
    const targetDir = path.join(jobsRoot, entry.jobName);
    const resolvedRoot = path.resolve(jobsRoot);
    const resolvedTarget = path.resolve(targetDir);
    if (!resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) return;
    await fs.rm(resolvedTarget, { recursive: true, force: true });
    prunedJobNames.add(entry.jobName);
  }));
  return prunedJobNames;
}

async function normalizeStaleState(state: UpgradeJobState, statePath: string): Promise<UpgradeJobState> {
  if (!RUNNING_STATUSES.has(state.status)) return state;

  const updatedAtMs = new Date(state.updatedAt || state.startedAt).getTime();
  if (!Number.isFinite(updatedAtMs)) return state;

  const timeoutMs = STALE_TIMEOUTS_MS[state.status] || STALE_TIMEOUTS_MS.running;
  if (Date.now() - updatedAtMs < timeoutMs) return state;

  const now = new Date().toISOString();
  const isRollback = state.status === 'rolling_back';
  const error = isRollback
    ? `升级任务在回滚阶段超过 ${formatDuration(timeoutMs)} 没有状态更新，可能 runner 已退出或服务器曾重启，请人工检查备份与运行状态`
    : `升级任务超过 ${formatDuration(timeoutMs)} 没有状态更新，可能 runner 已退出或服务器曾重启，已自动解除升级锁`;
  const next: UpgradeJobState = {
    ...state,
    status: isRollback ? 'rollback_failed' : 'failed',
    step: isRollback ? 'rollback_stale' : 'stale',
    progress: 100,
    message: isRollback ? '升级回滚长时间无更新，请人工检查' : '升级任务长时间无更新，已解除升级锁',
    error,
    stale: true,
    staleAt: now,
    finishedAt: now,
    updatedAt: now,
    logs: [
      ...(state.logs || []),
      `[${now}] ${error}`,
    ].slice(-1000),
  };

  await fs.writeFile(statePath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  return next;
}

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.round(minutes / 60);
  return `${hours} 小时`;
}

async function writeState(jobDir: string, state: UpgradeJobState): Promise<void> {
  await fs.mkdir(jobDir, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(jobDir, 'state.json'), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

function isAllowedArchiveName(name: string): boolean {
  return name.endsWith('.tar') || name.endsWith('.tar.gz') || name.endsWith('.tgz');
}

function sanitizeFileName(name: string): string {
  const baseName = path.basename(name).replace(/[^a-zA-Z0-9._-]/g, '_');
  return baseName || 'upgrade-package.tar.gz';
}
