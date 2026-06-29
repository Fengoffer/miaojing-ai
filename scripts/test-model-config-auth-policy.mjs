import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = path => readFileSync(join(root, path), 'utf8');

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

const modelConfigRoute = read('src/app/api/model-config/route.ts');
const managedModelStore = read('src/lib/managed-model-store.ts');
const apiKeyManager = read('src/components/profile/api-key-manager.tsx');

await runTest('model-config does not expose model lists to anonymous callers', () => {
  assert.match(modelConfigRoute, /export const dynamic\s*=\s*'force-dynamic'/);
  assert.match(modelConfigRoute, /export const revalidate\s*=\s*0/);
  assert.match(modelConfigRoute, /export const fetchCache\s*=\s*'force-no-store'/);
  assert.match(modelConfigRoute, /Cache-Control':\s*'private, no-store, max-age=0, must-revalidate'/);
  assert.match(modelConfigRoute, /'Surrogate-Control':\s*'no-store'/);
  assert.match(modelConfigRoute, /Vary:\s*'Authorization, Cookie'/);
  assert.match(modelConfigRoute, /function modelConfigJson/);
  assert.match(modelConfigRoute, /if \(!userId\)/);
  assert.match(modelConfigRoute, /getBearerToken\(request\)/);
  assert.match(modelConfigRoute, /登录状态已过期，请重新登录/);
  assert.match(modelConfigRoute, /\{\s*status:\s*401\s*\}/);
  assert.match(modelConfigRoute, /providers:\s*\[\]/);
  assert.match(modelConfigRoute, /recommendations:\s*\[\]/);
  assert.match(modelConfigRoute, /systemApis:\s*\[\]/);
  assert.doesNotMatch(modelConfigRoute, /const membershipTier = userId \? await getUserMembershipTier\(userId\) : 'free'/);
  assert.doesNotMatch(modelConfigRoute, /anonymous users are treated as `free`/i);
});

await runTest('managed model store sends bearer auth and clears models on empty response', () => {
  assert.match(managedModelStore, /export function buildModelConfigRequest\(accessToken: string\)/);
  assert.match(managedModelStore, /nonce=/);
  assert.match(managedModelStore, /cache:\s*'no-store'/);
  assert.match(managedModelStore, /headers\.set\('Cache-Control', 'no-cache'\)/);
  assert.match(managedModelStore, /if \(!accessToken\)/);
  assert.match(managedModelStore, /fetch\(request\.url, request\.init\)/);
  assert.match(managedModelStore, /handleClientAuthFailure\(res\.status/);
  assert.match(managedModelStore, /setSystemApis\(\(data\?\.systemApis \|\| \[\]\)\.filter/);
});

await runTest('profile API manager reuses authenticated no-store model config requests', () => {
  assert.match(apiKeyManager, /buildModelConfigRequest/);
  assert.match(apiKeyManager, /if \(!authToken\)/);
  assert.match(apiKeyManager, /fetch\(request\.url, request\.init\)/);
  assert.doesNotMatch(apiKeyManager, /fetch\('\/api\/model-config'/);
});
