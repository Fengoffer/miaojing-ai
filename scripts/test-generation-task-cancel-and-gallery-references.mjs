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

const createPanels = [
  'src/components/create/text-to-image.tsx',
  'src/components/create/image-to-image.tsx',
  'src/components/create/text-to-video.tsx',
  'src/components/create/image-to-video.tsx',
];

await runTest('create panels allow a new different submission while another task is active', () => {
  for (const relativePath of createPanels) {
    const source = read(relativePath);
    assert.doesNotMatch(source, /disabled=\{!hasModels \|\| generating\}/, `${relativePath} should not disable submit only because active tasks exist`);
    assert.doesNotMatch(source, /任务生成中/, `${relativePath} should keep the submit action available while tasks are running`);
    assert.match(source, /activeSubmissionSignaturesRef\.current\.has\(submissionSignature\)/, `${relativePath} should still block the same in-flight submission`);
  }
});

await runTest('text-to-image live result column does not show prompt text above images', () => {
  const source = read('src/components/create/text-to-image.tsx');
  assert.doesNotMatch(source, /resultPrompt/);
  assert.doesNotMatch(source, /title=\{resultPrompt \|\| '图片生成'\}/);
  assert.doesNotMatch(source, /line-clamp-2 break-words text-sm leading-6 text-muted-foreground/);
});

await runTest('generation job status supports user cancellation end to end', () => {
  assert.match(read('src/lib/generation-job-client.ts'), /'cancelled'/);
  assert.match(read('src/lib/generation-job-client.ts'), /cancelGenerationJob/);
  assert.match(read('src/components/create/generation-task-list.tsx'), /onCancelTask/);
  assert.match(read('src/components/create/generation-task-list.tsx'), /取消任务/);

  const statusRoute = read('src/app/api/generation-jobs/[id]/route.ts');
  assert.match(statusRoute, /export async function (PATCH|DELETE)/);
  assert.match(statusRoute, /status = 'cancelled'/);

  const worker = read('src/lib/generation-job-worker.ts');
  assert.match(worker, /isJobStillRunning/);
  assert.match(worker, /cancelled/);
  assert.match(worker, /skip/i);
});

await runTest('image-to-image and image-to-video share reference images to gallery', () => {
  for (const relativePath of [
    'src/components/create/image-to-image.tsx',
    'src/components/create/image-to-video.tsx',
  ]) {
    const source = read(relativePath);
    assert.match(source, /referenceImage:\s*refImages\[0\]\?\.dataUrl/, `${relativePath} should share the primary reference`);
    assert.match(source, /referenceImages:\s*refImages\.map\(img => img\.dataUrl\)/, `${relativePath} should share all references`);
  }
});

await runTest('gallery publish persists reference images as stable local-storage URLs', () => {
  const publishRoute = read('src/app/api/gallery/publish/route.ts');
  const mediaHelper = read('src/lib/gallery-publish-media.ts');
  assert.match(mediaHelper, /resolveGalleryReferenceImages/);
  assert.match(mediaHelper, /gallery\/references/);
  assert.match(publishRoute, /resolveGalleryReferenceImages/);
  assert.match(publishRoute, /galleryReferenceImages/);
});

await runTest('gallery detail shows reference images but does not expose reference downloads', () => {
  const source = read('src/app/gallery/page.tsx');
  assert.match(source, /getWorkReferenceImages/);
  assert.match(source, /getWorkReferenceImageThumbnails/);
  assert.match(source, /ReferencePreviewImage/);
  assert.match(source, /thumbnailSrc=\{selectedReferenceImageThumbnails\[index\]\}/);
  assert.match(source, /参考图/);
  assert.match(source, /referencePreviewSrc/);
  assert.match(source, /disableContextMenu/);
  assert.match(source, /onContextMenu=\{[^}]*preventDefault/s);
  assert.doesNotMatch(source, /handleDownload\([^)]*reference/i);
});

await runTest('gallery api merges reference metadata from duplicate result rows', () => {
  const route = read('src/app/api/gallery/route.ts');
  assert.match(route, /mergeGalleryRowMetadata/);
  assert.match(route, /dedupeGalleryRowsByResultUrl/);
  assert.match(route, /referenceImageThumbnails/);
});

await runTest('inspiration reuse preserves original reference images when available', () => {
  const reuseSource = read('src/lib/creation-reuse.ts');
  assert.match(reuseSource, /explicitReferences/);
  assert.match(reuseSource, /useOutputAsReference/);

  const inspirationSource = read('src/components/create/inspiration-gallery-dialog.tsx');
  assert.match(inspirationSource, /referenceImages/);
  assert.match(inspirationSource, /referencePreviewSrc/);
  assert.match(inspirationSource, /disableContextMenu/);
  assert.doesNotMatch(inspirationSource, /window\.open/);
  assert.match(inspirationSource, /buildCreationReuseDraft/);
});

if (process.exitCode) process.exit(process.exitCode);
