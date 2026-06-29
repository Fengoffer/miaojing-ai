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

await runTest('video generation persists generated videos as object-backed media under generated/videos', () => {
  const source = read('src/app/api/generate/video/route.ts');

  assert.match(source, /uploadFileObjectOnly\(/);
  assert.match(source, /fileName:\s*`\$\{prefix\}\/\$\{suffix\}\.\$\{ext \|\| 'mp4'\}`/);
  assert.doesNotMatch(source, /uploadFromUrl\(\{\s*url,\s*timeout:\s*60000\s*\}\)/);
});

await runTest('download route can redirect object-backed local-storage downloads without buffering full videos', () => {
  const source = read('src/app/api/download/route.ts');

  assert.match(source, /objectFileExistsAsync\(key\)/);
  assert.match(source, /generateObjectReadUrl\(key,\s*300,/);
  assert.match(source, /NextResponse\.redirect\(objectUrl,\s*302\)/);
});

await runTest('video result download buttons trigger a streaming browser download instead of fetching a blob first', () => {
  const utilsSource = read('src/lib/utils.ts');
  const textVideoSource = read('src/components/create/text-to-video.tsx');
  const imageVideoSource = read('src/components/create/image-to-video.tsx');

  assert.match(utilsSource, /export function triggerDownloadFile\(/);
  assert.match(utilsSource, /link\.href = proxyUrl/);
  assert.doesNotMatch(utilsSource, /triggerDownloadFile[\s\S]*?response\.blob\(\)/);
  assert.match(textVideoSource, /triggerDownloadFile\(url,/);
  assert.match(imageVideoSource, /triggerDownloadFile\(url,/);
});

await runTest('gallery publish reuses object-backed video URLs instead of synchronously copying large videos', () => {
  const routeSource = read('src/app/api/gallery/publish/route.ts');
  const source = read('src/lib/gallery-publish-media.ts');

  assert.match(routeSource, /resolveGalleryPublishMedia\(\{/);
  assert.match(source, /if \(input\.type === 'video'\) \{/);
  assert.match(source, /if \(!isStableLocalStorageUrl\(input\.resultUrl\)\) \{[\s\S]*?copyPublicUrlToFolder\(input\.resultUrl,\s*'gallery\/videos',\s*\{\s*storageTarget:\s*'object'\s*\}/);
  assert.match(source, /let galleryResultUrl = input\.resultUrl/);
});

await runTest('gallery publish prefers real video frame thumbnails over stale client SVG thumbnails', () => {
  const source = read('src/lib/gallery-publish-media.ts');

  const videoThumbnailIndex = source.indexOf("type === 'video'");
  const ensureIndex = source.indexOf('ensureLocalVideoThumbnail(');
  const copyProvidedIndex = source.indexOf("copyPublicUrlToFolder(input.thumbnailUrl, 'gallery/thumbnails'");

  assert.notEqual(ensureIndex, -1);
  assert.notEqual(copyProvidedIndex, -1);
  assert.ok(videoThumbnailIndex < ensureIndex);
  assert.ok(ensureIndex < copyProvidedIndex);
  assert.match(source, /thumbnailUrl: generatedVideoThumbnailUrl \|\| copiedVideoThumbnailUrl \|\| galleryThumbnailUrl/);
});

await runTest('share to gallery surfaces server publish failures before marking a work as published', () => {
  const source = read('src/lib/creation-history-store.ts');

  assert.match(source, /if \(!res\.ok\) \{/);
  assert.match(source, /throw new Error\(typeof data\.error === 'string' \? data\.error : '分享失败，请重试'\)/);
  assert.doesNotMatch(source, /catch \{\s*\/\/ Non-critical/);

  const fetchIndex = source.indexOf("fetch('/api/gallery/publish'");
  const markIndex = source.indexOf('markRecordAsPublished(options.url)');
  assert.notEqual(fetchIndex, -1);
  assert.notEqual(markIndex, -1);
  assert.ok(fetchIndex < markIndex);
});

await runTest('share buttons wait for confirmed server publish and ignore stale local published flags', () => {
  const storeSource = read('src/lib/creation-history-store.ts');
  const detailSource = read('src/components/creation-detail-dialog.tsx');
  const createSources = [
    read('src/components/create/text-to-image.tsx'),
    read('src/components/create/image-to-image.tsx'),
    read('src/components/create/text-to-video.tsx'),
    read('src/components/create/image-to-video.tsx'),
  ];

  assert.match(storeSource, /publishedAt\?: string/);
  assert.match(storeSource, /r\.url === url && r\.published && r\.publishedAt/);
  assert.doesNotMatch(detailSource, /record\.published \|\| isUrlPublished\(record\.url\)/);

  for (const source of createSources) {
    assert.match(source, /const handleShareToGallery = useCallback\(async \(url: string\) => \{/);
    assert.match(source, /await shareToGallery\(\{/);
    assert.match(source, /catch \(error\) \{/);
  }
});

await runTest('gallery video cards and detail use thumbnails until the user starts playback', () => {
  const source = read('src/app/gallery/page.tsx');

  assert.match(source, /isVideoWork\(work\)/);
  assert.match(source, /const mediaPreviewUrl = work\.thumbnailUrl \|\| \(isVideoWork\(work\) \? getVideoFallbackThumbnail\(work\) : ''\)/);
  assert.match(source, /isVideoWork\(selectedWork\)/);
  assert.match(source, /activeVideoWorkId !== selectedWork\.id/);
  assert.match(source, /setActiveVideoWorkId\(selectedWork\.id\)/);
  assert.match(source, /下载\{isVideoWork\(selectedWork\) \? '视频' : '图片'\}/);
});

await runTest('video thumbnails extract a real video frame before falling back to SVG', () => {
  const source = read('src/lib/media-storage.ts');

  assert.match(source, /ffmpeg-static/);
  assert.match(source, /extractVideoFrameThumbnail\(/);
  assert.match(source, /VIDEO_FRAME_THUMBNAIL_PROFILE/);
  assert.match(source, /contentType:\s*'image\/webp'/);
  assert.match(source, /VIDEO_FALLBACK_THUMBNAIL_PROFILE/);
  assert.doesNotMatch(source, /const VIDEO_THUMBNAIL_PROFILE = 'video-svg-v1'/);
});

await runTest('object-backed video thumbnails stream to a temporary local file before ffmpeg extraction', () => {
  const source = read('src/lib/media-storage.ts');
  const resolveStart = source.indexOf('async function resolveVideoThumbnailInput(');
  const resolveEnd = source.indexOf('async function fetchTemporaryVideoInput(', resolveStart);
  const resolveSource = source.slice(resolveStart, resolveEnd);

  assert.notEqual(resolveStart, -1);
  assert.notEqual(resolveEnd, -1);
  assert.match(resolveSource, /writeStoredTemporaryVideoInput\(existingKey,\s*sourceKey\)/);
  assert.match(resolveSource, /generateObjectReadUrl\(existingKey,\s*300\)/);
  assert.match(resolveSource, /fetchTemporaryVideoInput\(objectReadUrl,\s*sourceKey\)/);
  assert.doesNotMatch(resolveSource, /fileExistsAsync\(existingKey\)[\s\S]*?openFileStreamAsync\(existingKey\)/);
  assert.match(source, /const VIDEO_THUMBNAIL_INPUT_ATTEMPTS/);
  assert.match(source, /openFileStreamAsync\(existingKey\)/);
  assert.match(source, /writeTemporaryVideoInputFromStream\(storedFile\.body/);
  assert.match(source, /VIDEO_THUMBNAIL_MAX_INPUT_BYTES/);
  assert.doesNotMatch(source, /return \{ input: objectReadUrl \}/);
});

await runTest('ffmpeg path resolution falls back to the runtime cwd when bundled route context is synthetic', () => {
  const source = read('src/lib/media-storage.ts');

  assert.match(source, /existsSync\(/);
  assert.match(source, /createRequire\(path\.join\(process\.cwd\(\), 'package\.json'\)\)/);
  assert.match(source, /getExistingFfmpegPath\(cwdRequire\('ffmpeg-static'\)\)/);
  assert.doesNotMatch(source, /return typeof binaryPath === 'string' && binaryPath \? binaryPath : null/);
});

await runTest('creation history de-duplicates repeated video records by URL', () => {
  const storeSource = read('src/lib/creation-history-store.ts');
  const routeSource = read('src/app/api/creation-history/route.ts');

  assert.match(storeSource, /function dedupeCreationRecordsByUrl\(/);
  assert.match(storeSource, /dedupeCreationRecordsByUrl\(records\.slice\(0, MAX_RECORDS\)\)/);
  assert.match(routeSource, /function dedupeRowsByResultUrl\(/);
  assert.match(routeSource, /dedupeRowsByResultUrl\(result\.rows\)/);
});

if (process.exitCode) process.exit(process.exitCode);
