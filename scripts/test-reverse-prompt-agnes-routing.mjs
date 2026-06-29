import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = path => readFileSync(join(root, path), 'utf8');

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

const reversePanel = read('src/components/create/reverse-prompt-panel.tsx');
const reverseRoute = read('src/app/api/generate/reverse-prompt/route.ts');
const generationJobsRoute = read('src/app/api/generation-jobs/route.ts');
const customApiFetch = read('src/lib/custom-api-fetch.ts');

await runTest('reverse-prompt panel does not expose model choices or send model config', () => {
  assert.doesNotMatch(reversePanel, /useManagedSystemApis/);
  assert.doesNotMatch(reversePanel, /useCustomApiKeys/);
  assert.doesNotMatch(reversePanel, /selectedModelId/);
  assert.doesNotMatch(reversePanel, /selectedConfig/);
  assert.doesNotMatch(reversePanel, /反推模型/);
  assert.doesNotMatch(reversePanel, /customApiConfig:\s*selectedConfig/);
  assert.match(reversePanel, /disabled=\{loading \|\| !hasInput\}/);
});

await runTest('reverse-prompt API always resolves the system gpt-5.5 model', () => {
  assert.match(reverseRoute, /resolveSystemTextApiByModelName/);
  assert.match(reverseRoute, /REVERSE_PROMPT_SYSTEM_MODEL\s*=\s*'gpt-5\.5'/);
  assert.match(reverseRoute, /REVERSE_PROMPT_REASONING_EFFORT\s*=\s*'XHigh'/);
  assert.match(reverseRoute, /REVERSE_PROMPT_RESPONSES_REASONING_EFFORT\s*=\s*'xhigh'/);
  assert.match(reverseRoute, /resolveSystemTextApiByModelName\(\s*request,\s*REVERSE_PROMPT_SYSTEM_MODEL/);
  assert.match(reverseRoute, /buildReversePromptResponsesBody/);
  assert.match(reverseRoute, /resolveResponsesApiUrl/);
  assert.match(reverseRoute, /stream:\s*true/);
  assert.match(reverseRoute, /reasoning:\s*\{\s*effort:\s*REVERSE_PROMPT_RESPONSES_REASONING_EFFORT\s*\}/);
  assert.doesNotMatch(reverseRoute, /reasoning:\s*\{\s*effort:\s*REVERSE_PROMPT_REASONING_EFFORT\s*\}/);
  assert.doesNotMatch(reverseRoute, /reasoning_effort:\s*REVERSE_PROMPT_REASONING_EFFORT/);
  assert.match(reverseRoute, /type:\s*'input_image'/);
  assert.match(reverseRoute, /image_url:\s*upstreamImage/);
  assert.match(reverseRoute, /readResponsesStreamText/);
  assert.match(reverseRoute, /readStreamChunkWithTimeout/);
  assert.match(reverseRoute, /REVERSE_PROMPT_TOTAL_TIMEOUT\s*=\s*120_000/);
  assert.match(reverseRoute, /反推提示词上游响应超时/);
  assert.doesNotMatch(reverseRoute, /resolveServerApiConfig/);
  assert.doesNotMatch(reverseRoute, /customApiConfig/);
  assert.doesNotMatch(reverseRoute, /AGNES_PROMPT_OPTIMIZER_MODEL/);
  assert.doesNotMatch(reverseRoute, /GATEWAY_FALLBACK_STATUSES/);
  assert.doesNotMatch(reverseRoute, /fallback/i);
});

await runTest('generation job queue does not rewrite reverse-prompt jobs to Agnes', () => {
  assert.match(generationJobsRoute, /type === 'reverse-prompt'/);
  assert.doesNotMatch(generationJobsRoute, /normalizeReversePromptPayloadForAgnes/);
  assert.doesNotMatch(generationJobsRoute, /shouldPreferAgnesReversePrompt/);
  assert.doesNotMatch(generationJobsRoute, /AGNES_PROMPT_OPTIMIZER_MODEL/);
});

await runTest('reverse prompt no longer uses synchronous chat completions for the fixed system model', () => {
  assert.doesNotMatch(reverseRoute, /buildReversePromptChatBody/);
  assert.doesNotMatch(reverseRoute, /stream:\s*false/);
  assert.doesNotMatch(reverseRoute, /chat\/completions/);
});

await runTest('reverse-prompt panel surfaces failed jobs instead of waiting for the long recovery window', () => {
  const recoveryHook = read('src/components/create/use-generation-job-recovery.ts');
  assert.match(reversePanel, /generationError/);
  assert.match(reversePanel, /setGenerationError\(error \|\| '生成提示词失败'\)/);
  assert.match(reversePanel, /反推提示词暂时失败/);
  assert.match(reversePanel, /REVERSE_PROMPT_JOB_TIMEOUT_MS\s*=\s*150_000/);
  assert.match(reversePanel, /timeoutMs:\s*REVERSE_PROMPT_JOB_TIMEOUT_MS/);
  assert.match(reversePanel, /setGenerationError\('反推提示词仍在后台执行，稍后会自动同步结果。'\)/);
  assert.match(reversePanel, /setLoading\(false\)/);
  assert.match(recoveryHook, /getRecoveryPollingTimeoutMs/);
  assert.match(recoveryHook, /type === 'reverse-prompt'\) return 150_000/);
  assert.match(recoveryHook, /window\.setInterval\(\(\) => \{\s*void recover\(\);\s*\}, 5000\)/);
  assert.doesNotMatch(reversePanel, /timeoutMs:\s*300_000/);
  assert.doesNotMatch(recoveryHook, /job\.type === 'reverse-prompt' \? 300_000/);
});

await runTest('multimodal 524 message stays specific to upstream multimodal timeout', () => {
  assert.match(customApiFetch, /上游多模态模型网关超时（Cloudflare 524）/);
  assert.match(customApiFetch, /支持图片输入的多模态\/Responses 接口/);
});
