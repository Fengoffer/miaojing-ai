import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

function read(path) {
  return readFileSync(join(root, path), 'utf8');
}

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function chooseFallbackModel(options) {
  const customOption = options.find(option => option.group === '自定义模型');
  return customOption?.id || options[0]?.id || '';
}

function normalizeSelectedModel(selectedModel, options) {
  if (options.length === 0) return '';
  if (selectedModel && options.some(option => option.id === selectedModel)) return selectedModel;
  return chooseFallbackModel(options);
}

await runTest('stale stored model is replaced by an available system-default option', () => {
  assert.equal(
    normalizeSelectedModel('system:deleted', [
      { id: 'system:image-default', group: '默认模型' },
      { id: 'system:image-backup', group: '默认模型' },
    ]),
    'system:image-default',
  );
});

await runTest('custom model remains the preferred automatic fallback when available', () => {
  assert.equal(
    normalizeSelectedModel('', [
      { id: 'system:image-default', group: '默认模型' },
      { id: 'custom:user-key', group: '自定义模型' },
    ]),
    'custom:user-key',
  );
});

await runTest('create panels share the validated model selection hook', () => {
  for (const file of [
    'src/components/create/text-to-image.tsx',
    'src/components/create/image-to-image.tsx',
    'src/components/create/text-to-video.tsx',
    'src/components/create/image-to-video.tsx',
  ]) {
    const source = read(file);
    assert.match(source, /useModelSelection\(/, `${file} should use useModelSelection`);
    assert.doesNotMatch(source, /window\.localStorage\.getItem\([^)]*_SELECTED_MODEL_KEY/, `${file} should not restore selected models directly`);
  }
});

await runTest('hook normalizes selected models before saving them back to storage', () => {
  const source = read('src/components/create/use-model-selection.ts');
  assert.match(source, /export function normalizeSelectedModel/);
  assert.match(source, /const normalizedModel = normalizeSelectedModel\(selectedModel, options\)/);
  assert.match(source, /if \(normalizedModel !== selectedModel\) setSelectedModel\(normalizedModel\)/);
});
