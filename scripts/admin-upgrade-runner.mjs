#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const projectRoot = path.resolve(args.project || process.cwd());
if (process.env.MIAOJING_LOAD_ENV_FILE !== '0') {
  loadEnvFile(path.join(projectRoot, '.env.local'));
}

const stateRoot = path.resolve(
  process.env.UPGRADE_STATE_DIR ||
    (process.env.LOCAL_STORAGE_DIR ? path.join(path.dirname(process.env.LOCAL_STORAGE_DIR), 'upgrade') : path.join(projectRoot, 'upgrade-state')),
);

const jobId = requireArg(args, 'job-id');
const mode = requireArg(args, 'mode');
const dryRun = args['dry-run'] === 'true';
const packagePath = path.resolve(requireArg(args, 'package'));
const packageName = args['package-name'] || path.basename(packagePath);
const jobDir = path.join(stateRoot, 'jobs', jobId);
const stateFile = path.join(jobDir, 'state.json');
const extractDir = path.join(jobDir, 'extract');
const sourceBackupFile = path.join(jobDir, `source-before-${jobId}.tar.gz`);

const HOT_ALLOWED_PREFIXES = ['public/'];
const HOT_ALLOWED_FILES = new Set([
  'manifest.json',
  'robots.txt',
  'sitemap.xml',
  'favicon.ico',
  'icon.png',
  'apple-icon.png',
]);

const COLD_ALLOWED_PREFIXES = ['src/', 'public/', 'scripts/', 'database/', 'docs/'];
const COLD_ALLOWED_FILES = new Set([
  'manifest.json',
  'package.json',
  'pnpm-lock.yaml',
  'next.config.js',
  'next.config.mjs',
  'next.config.ts',
  'tsconfig.json',
  'postcss.config.mjs',
  'components.json',
  'ecosystem.config.cjs',
]);

const BLOCKED_TOP_LEVEL_NAMES = new Set(['.git', 'node_modules', '.next', 'dist', 'backups', 'local-storage', 'upgrade-state']);
const BLOCKED_ANYWHERE_NAMES = new Set(['.git', 'node_modules', '.next']);
const MAX_EXTRACTED_FILES = Number(process.env.UPGRADE_MAX_EXTRACTED_FILES || 5000);
const MAX_EXTRACTED_BYTES = Number(process.env.UPGRADE_MAX_EXTRACTED_BYTES || 500 * 1024 * 1024);
const MAX_EXTRACTED_FILE_BYTES = Number(process.env.UPGRADE_MAX_EXTRACTED_FILE_BYTES || 200 * 1024 * 1024);
const MIN_FREE_BYTES = Number(process.env.UPGRADE_MIN_FREE_BYTES || 1024 * 1024 * 1024);
const BUILD_FREE_BYTES = Number(process.env.UPGRADE_BUILD_FREE_BYTES || 1024 * 1024 * 1024);
const PAYLOAD_TOP_LEVEL_DIRECTORIES = new Set([
  ...HOT_ALLOWED_PREFIXES.map(prefix => prefix.replace(/\/$/, '')),
  ...COLD_ALLOWED_PREFIXES.map(prefix => prefix.replace(/\/$/, '')),
  ...BLOCKED_TOP_LEVEL_NAMES,
]);

let state = readState() || {
  id: jobId,
  mode,
  status: 'queued',
  step: 'queued',
  message: '升级任务已创建',
  progress: 0,
  packageName,
  startedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  logs: [],
};

main().catch(error => {
  log(`fatal: ${error instanceof Error ? error.stack || error.message : String(error)}`);
  if (dryRun) {
    cleanupExtractDir();
    updateState({
      status: 'failed',
      step: 'preflight_failed',
      progress: 100,
      message: '升级包预检失败，请按错误信息调整升级包',
      error: error instanceof Error ? error.message : '升级包预检异常退出',
      finishedAt: new Date().toISOString(),
    });
    return;
  }
  rollbackAfterFailure(error instanceof Error ? error.message : '升级任务异常退出').catch(rollbackError => {
    updateState({
      status: 'rollback_failed',
      step: 'rollback_failed',
      progress: 100,
      message: '升级失败，自动回滚也失败，请立即人工检查',
      error: `${error instanceof Error ? error.message : String(error)}; rollback: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
      finishedAt: new Date().toISOString(),
    });
  });
});

async function main() {
  ensureDir(jobDir);
  updateState({
    status: 'running',
    step: 'preflight',
    progress: 5,
    message: '正在检查升级包与运行环境',
    startedAt: state.startedAt || new Date().toISOString(),
  });
  logStep('开始升级任务', `任务 ${jobId} 使用${mode === 'hot' ? '热更新' : '冷更新'}模式，升级包 ${packageName}${dryRun ? '，仅执行预检' : ''}`);

  if (mode !== 'hot' && mode !== 'cold') {
    throw new Error('升级方式无效');
  }
  if (!fs.existsSync(packagePath)) {
    throw new Error(`升级包不存在: ${packagePath}`);
  }
  if (!isAllowedArchive(packageName) && !isAllowedArchive(packagePath)) {
    throw new Error('仅支持 .tar、.tar.gz、.tgz 升级包');
  }
  const packageBytes = fs.statSync(packagePath).size;
  const preExtractDiskChecks = validatePreExtractDiskSpace(packageBytes);
  updateState({ diskChecks: preExtractDiskChecks });

  logStep('校验升级包', '正在读取压缩包目录并检查格式');
  run('tar', tarReadArgs('list', packagePath), { cwd: projectRoot, label: '检查升级包结构' });

  resetDir(extractDir);
  run('tar', [...tarReadArgs('extract', packagePath), '-C', extractDir], { cwd: projectRoot, label: '解压升级包' });

  const payloadRoot = resolvePayloadRoot(extractDir);
  const packageStats = collectPackageStats(payloadRoot);
  const files = packageStats.files;
  if (files.length === 0) {
    throw new Error('升级包为空');
  }
  validatePackageSize(packageStats);
  const diskChecks = validateUpgradeDiskSpace(packageStats, packageBytes);

  const validation = validateFiles(files, mode);
  logStep('升级包内容', `校验通过，共 ${files.length} 个文件，解压后 ${formatBytes(packageStats.totalBytes)}：${files.slice(0, 20).join('、')}${files.length > 20 ? ` 等 ${files.length} 个文件` : ''}`);
  updateState({
    step: 'validated',
    progress: 14,
    message: `升级包校验通过，共 ${files.length} 个文件`,
    restartRequired: mode === 'cold' || validation.requiresRestart,
    packageHash: sha256(packagePath),
    changedFiles: files,
    extractedFileCount: packageStats.files.length,
    extractedBytes: packageStats.totalBytes,
    largestFileBytes: packageStats.largestFileBytes,
    diskChecks,
    dryRun,
  });

  if (dryRun) {
    logStep('预检完成', `升级包可用于${mode === 'hot' ? '热更新' : '冷更新'}，${mode === 'cold' || validation.requiresRestart ? '需要重启平台' : '无需重启平台'}`);
    cleanupExtractDir();
    updateState({
      status: 'succeeded',
      step: 'preflight_completed',
      progress: 100,
      message: `预检通过：共 ${files.length} 个文件，${mode === 'cold' || validation.requiresRestart ? '执行时需要重启平台' : '执行时无需重启平台'}`,
      finishedAt: new Date().toISOString(),
      restartRequired: mode === 'cold' || validation.requiresRestart,
      dryRun: true,
    });
    return;
  }

  updateState({ step: 'backup_data', progress: 22, message: '正在创建数据库、存储与环境配置备份' });
  logStep('创建数据备份', '开始备份数据库、存储目录和环境配置');
  const backupFile = runCapture('bash', ['./scripts/backup-create.sh'], {
    cwd: projectRoot,
    label: '创建数据备份',
    env: { BACKUP_DIR: path.join(stateRoot, 'data-backups'), COZE_WORKSPACE_PATH: projectRoot },
  }).trim().split('\n').pop();
  if (!backupFile || !fs.existsSync(backupFile)) {
    throw new Error('数据备份创建失败');
  }
  verifyTarArchive(backupFile, '校验数据备份');
  const backupHash = sha256(backupFile);
  updateState({ backupFile, backupHash });
  logStep('数据备份完成', `备份文件：${backupFile}，SHA256：${backupHash}`);

  updateState({ step: 'backup_source', progress: 30, message: '正在创建源码快照' });
  logStep('创建源码快照', '开始保存升级前源码状态');
  createSourceBackup(sourceBackupFile);
  verifyTarArchive(sourceBackupFile, '校验源码快照');
  const sourceBackupHash = sha256(sourceBackupFile);
  updateState({ sourceBackupFile, sourceBackupHash });
  logStep('源码快照完成', `快照文件：${sourceBackupFile}，SHA256：${sourceBackupHash}`);

  updateState({ step: 'apply', progress: 42, message: '正在应用升级包文件' });
  logStep('应用升级文件', '开始覆盖升级包中的文件');
  updateState({ preExistingFiles: files.filter(file => fs.existsSync(path.join(projectRoot, file))) });
  applyFiles(payloadRoot, files);
  logStep('升级文件应用完成', `已应用 ${files.filter(file => file !== 'manifest.json').length} 个文件`);

  if (mode === 'hot') {
    updateState({ step: 'verify_hot', progress: 70, message: '正在验证热更新文件' });
    logStep('热更新验证', '正在执行 TypeScript 校验，确认补丁不会破坏现有代码');
    run('pnpm', ['run', 'ts-check'], { cwd: projectRoot, label: 'TypeScript 校验' });
    logStep('热更新完成', '升级成功，平台未重启，前端业务不中断');
    cleanupExtractDir();
    updateState({
      status: 'succeeded',
      step: 'completed',
      progress: 100,
      message: '热更新成功，平台未重启',
      finishedAt: new Date().toISOString(),
      restartRequired: false,
    });
    return;
  }

  const dependencyChanged = files.some(file => file === 'package.json' || file === 'pnpm-lock.yaml');
  if (dependencyChanged) {
    updateState({ step: 'install', progress: 54, message: '依赖文件发生变化，正在安装依赖' });
    logStep('安装依赖', '检测到 package.json 或 pnpm-lock.yaml 变化，开始安装依赖');
    run('pnpm', ['install', '--frozen-lockfile', '--prod=false'], { cwd: projectRoot, label: '安装依赖' });
    logStep('依赖安装完成', '依赖安装已完成');
  }

  updateState({ step: 'ts_check', progress: 64, message: '正在执行 TypeScript 校验' });
  logStep('代码校验', '开始执行 TypeScript 校验');
  run('pnpm', ['run', 'ts-check'], { cwd: projectRoot, label: 'TypeScript 校验' });
  logStep('代码校验完成', 'TypeScript 校验已通过');

  updateState({ step: 'build', progress: 75, message: '正在构建平台' });
  logStep('平台构建', '开始构建生产版本');
  run('pnpm', ['run', 'build'], { cwd: projectRoot, label: '构建平台' });
  logStep('平台构建完成', '生产构建已完成');

  updateState({ step: 'restart', progress: 94, message: '构建已完成，正在后台重启平台进程' });
  logStep('冷更新完成', '升级文件已应用并完成构建，将在后台重启平台进程');
  cleanupExtractDir();
  updateState({
    status: 'succeeded',
    step: 'completed',
    progress: 100,
    message: '冷更新成功，平台正在后台重启',
    finishedAt: new Date().toISOString(),
    restartRequired: true,
  });
  restartPlatform({ detached: true });
}

async function rollbackAfterFailure(message) {
  const originalError = message;
  logStep('升级失败', `失败原因：${originalError}`);
  updateState({
    status: 'rolling_back',
    step: 'rolling_back',
    progress: 96,
    message: '升级失败，正在自动回滚到升级前状态',
    error: originalError,
  });

  if (fs.existsSync(sourceBackupFile)) {
    logStep('回滚源码', '正在恢复升级前源码快照，并移除升级中新建的文件');
    restoreSourceBackup(sourceBackupFile);
    logStep('源码回滚完成', '源码已恢复到升级开始前状态');
  }

  if (state.backupFile && fs.existsSync(state.backupFile)) {
    logStep('回滚数据', '正在恢复数据库、存储目录和环境配置备份');
    run('bash', ['./scripts/backup-restore.sh', state.backupFile], {
      cwd: projectRoot,
      label: '恢复数据备份',
      env: {
        COZE_WORKSPACE_PATH: projectRoot,
        RESTORE_SAFETY_DIR: path.join(stateRoot, 'restore-safety'),
      },
    });
    logStep('数据回滚完成', '数据库、存储目录和环境配置已恢复');
  }

  if (mode === 'cold') {
    try {
      logStep('回滚后重建', '冷更新失败后正在重新构建回滚版本');
      run('pnpm', ['run', 'build'], { cwd: projectRoot, label: '回滚后重新构建' });
      logStep('回滚后重启', '将后台重启回滚后的平台版本');
    } catch (error) {
      throw new Error(`回滚后平台恢复检查失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  logStep('自动回滚完成', '升级失败，但已自动恢复到升级开始前状态');
  cleanupExtractDir();
  updateState({
    status: 'rolled_back',
    step: 'rolled_back',
    progress: 100,
    message: '升级失败，已自动回滚到升级开始前状态',
    error: originalError,
    finishedAt: new Date().toISOString(),
  });
  if (mode === 'cold') {
    restartPlatform({ detached: true });
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      parsed[key] = 'true';
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function requireArg(parsed, key) {
  const value = parsed[key];
  if (!value) throw new Error(`missing --${key}`);
  return value;
}

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const index = trimmed.indexOf('=');
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch {
    return null;
  }
}

function updateState(patch) {
  state = {
    ...state,
    ...patch,
    updatedAt: new Date().toISOString(),
    logs: patch.logs || state.logs || [],
  };
  ensureDir(path.dirname(stateFile));
  const tempFile = `${stateFile}.tmp`;
  fs.writeFileSync(tempFile, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(tempFile, stateFile);
}

function log(line) {
  const timestamped = `[${new Date().toISOString()}] ${line}`;
  const logs = [...(state.logs || []), timestamped].slice(-1000);
  updateState({ logs });
}

function logStep(title, detail = '') {
  log(detail ? `${title}：${detail}` : title);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function resetDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  ensureDir(dir);
}

function cleanupExtractDir() {
  if (!fs.existsSync(extractDir)) return;
  fs.rmSync(extractDir, { recursive: true, force: true });
  logStep('清理解压目录', `已删除临时目录：${extractDir}`);
}

function run(command, commandArgs, options = {}) {
  runCapture(command, commandArgs, options);
}

function runCapture(command, commandArgs, options = {}) {
  const label = options.label || command;
  logStep(label, `执行命令 ${command} ${commandArgs.join(' ')}`);
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd || projectRoot,
    env: { ...process.env, COREPACK_HOME: process.env.COREPACK_HOME || '/tmp/corepack', ...(options.env || {}) },
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  if (output) {
    for (const line of output.split(/\r?\n/).slice(-180)) log(`${label}输出：${line}`);
  }
  if (result.status !== 0) {
    throw new Error(`${label}失败，退出码 ${result.status ?? 'unknown'}`);
  }
  return result.stdout || '';
}

function isAllowedArchive(file) {
  return file.endsWith('.tar') || file.endsWith('.tar.gz') || file.endsWith('.tgz');
}

function resolvePayloadRoot(root) {
  const entries = fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.name !== '__MACOSX');
  if (entries.length === 1 && entries[0].isDirectory() && !PAYLOAD_TOP_LEVEL_DIRECTORIES.has(entries[0].name)) {
    return path.join(root, entries[0].name);
  }
  return root;
}

function collectPackageStats(root) {
  const files = [];
  let totalBytes = 0;
  let largestFileBytes = 0;
  walk(root, '');
  return { files: files.sort(), totalBytes, largestFileBytes };

  function walk(currentRoot, relativeRoot) {
    for (const entry of fs.readdirSync(currentRoot, { withFileTypes: true })) {
      if (entry.name === '.DS_Store') continue;
      const relative = toPosix(path.join(relativeRoot, entry.name));
      const absolute = path.join(currentRoot, entry.name);
      if (entry.isDirectory()) {
        walk(absolute, relative);
      } else if (entry.isFile()) {
        const stat = fs.statSync(absolute);
        totalBytes += stat.size;
        largestFileBytes = Math.max(largestFileBytes, stat.size);
        files.push(relative);
      } else {
        throw new Error(`升级包包含不支持的文件类型: ${relative}`);
      }
    }
  }
}

function validatePackageSize(stats) {
  if (Number.isFinite(MAX_EXTRACTED_FILES) && stats.files.length > MAX_EXTRACTED_FILES) {
    throw new Error(`升级包文件数量过多：${stats.files.length} 个，最多允许 ${MAX_EXTRACTED_FILES} 个`);
  }
  if (Number.isFinite(MAX_EXTRACTED_BYTES) && stats.totalBytes > MAX_EXTRACTED_BYTES) {
    throw new Error(`升级包解压后过大：${formatBytes(stats.totalBytes)}，最多允许 ${formatBytes(MAX_EXTRACTED_BYTES)}`);
  }
  if (Number.isFinite(MAX_EXTRACTED_FILE_BYTES) && stats.largestFileBytes > MAX_EXTRACTED_FILE_BYTES) {
    throw new Error(`升级包包含过大的单个文件：${formatBytes(stats.largestFileBytes)}，最多允许 ${formatBytes(MAX_EXTRACTED_FILE_BYTES)}`);
  }
}

function validatePreExtractDiskSpace(packageBytes) {
  const stateCheck = buildDiskCheck({
    label: '升级状态目录',
    targetPath: stateRoot,
    requiredBytes: packageBytes + MAX_EXTRACTED_BYTES + MIN_FREE_BYTES,
  });
  assertDiskSpace(stateCheck);
  logDiskCheck(stateCheck);
  return [stateCheck];
}

function validateUpgradeDiskSpace(stats, packageBytes) {
  const checks = [
    buildDiskCheck({
      label: '升级状态目录',
      targetPath: stateRoot,
      requiredBytes: packageBytes + stats.totalBytes + MIN_FREE_BYTES,
    }),
    buildDiskCheck({
      label: '项目目录',
      targetPath: projectRoot,
      requiredBytes: stats.totalBytes + (mode === 'cold' ? BUILD_FREE_BYTES : MIN_FREE_BYTES),
    }),
  ];
  for (const check of checks) {
    assertDiskSpace(check);
    logDiskCheck(check);
  }
  return checks;
}

function buildDiskCheck({ label, targetPath, requiredBytes }) {
  const usage = readDiskUsage(targetPath);
  return {
    label,
    path: path.resolve(targetPath),
    mountPath: usage.mountPath,
    totalBytes: usage.totalBytes,
    availableBytes: usage.availableBytes,
    requiredBytes,
    usedPercent: usage.usedPercent,
  };
}

function readDiskUsage(targetPath) {
  ensureDir(targetPath);
  const result = spawnSync('df', ['-Pk', targetPath], { encoding: 'utf8', timeout: 5000 });
  if (result.status !== 0 || !result.stdout) {
    const detail = `${result.stderr || result.stdout || ''}`.trim();
    throw new Error(`读取磁盘空间失败：${targetPath}${detail ? `；${detail}` : ''}`);
  }
  const lines = result.stdout.trim().split(/\r?\n/);
  const row = lines[lines.length - 1]?.trim().split(/\s+/);
  if (!row || row.length < 6) {
    throw new Error(`读取磁盘空间失败：${targetPath}`);
  }
  const totalBytes = Number(row[1]) * 1024;
  const availableBytes = Number(row[3]) * 1024;
  const usedPercent = Number(row[4].replace('%', ''));
  if (!Number.isFinite(totalBytes) || !Number.isFinite(availableBytes)) {
    throw new Error(`读取磁盘空间失败：${targetPath}`);
  }
  return {
    mountPath: row.slice(5).join(' ') || targetPath,
    totalBytes,
    availableBytes,
    usedPercent: Number.isFinite(usedPercent) ? usedPercent : null,
  };
}

function assertDiskSpace(check) {
  if (!Number.isFinite(check.requiredBytes) || check.requiredBytes <= 0) return;
  if (check.availableBytes >= check.requiredBytes) return;
  throw new Error(`升级前磁盘空间不足：${check.label} ${check.path} 可用 ${formatBytes(check.availableBytes)}，需要至少 ${formatBytes(check.requiredBytes)}`);
}

function logDiskCheck(check) {
  const mountDetail = check.mountPath && check.mountPath !== check.path ? `（挂载点 ${check.mountPath}）` : '';
  logStep('磁盘空间检查', `${check.label} ${check.path}${mountDetail} 可用 ${formatBytes(check.availableBytes)}，需要 ${formatBytes(check.requiredBytes)}`);
}

function validateFiles(files, updateMode) {
  for (const file of files) {
    assertSafeRelativePath(file);
    if (isBlockedPackagePath(file)) {
      throw new Error(`升级包包含禁止覆盖的路径: ${file}`);
    }
    if (updateMode === 'hot' && !isHotAllowed(file)) {
      throw new Error(`热更新只能包含 public 等无需重启的静态资源；${file} 需要使用冷更新`);
    }
    if (updateMode === 'cold' && !isColdAllowed(file)) {
      throw new Error(`冷更新包包含未授权路径: ${file}`);
    }
  }
  return { requiresRestart: files.some(file => !isHotAllowed(file)) };
}

function isBlockedPackagePath(file) {
  const parts = file.split('/');
  return (
    parts.some(part => part.startsWith('.env')) ||
    BLOCKED_TOP_LEVEL_NAMES.has(parts[0]) ||
    parts.some(part => BLOCKED_ANYWHERE_NAMES.has(part))
  );
}

function assertSafeRelativePath(file) {
  if (!file || file.startsWith('/') || file.startsWith('\\') || file.includes('\\')) {
    throw new Error(`升级包包含非法路径: ${file}`);
  }
  const normalized = path.posix.normalize(file);
  if (normalized !== file || normalized === '.' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new Error(`升级包包含目录穿越路径: ${file}`);
  }
}

function isHotAllowed(file) {
  return HOT_ALLOWED_FILES.has(file) || HOT_ALLOWED_PREFIXES.some(prefix => file.startsWith(prefix));
}

function isColdAllowed(file) {
  return COLD_ALLOWED_FILES.has(file) || COLD_ALLOWED_PREFIXES.some(prefix => file.startsWith(prefix));
}

function applyFiles(root, files) {
  for (const file of files) {
    if (file === 'manifest.json') continue;
    const source = path.join(root, file);
    const target = path.join(projectRoot, file);
    ensureDir(path.dirname(target));
    fs.copyFileSync(source, target);
  }
}

function createSourceBackup(target) {
  ensureDir(path.dirname(target));
  run('tar', [
    '-czf',
    target,
    '--exclude=.git',
    '--exclude=node_modules',
    '--exclude=.next',
    '--exclude=dist',
    '--exclude=backups',
    '--exclude=./local-storage',
    '--exclude=upgrade-state',
    '--exclude=tsconfig.tsbuildinfo',
    '-C',
    projectRoot,
    '.',
  ], { cwd: projectRoot, label: '创建源码快照' });
}

function restoreSourceBackup(source) {
  log(`恢复源码快照: ${source}`);
  const preExistingFiles = new Set(Array.isArray(state.preExistingFiles) ? state.preExistingFiles : []);
  const changedFiles = Array.isArray(state.changedFiles) ? state.changedFiles : [];
  for (const file of changedFiles) {
    if (file === 'manifest.json' || preExistingFiles.has(file)) continue;
    const target = path.join(projectRoot, file);
    if (target.startsWith(projectRoot)) {
      fs.rmSync(target, { force: true });
    }
  }
  run('tar', [
    '-xzf',
    source,
    '--exclude=.git',
    '--exclude=node_modules',
    '--exclude=.next',
    '--exclude=dist',
    '-C',
    projectRoot,
  ], { cwd: projectRoot, label: '恢复源码快照' });
}

function restartPlatform(options = {}) {
  const restartCommand = process.env.UPGRADE_RESTART_COMMAND || detectRestartCommand();
  if (options.detached) {
    const logFile = path.join(jobDir, 'restart.log');
    const detachedCommand = `nohup bash -lc ${JSON.stringify(restartCommand)} >> ${JSON.stringify(logFile)} 2>&1 &`;
    spawnSync('bash', ['-lc', detachedCommand], {
      cwd: projectRoot,
      env: { ...process.env, COREPACK_HOME: process.env.COREPACK_HOME || '/tmp/corepack' },
      encoding: 'utf8',
    });
    logStep('后台重启平台', `已触发后台重启命令，日志：${logFile}`);
    return;
  }
  run('bash', ['-lc', restartCommand], { cwd: projectRoot, label: '重启平台' });
}

function detectRestartCommand() {
  const pm2Names = runCapture('bash', ['-lc', 'command -v pm2 >/dev/null 2>&1 && pm2 jlist || true'], {
    cwd: projectRoot,
    label: '检测 PM2 进程',
  });
  if (pm2Names.includes('"name":"miaojing-dev"')) return 'pm2 restart miaojing-dev --update-env';
  if (fs.existsSync(path.join(projectRoot, 'ecosystem.config.cjs'))) return 'pm2 startOrReload ecosystem.config.cjs --update-env && pm2 save';
  return 'pm2 restart miaojing-dev --update-env';
}

function tarReadArgs(action, archivePath) {
  const flag = action === 'list' ? '-tf' : '-xf';
  const gzipFlag = action === 'list' ? '-tzf' : '-xzf';
  return archivePath.endsWith('.tar') ? [flag, archivePath] : [gzipFlag, archivePath];
}

function verifyTarArchive(archivePath, label) {
  if (!fs.existsSync(archivePath)) {
    throw new Error(`${label}失败，文件不存在: ${archivePath}`);
  }
  run('tar', tarReadArgs('list', archivePath), { cwd: projectRoot, label });
}

function waitForHealth() {
  const healthUrl = process.env.UPGRADE_HEALTH_URL || process.env.APP_HEALTH_URL || 'http://127.0.0.1:5100/api/health';
  const timeoutMs = Number(process.env.UPGRADE_HEALTH_TIMEOUT_MS || 90000);
  const startedAt = Date.now();
  let lastError = '';
  while (Date.now() - startedAt < timeoutMs) {
    const result = spawnSync('curl', ['-fsS', healthUrl], { encoding: 'utf8', timeout: 8000 });
    if (result.status === 0) {
      log(`健康检查通过: ${healthUrl}`);
      return;
    }
    lastError = `${result.stderr || result.stdout || `exit ${result.status}`}`.trim();
    sleep(3000);
  }
  throw new Error(`健康检查超时: ${healthUrl}; ${lastError}`);
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function sha256(file) {
  const hash = createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return 'unknown';
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

function toPosix(file) {
  return file.split(path.sep).join('/');
}
