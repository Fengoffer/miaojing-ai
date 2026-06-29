import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');

const {
  buildReferenceImagePrompt,
  normalizeReferenceImageAnnotations,
} = await import('../src/lib/reference-image-prompt.ts');

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

await runTest('adds model-readable mappings for referenced uploaded images', () => {
  const prompt = '让 @参考图2 的外套穿到 @参考图1 的人物身上，保持 @参考图1 的脸部特征';
  const result = buildReferenceImagePrompt(prompt, 2, [
    { index: 1, token: '@参考图1', name: 'person.jpg', width: 1024, height: 1536 },
    { index: 2, token: '@参考图2', name: 'coat.png', width: 800, height: 800 },
  ]);

  assert.ok(result.startsWith(prompt));
  assert.match(result, /参考图标注说明/);
  assert.match(result, /@参考图1 对应上传的第1张参考图/);
  assert.match(result, /文件名：person\.jpg/);
  assert.match(result, /尺寸：1024x1536/);
  assert.match(result, /@参考图2 对应上传的第2张参考图/);
  assert.match(result, /文件名：coat\.png/);
  assert.match(result, /尺寸：800x800/);
  assert.match(result, /当提示词提到 @参考图2 时/);
});

await runTest('normalizes annotations and ignores impossible image indexes', () => {
  const annotations = normalizeReferenceImageAnnotations([
    { index: 2, token: '@衣服', name: 'coat.png' },
    { index: 9, token: '@不存在', name: 'missing.png' },
    { index: 1, token: '人物', name: 'person.jpg', width: 'bad', height: 1024 },
  ], 2);

  assert.deepEqual(annotations, [
    { index: 2, token: '@衣服', name: 'coat.png' },
    { index: 1, token: '@参考图1', name: 'person.jpg', height: 1024 },
  ]);
});

await runTest('does not alter prompts without reference images', () => {
  assert.equal(buildReferenceImagePrompt('一只杯子', 0, []), '一只杯子');
  assert.equal(buildReferenceImagePrompt('', 2, []), '');
});

await runTest('image-to-image and image-to-video send reference annotations from the @ picker', () => {
  const imageToImageSource = fs.readFileSync(path.join(repoRoot, 'src/components/create/image-to-image.tsx'), 'utf8');
  const imageToVideoSource = fs.readFileSync(path.join(repoRoot, 'src/components/create/image-to-video.tsx'), 'utf8');

  for (const source of [imageToImageSource, imageToVideoSource]) {
    assert.match(source, /ReferenceImageMentionControls/);
    assert.match(source, /referenceImageAnnotations/);
    assert.match(source, /buildReferenceImageAnnotations/);
  }
});
