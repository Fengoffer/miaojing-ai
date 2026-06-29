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

const agnesTemplates = read('src/lib/agnes-model-templates.ts');
const suggestRoute = read('src/app/api/generate/suggest-prompt/route.ts');
const createPages = [
  'src/components/create/text-to-image.tsx',
  'src/components/create/image-to-image.tsx',
  'src/components/create/text-to-video.tsx',
  'src/components/create/image-to-video.tsx',
].map(path => ({ path, source: read(path) }));

await runTest('Agnes template helpers define prompt optimizer and target detection', () => {
  assert.match(agnesTemplates, /AGNES_PROMPT_OPTIMIZER_MODEL\s*=\s*'agnes-2\.0-flash'/);
  assert.match(agnesTemplates, /getAgnesPromptOptimizationTarget/);
  assert.match(agnesTemplates, /isAgnesPromptOptimizerModel/);
  assert.match(agnesTemplates, /agnes-image-2\.0-flash/);
  assert.match(agnesTemplates, /agnes-image-2\.1-flash/);
  assert.match(agnesTemplates, /agnes-video-v2\.0/);
  assert.match(agnesTemplates, /Agnes Image 2\.0 Flash/);
  assert.match(agnesTemplates, /Agnes Image 2\.1 Flash/);
  assert.match(agnesTemplates, /Agnes Video V2\.0/);
});

await runTest('suggest prompt route applies structured target metadata to generic and Agnes optimization paths', () => {
  assert.match(suggestRoute, /targetGenerationModel/);
  assert.match(suggestRoute, /normalizeTargetGenerationModel/);
  assert.match(suggestRoute, /getAgnesPromptOptimizationTarget/);
  assert.match(suggestRoute, /isAgnesPromptOptimizerModel/);
  assert.match(suggestRoute, /getSuggestPromptErrorStatus/);
  assert.match(suggestRoute, /请先登录\|未登录\|unauthorized\|jwt\|token/);
  assert.match(suggestRoute, /const status = getSuggestPromptErrorStatus\(message\)/);
  assert.match(suggestRoute, /if \(status >= 500\)/);
  assert.match(suggestRoute, /console\.log\('\[Suggest Prompt Reject\]'/);
  assert.doesNotMatch(suggestRoute, /resolveSystemTextApiByModelName/);
  assert.match(suggestRoute, /Agnes 提示词优化模型未配置或未启用/);
  assert.match(suggestRoute, /此次提示词优化面向/);
  assert.match(suggestRoute, /targetGenerationModel\.displayName/);
  assert.match(suggestRoute, /targetGenerationModel\.modelName/);
  assert.match(suggestRoute, /agnesTarget\.displayName/);
  assert.match(suggestRoute, /agnesTarget\.modelName/);
  assert.match(suggestRoute, /English positive prompt/);
  assert.match(suggestRoute, /English negative prompt/);
  assert.match(suggestRoute, /targetGenerationModel:\s*normalizedTargetGenerationModel/);
  assert.match(suggestRoute, /\|\| normalizedTargetGenerationModel\?\.displayName/);
});

await runTest('create pages always pass the currently selected generation model as prompt optimization target', () => {
  for (const { path, source } of createPages) {
    assert.match(source, /promptOptimizationTarget/);
    assert.match(source, /selectedAgnesPromptTarget/);
    assert.match(source, /agnesOptimizerTextModel/);
    assert.match(source, /genericTextModelOptions/);
    assert.match(source, /canUseAgnesOptimizer/);
    assert.match(source, /targetGenerationModel/);
    assert.match(source, /targetGenerationModel:\s*promptOptimizationTarget/);
    assert.doesNotMatch(source, /targetGenerationModel:\s*canUseAgnesOptimizer \? selectedAgnesPromptTarget : undefined/);
    assert.match(source, /mediaType:\s*'(image|video)'/);
    assert.match(source, /modelName:\s*(?:key|api)\?\.modelName/);
    assert.match(source, /displayName:\s*getCurrentModelLabel\(\)/);
    assert.doesNotMatch(
      source,
      /if \(textModelOptions\.length === 0\) \{ toast\.error\('未配置(?:多模态模型，请先在API设置中添加多模态模型|文本模型)'\); return; \}/,
      `${path} should not block Agnes prompt optimization only because textModelOptions is empty`,
    );
  }
});

await runTest('optimize buttons stay available when the selected Agnes model uses the system optimizer', () => {
  for (const { source } of createPages) {
    assert.match(source, /canOptimizePrompt/);
    assert.match(source, /genericTextModelOptions\.length > 0 \|\| canUseAgnesOptimizer/);
    assert.match(source, /\{canOptimizePrompt && \(/);
  }
});
