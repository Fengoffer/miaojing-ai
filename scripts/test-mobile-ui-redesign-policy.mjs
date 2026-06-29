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

await runTest('mobile navigation is a first-class safe-area tab bar with accessible controls', () => {
  const source = read('src/components/navbar.tsx');
  assert.match(source, /aria-label="打开导航菜单"/, 'mobile menu button should expose an accessible label');
  assert.match(source, /aria-expanded=\{mobileOpen\}/, 'mobile menu button should expose expanded state');
  assert.match(source, /aria-label="主导航"/, 'mobile bottom navigation should expose a nav label');
  assert.match(source, /mobile-bottom-nav/, 'bottom navigation should use the mobile redesign class');
  assert.match(source, /aria-label=\{item\.label\}/, 'bottom nav icon links should have accessible labels');
});

await runTest('home page uses a dedicated mobile-first product surface instead of desktop marketing sections only', () => {
  const source = read('src/app/page.tsx');
  assert.match(source, /mobile-home-page/, 'home page should opt into mobile shell styling');
  assert.match(source, /mobile-hero-card/, 'home hero should have a compact mobile card surface');
  assert.match(source, /mobile-quick-action-grid/, 'home page should expose primary actions as mobile tiles');
  assert.match(source, /mobile-feature-rail/, 'core creation modes should become a horizontal mobile rail');
  assert.doesNotMatch(source, /99\.9%/, 'home page should avoid fake-perfect marketing metrics');
});

await runTest('gallery mobile keeps discovery controls and detail overlay usable on phone screens', () => {
  const source = read('src/app/gallery/page.tsx');
  assert.match(source, /gallery-mobile-page/, 'gallery page should opt into mobile shell styling');
  assert.match(source, /gallery-mobile-filter-bar/, 'category and sort controls should have a mobile filter bar');
  assert.match(source, /gallery-detail-shell/, 'detail overlay should expose a responsive shell class');
  assert.match(source, /gallery-detail-media/, 'detail overlay media pane should be targetable for mobile layout');
  assert.match(source, /gallery-detail-panel/, 'detail overlay metadata/actions pane should be targetable for mobile layout');
});

await runTest('profile mobile turns account management into a compact dashboard with reachable tabs', () => {
  const source = read('src/app/profile/page.tsx');
  assert.match(source, /profile-mobile-page/, 'profile page should opt into mobile shell styling');
  assert.match(source, /profile-mobile-hero/, 'profile header should have a mobile hero treatment');
  assert.match(source, /profile-mobile-stats/, 'profile metrics should use a mobile stat grid');
  assert.match(source, /profile-mobile-tabs/, 'profile tabs should become horizontally scrollable on mobile');
  assert.match(source, /profile-mobile-card/, 'profile content cards should have mobile-safe padding and radius');
});

await runTest('auth and console login pages use mobile-safe app entry layouts', () => {
  for (const relativePath of [
    'src/app/auth/login/page.tsx',
    'src/app/auth/register/page.tsx',
    'src/modules/console/pages/console-login-page.tsx',
  ]) {
    const source = read(relativePath);
    assert.match(source, /auth-mobile-page/, `${relativePath} should opt into the shared auth mobile page shell`);
    assert.match(source, /auth-mobile-shell/, `${relativePath} should constrain the auth form shell on phones`);
    assert.match(source, /auth-mobile-card/, `${relativePath} should expose the auth card for mobile padding/radius rules`);
  }

  const loginSource = read('src/app/auth/login/page.tsx');
  const registerSource = read('src/app/auth/register/page.tsx');
  const agreementSource = read('src/components/auth/registration-agreement-dialog.tsx');
  assert.match(loginSource, /auth-mobile-code-row/, 'login/register tab should make email-code rows wrap safely on narrow phones');
  assert.match(registerSource, /auth-mobile-code-row/, 'standalone register page should make email-code rows wrap safely on narrow phones');
  assert.match(agreementSource, /auth-mobile-dialog/, 'registration agreement dialog should have a mobile viewport/safe-area class');
});

await runTest('policy pages use readable mobile article surfaces instead of a squeezed desktop card', () => {
  const source = read('src/components/site-policy-page.tsx');
  assert.match(source, /policy-mobile-page/, 'policy shell should expose mobile page styling');
  assert.match(source, /policy-mobile-shell/, 'policy content should use a mobile safe-area shell');
  assert.match(source, /policy-mobile-header/, 'policy header actions should be targetable on phones');
  assert.match(source, /policy-mobile-content/, 'policy markdown card should use mobile article spacing');
});

await runTest('global CSS defines mobile safe-area, detail, home, gallery, and profile layout rules', () => {
  const css = read('src/app/globals.css');
  assert.match(css, /--mobile-bottom-nav-height:\s*4\.25rem/, 'global mobile nav height token should be defined');
  assert.match(css, /\.mobile-bottom-nav\s*\{/, 'bottom nav redesign class should be styled');
  assert.match(css, /\.mobile-home-page\s*\{/, 'home mobile shell should be styled');
  assert.match(css, /\.mobile-feature-rail\s*\{/, 'home feature rail should be styled');
  assert.match(css, /\.gallery-mobile-filter-bar\s*\{/, 'gallery mobile filter bar should be styled');
  assert.match(css, /\.gallery-detail-shell\s*\{[^}]*flex-direction:\s*column/s, 'gallery detail should stack on mobile');
  assert.match(css, /\.profile-mobile-tabs\s*\{[^}]*overflow-x:\s*auto/s, 'profile tabs should scroll horizontally on mobile');
  assert.match(css, /\.auth-mobile-page\s*\{/, 'auth pages should have a shared mobile page shell');
  assert.match(css, /\.auth-mobile-page\s*\{[^}]*position:\s*relative/s, 'auth page should contain absolute background effects');
  assert.match(css, /\.auth-mobile-shell\s*\{[^}]*width:\s*min\(100%,\s*calc\(100vw - 1\.7rem\)\)/s, 'auth form shell should clamp to the padded mobile viewport');
  assert.match(css, /\.auth-mobile-page\s*>\s*\.absolute\s*\{[^}]*overflow:\s*hidden/s, 'auth background glow should not create horizontal document overflow');
  assert.match(css, /\.auth-mobile-code-row\s*\{[^}]*grid-template-columns:\s*1fr/s, 'auth code rows should wrap to one column on phones');
  assert.match(css, /\.auth-mobile-dialog\s*\{[^}]*max-height:\s*calc\(100dvh/s, 'auth dialogs should respect mobile viewport height');
  assert.match(css, /\.policy-mobile-content\s*\{[^}]*font-size:\s*0\.95rem/s, 'policy markdown should use readable mobile type');
  assert.match(css, /\.console-mobile-content table\s*\{[^}]*min-width:\s*48rem/s, 'console data tables should remain horizontally scrollable on phones');
});

if (process.exitCode) process.exit(process.exitCode);
