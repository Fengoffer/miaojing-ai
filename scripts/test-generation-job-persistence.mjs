import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

await runTest('generation job runner can dispatch reverse-prompt payloads to the reverse prompt route', () => {
  const source = read('src/lib/generation-job-runner.ts');
  assert.match(source, /type GenerationJobType = 'image' \| 'video' \| 'reverse-prompt';/);
  assert.match(source, /const endpoint = type === 'image' \? '\/api\/generate\/image' : type === 'video' \? '\/api\/generate\/video' : '\/api\/generate\/reverse-prompt';/);
});

await runTest('generation job runner uses long-lived internal HTTP requests for slow video jobs', () => {
  const source = read('src/lib/generation-job-runner.ts');
  assert.match(source, /requestInternalGenerationJson/);
  assert.match(source, /GENERATION_INTERNAL_REQUEST_TIMEOUT_MS/);
  assert.match(source, /25 \* 60_000/);
  assert.match(source, /20 \* 60_000/);
  assert.match(source, /req\.setTimeout\(timeoutMs/);
  assert.doesNotMatch(source, /await fetch\(`\$\{baseUrl\}\$\{endpoint\}`/);
});

await runTest('generation jobs route can list active jobs and accept reverse-prompt submissions', () => {
  const source = read('src/app/api/generation-jobs/route.ts');
  assert.match(source, /export async function GET\(request: NextRequest\)/);
  assert.match(source, /status IN \('queued', 'running'\)/);
  assert.match(source, /type !== 'image' && type !== 'video' && type !== 'reverse-prompt'/);
  assert.match(source, /resolveGenerationJobIdentity\(client,\s*userId,\s*type,\s*payload\)/);
});

await runTest('reverse prompt generation jobs record the fixed system text model identity', () => {
  const source = read('src/lib/generation-job-estimates.ts');
  assert.match(source, /REVERSE_PROMPT_SYSTEM_MODEL\s*=\s*'gpt-5\.5'/);
  assert.match(source, /type === 'reverse-prompt'/);
  assert.match(source, /WHERE LOWER\(model_name\) = LOWER\(\$1\)[\s\S]*AND type = 'text'[\s\S]*AND is_default = true[\s\S]*AND is_active = true/);
  assert.match(source, /modelName:\s*safeString\(row\.model_name\) \|\| REVERSE_PROMPT_SYSTEM_MODEL/);
});

await runTest('creation history post accepts trusted internal generation requests', () => {
  const source = read('src/app/api/creation-history/route.ts');
  assert.match(source, /isTrustedInternalGenerationRequest/);
  assert.match(source, /x-miaojing-generation-user-id/);
  assert.match(source, /if \(!userId\) return NextResponse\.json\(\{ error: '请先登录' \}, \{ status: 401 \}\);/);
});

await runTest('generation worker persists completed jobs back into creation history', () => {
  const source = read('src/lib/generation-job-worker.ts');
  assert.match(source, /saveCreationHistoryRecords/);
  assert.doesNotMatch(source, /\/api\/creation-history/);
  assert.doesNotMatch(source, /getInternalBaseUrl/);
  assert.match(source, /persistGenerationHistoryRecord|saveGenerationHistoryRecord|creation history/i);
  assert.match(source, /status: 'succeeded'/);
});

await runTest('media storage ffmpeg lookup is safe inside the CJS backend bundle', () => {
  const source = read('src/lib/media-storage.ts');
  assert.doesNotMatch(source, /createRequire\(import\.meta\.url\)/);
  assert.match(source, /createRequire\(path\.join\(process\.cwd\(\), 'package\.json'\)\)/);
});

await runTest('direct generate routes require trusted internal calls unless using authenticated resolved API config', () => {
  const authHelper = read('src/lib/generation-route-auth.ts');
  assert.match(authHelper, /isTrustedInternalGenerationRequest\(request\)/);
  assert.match(authHelper, /getAuthenticatedUserId\(request\)/);
  assert.match(authHelper, /hasDirectSystemOrSecretConfig/);
  assert.match(authHelper, /config\?\.systemApiId \|\| config\?\.apiKey/);
  assert.match(authHelper, /普通生成请求请通过任务队列提交/);
  assert.match(authHelper, /请先登录后再使用自定义 API/);

  for (const relativePath of [
    'src/app/api/generate/image/route.ts',
    'src/app/api/generate/video/route.ts',
  ]) {
    const source = read(relativePath);
    assert.match(source, /enforceGenerationRouteAccess/);
    assert.match(source, /resolveServerApiConfig\(/);
  }

  const reversePromptRoute = read('src/app/api/generate/reverse-prompt/route.ts');
  assert.match(reversePromptRoute, /enforceGenerationRouteAccess\(request,\s*undefined\)/);
  assert.match(reversePromptRoute, /REVERSE_PROMPT_SYSTEM_MODEL\s*=\s*'gpt-5\.5'/);
  assert.match(reversePromptRoute, /resolveSystemTextApiByModelName/);
  assert.doesNotMatch(reversePromptRoute, /resolveServerApiConfig\(/);

  const runnerSource = read('src/lib/generation-job-runner.ts');
  assert.match(runnerSource, /getInternalGenerationHeaders\(\)/);
});

await runTest('video custom API failures never return raw upstream payloads', () => {
  const source = read('src/app/api/generate/video/route.ts');
  assert.doesNotMatch(source, /raw:\s*customData/);
  assert.match(source, /summarizeCustomVideoResponse/);
});

await runTest('image generation caps persisted images to the requested count', () => {
  const source = read('src/app/api/generate/image/route.ts');
  assert.match(source, /function capPersistedImagesToRequestedCount/);
  assert.match(source, /imageResponsePayload\([^,\n]+,\s*n\)/);
  assert.match(source, /persistQualifiedImageUrls\([^)]*requestedCount/s);
});

await runTest('creation history serializes same-user same-url inserts to prevent duplicate rows', () => {
  const routeSource = read('src/app/api/creation-history/route.ts');
  const source = read('src/lib/creation-history-service.ts');
  assert.match(routeSource, /saveCreationHistoryRecords/);
  assert.match(source, /pg_advisory_xact_lock/);
  assert.match(source, /historyRecordDedupeLockKey/);
  assert.match(source, /WHERE user_id = \$1 AND result_url = \$2/);
});

await runTest('create panels restore active jobs from the server after reload or auth change', () => {
  for (const relativePath of [
    'src/components/create/text-to-image.tsx',
    'src/components/create/image-to-image.tsx',
    'src/components/create/text-to-video.tsx',
    'src/components/create/image-to-video.tsx',
    'src/components/create/reverse-prompt-panel.tsx',
  ]) {
    const source = read(relativePath);
    assert.match(source, /useGenerationJobRecovery|fetchActiveGenerationJobs|\/api\/generation-jobs\?status=queued%2Crunning|\/api\/generation-jobs\?status=queued,running/);
  }
});

await runTest('recovered job polling is not cancelled by active task state updates', () => {
  const source = read('src/components/create/use-generation-job-recovery.ts');
  assert.match(source, /knownJobIdsRef/);
  const effectMatches = [...source.matchAll(/useEffect\(\(\) => \{[\s\S]*?void recover\(\);[\s\S]*?\}, \[([^\]]*)\]\);/g)];
  assert.ok(effectMatches.length > 0, 'expected to find the recovery polling effect');
  const dependencies = effectMatches.at(-1)?.[1] || '';
  assert.doesNotMatch(dependencies, /\btypes\b/);
  assert.doesNotMatch(dependencies, /\bnormalizedKnownJobIds\b/);
});

await runTest('active generation job recovery avoids anonymous polling and dedupes short-lived list requests', () => {
  const source = read('src/lib/generation-job-client.ts');
  assert.match(source, /const ACTIVE_JOBS_REQUEST_TTL_MS = \d+;/);
  assert.match(source, /activeJobsRequestCache/);
  assert.match(source, /if \(!authToken\) return \[\];/);
  assert.match(source, /getActiveJobsRequestKey\(normalizedTypes, authToken\)/);
});

await runTest('client auth helper accepts legacy session tokens for generation job requests', () => {
  const clientSource = read('src/lib/generation-job-client.ts');
  const authHelper = read('src/lib/client-auth.ts');

  assert.match(clientSource, /getClientAuthToken/);
  assert.match(clientSource, /getClientAuthHeaders/);
  assert.doesNotMatch(clientSource, /localStorage\.getItem\(['"]miaojing_auth['"]\)/);
  assert.match(authHelper, /auth\?\.accessToken/);
  assert.match(authHelper, /auth\?\.session\?\.access_token/);
  assert.match(authHelper, /export function getClientAuthHeaders/);
});

await runTest('generation jobs stay recoverable after the browser closes before the result is consumed', () => {
  const clientSource = read('src/lib/generation-job-client.ts');
  const recoverySource = read('src/components/create/use-generation-job-recovery.ts');

  assert.match(clientSource, /PENDING_GENERATION_JOBS_STORAGE_PREFIX/);
  assert.match(clientSource, /rememberPendingGenerationJob/);
  assert.match(clientSource, /forgetPendingGenerationJob/);
  assert.match(clientSource, /fetchGenerationJobStatus/);
  assert.match(clientSource, /fetchRecoverableGenerationJobs/);
  assert.match(clientSource, /rememberPendingGenerationJob\(type,\s*createData\.jobId/);
  assert.match(recoverySource, /fetchRecoverableGenerationJobs/);
  assert.doesNotMatch(recoverySource, /const jobs = await fetchActiveGenerationJobs\(typesRef\.current\);/);
});

await runTest('terminal recovered generation jobs clear pending browser recovery state', () => {
  const clientSource = read('src/lib/generation-job-client.ts');
  const recoverySource = read('src/components/create/use-generation-job-recovery.ts');

  assert.match(clientSource, /statusData\.status === 'succeeded'[\s\S]*forgetPendingGenerationJob/);
  assert.match(clientSource, /statusData\.status === 'failed'[\s\S]*forgetPendingGenerationJob/);
  assert.match(clientSource, /statusData\.status === 'cancelled'[\s\S]*forgetPendingGenerationJob/);
  assert.match(clientSource, /cancelGenerationJob[\s\S]*forgetPendingGenerationJob/);
  assert.match(recoverySource, /forgetPendingGenerationJob/);
});

await runTest('generation job status polling survives transient frontend proxy failures', () => {
  const clientSource = read('src/lib/generation-job-client.ts');

  assert.match(clientSource, /GENERATION_JOB_STATUS_REQUEST_TIMEOUT_MS/);
  assert.match(clientSource, /GENERATION_JOB_STATUS_REQUEST_ATTEMPTS/);
  assert.match(clientSource, /new AbortController\(\)/);
  assert.match(clientSource, /controller\.abort\(\)/);
  assert.match(clientSource, /isRetryableGenerationJobStatusHttpStatus\(res\.status\)/);
  assert.match(clientSource, /status === 502 \|\| status === 503 \|\| status === 504/);
  assert.match(clientSource, /isRetryableGenerationJobStatusError\(error\)/);
  assert.match(clientSource, /cache: 'no-store'/);
  assert.match(clientSource, /'Cache-Control': 'no-cache'/);
  assert.match(clientSource, /params\.set\('_t', String\(Date\.now\(\)\)\)/);
});

await runTest('active job recovery dedupes locally submitted tasks by client request id', () => {
  const taskListSource = read('src/components/create/generation-task-list.tsx');
  const recoverySource = read('src/components/create/use-generation-job-recovery.ts');
  const textToImageSource = read('src/components/create/text-to-image.tsx');

  assert.match(taskListSource, /clientRequestId\?: string;/);
  assert.match(recoverySource, /payload\?\.clientRequestId/);
  assert.match(recoverySource, /getJobIdentityIds/);
  assert.match(recoverySource, /identityIds\.some\(id => activeJobIdsRef\.current\.has\(id\) \|\| knownJobIdsRef\.current\.has\(id\)\)/);
  assert.match(textToImageSource, /clientRequestId: taskId/);
  assert.match(textToImageSource, /task\.clientRequestId/);
});

await runTest('generation job API only dedupes active jobs for the same client request id', () => {
  const source = read('src/app/api/generation-jobs/route.ts');
  assert.match(source, /const existing = clientRequestId\s*\?/);
  assert.match(source, /payload->>'clientRequestId' = \$3/);
  assert.match(source, /progress->>'clientRequestId' = \$3/);
  assert.match(source, /AND payload = \$3::jsonb/);
  assert.doesNotMatch(source, /payload - 'clientRequestId'/);
  assert.doesNotMatch(source, /\$3::jsonb - 'clientRequestId'/);
  assert.match(source, /deduplicated: true/);
});

await runTest('create panels do not prepend duplicate completed media urls', () => {
  for (const relativePath of [
    'src/components/create/text-to-image.tsx',
    'src/components/create/image-to-image.tsx',
    'src/components/create/text-to-video.tsx',
    'src/components/create/image-to-video.tsx',
  ]) {
    const source = read(relativePath);
    assert.match(source, /filter\(url => !prev\.includes\(url\)\)/, `${relativePath} should filter duplicate result URLs before prepending`);
  }
});

await runTest('generation task cards render returned media before final cleanup', () => {
  const taskListSource = read('src/components/create/generation-task-list.tsx');

  assert.match(taskListSource, /completedResult\?:/, 'active task state should carry the returned media result');
  assert.match(taskListSource, /CachedPreviewImage/, 'completed image tasks should render the returned image in the active task card');
  assert.match(taskListSource, /<video[\s\S]*src=\{url\}/, 'completed video tasks should render the returned video in the active task card');
  assert.match(taskListSource, /finalCountdownSeconds[\s\S]*展示倒计时/, 'completed task cards should keep the 3 second final countdown visible');
});

await runTest('image create panels keep succeeded job results in the active task before cleanup', () => {
  for (const relativePath of [
    'src/components/create/text-to-image.tsx',
    'src/components/create/image-to-image.tsx',
  ]) {
    const source = read(relativePath);
    assert.match(source, /applyCompletedImageResult/, `${relativePath} should centralize completed image result rendering`);
    assert.match(source, /previewCompletedImageResult/, `${relativePath} should normalize completed media for active task preview`);
    assert.match(source, /status\.status === 'succeeded'[\s\S]*completedResult: previewCompletedImageResult\(status\.result as ImageGenerationResult \| undefined\)/, `${relativePath} should put succeeded polling results into the active task card`);
    assert.match(source, /removeActiveTaskByIds/, `${relativePath} should remove completed task cards by every known identity`);
    assert.doesNotMatch(source, /status\.status === 'succeeded'[\s\S]{0,400}removeActiveTaskByIds\(taskId, statusJobId, status\.id, getGenerationJobClientRequestId\(status\)\)/, `${relativePath} should not clear the active task as soon as polling observes success`);
    assert.match(source, /completedResult: previewCompletedImageResult\(data\)[\s\S]*runGenerationFinalCountdown[\s\S]*applyCompletedImageResult\(data\)[\s\S]*removeActiveTaskByIds\(taskId/, `${relativePath} should show the result in-place, run the final countdown, then move it into the results area`);
    assert.match(source, /filter\(url => !prev\.includes\(url\)\)/, `${relativePath} should keep status and final promise paths deduped`);
  }
});

await runTest('video create panels keep completed videos in the active task before cleanup', () => {
  for (const relativePath of [
    'src/components/create/text-to-video.tsx',
    'src/components/create/image-to-video.tsx',
  ]) {
    const source = read(relativePath);
    assert.match(source, /previewCompletedVideoResult/, `${relativePath} should normalize completed videos for active task preview`);
    assert.match(source, /status\.status === 'succeeded'[\s\S]*completedResult: previewCompletedVideoResult\(status\.result as VideoGenerationResult \| undefined\)/, `${relativePath} should put succeeded polling results into the active task card`);
    assert.match(source, /completedResult: previewCompletedVideoResult\(data\)[\s\S]*runGenerationFinalCountdown[\s\S]*applyCompletedVideoResult\(data\)[\s\S]*removeActiveTaskByIds\(taskId\)/, `${relativePath} should show the video in-place, run the final countdown, then move it into the results area`);
  }
});

await runTest('create page is served dynamically so stale generated state code is not cached for a year', () => {
  const pageSource = read('src/app/create/page.tsx');
  const clientSource = read('src/components/create/create-page-client.tsx');
  const proxySource = read('src/proxy.ts');

  assert.doesNotMatch(pageSource, /'use client'/);
  assert.match(pageSource, /export const dynamic\s*=\s*'force-dynamic'/);
  assert.match(pageSource, /export const revalidate\s*=\s*0/);
  assert.match(pageSource, /export const fetchCache\s*=\s*'force-no-store'/);
  assert.match(clientSource, /'use client'/);
  assert.match(clientSource, /export function CreatePageClient/);
  assert.match(proxySource, /path === '\/create' \|\| path === '\/create\/'/);
  assert.match(proxySource, /Cache-Control', 'no-store, max-age=0, must-revalidate'/);
});

await runTest('image create panels reconcile active task cards from persisted history records', () => {
  for (const relativePath of [
    'src/components/create/text-to-image.tsx',
    'src/components/create/image-to-image.tsx',
  ]) {
    const source = read(relativePath);
    assert.match(source, /function getHistoryRecordClientRequestId/, `${relativePath} should read clientRequestId from history params`);
    assert.match(source, /useEffect\(\(\) => \{[\s\S]*recordsByClientRequestId[\s\S]*activeTasks[\s\S]*completedResult: previewCompletedImageResult\(matchedResult\)[\s\S]*runGenerationFinalCountdown[\s\S]*removeActiveTaskByIds[\s\S]*\}, \[[^\]]*records[^\]]*activeTasks/s, `${relativePath} should show persisted history results in the active task card before cleanup`);
    assert.match(source, /images: \[matchedRecord\.url\]/, `${relativePath} should render the persisted history result in the current result area`);
  }
});

await runTest('recovery processes terminal jobs even when the task is already active locally', () => {
  const source = read('src/components/create/use-generation-job-recovery.ts');
  assert.match(source, /const isKnownJob = identityIds\.some\(id => activeJobIdsRef\.current\.has\(id\) \|\| knownJobIdsRef\.current\.has\(id\)\);/);
  assert.match(source, /if \(isKnownJob && !isTerminalGenerationJobStatus\(job\.status\)\) continue;/);
  assert.match(source, /if \(isTerminalGenerationJobStatus\(job\.status\)\) \{[\s\S]*onTaskFinishedRef\.current\(task\.id, job\);[\s\S]*continue;/);
});

await runTest('image panels remove recovered terminal tasks by client request id', () => {
  for (const relativePath of [
    'src/components/create/text-to-image.tsx',
    'src/components/create/image-to-image.tsx',
  ]) {
    const source = read(relativePath);
    assert.match(source, /function getGenerationJobClientRequestId/, `${relativePath} should normalize clientRequestId from recovered job payload`);
    assert.match(source, /onTaskFinished: \(taskId, job\) => \{[\s\S]*previewAndFinalizeCompletedImageTask\(taskId, job\.result as ImageGenerationResult \| undefined, \[job\.jobId, job\.id, getGenerationJobClientRequestId\(job\)\]\)/, `${relativePath} should preview recovered terminal tasks before clearing them by clientRequestId`);
  }
});

await runTest('image panels reconcile terminal active task cards from job status polling', () => {
  const helperSource = read('src/components/create/use-active-generation-task-status-reconciliation.ts');
  assert.match(helperSource, /fetchGenerationJobStatus/);
  assert.match(helperSource, /isTerminalGenerationJobStatus/);
  assert.match(helperSource, /task\.clientRequestId/);
  assert.match(helperSource, /getGenerationJobClientRequestIdRef\.current\(status\)/);
  assert.match(helperSource, /extractCompletedResultFromGenerationJob/);
  assert.match(helperSource, /const nextTask: ActiveGenerationTask = \{[\s\S]*\.\.\.task,[\s\S]*jobStatus: status,[\s\S]*jobId: statusJobId,[\s\S]*completedResult:[\s\S]*finalCountdownSeconds:/);
  assert.match(helperSource, /status\.status === 'succeeded'[\s\S]*updateActiveTask\(task\.id,[\s\S]*completedResult:[\s\S]*finalCountdownSeconds:[\s\S]*onTaskSucceededRef\.current\(nextTask, status\)/);
  assert.match(helperSource, /status\.status === 'succeeded'[\s\S]*onTaskSucceededRef\.current\(nextTask, status\);[\s\S]*return;/, 'succeeded polling should render returned media before delegating cleanup to the panel callback');
  assert.match(helperSource, /onTaskSucceededRef\.current\(nextTask, status\)/);
  assert.match(helperSource, /window\.setInterval/);

  for (const relativePath of [
    'src/components/create/text-to-image.tsx',
    'src/components/create/image-to-image.tsx',
  ]) {
    const source = read(relativePath);
    assert.match(source, /useActiveGenerationTaskStatusReconciliation/);
    assert.match(source, /activeTasks,[\s\S]*updateActiveTask,[\s\S]*removeActiveTaskByIds,[\s\S]*getGenerationJobClientRequestId/);
    assert.match(source, /onTaskSucceeded: \(_task, job\) => \{[\s\S]*previewAndFinalizeCompletedImageTask\(_task\.id, job\.result as ImageGenerationResult \| undefined, \[_task\.jobId, _task\.clientRequestId, job\.jobId, job\.id, getGenerationJobClientRequestId\(job\)\]\)/);
  }
});

await runTest('generation job status preserves lightweight client request identity after payload cleanup', () => {
  const listRouteSource = read('src/app/api/generation-jobs/route.ts');
  const detailRouteSource = read('src/app/api/generation-jobs/[id]/route.ts');
  const workerSource = read('src/lib/generation-job-worker.ts');
  const clientSource = read('src/lib/generation-job-client.ts');

  assert.match(listRouteSource, /buildInitialGenerationProgress\(estimate\)[\s\S]*clientRequestId/, 'queued generation jobs should copy clientRequestId into progress');
  assert.match(workerSource, /jsonb_strip_nulls\(jsonb_build_object\([\s\S]*'clientRequestId', NULLIF\(j\.payload->>'clientRequestId', ''\)/, 'running generation jobs should retain clientRequestId in progress before payload cleanup');
  assert.match(detailRouteSource, /function getProgressClientRequestId/, 'status detail should read clientRequestId from progress');
  assert.match(detailRouteSource, /payload: \{ clientRequestId \}/, 'status detail should expose only the lightweight clientRequestId payload');
  assert.match(clientSource, /getGenerationJobStatusClientRequestId/, 'browser recovery should consider clientRequestId from status progress');
  assert.match(clientSource, /const clientRequestId = pending\.clientRequestId \|\| getGenerationJobStatusClientRequestId\(status\)/, 'browser recovery should prefer the tab-local pending clientRequestId');
});

await runTest('active task reconciliation can recover completed jobs by client request id when job id binding was lost', () => {
  const listRouteSource = read('src/app/api/generation-jobs/route.ts');
  const clientSource = read('src/lib/generation-job-client.ts');
  const helperSource = read('src/components/create/use-active-generation-task-status-reconciliation.ts');

  assert.match(listRouteSource, /const CLIENT_REQUEST_JOB_STATUSES = new Set\(\['queued', 'running', 'succeeded', 'failed', 'cancelled'\]\)/);
  assert.match(listRouteSource, /parseClientRequestIdFilter/);
  assert.match(listRouteSource, /clientRequestIdClause/);
  assert.match(listRouteSource, /payload->>'clientRequestId' = \$\d+[\s\S]*OR progress->>'clientRequestId' = \$\d+/);
  assert.match(clientSource, /fetchGenerationJobByClientRequestId/);
  assert.match(clientSource, /const normalizedClientRequestId = clientRequestId\.trim\(\);/);
  assert.match(clientSource, /params\.set\('clientRequestId', normalizedClientRequestId\)/);
  assert.match(clientSource, /status', 'queued,running,succeeded,failed,cancelled'/);
  assert.match(helperSource, /fetchGenerationJobByClientRequestId/);
  assert.match(helperSource, /const taskClientRequestId = task\.clientRequestId \|\| task\.id;/);
  assert.match(helperSource, /const jobId = task\.jobId \|\| '';/);
  assert.match(helperSource, /fetchGenerationJobStatus\(jobId\)/);
  assert.match(helperSource, /fetchGenerationJobByClientRequestId\(taskClientRequestId, typesRef\.current\)/);
});

await runTest('generation job status APIs and polling bypass stale route cache', () => {
  const listRouteSource = read('src/app/api/generation-jobs/route.ts');
  const detailRouteSource = read('src/app/api/generation-jobs/[id]/route.ts');
  const clientSource = read('src/lib/generation-job-client.ts');
  const helperSource = read('src/components/create/use-active-generation-task-status-reconciliation.ts');

  for (const source of [listRouteSource, detailRouteSource]) {
    assert.match(source, /export const dynamic\s*=\s*'force-dynamic'/);
    assert.match(source, /export const revalidate\s*=\s*0/);
    assert.match(source, /export const fetchCache\s*=\s*'force-no-store'/);
  }
  assert.match(clientSource, /clientRequestStatus = await fetchGenerationJobByClientRequestId/);
  assert.match(clientSource, /!isTerminalGenerationJobStatus\(statusData\.status\) && options\.clientRequestId/);
  assert.match(clientSource, /!isTerminalGenerationJobStatus\(status\.status\) && pending\.clientRequestId/);
  assert.match(clientSource, /clientRequestId: typeof payload\.clientRequestId === 'string'/);
  assert.match(helperSource, /!isTerminalGenerationJobStatus\(status\.status\) && taskClientRequestId/);
  assert.match(helperSource, /clientRequestStatus && isTerminalGenerationJobStatus\(clientRequestStatus\.status\)/);
});

await runTest('manifest polling returns as soon as upstream success includes media urls', () => {
  const source = read('src/lib/user-api-manifest-executor.ts');
  assert.match(source, /const hasMedia = media\.images\.length > 0 \|\| media\.videos\.length > 0;/);
  assert.match(source, /if \(isSuccess && hasMedia\) \{[\s\S]*return \{ raw, \.\.\.media \};[\s\S]*\}/);
  assert.match(source, /if \(isSuccess && !hasMedia\) \{[\s\S]*notifyManifestProgress\(input, \{[\s\S]*message: '上游已完成，正在等待结果地址'[\s\S]*\}\);[\s\S]*\}/);
});

await runTest('create panels block duplicate in-flight submissions before creating another job', () => {
  for (const relativePath of [
    'src/components/create/text-to-image.tsx',
    'src/components/create/image-to-image.tsx',
    'src/components/create/text-to-video.tsx',
    'src/components/create/image-to-video.tsx',
  ]) {
    const source = read(relativePath);
    assert.match(source, /activeSubmissionSignaturesRef = useRef\(new Set<string>\(\)\)/, `${relativePath} should keep in-flight submission signatures`);
    assert.match(source, /activeSubmissionSignaturesRef\.current\.has\(submissionSignature\)/, `${relativePath} should check an in-flight duplicate signature`);
    assert.match(source, /activeSubmissionSignaturesRef\.current\.add\(submissionSignature\)/, `${relativePath} should mark the signature before creating the job`);
    assert.match(source, /activeSubmissionSignaturesRef\.current\.delete\(submissionSignature\)/, `${relativePath} should clear the signature after the job settles`);
    assert.match(source, /相同任务正在生成中，请勿重复提交/, `${relativePath} should explain duplicate submit prevention`);
  }
});

await runTest('create panels do not label active generation as another submit action', () => {
  for (const relativePath of [
    'src/components/create/text-to-image.tsx',
    'src/components/create/image-to-image.tsx',
    'src/components/create/text-to-video.tsx',
    'src/components/create/image-to-video.tsx',
    'src/components/create/mobile-creation-composer.tsx',
  ]) {
    const source = read(relativePath);
    assert.doesNotMatch(source, /继续提交任务/, `${relativePath} should not invite duplicate submits while a task is running`);
  }
});

await runTest('generation job client builds auth headers from the shared client auth helper', () => {
  const source = read('src/lib/generation-job-client.ts');
  for (const helper of [
    'getClientAuthHeaders',
    'getClientAuthToken',
    'getClientAuthUserId',
    'getRequiredClientAuthToken',
    'handleClientAuthFailure',
  ]) {
    assert.match(source, new RegExp(`\\b${helper}\\b`));
  }
  assert.match(source, /const authToken = getRequiredClientAuthToken\(\);/);
  assert.match(source, /const authHeaders = getClientAuthHeaders\(authToken\);/);
  assert.match(source, /\.\.\.getClientAuthHeaders\(authToken\)/);
  assert.match(source, /handleClientAuthFailure\(createRes\.status,\s*createData\.error\)/);
  assert.match(source, /handleClientAuthFailure\(res\.status,\s*data\.error\)/);
  assert.doesNotMatch(source, /function getAuthToken\(/);
  assert.doesNotMatch(source, /function getAuthHeaders\(/);
  assert.doesNotMatch(source, /localStorage\.getItem\(['"]miaojing_auth['"]\)/);
});

if (process.exitCode) process.exit(process.exitCode);
