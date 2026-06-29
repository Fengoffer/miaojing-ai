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

await runTest('site config hook shares in-flight refresh requests across global components', () => {
  const source = read('src/lib/site-config.ts');
  assert.match(source, /let siteConfigSnapshot: SiteConfig \| null = null;/);
  assert.match(source, /let inFlightSiteConfigRequest: Promise<SiteConfig \| null> \| null = null;/);
  assert.match(source, /function fetchFreshSiteConfig\(\): Promise<SiteConfig \| null>/);
  assert.match(source, /if \(inFlightSiteConfigRequest\) return inFlightSiteConfigRequest;/);
  assert.match(source, /inFlightSiteConfigRequest = null;/);
});

await runTest('site config hook uses a shared snapshot for instant repeated mounts', () => {
  const source = read('src/lib/site-config.ts');
  assert.match(source, /function getInitialSiteConfig\(\): \{ config: SiteConfig; loaded: boolean \}/);
  assert.match(source, /if \(siteConfigSnapshot\) return \{ config: siteConfigSnapshot, loaded: true \};/);
  assert.match(source, /siteConfigSnapshot = config;/);
});

await runTest('site config hook skips fresh-cache network refreshes on route remounts', () => {
  const source = read('src/lib/site-config.ts');
  assert.match(source, /let siteConfigSnapshotTimestamp = 0;/);
  assert.match(source, /function isSiteConfigSnapshotFresh\(\): boolean/);
  assert.match(source, /if \(isSiteConfigSnapshotFresh\(\)\) \{/);
  assert.match(source, /siteConfigSnapshotTimestamp = Date\.now\(\);/);
});

await runTest('site config API caches schema compatibility checks after startup', () => {
  const source = read('src/app/api/site-config/route.ts');
  assert.match(source, /let siteConfigColumnsReady = false;/);
  assert.match(source, /let siteConfigColumnsPromise: Promise<void> \| null = null;/);
  assert.match(source, /async function ensureSiteConfigColumnsOnce/);
  assert.match(source, /if \(siteConfigColumnsReady\) return;/);
  assert.match(source, /siteConfigColumnsReady = true;/);
  assert.match(source, /await ensureSiteConfigColumnsOnce\(client\);/);
});

if (process.exitCode) process.exit(process.exitCode);
