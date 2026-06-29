import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');

const {
  buildCreationReuseDraft,
} = await import('../src/lib/creation-reuse.ts');

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

await runTest('creation detail renders thumbnail while fullscreen and actions keep original image', () => {
  const source = read('src/components/creation-detail-dialog.tsx');

  assert.match(source, /src=\{record\.thumbnailUrl \|\| record\.url\}/);
  assert.match(source, /openFullscreenPreview\(record\.url,\s*record\.thumbnailUrl\)/);
  assert.match(source, /openImageMenu\(event,\s*record\.url\)/);
  assert.match(source, /downloadFile\(url,\s*filename\)/);
});

await runTest('creation detail metadata badge does not load original image for dimensions', () => {
  const source = read('src/components/creation-detail-dialog.tsx');

  assert.match(source, /<ImageMetadataBadge[\s\S]*?src=\{record\.url\}[\s\S]*?width=\{record\.width\}[\s\S]*?height=\{record\.height\}[\s\S]*?loadMetadata=\{false\}/);
});

await runTest('creation history API preserves stored image dimensions for detail metadata', () => {
  const source = read('src/app/api/creation-history/route.ts');

  assert.match(source, /width:\s*row\.width/);
  assert.match(source, /height:\s*row\.height/);
  assert.match(source, /SELECT[\s\S]*\bwidth,\s*height[\s\S]*FROM works/);
  assert.match(source, /INSERT INTO works[\s\S]*width,\s*height/);
});

await runTest('image generation response exposes persisted dimensions for history records', () => {
  const routeSource = read('src/app/api/generate/image/route.ts');
  const textSource = read('src/components/create/text-to-image.tsx');
  const imageSource = read('src/components/create/image-to-image.tsx');

  assert.match(routeSource, /dimensions:\s*Object\.fromEntries\(images\.map\(image => \[image\.url,\s*\{\s*width:\s*image\.width,\s*height:\s*image\.height\s*\}\]\)\)/);
  assert.match(textSource, /dimensions\?:\s*Record<string,\s*\{\s*width:\s*number;\s*height:\s*number\s*\}>/);
  assert.match(textSource, /width:\s*data\.dimensions\?\.\[url\]\?\.width/);
  assert.match(textSource, /height:\s*data\.dimensions\?\.\[url\]\?\.height/);
  assert.match(imageSource, /dimensions\?:\s*Record<string,\s*\{\s*width:\s*number;\s*height:\s*number\s*\}>/);
  assert.match(imageSource, /width:\s*data\.dimensions\?\.\[url\]\?\.width/);
  assert.match(imageSource, /height:\s*data\.dimensions\?\.\[url\]\?\.height/);
});

await runTest('reuse drafts use original output as generated-reference fallback, never thumbnail', () => {
  const record = {
    id: 'work-1',
    url: '/api/local-storage/generated/images/original.webp',
    thumbnailUrl: '/api/local-storage/thumbnails/works/thumb.webp',
    prompt: 'prompt',
    negativePrompt: '',
    model: 'model',
    params: {},
  };

  const imageDraft = buildCreationReuseDraft(record, 'img2img', { source: 'creation-detail', useOutputAsReference: true });
  const videoDraft = buildCreationReuseDraft(record, 'img2video', { source: 'gallery', useOutputAsReference: true });

  assert.deepEqual(imageDraft.referenceImages, [record.url]);
  assert.equal(imageDraft.referenceImage, record.url);
  assert.deepEqual(videoDraft.referenceImages, [record.url]);
  assert.equal(videoDraft.referenceImage, record.url);
});

if (process.exitCode) process.exit(process.exitCode);
