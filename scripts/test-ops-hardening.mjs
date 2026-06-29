import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  checkStorageUrl,
  getMigrationCheckBaseUrl,
} from './migration-integrity-check-helpers.mjs';

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

await runTest('local-storage route serves thumbnails from local disk and redirects object originals', () => {
  const source = read('src/app/api/local-storage/[...path]/route.ts');

  assert.match(source, /filePath\.startsWith\('thumbnails\/'\)/);
  assert.match(source, /localStorage\.fileExists\(filePath\)/);
  assert.match(source, /localStorage\.readFile\(filePath\)/);
  assert.match(source, /localStorage\.generateObjectReadUrl\(filePath,\s*300\)/);
  assert.match(source, /NextResponse\.redirect\(objectUrl/);
});

await runTest('admin provider and recommendation reads require admin auth', () => {
  for (const relativePath of [
    'src/app/api/admin/providers/route.ts',
    'src/app/api/admin/model-recommendations/route.ts',
  ]) {
    const source = read(relativePath);
    assert.match(source, /export async function GET\(request: NextRequest\)/, relativePath);
    assert.match(source, /const authError = await requireAdmin\(request\)/, relativePath);
    assert.match(source, /if \(authError\) return authError;/, relativePath);
  }

  const tabSource = read('src/components/admin/api-management-tab.tsx');
  assert.match(tabSource, /fetch\('\/api\/admin\/providers', \{ headers: authHeaders\(accessToken\) \}\)/);
  assert.match(tabSource, /fetch\('\/api\/admin\/model-recommendations', \{ headers: authHeaders\(accessToken\) \}\)/);
});

await runTest('admin user deletion uses verified session user id for self-delete protection', () => {
  const route = read('src/app/api/admin/users/route.ts');

  assert.doesNotMatch(route, /function getTokenUserId/);
  assert.match(route, /requireAdminUser\(request\)/);
  assert.match(route, /deleteAdminUser\(client, String\(userId \|\| ''\), admin\.userId\)/);
});

await runTest('migration check defaults to production web port unless overridden', () => {
  assert.equal(getMigrationCheckBaseUrl({}), 'http://127.0.0.1:8000');
  assert.equal(
    getMigrationCheckBaseUrl({ MIGRATION_CHECK_BASE_URL: 'http://127.0.0.1:5000' }),
    'http://127.0.0.1:5000',
  );
});

await runTest('migration storage URL check records fetch failures instead of throwing', async () => {
  const result = await checkStorageUrl('http://127.0.0.1:8000', '/api/local-storage/missing.webp', {
    timeoutMs: 10,
    fetchImpl: async () => {
      throw new Error('connect timeout');
    },
  });

  assert.deepEqual(result, {
    ok: false,
    error: 'connect timeout',
  });
});

await runTest('migration storage URL check treats local-storage redirects as reachable', async () => {
  const calls = [];
  const result = await checkStorageUrl('http://127.0.0.1:8000', '/api/local-storage/gallery/images/work.png', {
    timeoutMs: 10,
    fetchImpl: async (_url, init) => {
      calls.push(init);
      return new Response(null, {
        status: 302,
        headers: { Location: 'https://object-storage.example/work.png' },
      });
    },
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(calls[0].method, 'HEAD');
  assert.equal(calls[0].redirect, 'manual');
});

await runTest('migration integrity script uses resilient storage URL helpers', () => {
  const source = read('scripts/migration-integrity-check.mjs');

  assert.match(source, /getMigrationCheckBaseUrl\(\)/);
  assert.match(source, /getMigrationStorageUrlTimeoutMs\(\)/);
  assert.match(source, /getMigrationStorageUrlConcurrency\(\)/);
  assert.match(source, /checkStorageUrl\(baseUrl, row\.url/);
});

if (process.exitCode) process.exit(process.exitCode);
