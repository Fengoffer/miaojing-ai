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

await runTest('admin user management exposes reset password without hiding it behind edit modal', () => {
  const source = read('src/components/admin/user-management-tab.tsx');

  assert.match(source, /const startResetPassword = \(user: ManagedUser\) => \{/);
  assert.match(source, /setResetPwUser\(user\)/);
  assert.match(source, /setNewPassword\(''\)/);
  assert.match(source, /setEditingUser\(null\)/);
  assert.match(source, /onClick=\{\(\) => startResetPassword\(user\)\}/);
  assert.match(source, /<KeyRound className="h-3\.5 w-3\.5" \/>重置密码/);
  assert.match(source, /onClick=\{\(\) => startResetPassword\(editingUser\)\}/);
});

await runTest('admin reset password form is rendered as an overlay dialog', () => {
  const source = read('src/components/admin/user-management-tab.tsx');
  const resetSection = source.slice(source.indexOf('{resetPwUser && ('), source.indexOf('{editingUser && ('));

  assert.match(resetSection, /fixed inset-0 z-50/);
  assert.match(resetSection, /max-h-\[90vh\] overflow-y-auto/);
  assert.doesNotMatch(resetSection, /\{resetPwUser && \(\s*<Card className="border-primary\/30">/);
  assert.match(source, /setRechargeUser\(null\)/);
  assert.match(source, /setShowAddForm\(false\)/);
});

await runTest('admin password reset upserts auth credentials instead of silently updating zero rows', () => {
  const source = read('src/lib/admin-users-service.ts');

  assert.match(source, /INSERT INTO auth\.users \(id, email, password_hash, created_at\)/);
  assert.match(source, /VALUES \(\$1, \$2, crypt\(\$3, gen_salt\('bf'\)\), NOW\(\)\)/);
  assert.match(source, /ON CONFLICT \(id\) DO UPDATE SET password_hash = crypt\(\$3, gen_salt\('bf'\)\)/);
  assert.match(source, /\[userId,\s*currentResult\.rows\[0\]\.email,\s*newPassword\]/);
});

await runTest('creation detail reuse supports text-to-video and image-to-video history records', () => {
  const source = read('src/components/creation-detail-dialog.tsx');

  assert.match(source, /buildCreationReuseDraft,\s*writeCreationReuseDraft/);
  assert.match(source, /function getReuseTarget\(record: CreationRecord\)/);
  assert.match(source, /return mode === 'img2video' \? 'img2video' : 'text2video'/);
  assert.match(source, /const target = getReuseTarget\(record\)/);
  assert.match(source, /writeCreationReuseDraft\(target,\s*draft\)/);
  assert.match(source, /router\.push\(`\/create\?type=\$\{target\}&reuse=\$\{encodeURIComponent\(record\.id\)\}`\)/);
  assert.doesNotMatch(source, /disabled=\{record\.type !== 'image'\}/);
  assert.doesNotMatch(source, /当前仅支持将图片创作配置复用到文生图/);
});

if (process.exitCode) process.exit(process.exitCode);
