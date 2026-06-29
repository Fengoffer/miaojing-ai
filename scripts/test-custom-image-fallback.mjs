import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const {
  parseCustomApiError,
} = await import('../src/lib/custom-api-fetch.ts');
const {
  openAICompatibleImageTemplate,
  normalizeOpenAICompatibleImageSize,
} = await import('../src/lib/image-api-templates/openai-compatible.ts');
const {
  buildSynchronousImageRequestBody,
  getSystemPollingFailureMessage,
  shouldRetryImageRequestWithoutStream,
  STREAM_UNSUPPORTED_SYNC_CONFIRM_PREFIX,
} = await import('../src/lib/custom-image-fallback.ts');

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

await runTest('detects stream timeout confirmation errors for synchronous fallback', () => {
  assert.equal(
    shouldRetryImageRequestWithoutStream(
      { model: 'gpt-image-2', prompt: 'test', stream: true },
      `${STREAM_UNSUPPORTED_SYNC_CONFIRM_PREFIX}上游流式生图没有持续返回数据`,
    ),
    true,
  );
  assert.equal(
    shouldRetryImageRequestWithoutStream(
      { model: 'gpt-image-2', prompt: 'test', stream: false },
      `${STREAM_UNSUPPORTED_SYNC_CONFIRM_PREFIX}上游流式生图没有持续返回数据`,
    ),
    false,
  );
});

await runTest('builds a synchronous retry body without mutating the original request', () => {
  const original = { model: 'gpt-image-2', prompt: 'test', n: 1, stream: true };
  const next = buildSynchronousImageRequestBody(original);

  assert.deepEqual(next, { model: 'gpt-image-2', prompt: 'test', n: 1, stream: false });
  assert.equal(original.stream, true);
});

await runTest('system polling exposes actionable upstream errors instead of generic busy message', () => {
  assert.equal(
    getSystemPollingFailureMessage('上游 API 同步生图请求超时（Cloudflare 524）。请降低分辨率后重试。'),
    '上游 API 同步生图请求超时（Cloudflare 524）。请降低分辨率后重试。',
  );
  assert.equal(
    getSystemPollingFailureMessage(`${STREAM_UNSUPPORTED_SYNC_CONFIRM_PREFIX}上游流式生图没有持续返回数据`),
    '上游流式生图没有持续返回数据',
  );
  assert.equal(
    getSystemPollingFailureMessage(''),
    '因使用人数较多，模型繁忙，请稍后再试',
  );
});

await runTest('Cloudflare gateway errors are shown as concise retryable upstream messages', () => {
  const message = parseCustomApiError(502, '<!DOCTYPE html><title>mozhevip.top | 502: Bad gateway</title>');

  assert.equal(message.includes('<!DOCTYPE html>'), false);
  assert.match(message, /上游网关/);
  assert.match(message, /502/);
});

await runTest('non-official gpt-image endpoints preserve custom sizes but align dimensions to multiples of 16', () => {
  assert.equal(
    normalizeOpenAICompatibleImageSize('gpt-image-2', '1920x1080', { apiUrl: 'https://relay.example.com/v1/images/generations' }),
    '1920x1088',
  );
  assert.equal(
    normalizeOpenAICompatibleImageSize('gpt-image-2', '1080x1920', { apiUrl: 'https://relay.example.com/v1/images/generations' }),
    '1088x1920',
  );
  assert.equal(
    normalizeOpenAICompatibleImageSize('gpt-image-2', '2560x1440', { apiUrl: 'https://relay.example.com/v1/images/generations' }),
    '2560x1440',
  );
});

await runTest('mozhe gpt-image relay uses bounded official sizes to avoid Cloudflare 524 timeouts', () => {
  assert.equal(
    normalizeOpenAICompatibleImageSize('gpt-image-2', '1920x1080', { apiUrl: 'https://openai.mozhevip.top/v1/images/generations' }),
    '1536x1024',
  );
  assert.equal(
    normalizeOpenAICompatibleImageSize('gpt-image-2', '1080x1920', { apiUrl: 'https://openai.mozhevip.top/v1/images/generations' }),
    '1024x1536',
  );
  assert.equal(
    normalizeOpenAICompatibleImageSize('gpt-image-2', '2560x1440', { apiUrl: 'https://openai.mozhevip.top/v1/images/generations' }),
    '1536x1024',
  );
  assert.equal(
    normalizeOpenAICompatibleImageSize('gpt-image-2', 'auto', { apiUrl: 'https://openai.mozhevip.top/v1/images/generations' }),
    '1024x1024',
  );
});

await runTest('mozhe gpt-image relay keeps streaming enabled while using bounded official sizes', () => {
  const commonInput = {
    apiUrl: 'https://openai.mozhevip.top/v1/images/generations',
    modelName: 'gpt-image-2',
    prompt: 'test',
    aspectRatio: '16:9',
    size: '1920x1080',
    count: 1,
    outputFormat: 'png',
    imageQuality: 'high',
    stream: true,
  };
  const textRequest = openAICompatibleImageTemplate.buildTextToImageRequest(commonInput);
  assert.equal(textRequest.requestSize, '1536x1024');
  assert.equal(textRequest.body.stream, true);

  const imageRequest = openAICompatibleImageTemplate.buildImageToImageRequest({
    ...commonInput,
    imageUrl: 'https://example.com/reference.png',
    imageUrls: ['https://example.com/reference.png'],
    base64Image: 'data:image/png;base64,abc',
    base64Images: ['data:image/png;base64,abc'],
    strength: 0.5,
  });
  assert.equal(imageRequest.requestSize, '1536x1024');
  assert.equal(imageRequest.editsFormData.fields.stream, 'true');
  assert.equal(imageRequest.chatJson.body.stream, true);
  assert.equal(imageRequest.generationJson.body.stream, true);
});

await runTest('text-to-image custom fetch enables one retry for 502 503 504 gateway failures', () => {
  const source = read('src/app/api/generate/image/route.ts');

  assert.match(
    source,
    /fetchWithRetry\(\s*endpoint,\s*\{ method: 'POST', headers: buildCustomApiHeaders\(apiKey\), body: JSON\.stringify\(requestBody\) \},\s*GENERATION_TIMEOUT,\s*1,\s*\)/s,
  );
});

await runTest('multimodal 524 errors do not reuse image-generation timeout wording', () => {
  const message = parseCustomApiError(524, '<!DOCTYPE html><title>mozhevip.top | 524: A timeout occurred</title>', 'multimodal');

  assert.match(message, /多模态模型同步请求超时/);
  assert.equal(message.includes('生图请求超时'), false);
});

if (process.exitCode) process.exit(process.exitCode);
