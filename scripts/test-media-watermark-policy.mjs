import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const repoRoot = path.resolve(import.meta.dirname, '..');

const policyModule = await import('../src/lib/media-watermark-policy.ts');
const watermarkModule = await import('../src/lib/media-watermark.ts');

const {
  canAccessOriginalMedia,
  getWatermarkedStorageKey,
  isWatermarkableStorageKey,
  shouldWatermarkStorageResponse,
  shouldWatermarkDownloadResponse,
} = policyModule.default || policyModule;
const { applyImageWatermark } = watermarkModule.default || watermarkModule;

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

await runTest('watermark policy targets generated work media without touching site assets or avatars', () => {
  assert.equal(isWatermarkableStorageKey('generated/images/work.png'), true);
  assert.equal(isWatermarkableStorageKey('generated/videos/work.mp4'), true);
  assert.equal(isWatermarkableStorageKey('gallery/images/work.webp'), true);
  assert.equal(isWatermarkableStorageKey('gallery/videos/work.mp4'), true);
  assert.equal(isWatermarkableStorageKey('thumbnails/generated/images/work-m1280q86.webp'), true);
  assert.equal(isWatermarkableStorageKey('thumbnails/works/videos/frame-video-frame-m1280q86-v1.webp'), true);
  assert.equal(isWatermarkableStorageKey('imported/works/results/images/imported.jpg'), true);
  assert.equal(isWatermarkableStorageKey('site-assets/logo.png'), false);
  assert.equal(isWatermarkableStorageKey('avatars/user.webp'), false);
  assert.equal(isWatermarkableStorageKey('user-api-manifests/user/key.json'), false);
  assert.equal(isWatermarkableStorageKey('reverse-prompt/reference-images/input.png'), false);
});

await runTest('admin-authorized users can access original media while others receive watermarked downloads', () => {
  assert.equal(canAccessOriginalMedia(null), false);
  assert.equal(canAccessOriginalMedia({ role: 'user', membershipTier: 'free', watermarkDisabled: true }), true);
  assert.equal(canAccessOriginalMedia({ role: 'user', membershipTier: 'free', watermarkDisabled: false }), false);
  assert.equal(canAccessOriginalMedia({ role: 'vip', membershipTier: 'pro', watermarkDisabled: false }), false);
  assert.equal(canAccessOriginalMedia({ role: 'vip', membershipTier: 'pro', watermarkDisabled: true }), true);
  assert.equal(canAccessOriginalMedia({ role: 'admin', membershipTier: 'free', watermarkDisabled: false }), true);
});

await runTest('storage responses default to watermarked generated media', () => {
  assert.equal(shouldWatermarkStorageResponse('generated/images/work.png', 'image/png', null), true);
  assert.equal(
    shouldWatermarkStorageResponse('generated/images/work.png', 'image/png', {
      role: 'vip',
      membershipTier: 'pro',
      watermarkDisabled: true,
    }),
    true,
  );
  assert.equal(shouldWatermarkStorageResponse('site-assets/logo.png', 'image/png', null), false);
});

await runTest('download responses only skip watermark for privileged users who disabled it', () => {
  assert.equal(shouldWatermarkDownloadResponse('generated/images/work.png', 'image/png', null), true);
  assert.equal(shouldWatermarkDownloadResponse('generated/images/work.png', 'image/png', {
    role: 'vip',
    membershipTier: 'pro',
    watermarkDisabled: false,
  }), true);
  assert.equal(shouldWatermarkDownloadResponse('generated/images/work.png', 'image/png', {
    role: 'vip',
    membershipTier: 'pro',
    watermarkDisabled: true,
  }), false);
  assert.equal(shouldWatermarkDownloadResponse('site-assets/logo.png', 'image/png', null), false);
});

await runTest('watermarked cache keys are deterministic and separated by media kind', () => {
  assert.match(getWatermarkedStorageKey('generated/images/work.png', 'image/png'), /^watermarked\/images\/[a-f0-9]{64}\.png$/);
  assert.match(getWatermarkedStorageKey('gallery/images/work.webp', 'image/webp'), /^watermarked\/images\/[a-f0-9]{64}\.webp$/);
  assert.match(getWatermarkedStorageKey('generated/videos/work.mp4', 'video/mp4'), /^watermarked\/videos\/[a-f0-9]{64}\.mp4$/);
});

await runTest('image watermark renderer visibly changes raster media', async () => {
  const input = await sharp({
    create: {
      width: 640,
      height: 360,
      channels: 4,
      background: { r: 36, g: 50, b: 72, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

  const output = await applyImageWatermark(input, {
    key: 'generated/images/work.png',
    contentType: 'image/png',
  });

  assert.notDeepEqual(output, input);
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.width, 640);
  assert.equal(metadata.height, 360);
});

await runTest('watermark renderer dedupes concurrent generation for the same media', () => {
  const source = read('src/lib/media-watermark.ts');

  assert.match(source, /inflightWatermarkJobs/);
  assert.match(source, /inflightWatermarkJobs\.get\(outputKey\)/);
  assert.match(source, /inflightWatermarkJobs\.delete\(outputKey\)/);
});

await runTest('local storage route uses watermark access instead of exposing raw object URLs by default', () => {
  const source = read('src/app/api/local-storage/[...path]/route.ts');

  assert.match(source, /shouldWatermarkStorageResponse\(/);
  assert.match(source, /serveWatermarkedStorageFile\(/);
  assert.match(source, /getStoredThumbnailResponse\(/);
  assert.match(source, /thumbnailResponse/);
  const thumbnailResponseFunction = source.slice(
    source.indexOf('async function getStoredThumbnailResponse'),
    source.indexOf('function normalizeStoragePath'),
  );
  assert.doesNotMatch(thumbnailResponseFunction, /NextResponse\.redirect/);
  assert.doesNotMatch(
    source,
    /shouldWatermarkStorageResponse[\s\S]+?fileExistsAsync\(/,
    'storage display route should not require a slow object HEAD before watermark rendering',
  );
});

await runTest('download route applies watermark and checks authenticated no-watermark entitlement', () => {
  const source = read('src/app/api/download/route.ts');

  assert.match(source, /resolveMediaWatermarkAccess\(request\)/);
  assert.match(source, /serveWatermarkedDownloadFile\(/);
  assert.match(source, /canAccessOriginalMedia\(/);
});

await runTest('profile API and auth store carry the member no-watermark preference', () => {
  const preferenceSource = read('src/lib/profile-preferences.ts');
  const profileRouteSource = read('src/app/api/profile/route.ts');
  const authStoreSource = read('src/lib/auth-store.ts');

  assert.match(preferenceSource, /watermark_disabled BOOLEAN NOT NULL DEFAULT false/);
  assert.match(profileRouteSource, /watermark_disabled/);
  assert.match(profileRouteSource, /watermarkDisabled/);
  assert.match(profileRouteSource, /COALESCE\(watermark_disabled,\s*false\) AS watermark_disabled/);
  assert.match(authStoreSource, /watermarkDisabled:\s*boolean/);
  assert.match(authStoreSource, /watermark_disabled === true/);
});

await runTest('profile page exposes a VIP-only no-watermark download switch', () => {
  const source = read('src/app/profile/page.tsx');

  assert.match(source, /import \{ Switch \} from '@\/components\/ui\/switch'/);
  assert.match(source, /watermarkDisabled/);
  assert.match(source, /checked=\{accountForm\.watermarkDisabled\}/);
  assert.match(source, /disabled=\{!canDisableWatermark/);
  assert.doesNotMatch(source, /watermarkDisabled:\s*canDisableWatermark && accountForm\.watermarkDisabled/);
  assert.match(source, /if \(canDisableWatermark\) \{/);
  assert.match(source, /payload\.watermarkDisabled = accountForm\.watermarkDisabled === true/);
  assert.match(source, /下载无水印/);
});

await runTest('profile API preserves admin-granted no-watermark access for free users', () => {
  const source = read('src/app/api/profile/route.ts');

  assert.match(source, /const canManageOwnWatermark = canDisableWatermarkForProfile/);
  assert.match(source, /if \(hasWatermarkDisabled && watermarkDisabled && !canManageOwnWatermark\) \{/);
  assert.match(source, /watermarkDisabled && !canManageOwnWatermark/);
  assert.match(source, /const shouldUpdateWatermark = hasWatermarkDisabled && canManageOwnWatermark/);
  assert.match(source, /shouldUpdateWatermark,\s*watermarkDisabled,\s*tokenUserId/s);
  assert.doesNotMatch(source, /if \(hasWatermarkDisabled && watermarkDisabled && !canDisableWatermarkForProfile/);
});

await runTest('admin users API and UI can toggle no-watermark downloads per user', () => {
  const serviceSource = read('src/lib/admin-users-service.ts');
  const uiSource = read('src/components/admin/user-management-tab.tsx');
  const adminStoreSource = read('src/lib/admin-store.ts');

  assert.match(serviceSource, /ensureProfilePreferenceSchema/);
  assert.match(serviceSource, /COALESCE\(p\.watermark_disabled,\s*false\) AS watermark_disabled/);
  assert.match(serviceSource, /updates\.watermarkDisabled/);
  assert.match(serviceSource, /watermark_disabled = \$\$\{paramIdx\+\+\}/);
  assert.match(adminStoreSource, /watermarkDisabled\??:\s*boolean/);
  assert.match(uiSource, /import \{ Switch \} from '@\/components\/ui\/switch'/);
  assert.match(uiSource, /watermark_disabled:\s*boolean/);
  assert.match(uiSource, /watermarkDisabled:\s*u\.watermark_disabled === true/);
  assert.match(uiSource, /setEditWatermarkDisabled\(user\.watermarkDisabled === true\)/);
  assert.match(uiSource, /watermarkDisabled:\s*editWatermarkDisabled/);
  assert.match(uiSource, /checked=\{editWatermarkDisabled\}/);
  assert.match(uiSource, /下载无水印/);
});

await runTest('download helpers forward the current session to the download API', () => {
  const source = read('src/lib/utils.ts');

  assert.match(source, /function getStoredAccessTokenForDownload\(/);
  assert.match(source, /Authorization: `Bearer \$\{token\}`/);
  assert.match(source, /downloadToken/);
  assert.match(source, /includeDownloadToken: false/);
});

if (process.exitCode) process.exit(process.exitCode);
