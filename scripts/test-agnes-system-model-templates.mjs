import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');

const {
  agnesImageTemplate,
  isAgnesImageApi,
  normalizeAgnesImageSize,
} = await import('../src/lib/image-api-templates/index.ts');

const {
  AGNES_BASE_URL,
  AGNES_PROVIDER_NAME,
  AGNES_IMAGE_MODEL_GROUP,
  AGNES_VIDEO_MODEL_GROUP,
  AGNES_TEXT_MODEL_GROUP,
  AGNES_IMAGE_MODEL_TEMPLATES,
  AGNES_VIDEO_MODEL_TEMPLATES,
  AGNES_TEXT_MODEL_TEMPLATES,
  AGNES_VIDEO_FRAME_RATE,
  normalizeAgnesVideoDuration,
  getAgnesVideoNumFrames,
  getAgnesModelCapabilities,
  buildAgnesImageManifestBundle,
  buildAgnesVideoManifestBundle,
  buildAgnesCapabilitiesText,
} = await import('../src/lib/agnes-model-templates.ts');

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

await runTest('Agnes templates cover documented image, video, and text models', () => {
  assert.equal(AGNES_BASE_URL, 'https://apihub.agnes-ai.com');
  assert.equal(AGNES_PROVIDER_NAME, 'Agnes AI');
  assert.equal(AGNES_IMAGE_MODEL_GROUP, 'agnes-image');
  assert.equal(AGNES_VIDEO_MODEL_GROUP, 'agnes-video');
  assert.equal(AGNES_TEXT_MODEL_GROUP, 'agnes-text');

  assert.deepEqual(AGNES_IMAGE_MODEL_TEMPLATES.map(item => item.modelName), [
    'agnes-image-2.1-flash',
    'agnes-image-2.0-flash',
  ]);
  assert.deepEqual(AGNES_VIDEO_MODEL_TEMPLATES.map(item => item.modelName), ['agnes-video-v2.0']);
  assert.deepEqual(AGNES_TEXT_MODEL_TEMPLATES.map(item => item.modelName), ['agnes-2.0-flash', 'agnes-1.5-flash']);
});

await runTest('Agnes image Manifest maps documented OpenAI-compatible image fields', () => {
  const template = AGNES_IMAGE_MODEL_TEMPLATES.find(item => item.modelName === 'agnes-image-2.1-flash');
  assert.ok(template, 'missing Agnes Image 2.1 Flash template');
  const bundle = buildAgnesImageManifestBundle(template);
  const provider = bundle.customProviders[0];
  const profile = bundle.profiles[0];

  assert.equal(profile.baseUrl, AGNES_BASE_URL);
  assert.equal(profile.apiMode, 'images');
  assert.equal(profile.capabilities?.supportsAspectRatio, false);
  assert.deepEqual(profile.capabilities?.resolutions?.map(item => item.value), [
    '1024x768',
    '1024x1024',
    '768x1024',
    '1152x768',
    '768x1152',
  ]);
  assert.equal(provider.submit?.path, 'v1/images/generations');
  assert.equal(provider.submit?.method, 'POST');
  assert.equal(provider.submit?.contentType, 'json');
  assert.equal(provider.submit?.body?.model, '$profile.model');
  assert.equal(provider.submit?.body?.prompt, '$prompt');
  assert.equal(provider.submit?.body?.size, '$params.size');
  assert.equal(provider.submit?.body?.image, undefined);
  assert.deepEqual(provider.submit?.body?.extra_body, { response_format: 'url', image: '$inputImages.urls' });
  assert.equal(provider.submit?.body?.response_format, undefined);
  assert.deepEqual(provider.submit?.result?.imageUrlPaths, ['data.*.url']);
  assert.deepEqual(provider.submit?.result?.b64JsonPaths, ['data.*.b64_json']);
});

await runTest('custom Agnes image APIs use Agnes request shape instead of generic OpenAI-compatible fields', () => {
  assert.equal(isAgnesImageApi({
    provider: 'Agnes AI',
    apiUrl: `${AGNES_BASE_URL}/v1/images/generations`,
    modelName: 'agnes-image-2.1-flash',
  }), true);
  assert.equal(isAgnesImageApi({
    provider: 'OpenAI',
    apiUrl: 'https://api.openai.com/v1/images/generations',
    modelName: 'gpt-image-2',
  }), false);
  assert.equal(normalizeAgnesImageSize('1920x1080', '16:9'), '1152x768');
  assert.equal(normalizeAgnesImageSize('1080x1920', '9:16'), '768x1152');
  assert.equal(normalizeAgnesImageSize('1024x1024', '1:1'), '1024x1024');

  const request = agnesImageTemplate.buildTextToImageRequest({
    apiUrl: `${AGNES_BASE_URL}/v1/images/generations`,
    modelName: 'agnes-image-2.1-flash',
    prompt: 'A glass library at sunrise',
    negativePrompt: 'blurry',
    aspectRatio: '16:9',
    size: '1920x1080',
    count: 4,
    outputFormat: 'webp',
    imageQuality: 'high',
    guidanceScale: 12,
    stream: true,
  });

  assert.equal(request.endpoint, `${AGNES_BASE_URL}/v1/images/generations`);
  assert.equal(request.requestCount, 1);
  assert.equal(request.requestSize, '1152x768');
  assert.equal(request.body.model, 'agnes-image-2.1-flash');
  assert.match(String(request.body.prompt), /Negative prompt: blurry/);
  assert.equal(request.body.size, '1152x768');
  assert.deepEqual(request.body.extra_body, { response_format: 'url' });
  assert.equal(request.body.n, undefined);
  assert.equal(request.body.stream, undefined);
  assert.equal(request.body.response_format, undefined);
  assert.equal(request.body.output_format, undefined);
  assert.equal(request.body.quality, undefined);
  assert.equal(request.body.guidance_scale, undefined);
});

await runTest('custom Agnes image-to-image sends references through extra_body.image only', () => {
  const request = agnesImageTemplate.buildImageToImageRequest({
    apiUrl: `${AGNES_BASE_URL}/v1/images/generations`,
    modelName: 'agnes-image-2.0-flash',
    prompt: 'Turn this into watercolor',
    aspectRatio: '9:16',
    size: '1080x1920',
    count: 2,
    outputFormat: 'png',
    imageQuality: 'auto',
    stream: true,
    imageUrl: 'https://example.com/one.png',
    imageUrls: ['https://example.com/one.png', 'https://example.com/two.png'],
    base64Image: 'data:image/png;base64,abc',
    base64Images: ['data:image/png;base64,abc'],
    strength: 0.4,
  });

  assert.equal(request.strategy, 'generation-json-only');
  assert.equal(request.requestCount, 1);
  assert.equal(request.requestSize, '768x1152');
  assert.equal(request.generationJson.endpoint, `${AGNES_BASE_URL}/v1/images/generations`);
  assert.equal(request.generationJson.body.size, '768x1152');
  assert.deepEqual(request.generationJson.body.extra_body, {
    response_format: 'url',
    image: ['https://example.com/one.png', 'https://example.com/two.png'],
  });
  assert.equal(request.generationJson.body.image, undefined);
  assert.equal(request.generationJson.body.images, undefined);
  assert.equal(request.generationJson.body.init_image, undefined);
  assert.equal(request.generationJson.body.stream, undefined);
});

await runTest('Agnes image-to-image route forwards all reference image fields into Manifest inputImages', () => {
  const imageRoute = read('src/app/api/generate/image/route.ts');
  const executor = read('src/lib/user-api-manifest-executor.ts');

  assert.match(imageRoute, /images:\s*requestImages/);
  assert.match(imageRoute, /images\?:\s*unknown/);
  assert.match(imageRoute, /normalizeReferenceImages\(image,\s*requestImages,\s*extraImages\)/);
  assert.match(imageRoute, /inputImages:\s*referenceImages/);
  assert.match(imageRoute, /preferEdit:\s*referenceImages\.length > 0/);
  assert.match(executor, /inputImageUrls:\s*input\.inputImageUrls \|\| await resolveManifestInputImageReferences\(input\.inputImages \|\| \[\]\)/);
  assert.match(executor, /getObjectReadUrlForStoredInputImage/);
  assert.match(executor, /localStorage\.getKeyFromPublicUrl\(value\)/);
  assert.match(executor, /localStorage\.generateObjectReadUrl\(key,\s*3600\)/);
  assert.match(executor, /usesStoredObjectRefs/);
  assert.match(executor, /extraBodyImage/);
  assert.match(executor, /imageField/);
  assert.match(executor, /bodyImageCount/);
  assert.match(executor, /User API Manifest Agnes Image/);
});

await runTest('Agnes custom image-to-image skips generic FormData and chat probing', () => {
  const imageRoute = read('src/app/api/generate/image/route.ts');

  assert.match(imageRoute, /const useGenerationJsonOnly = templatedRequest\.strategy === 'generation-json-only'/);
  assert.match(imageRoute, /if \(!useGenerationJsonOnly && referenceFiles\.length > 0\)/);
  assert.match(imageRoute, /let result2: StrategyResult \| null = null/);
  assert.match(imageRoute, /if \(!useGenerationJsonOnly\) \{/);
  assert.match(imageRoute, /useGenerationJsonOnly \? '策略1: images\/generations' : '策略3: images\/generations\+init_image'/);
});


await runTest('Agnes video Manifest creates async task and polls by video_id', () => {
  const template = AGNES_VIDEO_MODEL_TEMPLATES[0];
  const bundle = buildAgnesVideoManifestBundle(template);
  const provider = bundle.customProviders[0];

  assert.equal(bundle.profiles[0].baseUrl, AGNES_BASE_URL);
  assert.equal(bundle.profiles[0].apiMode, 'videos');
  assert.equal(provider.submit?.path, 'v1/videos');
  assert.equal(provider.submit?.body?.model, '$profile.model');
  assert.equal(provider.submit?.body?.prompt, '$prompt');
  assert.equal(provider.submit?.body?.image, '$inputImages.urls.0');
  assert.equal(provider.submit?.body?.num_frames, '$params.num_frames');
  assert.equal(provider.submit?.body?.negative_prompt, '$params.negative_prompt');
  assert.equal(provider.submit?.body?.frame_rate, '$params.fps');
  assert.equal(provider.submit?.body?.width, '$params.width');
  assert.equal(provider.submit?.body?.height, '$params.height');
  assert.match(provider.submit?.taskIdPath || '', /video_id/);
  assert.equal(provider.poll?.path, 'agnesapi');
  assert.deepEqual(provider.poll?.query, {
    video_id: '{task_id}',
    model_name: '$profile.model',
  });
  assert.equal(provider.poll?.statusPath, 'status');
  assert.deepEqual(provider.poll?.successValues, ['completed']);
  assert.deepEqual(provider.poll?.failureValues, ['failed']);
  assert.deepEqual(provider.poll?.result?.videoUrlPaths, ['remixed_from_video_id', 'video_url', 'url']);
});

await runTest('Agnes video duration options map to documented frame counts at 24fps', () => {
  assert.equal(AGNES_VIDEO_FRAME_RATE, 24);
  assert.deepEqual(AGNES_VIDEO_MODEL_TEMPLATES[0].capabilities.durations?.map(item => item.value), ['3', '5', '10']);
  assert.equal(normalizeAgnesVideoDuration(18), null);
  assert.equal(getAgnesVideoNumFrames(3), 81);
  assert.equal(getAgnesVideoNumFrames(5), 121);
  assert.equal(getAgnesVideoNumFrames(10), 241);
  assert.deepEqual(getAgnesModelCapabilities('agnes-video-v2.0')?.durations?.map(item => item.value), ['3', '5', '10']);

  const videoRoute = read('src/app/api/generate/video/route.ts');
  assert.match(videoRoute, /normalizeAgnesVideoDuration\(duration\)/);
  assert.match(videoRoute, /Agnes Video V2\.0 当前仅开放 3、5、10 秒/);
  assert.match(videoRoute, /const useAgnesVideoParams = isAgnesVideoApi\(resolvedCustomApiConfig\)/);
  assert.match(videoRoute, /getAgnesVideoNumFrames\(resolvedAgnesDuration\)/);
  assert.match(videoRoute, /fps:\s*useAgnesVideoParams\s*\?\s*AGNES_VIDEO_FRAME_RATE\s*:\s*fps/);
  assert.match(videoRoute, /num_frames:\s*useAgnesVideoParams\s*\?\s*getAgnesVideoNumFrames\(resolvedAgnesDuration\)\s*:\s*undefined/);
  assert.match(videoRoute, /timeoutMs:\s*useAgnesVideoParams\s*\?\s*AGNES_VIDEO_GENERATION_TIMEOUT\s*:\s*GENERATION_TIMEOUT/);
});

await runTest('Agnes video failures are reported by stage instead of raw fetch failed', () => {
  const executor = read('src/lib/user-api-manifest-executor.ts');
  const videoRoute = read('src/app/api/generate/video/route.ts');
  const worker = read('src/lib/generation-job-worker.ts');
  const runner = read('src/lib/generation-job-runner.ts');

  assert.match(executor, /const stage = method === 'GET' \? '上游任务轮询' : '上游任务创建'/);
  assert.match(executor, /网络连接失败，请稍后重试/);
  assert.match(videoRoute, /上游已返回视频地址，但平台下载或保存结果视频失败/);
  assert.match(worker, /creation history persistence failed:/);
  assert.match(runner, /内部生成请求网络连接失败/);
  assert.match(runner, /requestInternalGenerationJson/);
});

await runTest('Agnes video polling progress is forwarded into generation job status', () => {
  const executor = read('src/lib/user-api-manifest-executor.ts');

  assert.match(executor, /function getManifestProgress/);
  assert.match(executor, /getPathValue\(raw,\s*'progress'\)/);
  assert.match(executor, /remainingSeconds/);
  assert.match(executor, /上游任务创建中/);
  assert.match(executor, /上游任务已创建，等待生成结果/);
  assert.match(executor, /notifyManifestProgress\(input,\s*getManifestProgress\(raw,\s*status\)\)/);
});

await runTest('Agnes video manifest splits per-request timeout from total polling budget', () => {
  const executor = read('src/lib/user-api-manifest-executor.ts');

  assert.match(executor, /function getManifestRequestTimeoutMs/);
  assert.match(executor, /USER_API_MANIFEST_SUBMIT_TIMEOUT_MS/);
  assert.match(executor, /USER_API_MANIFEST_POLL_REQUEST_TIMEOUT_MS/);
  assert.match(executor, /AGNES_VIDEO_MANIFEST_SUBMIT_TIMEOUT_MS/);
  assert.match(executor, /function isAgnesVideoManifestRequest/);
  assert.match(executor, /getManifestRequestTimeoutMs\(input\.timeoutMs,\s*method,\s*input\)/);
  assert.match(executor, /while \(Date\.now\(\) < deadline\)/);
  assert.match(executor, /isTransientPollError/);
});

await runTest('Agnes installer source creates free inactive rows with empty API key and per-row Manifest files', () => {
  const installer = read('src/lib/agnes-template-installer.ts');

  assert.match(installer, /encryptApiKeyForStorage\(''\)/);
  assert.match(installer, /credits_per_use/);
  assert.match(installer, /billingMode:\s*'free'/);
  assert.match(installer, /is_active,\s*sort_order/);
  assert.match(installer, /false,\s*input\.sortOffset/s);
  assert.match(installer, /attachManifest\(client,\s*row,\s*bundle,\s*saveManifestFile\)/);
  assert.match(installer, /syncImageModels/);
  assert.match(installer, /syncVideoModels/);
  assert.match(installer, /syncTextModels/);
  assert.match(installer, /`\$\{AGNES_BASE_URL\}\/v1\/images\/generations`/);
  assert.match(installer, /`\$\{AGNES_BASE_URL\}\/v1\/chat\/completions`/);
  assert.match(installer, /const apiUrl = resolveImportedProfileApiUrl\(bundle,\s*profile\) \|\| AGNES_BASE_URL/);
  assert.match(installer, /saveSystemApiManifestFile/);
  assert.match(installer, /Agnes 免费模型/);
});

await runTest('Agnes system model capabilities use built-in fallback so stale manifests do not expose unstable 18s', () => {
  const serverConfig = read('src/lib/server-api-config.ts');
  const agnesSystemManifest = read('src/lib/agnes-system-manifest.ts');

  assert.match(serverConfig, /getAgnesModelCapabilities/);
  assert.match(serverConfig, /getAgnesSystemApiCapabilitiesFallback/);
  assert.match(serverConfig, /getAgnesSystemApiCapabilitiesFallback\(row\)\s*\|\|\s*readManifestCapabilities/);
  assert.match(serverConfig, /ensureAgnesSystemApiManifest/);
  assert.match(serverConfig, /const agnesManifest = await ensureAgnesSystemApiManifest\(client,\s*row\)/);
  assert.match(serverConfig, /apiUrl:\s*agnesManifest\?\.apiUrl \|\|/);
  assert.match(serverConfig, /manifestPath:\s*agnesManifest\?\.manifestPath \|\|/);
  assert.match(agnesSystemManifest, /buildAgnesImageManifestBundle/);
  assert.match(agnesSystemManifest, /buildAgnesVideoManifestBundle/);
  assert.match(agnesSystemManifest, /isStoredManifestCurrent/);
  assert.match(agnesSystemManifest, /saveSystemApiManifestFile/);
  assert.match(agnesSystemManifest, /apiUrl:\s*`\$\{AGNES_BASE_URL\}\/v1\/images\/generations`/);
});

await runTest('admin UI exposes Agnes as system-default built-in templates, not smart import', () => {
  const adminTab = read('src/components/admin/api-management-tab.tsx');

  assert.match(adminTab, /agnes-capabilities/);
  assert.match(adminTab, /安装 Agnes 免费模型/);
  assert.match(adminTab, /免费模型/);
});

await runTest('Agnes capabilities text summarizes documented modules', () => {
  const text = buildAgnesCapabilitiesText();
  assert.match(text, /Agnes Image 2\.1 Flash/);
  assert.match(text, /Agnes Image 2\.0 Flash/);
  assert.match(text, /Agnes Video V2\.0/);
  assert.match(text, /Agnes 2\.0 Flash/);
  assert.match(text, /https:\/\/apihub\.agnes-ai\.com/);
});

if (process.exitCode) process.exit(process.exitCode);
