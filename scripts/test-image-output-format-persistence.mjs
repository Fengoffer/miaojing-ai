import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const { normalizeImageBufferForOutputFormat } = await import(`../src/lib/media-storage.ts?test=${Date.now()}`);
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

await runTest('converts upstream PNG bytes to JPEG when JPEG is requested', async () => {
  const upstreamPng = await sharp({
    create: {
      width: 12,
      height: 8,
      channels: 4,
      background: { r: 64, g: 128, b: 192, alpha: 1 },
    },
  }).png().toBuffer();

  const converted = await normalizeImageBufferForOutputFormat({
    buffer: upstreamPng,
    mimeType: 'image/png',
    ext: 'png',
  }, 'jpeg', 'high');

  assert.equal(converted.mimeType, 'image/jpeg');
  assert.equal(converted.ext, 'jpg');
  assert.deepEqual([...converted.buffer.subarray(0, 3)], [0xff, 0xd8, 0xff]);

  const metadata = await sharp(converted.buffer).metadata();
  assert.equal(metadata.format, 'jpeg');
  assert.equal(metadata.width, 12);
  assert.equal(metadata.height, 8);
});

await runTest('image generation persistence passes the requested output format to storage', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'src/app/api/generate/image/route.ts'), 'utf8');

  assert.match(source, /persistImageWithMetadata\(url,\s*prefix,\s*outputFormat,\s*imageQuality\)/);
  assert.match(source, /requestQualifiedCustomImages\([\s\S]*resolvedOutputFormat,\s*resolvedImageQuality,\s*handleUpstreamProgress/);
  assert.match(source, /User API Manifest Image'[\s\S]*resolvedOutputFormat,\s*resolvedImageQuality/);
  assert.match(source, /Custom API img2img strategy1'[\s\S]*outputFormat,\s*imageQuality/);
  assert.match(source, /Custom API img2img strategy2'[\s\S]*outputFormat,\s*imageQuality/);
  assert.match(source, /Custom API img2img strategy3'[\s\S]*outputFormat,\s*imageQuality/);
  assert.match(source, /SDK Image'[\s\S]*resolvedOutputFormat,\s*resolvedImageQuality/);
});

await runTest('image downloads derive filename extension from URL or selected output format', () => {
  const utils = fs.readFileSync(path.join(repoRoot, 'src/lib/utils.ts'), 'utf8');
  const textToImage = fs.readFileSync(path.join(repoRoot, 'src/components/create/text-to-image.tsx'), 'utf8');
  const imageToImage = fs.readFileSync(path.join(repoRoot, 'src/components/create/image-to-image.tsx'), 'utf8');
  const detail = fs.readFileSync(path.join(repoRoot, 'src/components/creation-detail-dialog.tsx'), 'utf8');
  const lightbox = fs.readFileSync(path.join(repoRoot, 'src/components/lightbox.tsx'), 'utf8');

  assert.match(utils, /export function getImageDownloadExtension\(/);
  assert.match(utils, /jpeg['"]?\s*\)\s*return ['"]jpg['"]/);
  assert.doesNotMatch(textToImage, /downloadFile\(url,\s*`miaojing-\$\{Date\.now\(\)\}-\$\{index\}\.png`\)/);
  assert.doesNotMatch(imageToImage, /downloadFile\(url,\s*`miaojing-img2img-\$\{Date\.now\(\)\}-\$\{index\}\.png`\)/);
  assert.match(textToImage, /getImageDownloadExtension\(url,\s*outputFormat\)/);
  assert.match(imageToImage, /getImageDownloadExtension\(url,\s*outputFormat\)/);
  assert.match(detail, /getImageDownloadExtension\(\s*url,[\s\S]*record\.params\?\.outputFormat/);
  assert.match(lightbox, /getImageDownloadExtension\(src\)/);
});

if (process.exitCode) process.exit(process.exitCode);
