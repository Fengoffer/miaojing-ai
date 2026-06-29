import assert from 'node:assert/strict';
import {
  getPublicGalleryAvatarUrl,
  toPublicGalleryWork,
} from '../src/lib/gallery-response.ts';
import {
  GALLERY_CACHE_MAX_AGE_MS,
  GALLERY_CACHE_TTL_MS,
  isGalleryCacheEntryFresh,
  isGalleryCacheEntryUsable,
} from '../src/lib/gallery-cache-policy.ts';

function createGalleryRow(overrides = {}) {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    type: 'text2img',
    title: 'public work',
    prompt: 'prompt',
    negative_prompt: null,
    result_url: '/api/local-storage/gallery/image.webp',
    thumbnail_url: '/api/local-storage/thumbnails/gallery/image.webp',
    width: 1024,
    height: 1024,
    duration: null,
    likes_count: 7,
    credits_cost: 2,
    params: {
      creationMode: 'text2img',
      referenceImages: ['/api/local-storage/reference.webp', ''],
      referenceImageThumbnails: ['/api/local-storage/thumbnails/reference.webp', ''],
    },
    user_id: '22222222-2222-2222-2222-222222222222',
    nickname: 'login-name',
    display_nickname: '公开昵称',
    email: 'user@example.com',
    avatar_url: null,
    created_at: '2026-05-20T00:00:00.000Z',
    ...overrides,
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

await runTest('filters data URL avatars from public gallery rows', () => {
  const dataAvatar = `data:image/svg+xml;base64,${'a'.repeat(40000)}`;
  const work = toPublicGalleryWork(createGalleryRow({ avatar_url: dataAvatar }));

  assert.equal(work.publisherAvatarUrl, null);
  assert.equal(JSON.stringify(work).includes(dataAvatar), false);
});

await runTest('keeps short URL avatars for public gallery rows', () => {
  assert.equal(
    getPublicGalleryAvatarUrl('/api/local-storage/avatars/user.webp'),
    '/api/local-storage/avatars/user.webp',
  );
  assert.equal(
    getPublicGalleryAvatarUrl('https://example.com/avatar.webp'),
    'https://example.com/avatar.webp',
  );
});

await runTest('uses display nickname before login nickname', () => {
  const work = toPublicGalleryWork(createGalleryRow());

  assert.equal(work.publisherNickname, '公开昵称');
});

await runTest('maps reference images without blank entries', () => {
  const work = toPublicGalleryWork(createGalleryRow());

  assert.deepEqual(work.referenceImages, ['/api/local-storage/reference.webp']);
  assert.equal(work.referenceImage, '/api/local-storage/reference.webp');
  assert.deepEqual(work.referenceImageThumbnails, ['/api/local-storage/thumbnails/reference.webp']);
});

await runTest('allows stale gallery cache rows for instant first paint', () => {
  const now = Date.UTC(2026, 4, 20, 12, 0, 0);
  const staleButUsable = now - GALLERY_CACHE_TTL_MS - 1;

  assert.equal(isGalleryCacheEntryFresh(staleButUsable, now), false);
  assert.equal(isGalleryCacheEntryUsable(staleButUsable, now), true);
});

await runTest('rejects gallery cache rows older than max age', () => {
  const now = Date.UTC(2026, 4, 20, 12, 0, 0);
  const expired = now - GALLERY_CACHE_MAX_AGE_MS - 1;

  assert.equal(isGalleryCacheEntryUsable(expired, now), false);
});

if (process.exitCode) process.exit(process.exitCode);
