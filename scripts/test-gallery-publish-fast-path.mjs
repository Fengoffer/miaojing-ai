import assert from 'node:assert/strict';

const galleryPublishMediaModule = await import('../src/lib/gallery-publish-media.ts');
const { resolveGalleryPublishMedia } = galleryPublishMediaModule.default || galleryPublishMediaModule;

function createDeps() {
  const calls = {
    copy: [],
    imageThumbnail: [],
    videoThumbnail: [],
  };
  return {
    calls,
    deps: {
      copyPublicUrlToFolder: async (url, folder, options) => {
        calls.copy.push({ url, folder, options });
        return `/api/local-storage/${folder}/copied.png`;
      },
      ensureLocalImageThumbnail: async (url, prefix) => {
        calls.imageThumbnail.push({ url, prefix });
        return `/api/local-storage/${prefix}/generated-m1280q86.webp`;
      },
      ensureLocalVideoThumbnail: async (url, prefix) => {
        calls.videoThumbnail.push({ url, prefix });
        return `/api/local-storage/${prefix}/frame-video-frame-m1280q86-v1.webp`;
      },
    },
  };
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

await runTest('new object-backed image publishes reuse the existing local-storage URL and current thumbnail', async () => {
  const { calls, deps } = createDeps();
  const result = await resolveGalleryPublishMedia({
    type: 'image',
    resultUrl: '/api/local-storage/generated/images/source.png',
    thumbnailUrl: '/api/local-storage/thumbnails/generated/images/source-m1280q86.webp',
    prompt: 'image prompt',
  }, deps);

  assert.equal(result.resultUrl, '/api/local-storage/generated/images/source.png');
  assert.equal(result.thumbnailUrl, '/api/local-storage/thumbnails/generated/images/source-m1280q86.webp');
  assert.deepEqual(calls.copy, []);
  assert.deepEqual(calls.imageThumbnail, []);
});

await runTest('external image publishes still copy into gallery storage before thumbnailing', async () => {
  const { calls, deps } = createDeps();
  const result = await resolveGalleryPublishMedia({
    type: 'image',
    resultUrl: 'https://example.com/source.png',
    thumbnailUrl: null,
    prompt: 'image prompt',
  }, deps);

  assert.equal(result.resultUrl, '/api/local-storage/gallery/images/copied.png');
  assert.equal(result.thumbnailUrl, '/api/local-storage/thumbnails/gallery/generated-m1280q86.webp');
  assert.deepEqual(calls.copy, [
    {
      url: 'https://example.com/source.png',
      folder: 'gallery/images',
      options: { storageTarget: 'object' },
    },
  ]);
  assert.deepEqual(calls.imageThumbnail, [
    {
      url: '/api/local-storage/gallery/images/copied.png',
      prefix: 'thumbnails/gallery',
    },
  ]);
});

await runTest('object-backed video publishes keep reusing the existing local-storage URL', async () => {
  const { calls, deps } = createDeps();
  const result = await resolveGalleryPublishMedia({
    type: 'video',
    resultUrl: '/api/local-storage/generated/videos/source.mp4',
    thumbnailUrl: null,
    prompt: 'video prompt',
  }, deps);

  assert.equal(result.resultUrl, '/api/local-storage/generated/videos/source.mp4');
  assert.equal(result.thumbnailUrl, '/api/local-storage/thumbnails/gallery/videos/frame-video-frame-m1280q86-v1.webp');
  assert.deepEqual(calls.copy, []);
  assert.deepEqual(calls.videoThumbnail, [
    {
      url: '/api/local-storage/generated/videos/source.mp4',
      prefix: 'thumbnails/gallery/videos',
    },
  ]);
});

if (process.exitCode) process.exit(process.exitCode);
