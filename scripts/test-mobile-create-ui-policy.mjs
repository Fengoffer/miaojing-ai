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

const panelFiles = [
  'src/components/create/text-to-image.tsx',
  'src/components/create/image-to-image.tsx',
  'src/components/create/text-to-video.tsx',
  'src/components/create/image-to-video.tsx',
  'src/components/create/reverse-prompt-panel.tsx',
];

await runTest('mobile composer supports custom input content for non-text-only creation modes', () => {
  const source = read('src/components/create/mobile-creation-composer.tsx');
  assert.match(source, /input\?: ReactNode/, 'MobileCreationComposer should expose an input slot');
  assert.match(source, /\{input \?\? \(/, 'MobileCreationComposer should render the custom input instead of the default textarea');
  assert.match(source, /aria-busy=\{generating \|\| undefined\}/, 'MobileCreationComposer should expose generating state to assistive tech');
  assert.match(source, /generating \? <Loader2/, 'MobileCreationComposer should show an inline loading indicator while generating');
});

await runTest('all creation panels render the mobile composer', () => {
  for (const relativePath of panelFiles) {
    const source = read(relativePath);
    assert.match(source, /MobileCreationComposer/, `${relativePath} should import and render MobileCreationComposer`);
  }
});

await runTest('non-text-to-image panels keep mobile conversation status flows', () => {
  for (const relativePath of panelFiles.slice(1)) {
    const source = read(relativePath);
    assert.match(source, /create-mobile-history-flow/, `${relativePath} should render a mobile history/status flow above the fixed composer`);
    assert.match(source, /useIsMobile/, `${relativePath} should only mount the mobile flow on mobile viewports`);
  }
});

await runTest('all creation panels show a mobile empty state before the first result', () => {
  const componentSource = read('src/components/create/mobile-create-empty-state.tsx');
  assert.match(componentSource, /create-mobile-empty-state/, 'shared mobile empty state should have a stable class');
  for (const relativePath of panelFiles) {
    const source = read(relativePath);
    assert.match(source, /MobileCreateEmptyState/, `${relativePath} should render the shared mobile empty state`);
    assert.match(source, /create-mobile-history-flow/, `${relativePath} should keep the empty state inside the mobile thread`);
  }
});

await runTest('mobile image reference modes preserve mention-aware prompt input', () => {
  for (const relativePath of [
    'src/components/create/image-to-image.tsx',
    'src/components/create/image-to-video.tsx',
  ]) {
    const source = read(relativePath);
    assert.match(source, /ReferenceImageMentionControls/, `${relativePath} should still use @ reference controls`);
    assert.match(source, /create-mobile-reference-strip/, `${relativePath} should show uploaded references in the mobile composer`);
    assert.match(source, /input=\{\(/, `${relativePath} should pass the mention-aware input into MobileCreationComposer`);
  }
});

await runTest('reverse prompt mobile composer keeps upload and mode controls reachable', () => {
  const source = read('src/components/create/reverse-prompt-panel.tsx');
  assert.match(source, /create-mobile-reverse-upload/, 'reverse prompt should expose mobile upload/change-image controls');
  assert.match(source, /create-mobile-reverse-controls/, 'reverse prompt should expose mobile mode/language controls');
  assert.match(source, /MobileCreationComposer/, 'reverse prompt should render MobileCreationComposer');
});

await runTest('mobile conversation is separated from the bottom composer instead of being covered by it', () => {
  const css = read('src/app/globals.css');
  const composerSource = read('src/components/create/mobile-creation-composer.tsx');
  assert.match(css, /\.create-mobile-shell\s*\{[^}]*height:\s*calc\(/, 'mobile create shell should own the available viewport-height region');
  assert.match(css, /\.create-chat-layout\s*\{[^}]*height:\s*100%/, 'mobile create layout should fill the shell instead of growing under the composer');
  assert.match(css, /\.create-chat-layout\s*\{[^}]*overflow:\s*hidden/, 'mobile create layout should clip children to the conversation/composer split');
  assert.match(css, /\.create-chat-thread\s*\{[^}]*overflow-y:\s*auto/, 'mobile conversation thread should scroll independently above the composer');
  assert.match(css, /\.create-chat-thread\s*\{[^}]*padding-bottom:\s*calc\(var\(--create-mobile-composer-height/, 'mobile conversation thread should reserve the measured composer height');
  assert.match(css, /\.create-mobile-dialog-composer\s*\{[^}]*position:\s*fixed/, 'mobile composer should stay fixed to the bottom like a chat input');
  assert.doesNotMatch(css, /\.create-mobile-dialog-composer\s*\{[^}]*position:\s*sticky/, 'mobile composer should not drift inside the thread layout');
  assert.match(composerSource, /ResizeObserver/, 'mobile composer should measure its height when params, styles, or references change');
  assert.match(composerSource, /--create-mobile-composer-height/, 'mobile composer should publish its measured height to the layout');
  assert.doesNotMatch(css, /\.create-mobile-dialog-composer::before/, 'mobile composer should not render the user screenshot annotation as a red divider');
  assert.doesNotMatch(css, /rgb\(219 73 50/, 'mobile create UI should not include a hard-coded red annotation line');
});

await runTest('mobile bottom navigation is not trapped by the sticky header', () => {
  const source = read('src/components/navbar.tsx');
  assert.match(source, /return\s*\(\s*<>/, 'Navbar should wrap the sticky header and fixed mobile nav as siblings');
  assert.match(
    source,
    /<\/header>\s*<nav className="fixed inset-x-0 bottom-0/,
    'fixed mobile bottom navigation should be rendered outside the sticky header backdrop context',
  );
});

if (process.exitCode) process.exit(process.exitCode);
