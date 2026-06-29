import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');

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

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

await runTest('model call records service owns schema and lifecycle helpers', () => {
  const source = read('src/lib/model-call-records.ts');
  assert.match(source, /CREATE TABLE IF NOT EXISTS model_call_records/);
  assert.match(source, /generation_job_id UUID REFERENCES generation_jobs\(id\) ON DELETE SET NULL/);
  assert.match(source, /model_call_records_generation_job_uidx/);
  assert.match(source, /export async function createModelCallRecord/);
  assert.match(source, /export async function updateModelCallRecordByJob/);
  assert.match(source, /export async function updateModelCallRecordById/);
  assert.match(source, /export function countModelCallResults/);
});

await runTest('create call record casts status parameter consistently for PostgreSQL', () => {
  const source = read('src/lib/model-call-records.ts');
  assert.match(source, /\$11::varchar\(16\)/);
  assert.match(source, /CASE WHEN \$11::varchar\(16\) = 'running' THEN NOW\(\) ELSE NULL END/);
  assert.doesNotMatch(source, /CASE WHEN \$11 = 'running'/);
});

await runTest('generation jobs create queued call records and preserve config ids', () => {
  const source = read('src/app/api/generation-jobs/route.ts');
  assert.match(source, /createModelCallRecord/);
  assert.match(source, /getModelCallConfigRefs\(payload\)/);
  assert.match(source, /generationJobId: jobId/);
  assert.match(source, /source: 'generation-job'/);
  assert.match(source, /status: 'queued'/);
});

await runTest('worker updates model call records for running success failure and stale jobs', () => {
  const source = read('src/lib/generation-job-worker.ts');
  assert.match(source, /ensureRunningModelCallRecord/);
  assert.match(source, /updateModelCallRecordByJob\(client, jobId/);
  assert.match(source, /markModelCallRecordsForJobs/);
  assert.match(source, /countModelCallResults\(job\.type, finalResult\)/);
  assert.match(source, /creditsCost: creditChargeResult\?\.creditsCost \|\| 0/);
  assert.match(source, /status: 'failed'/);
});

await runTest('cancel and detail timeout paths update model call records', () => {
  const source = read('src/app/api/generation-jobs/[id]/route.ts');
  assert.match(source, /markModelCallRecordsForJobs/);
  assert.match(source, /updateModelCallRecordByJob\(client, id/);
  assert.match(source, /status: 'cancelled'/);
  assert.match(source, /任务执行超时或被服务重启中断/);
});

await runTest('generation job detail GET never marks model call records cancelled', () => {
  const source = read('src/app/api/generation-jobs/[id]/route.ts');
  const getStart = source.indexOf('export async function GET');
  const patchStart = source.indexOf('export async function PATCH');
  assert.ok(getStart > -1 && patchStart > getStart, 'expected GET before PATCH in generation job detail route');
  const getBlock = source.slice(getStart, patchStart);
  const patchBlock = source.slice(patchStart);

  assert.doesNotMatch(getBlock, /updateModelCallRecordByJob\(client, id,[\s\S]*status: 'cancelled'/);
  assert.match(getBlock, /markModelCallRecordsForJobs/);
  assert.match(patchBlock, /updateModelCallRecordByJob\(client, id,[\s\S]*status: 'cancelled'/);
});

await runTest('suggest prompt writes standalone model call records', () => {
  const source = read('src/app/api/generate/suggest-prompt/route.ts');
  assert.match(source, /createModelCallRecordStandalone/);
  assert.match(source, /source: 'suggest-prompt'/);
  assert.match(source, /operation: agnesPromptTarget \? 'agnes-prompt-optimization' : 'suggest-prompt'/);
  assert.match(source, /updateModelCallRecordById\(modelCallRecordId/);
  assert.match(source, /targetGenerationModel/);
});

await runTest('admin API and console expose model call records without secrets', () => {
  const route = read('src/app/api/admin/model-call-records/route.ts');
  assert.match(route, /requireAdmin\(request\)/);
  assert.match(route, /ensureModelCallRecordSchema/);
  assert.match(route, /maskApiUrl/);
  assert.match(route, /FROM model_call_records r/);
  assert.doesNotMatch(route, /api_key_encrypted/i);
  assert.doesNotMatch(route, /\bapiKey\b/);

  const consolePage = read('src/modules/console/pages/console-dashboard-page.tsx');
  assert.match(consolePage, /ModelCallRecordsTab/);
  assert.match(consolePage, /modelCalls/);
  assert.match(consolePage, /模型调用/);

  const component = read('src/components/admin/model-call-records-tab.tsx');
  assert.match(component, /\/api\/admin\/model-call-records/);
  assert.match(component, /不展示 payload、API Key 或用户提示词原文/);
  assert.doesNotMatch(component, /apiKey/);
});

await runTest('database init and cold upgrade scripts create model call records table', () => {
  for (const file of ['scripts/init-database.sql', 'scripts/deploy-or-upgrade.sh']) {
    const source = read(file);
    assert.match(source, /CREATE TABLE IF NOT EXISTS model_call_records/);
    assert.match(source, /model_call_records_user_created_idx/);
    assert.match(source, /model_call_records_model_created_idx/);
    assert.match(source, /model_call_records_custom_api_idx/);
  }
});

await runTest('server api config keeps selected config ids for audit records', () => {
  const source = read('src/lib/server-api-config.ts');
  assert.match(source, /customApiKeyId: input\.customApiKeyId/);
  assert.match(source, /systemApiId: input\.systemApiId/);
});
