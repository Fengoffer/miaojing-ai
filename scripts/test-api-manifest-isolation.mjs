import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

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

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

await runTest('user Manifest files are isolated by user id and API key id', async () => {
  const source = read('src/lib/user-api-manifest.ts');

  assert.match(source, /path\.posix\.join\('user-api-manifests', input\.userId, `\$\{input\.keyId\}\.json`\)/);
  assert.match(source, /path\.posix\.join\('system-api-manifests', `\$\{input\.keyId\}\.json`\)/);
});

await runTest('user smart import writes Manifest only after creating the selected key row', () => {
  const source = read('src/app/api/user-api-keys/smart-import/route.ts');

  assert.match(source, /INSERT INTO user_api_keys[\s\S]*manifest_path[\s\S]*VALUES[\s\S]*'', '', '待填写'/);
  assert.match(source, /saveUserApiManifestFile\(\{\s*userId,\s*keyId: String\(row\.id\),\s*bundle,\s*profile,/s);
  assert.match(source, /WHERE id = \$2 AND user_id = \$3/);
});

await runTest('user API key save ignores client-supplied Manifest paths', () => {
  const source = read('src/app/api/user-api-keys/route.ts');

  assert.doesNotMatch(source, /String\(item\.manifestPath \|\| ''\)\.trim\(\)/);
  assert.doesNotMatch(source, /manifest_path = CASE WHEN \$7::text <> '' THEN \$7 ELSE manifest_path END/);
  assert.match(source, /manifest_path = manifest_path/);
  assert.match(source, /INSERT INTO user_api_keys \([^)]*manifest_path[^)]*\)[\s\S]*VALUES \(\$1, \$2, \$3, \$4, \$5, \$6, '', COALESCE\(\$7, ''\)/s);
});

await runTest('admin manual system API save ignores client-supplied Manifest paths', () => {
  const source = read('src/app/api/admin/system-apis/route.ts');

  assert.doesNotMatch(source, /String\(body\.manifestPath \|\| ''\)\.trim\(\)/);
  assert.match(source, /price_note, manifest_path, is_default/);
  assert.match(source, /String\(body\.priceNote \|\| ''\)\.trim\(\),\s*'',\s*body\.isDefault !== false/s);
});

await runTest('admin smart import writes one Manifest per created system API row', () => {
  const source = read('src/app/api/admin/system-apis/smart-import/route.ts');

  assert.match(source, /INSERT INTO system_api_configs[\s\S]*manifest_path[\s\S]*'', \$11/s);
  assert.match(source, /saveSystemApiManifestFile\(\{\s*keyId: String\(row\.id\),\s*bundle,\s*profile,/s);
  assert.match(source, /SET manifest_path = \$1/);
});

await runTest('server API resolution trusts selected rows instead of client path overrides', () => {
  const source = read('src/lib/server-api-config.ts');

  assert.doesNotMatch(source, /row\.api_url \|\| input\.apiUrl/);
  assert.doesNotMatch(source, /row\.model_name \|\| input\.modelName/);
  assert.doesNotMatch(source, /String\(row\.api_url \|\| input\.apiUrl/);
  assert.doesNotMatch(source, /String\(row\.model_name \|\| input\.modelName/);
  assert.match(source, /if \(input\.apiKey\) return \{ \.\.\.input, manifestPath: '' \};/);
});

await runTest('queued generation jobs strip direct API config overrides', () => {
  const source = read('src/app/api/generation-jobs/route.ts');

  assert.match(source, /function sanitizeQueuedCustomApiConfig/);
  assert.match(source, /if \(isUuid\(customApiKeyId\)\) next\.customApiKeyId = customApiKeyId/);
  assert.match(source, /if \(isUuid\(systemApiId\)\) next\.systemApiId = systemApiId/);
  assert.match(source, /payload = sanitizeQueuedGenerationPayload\(payload\)/);
  assert.doesNotMatch(source, /next\.apiKey/);
  assert.doesNotMatch(source, /next\.apiUrl/);
  assert.doesNotMatch(source, /next\.manifestPath/);
});

await runTest('browser custom API cache is isolated per logged-in user', () => {
  const source = read('src/lib/custom-api-store.ts');

  assert.match(source, /function storageKeyForUser\(userId = getClientAuthUserId\(\)\): string/);
  assert.match(source, /return userId \? `\$\{STORAGE_KEY\}:\$\{userId\}` : STORAGE_KEY/);
  assert.match(source, /window\.addEventListener\(AUTH_EVENT_KEY, handler\)/);
});

if (process.exitCode) process.exit(process.exitCode);
