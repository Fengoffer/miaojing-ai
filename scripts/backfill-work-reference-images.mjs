#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import pg from 'pg';

if (process.env.MIAOJING_LOAD_ENV_FILE !== '0') {
  loadEnvFile(path.join(process.cwd(), '.env.local'));
}

const { Client } = pg;
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const referenceImageStorage = await import('../src/lib/reference-image-storage.ts');
const persistReferenceImages = referenceImageStorage.persistReferenceImages
  || referenceImageStorage.default?.persistReferenceImages;
const verbose = args.has('--verbose');

if (args.has('--check-import')) {
  if (typeof persistReferenceImages !== 'function') {
    throw new Error('persistReferenceImages import failed');
  }
  console.log(JSON.stringify({ ok: true, import: 'persistReferenceImages' }));
  process.exit(0);
}
const limitArg = [...args].find(arg => arg.startsWith('--limit='));
const limit = Math.max(1, Math.min(5000, Number(limitArg?.split('=')[1] || 500)));
const timeoutArg = [...args].find(arg => arg.startsWith('--item-timeout-ms='));
const itemTimeoutMs = Math.max(5_000, Math.min(300_000, Number(timeoutArg?.split('=')[1] || 90_000)));

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, '');
  }
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getReferenceInputs(params) {
  const values = [
    params.referenceImage,
    ...(Array.isArray(params.referenceImages) ? params.referenceImages : []),
    params.image,
    ...(Array.isArray(params.images) ? params.images : []),
    ...(Array.isArray(params.extraImages) ? params.extraImages : []),
    params.sourceImage,
    params.source_image,
    params.inputImage,
    params.input_image,
  ];
  return [...new Set(values.map(normalizeString).filter(value => value && !value.startsWith('[')))];
}

function shouldBackfill(params) {
  const references = getReferenceInputs(params);
  const hasThumbnails = Array.isArray(params.referenceImageThumbnails) && params.referenceImageThumbnails.length > 0;
  return references.some(value => value.startsWith('data:image/') || /^https?:\/\//i.test(value) || value.startsWith('/api/local-storage/'))
    && (!Array.isArray(params.referenceImages) || params.referenceImages.length === 0 || !hasThumbnails || references.some(value => value.startsWith('data:image/')));
}

function withTimeout(promise, timeoutMs, label) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

async function main() {
  const connectionString = process.env.LOCAL_DB_URL || process.env.DATABASE_URL;
  if (!connectionString) throw new Error('LOCAL_DB_URL or DATABASE_URL is required');
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query(
      `SELECT id, params
         FROM works
        WHERE status = 'completed'
          AND (
            type IN ('img2img', 'img2video')
            OR params->>'creationMode' IN ('img2img', 'img2video')
            OR params->>'workType' IN ('img2img', 'img2video')
            OR params->>'referenceImage' IS NOT NULL
            OR jsonb_typeof(params->'referenceImages') = 'array'
          )
        ORDER BY created_at DESC
        LIMIT $1`,
      [limit],
    );

    let candidates = 0;
    let updated = 0;
    let skipped = 0;
    for (const row of result.rows) {
      const params = row.params || {};
      if (!shouldBackfill(params)) {
        skipped += 1;
        continue;
      }
      candidates += 1;
      if (dryRun) continue;
      const references = getReferenceInputs(params);
      if (verbose) {
        console.log(JSON.stringify({
          event: 'backfill-reference-images:start',
          id: row.id,
          index: candidates,
          references: references.length,
        }));
      }
      let persisted;
      try {
        persisted = await withTimeout(
          persistReferenceImages(references),
          itemTimeoutMs,
          `work ${row.id}`,
        );
      } catch (error) {
        skipped += 1;
        console.warn('[backfill-work-reference-images] skipped row:', row.id, error instanceof Error ? error.message : error);
        continue;
      }
      if (persisted.length === 0) {
        skipped += 1;
        continue;
      }
      const referenceImages = persisted.map(item => item.url);
      const referenceImageThumbnails = persisted.map(item => item.thumbnailUrl || item.url);
      await client.query(
        `UPDATE works
            SET params = $2::jsonb
          WHERE id = $1`,
        [
          row.id,
          JSON.stringify({
            ...params,
            referenceImage: referenceImages[0],
            referenceImages,
            referenceImageThumbnails,
            refImageCount: Math.max(Number(params.refImageCount || 0), referenceImages.length),
          }),
        ],
      );
      updated += 1;
      if (verbose) {
        console.log(JSON.stringify({
          event: 'backfill-reference-images:updated',
          id: row.id,
          index: candidates,
          persisted: persisted.length,
        }));
      }
    }

    console.log(JSON.stringify({
      dryRun,
      scanned: result.rowCount,
      candidates,
      updated,
      skipped,
      limit,
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
