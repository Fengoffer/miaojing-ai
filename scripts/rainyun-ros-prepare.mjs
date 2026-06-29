#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

if (process.env.MIAOJING_LOAD_ENV_FILE !== '0') {
  loadEnvFile(path.join(process.cwd(), '.env.local'));
}

const args = new Set(process.argv.slice(2));
const create = args.has('--create');
const list = args.has('--list');
const printEnv = args.has('--print-env');
const apiBaseUrl = trimTrailingSlash(process.env.RAINYUN_API_BASE_URL || 'https://api.v2.rainyun.com');
const apiKey = process.env.RAINYUN_API_KEY?.trim() || '';
const devToken = process.env.RAINYUN_DEV_TOKEN?.trim();
const bucketName = process.env.RAINYUN_ROS_BUCKET_NAME?.trim() || process.env.OBJECT_STORAGE_BUCKET?.trim();
const instanceId = Number(process.env.RAINYUN_ROS_INSTANCE_ID || 0);
const outputEnvPath = process.env.RAINYUN_ROS_OUTPUT_ENV || '.env.rainyun-object.generated';

if (!create && !list) {
  console.log(JSON.stringify({
    ok: true,
    dryRun: true,
    message: 'No network request was sent. Pass --list to list ROS buckets or --create to create one.',
    apiBaseUrl,
    createEndpoint: `${apiBaseUrl}/product/ros/bucket`,
    requiredEnv: ['RAINYUN_API_KEY', 'RAINYUN_ROS_BUCKET_NAME', 'RAINYUN_ROS_INSTANCE_ID'],
    outputEnvPath,
  }, null, 2));
  process.exit(0);
}

if (list) {
  const buckets = await rainyunRequest('/product/ros/bucket', { method: 'GET' });
  console.log(JSON.stringify({
    ok: true,
    action: 'list',
    buckets: sanitizeForLog(buckets),
  }, null, 2));
}

if (create) {
  if (!bucketName) throw new Error('RAINYUN_ROS_BUCKET_NAME or OBJECT_STORAGE_BUCKET is required');
  if (!Number.isInteger(instanceId) || instanceId <= 0) throw new Error('RAINYUN_ROS_INSTANCE_ID must be a positive integer');

  const bucket = await rainyunRequest('/product/ros/bucket', {
    method: 'POST',
    body: {
      bucket_name: bucketName,
      instance_id: instanceId,
    },
  });
  const env = buildObjectStorageEnv(bucket);
  if (!env.OBJECT_STORAGE_ENDPOINT) {
    throw new Error('Rainyun response did not include public_api_url; set OBJECT_STORAGE_ENDPOINT manually before migration');
  }
  writeEnvFile(outputEnvPath, env);
  console.log(JSON.stringify({
    ok: true,
    action: 'create',
    bucket: sanitizeForLog(bucket),
    outputEnvPath,
    printedEnv: printEnv ? redactEnv(env) : undefined,
    nextSteps: [
      `Review ${outputEnvPath} and copy the OBJECT_STORAGE_* values into production .env.local`,
      'Set STORAGE_MODE=dual first, not object',
      'Run pnpm run migration:check before migration',
      'Run pnpm run storage:sync-object -- --dry-run',
      'Run pnpm run storage:sync-object',
      'Run pnpm run storage:sync-object -- --verify-only',
      'Reload PM2 and run pnpm run migration:check again',
    ],
  }, null, 2));
}

async function rainyunRequest(endpoint, options = {}) {
  if (!apiKey) throw new Error('RAINYUN_API_KEY is required');
  const response = await fetch(`${apiBaseUrl}${endpoint}`, {
    method: options.method || 'GET',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      ...(devToken ? { 'rain-dev-token': devToken } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!response.ok) {
    throw new Error(`Rainyun API ${response.status}: ${typeof parsed === 'string' ? parsed.slice(0, 500) : JSON.stringify(sanitizeForLog(parsed))}`);
  }
  return unwrapRainyunData(parsed);
}

function unwrapRainyunData(value) {
  if (value && typeof value === 'object') {
    if ('data' in value && value.data && typeof value.data === 'object') return value.data;
    if ('Data' in value && value.Data && typeof value.Data === 'object') return value.Data;
  }
  return value;
}

function buildObjectStorageEnv(bucket) {
  const source = bucket && typeof bucket === 'object' ? bucket : {};
  const instance = source.instance && typeof source.instance === 'object' ? source.instance : {};
  const endpoint = normalizeEndpoint(
    firstString(source.public_api_url, instance.public_api_url, process.env.OBJECT_STORAGE_ENDPOINT),
  );
  return {
    STORAGE_MODE: 'dual',
    OBJECT_STORAGE_BUCKET: firstString(source.name, source.bucket_name, bucketName),
    OBJECT_STORAGE_REGION: process.env.OBJECT_STORAGE_REGION || 'auto',
    OBJECT_STORAGE_ENDPOINT: endpoint,
    OBJECT_STORAGE_ACCESS_KEY_ID: firstString(source.access_key, instance.access_key, process.env.OBJECT_STORAGE_ACCESS_KEY_ID),
    OBJECT_STORAGE_SECRET_ACCESS_KEY: firstString(source.secret_key, instance.secret_key, process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY),
    OBJECT_STORAGE_FORCE_PATH_STYLE: process.env.OBJECT_STORAGE_FORCE_PATH_STYLE || 'true',
    OBJECT_STORAGE_PREFIX: process.env.OBJECT_STORAGE_PREFIX || 'miaojing',
  };
}

function normalizeEndpoint(value) {
  const raw = firstString(value);
  if (!raw) return '';
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withProtocol);
    url.pathname = url.pathname.replace(/\/+$/, '');
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return withProtocol.replace(/\/+$/, '');
  }
}

function writeEnvFile(filePath, env) {
  const lines = [
    '# Generated by scripts/rainyun-ros-prepare.mjs',
    '# Keep this file private. It contains object storage credentials.',
    ...Object.entries(env).map(([key, value]) => `${key}=${quoteEnvValue(value)}`),
    '',
  ];
  fs.writeFileSync(filePath, lines.join('\n'), { mode: 0o600 });
}

function redactEnv(env) {
  return Object.fromEntries(Object.entries(env).map(([key, value]) => [
    key,
    /SECRET|KEY/i.test(key) ? redact(value) : value,
  ]));
}

function sanitizeForLog(value) {
  if (Array.isArray(value)) return value.map(sanitizeForLog);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [
    key,
    /secret|access_key|api[_-]?key|token/i.test(key) ? redact(String(nested || '')) : sanitizeForLog(nested),
  ]));
}

function redact(value) {
  if (!value) return '';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function quoteEnvValue(value) {
  const text = String(value ?? '');
  if (/^[A-Za-z0-9._~:/@-]*$/.test(text)) return text;
  return JSON.stringify(text);
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, '');
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
