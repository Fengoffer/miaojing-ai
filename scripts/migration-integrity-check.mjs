#!/usr/bin/env node
import fs from 'fs';
import { Pool } from 'pg';
import {
  checkStorageUrl,
  getMigrationCheckBaseUrl,
  getMigrationStorageUrlConcurrency,
  getMigrationStorageUrlTimeoutMs,
} from './migration-integrity-check-helpers.mjs';

if (process.env.MIAOJING_LOAD_ENV_FILE !== '0') {
  loadEnvFile('.env.local');
}

const connectionString = process.env.LOCAL_DB_URL;
if (!connectionString) {
  console.error('LOCAL_DB_URL is required');
  process.exit(1);
}

const baseUrl = getMigrationCheckBaseUrl();
const maxStorageUrls = Number(process.env.MIGRATION_CHECK_STORAGE_URL_LIMIT || 200);
const storageUrlTimeoutMs = getMigrationStorageUrlTimeoutMs();
const storageUrlConcurrency = getMigrationStorageUrlConcurrency();
const pool = new Pool({ connectionString, max: 2 });
const checks = [];

try {
  await collectChecks();
  const blockers = checks.filter(check => check.severity === 'blocker' && check.value > 0);
  const warnings = checks.filter(check => check.severity === 'warning' && check.value > 0);
  console.log(JSON.stringify({
    ok: blockers.length === 0,
    baseUrl,
    checkedAt: new Date().toISOString(),
    blockers,
    warnings,
    checks,
  }, null, 2));
  process.exit(blockers.length === 0 ? 0 : 1);
} finally {
  await pool.end().catch(() => undefined);
}

async function collectChecks() {
  await scalar('profiles_total', 'info', 'select count(*) from profiles');
  await scalar('auth_users_total', 'info', 'select count(*) from auth.users');
  await scalar('works_total', 'info', 'select count(*) from works');
  await scalar('private_works_total', 'info', 'select count(*) from works where is_public = false');

  await scalar('profiles_without_auth', 'blocker', 'select count(*) from profiles p left join auth.users au on au.id = p.id where au.id is null');
  await scalar('auth_without_profile', 'blocker', 'select count(*) from auth.users au left join profiles p on p.id = au.id where p.id is null');
  await scalar('missing_password_hash', 'blocker', "select count(*) from auth.users where coalesce(password_hash, '') = ''");

  await scalar('works_missing_profile', 'blocker', 'select count(*) from works w left join profiles p on p.id = w.user_id where w.user_id is not null and p.id is null');
  await scalar('works_missing_user_id', 'blocker', 'select count(*) from works where user_id is null');
  await scalar('credit_tx_missing_profile', 'blocker', 'select count(*) from credit_transactions ct left join profiles p on p.id = ct.user_id where ct.user_id is not null and p.id is null');
  await scalar('credit_tx_missing_work', 'blocker', 'select count(*) from credit_transactions ct left join works w on w.id = ct.related_work_id where ct.related_work_id is not null and w.id is null');
  await scalar('credit_tx_user_work_mismatch', 'blocker', 'select count(*) from credit_transactions ct join works w on w.id = ct.related_work_id where ct.user_id is not null and w.user_id is not null and ct.user_id <> w.user_id');
  await scalar('orders_missing_profile', 'blocker', 'select count(*) from orders o left join profiles p on p.id = o.user_id where o.user_id is not null and p.id is null');
  await scalar('redeem_codes_created_by_missing_profile', 'blocker', "select case when to_regclass('public.redeem_codes') is null then 0 else (select count(*) from redeem_codes rc left join profiles p on p.id = rc.created_by where rc.created_by is not null and p.id is null) end");
  await scalar('redeem_codes_used_by_missing_profile', 'blocker', "select case when to_regclass('public.redeem_codes') is null then 0 else (select count(*) from redeem_codes rc left join profiles p on p.id = rc.used_by where rc.used_by is not null and p.id is null) end");
  await scalar('invitation_referrals_missing_inviter', 'blocker', "select case when to_regclass('public.invitation_referrals') is null then 0 else (select count(*) from invitation_referrals ir left join profiles p on p.id = ir.inviter_user_id where p.id is null) end");
  await scalar('invitation_referrals_missing_invitee', 'blocker', "select case when to_regclass('public.invitation_referrals') is null then 0 else (select count(*) from invitation_referrals ir left join profiles p on p.id = ir.invitee_user_id where p.id is null) end");
  await scalar('user_api_keys_missing_profile', 'blocker', 'select count(*) from user_api_keys k left join profiles p on p.id = k.user_id where k.user_id is not null and p.id is null');
  await scalar('user_api_keys_missing_preview', 'blocker', "select count(*) from user_api_keys where coalesce(api_key_encrypted, '') <> '' and coalesce(api_key_preview, '') = ''");
  await scalar('system_api_missing_preview', 'blocker', "select count(*) from system_api_configs where coalesce(api_key_encrypted, '') <> '' and coalesce(api_key_preview, '') = ''");
  await scalar('work_likes_missing_profile', 'blocker', 'select count(*) from work_likes wl left join profiles p on p.id = wl.user_id where wl.user_id is not null and p.id is null');
  await scalar('work_likes_missing_work', 'blocker', 'select count(*) from work_likes wl left join works w on w.id = wl.work_id where wl.work_id is not null and w.id is null');
  await scalar('generation_jobs_missing_profile', 'blocker', 'select count(*) from generation_jobs gj left join profiles p on p.id = gj.user_id where gj.user_id is not null and p.id is null');

  await scalar('same_url_different_users', 'info', "select count(*) from (select result_url from works where coalesce(result_url, '') <> '' group by result_url having count(distinct user_id) > 1) t");
  await scalar('duplicate_url_same_user', 'warning', "select count(*) from (select user_id, result_url from works where coalesce(result_url, '') <> '' group by user_id, result_url having count(*) > 1) t");

  for (const [table, column] of [
    ['user_api_keys', 'manifest_path'],
    ['system_api_configs', 'manifest_path'],
    ['system_api_configs', 'billing_mode'],
    ['system_api_configs', 'fixed_price'],
    ['system_api_configs', 'duration_price_per_second'],
    ['system_api_configs', 'input_price_per_1k'],
    ['system_api_configs', 'output_price_per_1k'],
    ['system_api_configs', 'is_default'],
    ['system_api_configs', 'allowed_membership_tiers'],
    ['system_api_configs', 'polling_mode'],
    ['system_api_configs', 'polling_order'],
    ['profiles', 'invite_code'],
    ['profiles', 'referred_by_user_id'],
    ['invitation_referrals', 'invite_code'],
    ['invitation_referrals', 'inviter_user_id'],
    ['invitation_referrals', 'invitee_user_id'],
  ]) {
    await requiredColumn(table, column);
  }

  await checkLocalStorageUrls();
}

async function scalar(name, severity, sql, params = []) {
  const res = await pool.query(sql, params);
  checks.push({
    name,
    severity,
    value: Number(res.rows[0]?.count ?? res.rows[0]?.value ?? 0),
  });
}

async function requiredColumn(table, column) {
  const [schema, tableName] = table.includes('.') ? table.split('.', 2) : ['public', table];
  const res = await pool.query(
    'select count(*)::int as count from information_schema.columns where table_schema = $1 and table_name = $2 and column_name = $3',
    [schema, tableName, column],
  );
  checks.push({
    name: `column_${table}_${column}`,
    severity: 'blocker',
    value: Number(res.rows[0]?.count || 0) === 1 ? 0 : 1,
  });
}

async function checkLocalStorageUrls() {
  const res = await pool.query(`
    with urls as (
      select result_url as url from works where result_url like '/api/local-storage/%'
      union select thumbnail_url as url from works where thumbnail_url like '/api/local-storage/%'
      union select logo_url as url from site_config where logo_url like '/api/local-storage/%'
      union select favicon_url as url from site_config where favicon_url like '/api/local-storage/%'
    )
    select url from urls where url is not null limit $1
  `, [Number.isFinite(maxStorageUrls) && maxStorageUrls > 0 ? maxStorageUrls : 200]);

  let missing = 0;
  let checked = 0;
  let cursor = 0;
  const workers = Array.from({ length: Math.min(storageUrlConcurrency, Math.max(1, res.rows.length)) }, async () => {
    while (cursor < res.rows.length) {
      const row = res.rows[cursor++];
      const result = await checkStorageUrl(baseUrl, row.url, { timeoutMs: storageUrlTimeoutMs });
      checked += 1;
      if (!result.ok) missing += 1;
    }
  });
  await Promise.all(workers);

  checks.push({ name: 'local_storage_urls_checked', severity: 'info', value: res.rows.length });
  checks.push({ name: 'local_storage_urls_probe_completed', severity: 'info', value: checked });
  checks.push({ name: 'local_storage_urls_missing', severity: 'blocker', value: missing });
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = value.replace(/^['"]|['"]$/g, '');
  }
}
