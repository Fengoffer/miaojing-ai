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

await runTest('client auth helper reads current and legacy storage fields through one strict token validator', () => {
  const source = read('src/lib/client-auth.ts');

  assert.match(source, /const AUTH_STORAGE_KEY = 'miaojing_auth'/);
  assert.match(source, /const AUTH_EVENT_KEY = 'miaojing_auth_updated'/);
  assert.match(source, /SESSION_TOKEN_PREFIX = 'mjst\.v1'/);
  assert.match(source, /auth\?\.accessToken/);
  assert.match(source, /auth\?\.session\?\.access_token/);
  assert.match(source, /isCurrentMiaojingSessionToken/);
  assert.match(source, /clearClientAuth\(\)/);
  assert.match(source, /export function getClientAuthHeaders/);
  assert.match(source, /export function getRequiredClientAuthToken/);
  assert.match(source, /export function handleClientAuthFailure/);
  assert.match(source, /Authorization: `Bearer \$\{token\}`/);
});

await runTest('client auth helper rejects stale legacy or malformed tokens before UI treats the user as logged in', () => {
  const source = read('src/lib/client-auth.ts');
  const authStore = read('src/lib/auth-store.ts');

  assert.match(source, /function isCurrentMiaojingSessionToken/, 'client helper should validate the current mjst.v1 token shape');
  assert.match(source, /parts\.length !== 4/, 'client helper should reject non-mjst legacy token shapes');
  assert.match(source, /clearClientAuth\(\);\s*return null;/, 'invalid client tokens should clear stored auth');
  assert.match(authStore, /if \(!getClientAuthToken\(\)\)/, 'auth store should not keep a logged-in UI state without a valid token');
});

await runTest('auth store and generation jobs clear stale logged-in UI state on auth failures', () => {
  const authStore = read('src/lib/auth-store.ts');
  const jobClient = read('src/lib/generation-job-client.ts');

  assert.match(authStore, /getClientAuthToken/);
  assert.match(authStore, /getClientAuthHeaders/);
  assert.match(authStore, /clearClientAuth/);
  assert.match(authStore, /res\.status === 401/);
  assert.match(jobClient, /getRequiredClientAuthToken/);
  assert.match(jobClient, /handleClientAuthFailure\(createRes\.status,\s*createData\.error\)/);
  assert.match(jobClient, /handleClientAuthFailure\(res\.status,\s*data\.error\)/);
});

await runTest('create prompt optimization requests use the shared auth helper', () => {
  for (const relativePath of [
    'src/components/create/text-to-image.tsx',
    'src/components/create/image-to-image.tsx',
    'src/components/create/text-to-video.tsx',
    'src/components/create/image-to-video.tsx',
  ]) {
    const source = read(relativePath);
    assert.match(source, /getRequiredClientAuthToken/, `${relativePath} should require a current session token`);
    assert.match(source, /getClientAuthHeaders\(authToken\)/, `${relativePath} should build Authorization from the shared helper`);
    assert.match(source, /handleClientAuthFailure\(res\.status,\s*data\.error\)/, `${relativePath} should clear stale auth after a 401`);
    assert.doesNotMatch(source, /Authorization: `Bearer \$\{accessToken\}`/, `${relativePath} should not use possibly stale React auth state directly`);
  }
});

await runTest('client API callers use shared auth helper instead of hand-parsing localStorage auth', () => {
  const directAuthStoragePattern = /(?:window\.)?localStorage\.getItem\((['"])miaojing_auth\1\)/;
  const allowDirectRead = new Set([
    'src/lib/auth-store.ts',
    'src/lib/client-auth.ts',
  ]);

  const files = [
    'src/lib/admin-store.ts',
    'src/lib/creation-history-store.ts',
    'src/lib/custom-api-store.ts',
    'src/lib/generation-job-client.ts',
    'src/lib/site-config.ts',
    'src/lib/utils.ts',
    'src/components/profile/api-key-manager.tsx',
    'src/components/admin/system-upgrade-tab.tsx',
    'src/components/admin/data-management-tab.tsx',
  ];

  for (const relativePath of files) {
    const source = read(relativePath);
    assert.doesNotMatch(source, directAuthStoragePattern, `${relativePath} should not hand-parse miaojing_auth`);
    if (!allowDirectRead.has(relativePath)) {
      assert.match(source, /@\/lib\/client-auth/, `${relativePath} should import the shared client auth helper`);
    }
  }
});

await runTest('generation job persistence checks cover the shared auth helper', () => {
  const source = read('scripts/test-generation-job-persistence.mjs');

  assert.match(source, /client auth helper accepts legacy session tokens/);
  assert.match(source, /getClientAuthHeaders/);
});

if (process.exitCode) process.exit(process.exitCode);
