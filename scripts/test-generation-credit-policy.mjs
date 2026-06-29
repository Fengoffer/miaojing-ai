import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const {
  chargeGenerationCredits,
  ensureGenerationCreditsAvailable,
  resolveGenerationCreditCost,
} = await import('../src/lib/generation-credit-service.ts');

const repoRoot = path.resolve(import.meta.dirname, '..');
const SYSTEM_API_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';

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

function createFakeClient({ apiRow, creditsBalance = 100, pendingJobs = [] } = {}) {
  const calls = [];
  const client = {
    calls,
    async query(sql, params = []) {
      const text = String(sql);
      calls.push({ sql: text, params });
      if (text.includes('FROM generation_jobs')) {
        return { rows: pendingJobs };
      }
      if (text.includes('FROM system_api_configs')) {
        return { rows: apiRow ? [apiRow] : [] };
      }
      if (text.includes('SELECT credits_balance FROM profiles') && text.includes('FOR UPDATE')) {
        return { rows: [{ credits_balance: creditsBalance }] };
      }
      if (text.includes('SELECT credits_balance FROM profiles')) {
        return { rows: [{ credits_balance: creditsBalance }] };
      }
      if (text.includes('UPDATE profiles SET credits_balance')) {
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('INSERT INTO credit_transactions')) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  return client;
}

await runTest('calculates fixed system image credits from backend system_api_configs pricing', async () => {
  const client = createFakeClient({
    apiRow: {
      id: SYSTEM_API_ID,
      provider: 'mozheAPI',
      name: 'gpt-image-2（主）',
      model_name: 'gpt-image-2',
      type: 'image',
      credits_per_use: 3,
      billing_mode: 'fixed',
      fixed_price: '3.0000',
    },
  });

  const cost = await resolveGenerationCreditCost(client, {
    type: 'image',
    payload: { customApiConfig: { systemApiId: SYSTEM_API_ID } },
    result: { images: ['a', 'b'] },
  });

  assert.equal(cost?.creditsCost, 6);
  assert.equal(cost?.description, '图片生成 - gpt-image-2（主）（mozheAPI）');
});

await runTest('calculates duration video credits from backend system_api_configs pricing', async () => {
  const client = createFakeClient({
    apiRow: {
      id: SYSTEM_API_ID,
      provider: 'VideoAPI',
      name: '视频模型',
      model_name: 'video-model',
      type: 'video',
      credits_per_use: 0,
      billing_mode: 'duration',
      fixed_price: '0',
      duration_price_per_second: '2.5',
    },
  });

  const cost = await resolveGenerationCreditCost(client, {
    type: 'video',
    payload: { duration: '6', customApiConfig: { systemApiId: SYSTEM_API_ID } },
    result: { videos: ['v'] },
  });

  assert.equal(cost?.creditsCost, 15);
  assert.equal(cost?.description, '视频生成 - 视频模型（VideoAPI）');
});

await runTest('does not charge user custom or platform SDK generation without systemApiId', async () => {
  const client = createFakeClient();

  const charge = await chargeGenerationCredits(client, {
    userId: USER_ID,
    type: 'image',
    payload: { customApiConfig: { customApiKeyId: '33333333-3333-3333-3333-333333333333' } },
    result: { images: ['a'] },
  });

  assert.equal(charge, null);
  assert.equal(client.calls.some(call => call.sql.includes('UPDATE profiles SET credits_balance')), false);
  assert.equal(client.calls.some(call => call.sql.includes('INSERT INTO credit_transactions')), false);
});

await runTest('blocks queued system generation before running when credits are insufficient', async () => {
  const client = createFakeClient({
    creditsBalance: 2,
    apiRow: {
      id: SYSTEM_API_ID,
      provider: 'mozheAPI',
      name: 'gpt-image-2（主）',
      model_name: 'gpt-image-2',
      type: 'image',
      credits_per_use: 3,
      billing_mode: 'fixed',
      fixed_price: '3.0000',
    },
  });

  await assert.rejects(
    () => ensureGenerationCreditsAvailable(client, USER_ID, {
      type: 'image',
      payload: { count: 1, customApiConfig: { systemApiId: SYSTEM_API_ID } },
    }),
    /积分不足/,
  );
});

await runTest('final credit charge fails instead of truncating an insufficient balance', async () => {
  const client = createFakeClient({
    creditsBalance: 2,
    apiRow: {
      id: SYSTEM_API_ID,
      provider: 'mozheAPI',
      name: 'gpt-image-2（主）',
      model_name: 'gpt-image-2',
      type: 'image',
      credits_per_use: 3,
      billing_mode: 'fixed',
      fixed_price: '3.0000',
    },
  });

  await assert.rejects(
    () => chargeGenerationCredits(client, {
      userId: USER_ID,
      type: 'image',
      payload: { count: 1, customApiConfig: { systemApiId: SYSTEM_API_ID } },
      result: { images: ['a'] },
    }),
    /积分不足/,
  );
  assert.equal(client.calls.some(call => call.sql.includes('UPDATE profiles SET credits_balance')), false);
  assert.equal(client.calls.some(call => call.sql.includes('INSERT INTO credit_transactions')), false);
});

await runTest('counts queued and running system generation cost before accepting a new job', async () => {
  const apiRow = {
    id: SYSTEM_API_ID,
    provider: 'mozheAPI',
    name: 'gpt-image-2（主）',
    model_name: 'gpt-image-2',
    type: 'image',
    credits_per_use: 3,
    billing_mode: 'fixed',
    fixed_price: '3.0000',
  };
  const client = createFakeClient({
    creditsBalance: 5,
    apiRow,
    pendingJobs: [
      {
        type: 'image',
        payload: {
          prompt: 'pending image',
          count: 1,
          customApiConfig: { systemApiId: SYSTEM_API_ID },
        },
      },
    ],
  });

  await assert.rejects(
    () => ensureGenerationCreditsAvailable(client, USER_ID, {
      type: 'image',
      payload: {
        prompt: 'new image',
        count: 1,
        customApiConfig: { systemApiId: SYSTEM_API_ID },
      },
    }),
    /积分不足/,
  );
});

await runTest('job creation keeps credit preflight and insertion in one database transaction', () => {
  const source = read('src/app/api/generation-jobs/route.ts');
  const begin = source.indexOf("await client.query('BEGIN')");
  const preflight = source.indexOf('await ensureGenerationCreditsAvailable');
  const insert = source.indexOf('INSERT INTO generation_jobs');
  const commit = source.lastIndexOf("await client.query('COMMIT')");
  const rollback = source.indexOf("await client.query('ROLLBACK')");

  assert.ok(begin > -1, 'job creation should start a transaction');
  assert.ok(preflight > begin, 'credit preflight should run inside the transaction');
  assert.ok(insert > preflight, 'job insertion should happen after credit preflight');
  assert.ok(commit > insert, 'job creation should commit after insertion');
  assert.ok(rollback > -1, 'job creation should rollback failed transactions');
});

await runTest('worker charges credits only after upstream generation returns a successful result', () => {
  const source = read('src/lib/generation-job-worker.ts');
  const successPath = source.indexOf('const result = await runGenerationPayload');
  const chargePath = source.indexOf('const creditCharge = await settleJobCredits');
  const failurePath = source.indexOf("status: 'failed'", chargePath);

  assert.ok(successPath > -1, 'worker should call upstream generation');
  assert.ok(chargePath > successPath, 'credit charge must happen after successful upstream result');
  assert.ok(failurePath > chargePath, 'failure handler must be outside the success charge path');
});

await runTest('worker keeps generated job result visible when creation history persistence fails', () => {
  const source = read('src/lib/generation-job-worker.ts');
  assert.match(source, /refundGenerationCredits/);
  assert.match(source, /refundSettledGenerationCredits/);
  assert.match(source, /historyPersistenceStatus:\s*'failed'/);
  assert.match(source, /generation_history_persistence_failed/);

  const chargePath = source.indexOf('const creditCharge = await settleJobCredits');
  const historyPath = source.indexOf('await persistGenerationHistoryRecord');
  const refundPath = source.indexOf('await refundSettledGenerationCredits');
  const updateJobPath = source.indexOf('await updateJob(job.id', chargePath);
  const successPath = source.indexOf("status: 'succeeded'", updateJobPath);
  assert.ok(chargePath > -1, 'worker should still charge only after upstream success');
  assert.ok(updateJobPath > chargePath, 'job update should happen after charge');
  assert.ok(successPath > chargePath, 'job success should happen after charge');
  assert.ok(historyPath > successPath, 'history persistence should run after the job result is visible');
  assert.ok(refundPath > chargePath, 'worker should compensate a settled credit charge on later failure');
});

await runTest('video panels use backend returned creditsCost and creditsBalance instead of local predicted deduction', () => {
  for (const relativePath of [
    'src/components/create/text-to-video.tsx',
    'src/components/create/image-to-video.tsx',
  ]) {
    const source = read(relativePath);
    assert.match(source, /creditsCost\?: number;[\s\S]*creditsBalance\?: number/, relativePath);
    assert.match(source, /const creditsCost = Math\.max\(0, Number\(data\.creditsCost \|\| 0\)\)/, relativePath);
    assert.match(source, /updateProfile\(\{ creditsBalance: result\.creditsBalance \}\)/, relativePath);
    assert.doesNotMatch(source, /addCreditRecord\(/, relativePath);
    assert.doesNotMatch(source, /balanceAfter: Math\.max\(0, currentCredits - credits\)/, relativePath);
  }
});

if (process.exitCode) process.exit(process.exitCode);
