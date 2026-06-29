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

await runTest('creation history persists and backfills reference image URLs and thumbnails', () => {
  const route = read('src/app/api/creation-history/route.ts');

  assert.match(route, /persistReferenceImages/);
  assert.match(route, /getReferenceImageInputs/);
  assert.match(route, /referenceImageThumbnails/);
  assert.match(route, /shouldPatchReferences/);
  assert.match(route, /mergeWorkRowMetadata/);
  assert.match(route, /hasReferenceMetadata/);
  assert.match(route, /params = \$4::jsonb/);
});

await runTest('reference image backfill script can persist old data-url history rows', () => {
  const script = read('scripts/backfill-work-reference-images.mjs');

  assert.match(script, /--dry-run/);
  assert.match(script, /persistReferenceImages/);
  assert.match(script, /referenceImageThumbnails/);
  assert.match(script, /params->>'creationMode' IN \('img2img', 'img2video'\)/);
});

await runTest('generation worker keeps data-url reference inputs for server-side persistence', () => {
  const worker = read('src/lib/generation-job-worker.ts');

  assert.match(worker, /function safeReferenceInput/);
  assert.match(worker, /function getReferenceInputs/);
  assert.match(worker, /const references = getReferenceInputs\(payload\)/);
  assert.doesNotMatch(worker, /const references = getSafeReferenceImages\(payload\);\n  return \{/);
});

await runTest('reference previews use lightweight thumbnails and do not expose downloads in detail', () => {
  const detail = read('src/components/creation-detail-dialog.tsx');
  const imageToImage = read('src/components/create/image-to-image.tsx');
  const imageToVideo = read('src/components/create/image-to-video.tsx');
  const preview = read('src/components/reference-preview-image.tsx');

  assert.match(detail, /ReferencePreviewImage/);
  assert.match(detail, /thumbnailSrc=\{referenceImageThumbnails\[index\]\}/);
  assert.doesNotMatch(detail, /miaojing-reference-\$\{record\.id\}/);
  assert.match(imageToImage, /<ReferencePreviewImage src=\{img\.dataUrl\}/);
  assert.match(imageToVideo, /<ReferencePreviewImage src=\{img\.dataUrl\}/);
  assert.match(preview, /const MAX_EDGE = 360/);
  assert.match(preview, /canvas\.toDataURL\('image\/webp', QUALITY\)/);
});

await runTest('image-to-video history cards avoid eager original video metadata loads', () => {
  const source = read('src/components/create/image-to-video.tsx');

  assert.match(source, /record\.thumbnailUrl/);
  assert.doesNotMatch(source, /<video src=\{record\.url\} className="w-full h-full object-cover" preload="metadata" \/>/);
});

if (process.exitCode) process.exit(process.exitCode);
