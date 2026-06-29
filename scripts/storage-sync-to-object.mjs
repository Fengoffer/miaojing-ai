#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

if (process.env.MIAOJING_LOAD_ENV_FILE !== '0') {
  loadEnvFile(path.join(process.cwd(), '.env.local'));
}

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const verifyOnly = args.has('--verify-only');
const localRoot = path.resolve(process.env.LOCAL_STORAGE_DIR || path.join(process.cwd(), 'local-storage'));
const bucket = requiredEnv('OBJECT_STORAGE_BUCKET');
const region = process.env.OBJECT_STORAGE_REGION || 'auto';
const endpoint = process.env.OBJECT_STORAGE_ENDPOINT || undefined;
const prefix = normalizePrefix(process.env.OBJECT_STORAGE_PREFIX || '');
const forcePathStyle = booleanEnv(process.env.OBJECT_STORAGE_FORCE_PATH_STYLE, true);

const client = new S3Client({
  region,
  endpoint,
  forcePathStyle,
  credentials: process.env.OBJECT_STORAGE_ACCESS_KEY_ID && process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY
    ? {
        accessKeyId: process.env.OBJECT_STORAGE_ACCESS_KEY_ID,
        secretAccessKey: process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY,
      }
    : undefined,
});

if (!fs.existsSync(localRoot) || !fs.statSync(localRoot).isDirectory()) {
  console.error(`Local storage directory does not exist: ${localRoot}`);
  process.exit(1);
}

const files = walk(localRoot);
let uploaded = 0;
let skipped = 0;
let verified = 0;
const failures = [];

for (const filePath of files) {
  const key = toObjectKey(path.relative(localRoot, filePath));
  const stat = fs.statSync(filePath);
  try {
    const existing = await headObject(key);
    if (existing && Number(existing.ContentLength || 0) === stat.size) {
      skipped++;
      verified++;
      continue;
    }
    if (verifyOnly) {
      failures.push(`${key}: missing or size mismatch`);
      continue;
    }
    if (!dryRun) {
      await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: fs.createReadStream(filePath),
        ContentType: getContentType(key),
      }));
      const after = await headObject(key);
      if (!after || Number(after.ContentLength || 0) !== stat.size) {
        failures.push(`${key}: uploaded size mismatch`);
        continue;
      }
    }
    uploaded++;
    verified++;
  } catch (error) {
    failures.push(`${key}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log(JSON.stringify({
  dryRun,
  verifyOnly,
  localRoot,
  bucket,
  endpoint,
  prefix,
  totalFiles: files.length,
  uploaded,
  skipped,
  verified,
  failures,
}, null, 2));

if (failures.length > 0) process.exit(1);

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

function requiredEnv(key) {
  const value = process.env[key]?.trim();
  if (!value) {
    console.error(`${key} is required`);
    process.exit(1);
  }
  return value;
}

function booleanEnv(value, fallback) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function normalizePrefix(value) {
  const normalized = path.posix.normalize(value.replace(/\\/g, '/')).replace(/^\/+|\/+$/g, '');
  if (!normalized || normalized === '.') return '';
  if (normalized.startsWith('../') || normalized.includes('/../') || normalized.includes('\0')) {
    throw new Error('Invalid OBJECT_STORAGE_PREFIX');
  }
  return normalized;
}

function toObjectKey(relativePath) {
  const key = relativePath.split(path.sep).join('/');
  return prefix ? `${prefix}/${key}` : key;
}

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap(entry => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    return entry.isFile() ? [fullPath] : [];
  });
}

async function headObject(key) {
  try {
    return await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  } catch {
    return null;
  }
}

function getContentType(key) {
  const ext = key.split('.').pop()?.toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'mp4') return 'video/mp4';
  if (ext === 'webm') return 'video/webm';
  if (ext === 'json') return 'application/json';
  return 'application/octet-stream';
}
