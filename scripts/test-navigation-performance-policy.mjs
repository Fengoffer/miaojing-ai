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

await runTest('create page keeps primary creation panels in the initial client bundle for instant mode switches', () => {
  const source = read('src/app/create/page.tsx');
  assert.match(source, /import\s+\{\s*TextToImagePanel\s*\}\s+from\s+'@\/components\/create\/text-to-image'/);
  assert.match(source, /import\s+\{\s*ImageToImagePanel\s*\}\s+from\s+'@\/components\/create\/image-to-image'/);
  assert.match(source, /import\s+\{\s*TextToVideoPanel\s*\}\s+from\s+'@\/components\/create\/text-to-video'/);
  assert.match(source, /import\s+\{\s*ImageToVideoPanel\s*\}\s+from\s+'@\/components\/create\/image-to-video'/);
  assert.match(source, /import\s+ReversePromptPanel\s+from\s+'@\/components\/create\/reverse-prompt-panel'/);
  assert.doesNotMatch(source, /ssr:\s*false/);
});

await runTest('create page avoids server/client tab hydration mismatch on type links', () => {
  const source = read('src/app/create/page.tsx');
  assert.match(source, /const \[activeTab, setActiveTab\] = useState\(DEFAULT_CREATE_TAB\)/);
  assert.doesNotMatch(source, /useState\(\(\) => normalizeCreateTab\(typeParam\)/);
  assert.match(source, /useEffect\(\(\) => \{\s*const nextTab = normalizeCreateTab\(typeParam\)/s);
});

await runTest('primary navigation avoids eager all-route prefetch pressure', () => {
  const source = read('src/components/navbar.tsx');
  assert.doesNotMatch(source, /router\.prefetch\('/);
  assert.doesNotMatch(source, /prefetch=\{true\}/);
});

await runTest('non-critical visit tracking waits for browser idle time', () => {
  const source = read('src/components/visit-tracker.tsx');
  assert.match(source, /requestIdleCallback/);
  assert.match(source, /keepalive:\s*true/);
});

await runTest('profile account page does not eagerly mount heavy record stores for inactive tabs', () => {
  const source = read('src/app/profile/page.tsx');
  assert.doesNotMatch(source, /useCreationHistory\(/);
  assert.doesNotMatch(source, /useCreditRecords\(/);
  assert.doesNotMatch(source, /useUserOrders\(/);
  assert.match(source, /getCreationRecordCount\(/);
  assert.doesNotMatch(source, /<CreditsTab[^>]*creditRecords=/);
  assert.doesNotMatch(source, /<OrdersTab[^>]*orders=/);
});

await runTest('creation panels request scoped lightweight history instead of repeated full history payloads', () => {
  const expectations = [
    ['src/components/create/text-to-image.tsx', "useCreationHistory({ mode: 'text2img', limit: 60 })"],
    ['src/components/create/image-to-image.tsx', "useCreationHistory({ mode: 'img2img', limit: 60 })"],
    ['src/components/create/text-to-video.tsx', "useCreationHistory({ mode: 'text2video', limit: 60 })"],
    ['src/components/create/image-to-video.tsx', "useCreationHistory({ mode: 'img2video', limit: 60 })"],
    ['src/components/create/reverse-prompt-panel.tsx', "useCreationHistory({ mode: 'reverse-prompt', limit: 60 })"],
  ];
  for (const [file, expected] of expectations) {
    assert.ok(read(file).includes(expected), `${file} should use scoped creation history`);
  }

  const storeSource = read('src/lib/creation-history-store.ts');
  assert.match(storeSource, /inflightHistoryRequests/);
  assert.match(storeSource, /buildHistoryUrl\(scope/);

  const routeSource = read('src/app/api/creation-history/route.ts');
  assert.match(routeSource, /searchParams\.get\('limit'\)/);
  assert.match(routeSource, /searchParams\.get\('mode'\)/);
});
