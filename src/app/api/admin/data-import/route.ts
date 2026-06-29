import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { localStorage } from '@/lib/local-storage';
import { ensureRedeemCodeSchema } from '@/lib/redeem-code-service';
import { ensureInvitationSchema } from '@/lib/invitation-service';
import { encryptSecret, previewSecret } from '@/lib/server-crypto';
import { getDbClient } from '@/storage/database/local-db';
import crypto from 'crypto';

interface ImportMeta {
  version: string;
  platform: string;
  exported_at: string;
  tables: string[];
  counts: Record<string, number>;
}

interface ImportPayload {
  _meta: ImportMeta;
  data: Record<string, unknown[]>;
  _media?: Record<string, ImportMediaEntry>;
  options?: {
    skipAuth?: boolean;
  };
}

type ImportMediaEntry = {
  contentType?: string;
  encoding?: 'base64';
  data?: string;
  dataUrl?: string;
  size?: number;
  sha256?: string;
};

const MAX_ROWS_PER_TABLE = 5000;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_ID_TABLES = new Set([
  'auth.users',
  'profiles',
  'announcements',
  'works',
  'credit_transactions',
  'invitation_referrals',
  'redeem_codes',
  'orders',
  'user_api_keys',
  'system_api_configs',
  'api_providers',
  'model_recommendations',
  'image_style_presets',
  'work_likes',
  'generation_jobs',
  'platform_logs',
]);

const TABLE_COLUMNS: Record<string, string[]> = {
  profiles: ['id', 'email', 'nickname', 'display_nickname', 'avatar_url', 'phone', 'role', 'membership_tier', 'membership_expires_at', 'credits_balance', 'daily_quota_used', 'daily_quota_limit', 'is_active', 'preferred_theme', 'watermark_disabled', 'invite_code', 'referred_by_user_id', 'created_at', 'updated_at'],
  site_config: ['id', 'site_name', 'site_tab_title', 'site_description', 'site_keywords', 'logo_url', 'favicon_url', 'announcement', 'membership_enabled', 'terms_of_service', 'privacy_policy', 'about_us', 'help_center', 'filing_info', 'filing_url', 'public_security_filing_info', 'public_security_filing_url', 'redeem_code_mall_url', 'log_retention_days', 'image_composition_skill_enabled', 'updated_at'],
  site_stats: ['id', 'total_visits', 'total_users', 'total_generations', 'updated_at'],
  announcements: ['id', 'title', 'content', 'type', 'is_active', 'starts_at', 'expires_at', 'created_at', 'updated_at'],
  works: ['id', 'user_id', 'title', 'type', 'prompt', 'negative_prompt', 'params', 'result_url', 'thumbnail_url', 'width', 'height', 'duration', 'status', 'is_public', 'likes_count', 'views_count', 'credits_cost', 'created_at', 'updated_at'],
  credit_transactions: ['id', 'user_id', 'amount', 'balance_after', 'type', 'description', 'related_work_id', 'created_at'],
  invitation_referrals: ['id', 'invite_code', 'inviter_user_id', 'invitee_user_id', 'inviter_bonus_credits', 'invitee_bonus_credits', 'created_at'],
  redeem_codes: ['id', 'code', 'normalized_code', 'code_type', 'credits_amount', 'membership_tier', 'membership_duration_value', 'membership_duration_unit', 'batch_id', 'note', 'is_active', 'created_by', 'used_by', 'used_at', 'created_at', 'updated_at'],
  orders: ['id', 'user_id', 'order_no', 'product_type', 'product_name', 'amount', 'credits_amount', 'status', 'payment_method', 'paid_at', 'created_at', 'updated_at'],
  user_api_keys: ['id', 'user_id', 'provider', 'supplier_name', 'api_url', 'model_name', 'note', 'manifest_path', 'api_key_encrypted', 'api_key_preview', 'type', 'is_active', 'created_at', 'updated_at'],
  system_api_configs: ['id', 'provider', 'name', 'api_url', 'model_name', 'model_group', 'note', 'manifest_path', 'is_default', 'allowed_membership_tiers', 'polling_mode', 'polling_order', 'api_key_encrypted', 'api_key_preview', 'type', 'credits_per_use', 'billing_mode', 'fixed_price', 'duration_price_per_second', 'input_price_per_1k', 'output_price_per_1k', 'model_ratio', 'completion_ratio', 'group_ratio', 'price_note', 'is_active', 'sort_order', 'created_at', 'updated_at'],
  api_providers: ['id', 'name', 'default_api_url', 'default_model', 'type', 'website', 'is_active', 'sort_order', 'created_at', 'updated_at'],
  model_recommendations: ['id', 'model_name', 'display_name', 'type', 'provider_id', 'is_active', 'sort_order', 'created_at', 'updated_at'],
  generation_jobs: ['id', 'type', 'status', 'payload', 'result', 'error', 'user_id', 'provider', 'model_name', 'api_url', 'progress', 'created_at', 'started_at', 'finished_at', 'updated_at'],
  platform_logs: ['id', 'type', 'level', 'action', 'message', 'user_id', 'user_name', 'user_email', 'target_type', 'target_id', 'ip_address', 'user_agent', 'metadata', 'created_at'],
  image_style_presets: ['id', 'label', 'prompt', 'usage_count', 'is_active', 'sort_order', 'created_at', 'updated_at'],
  payment_methods: ['id', 'type', 'name', 'is_active', 'public_config', 'secret_config_encrypted', 'secret_config_preview', 'created_at', 'updated_at'],
  work_likes: ['id', 'user_id', 'work_id', 'created_at'],
};

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';
const AUTH_USER_COLUMNS = ['id', 'email', 'created_at', 'raw_user_meta_data', 'password_hash'];

const CONFLICT_COLUMNS: Record<string, string[]> = {
  'auth.users': ['id'],
  profiles: ['id'],
  site_config: ['id'],
  site_stats: ['id'],
  announcements: ['id'],
  works: ['id'],
  credit_transactions: ['id'],
  invitation_referrals: ['id'],
  redeem_codes: ['id'],
  orders: ['id'],
  user_api_keys: ['id'],
  system_api_configs: ['id'],
  api_providers: ['id'],
  model_recommendations: ['id'],
  image_style_presets: ['id'],
  payment_methods: ['id'],
  generation_jobs: ['id'],
  platform_logs: ['id'],
  work_likes: ['id'],
};

type ImportResult = { imported: number; skipped: number; errors: string[] };

type ImportContext = {
  userIdMap: Map<string, string>;
  workIdMap: Map<string, string>;
  emailUserIdMap: Map<string, string>;
  apiKeyIdMap: Map<string, string>;
  apiKeyOwnerIdMap: Map<string, string>;
  media: Record<string, ImportMediaEntry>;
  columnCache: Map<string, Set<string>>;
  defaultableColumnCache: Map<string, Set<string>>;
};

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const body: ImportPayload = await request.json();
    const { _meta, data } = body;
    const skipAuth = body.options?.skipAuth === true;

    if (!_meta || _meta.platform !== 'miaojing' || !data || typeof data !== 'object') {
      return NextResponse.json({ error: '无效的导入文件：格式不匹配' }, { status: 400 });
    }

    const client = await getDbClient();
    const result: Record<string, ImportResult> = {};

    try {
      const context = await buildImportContext(client, data, body._media || {});
      await ensureRedeemCodeSchema(client);
      await ensureInvitationSchema(client);
      await client.query('BEGIN');

      if (!skipAuth && Array.isArray(data.auth_users)) {
        result.auth_users = await importRows(client, 'auth.users', AUTH_USER_COLUMNS, data.auth_users, context);
      } else {
        result.auth_users = {
          imported: 0,
          skipped: Array.isArray(data.auth_users) ? data.auth_users.length : 0,
          errors: skipAuth ? ['已按选项跳过认证账号导入'] : [],
        };
      }

      for (const [table, allowedColumns] of Object.entries(TABLE_COLUMNS)) {
        const rows = data[table];
        result[table] = await importRows(client, table, allowedColumns, Array.isArray(rows) ? rows : [], context);
      }

      result.dedupe_works = await dedupeWorks(client);
      await client.query('COMMIT');

      return NextResponse.json({ success: true, message: '数据导入完成', details: result, meta: _meta });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[data-import] Error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: err instanceof Error ? err.message : '导入失败' }, { status: 500 });
  }
}

async function importRows(
  client: Awaited<ReturnType<typeof getDbClient>>,
  table: string,
  allowedColumns: string[],
  rows: unknown[],
  context: ImportContext,
): Promise<ImportResult> {
  if (rows.length > MAX_ROWS_PER_TABLE) {
    return { imported: 0, skipped: rows.length, errors: [`${table}: 单表最多允许导入 ${MAX_ROWS_PER_TABLE} 行`] };
  }

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];
  const existingColumns = await getExistingColumns(client, table, context);
  const defaultableColumns = await getDefaultableColumns(client, table, context);
  const effectiveAllowedColumns = allowedColumns.filter(col => existingColumns.has(col));

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const savepoint = `import_row_${table.replace(/[^a-zA-Z0-9_]/g, '_')}_${rowIndex}`;
    try {
      await client.query(`SAVEPOINT ${savepoint}`);
      const rawRow = rows[rowIndex];
      const row = await normalizeImportRow(table, rawRow as Record<string, unknown>, context);
      const cols = Object.keys(row).filter(col => (
        effectiveAllowedColumns.includes(col)
        && !(row[col] == null && defaultableColumns.has(col))
      ));
      if (!cols.includes('id') || cols.length === 0) {
        skipped++;
        errors.push(`${table}: 缺少 id 或没有允许导入的字段`);
        await client.query(`RELEASE SAVEPOINT ${savepoint}`);
        continue;
      }

      const vals = cols.map(col => row[col]);
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
      const conflictCols = CONFLICT_COLUMNS[table] || ['id'];

      const mergeAssignments = getMergeAssignments(table, cols);
      const conflictAction = mergeAssignments.length > 0
        ? `DO UPDATE SET ${mergeAssignments.join(', ')}`
        : 'DO NOTHING';

      const insertResult = await client.query(
        `INSERT INTO ${table} AS target (${cols.join(', ')}) VALUES (${placeholders}) ON CONFLICT (${conflictCols.join(', ')}) ${conflictAction}`,
        vals,
      );
      if ((insertResult.rowCount || 0) > 0) {
        imported++;
      } else {
        skipped++;
      }
      await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    } catch (e) {
      await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`).catch(() => undefined);
      await client.query(`RELEASE SAVEPOINT ${savepoint}`).catch(() => undefined);
      skipped++;
      errors.push(`${table}: ${e instanceof Error ? e.message : 'unknown error'}`);
    }
  }

  return { imported, skipped, errors };
}

async function buildImportContext(
  client: Awaited<ReturnType<typeof getDbClient>>,
  data: Record<string, unknown[]>,
  media: Record<string, ImportMediaEntry>,
): Promise<ImportContext> {
  const userIdMap = new Map<string, string>();
  const workIdMap = new Map<string, string>();
  const emailUserIdMap = new Map<string, string>();
  const apiKeyIdMap = new Map<string, string>();
  const apiKeyOwnerIdMap = new Map<string, string>();

  const profileRows = Array.isArray(data.profiles) ? data.profiles : [];
  const authRows = Array.isArray(data.auth_users) ? data.auth_users : [];
  const profileEmails = new Map<string, string>();

  for (const raw of profileRows) {
    const row = raw as Record<string, unknown>;
    seedUuidMap(userIdMap, row.id);
    if (typeof row.id === 'string' && typeof row.email === 'string' && row.email.trim()) {
      const email = row.email.trim().toLowerCase();
      profileEmails.set(email, row.id);
      emailUserIdMap.set(email, userIdMap.get(row.id) || row.id);
    }
  }
  for (const raw of authRows) {
    const row = raw as Record<string, unknown>;
    seedUuidMap(userIdMap, row.id);
    if (typeof row.id === 'string' && typeof row.email === 'string' && row.email.trim() && !profileEmails.has(row.email.trim().toLowerCase())) {
      const email = row.email.trim().toLowerCase();
      profileEmails.set(email, row.id);
      emailUserIdMap.set(email, userIdMap.get(row.id) || row.id);
    }
  }

  if (profileEmails.size > 0) {
    const emails = [...profileEmails.keys()];
    const existing = await client.query(
      'SELECT id, lower(email) AS email FROM profiles WHERE lower(email) = ANY($1)',
      [emails],
    );
    for (const row of existing.rows) {
      const importedId = profileEmails.get(row.email);
      if (importedId && importedId !== row.id) {
        userIdMap.set(importedId, row.id);
        emailUserIdMap.set(row.email, row.id);
      }
    }
  }

  for (const [email, importedId] of profileEmails.entries()) {
    emailUserIdMap.set(email, userIdMap.get(importedId) || importedId);
  }

  const apiKeyRows = Array.isArray(data.user_api_keys) ? data.user_api_keys : [];
  for (const raw of apiKeyRows) {
    const row = raw as Record<string, unknown>;
    const oldId = typeof row.id === 'string' && row.id.trim() ? row.id.trim() : '';
    if (oldId) {
      apiKeyIdMap.set(oldId, isUuid(oldId) ? oldId : crypto.randomUUID());
    }
    const ownerId = findImportedWorkUserId(row);
    const ownerByEmail = findUserIdByEmail(row, {
      userIdMap,
      workIdMap,
      emailUserIdMap,
      apiKeyIdMap,
      apiKeyOwnerIdMap,
      media,
      columnCache: new Map(),
      defaultableColumnCache: new Map(),
    });
    const mappedOwnerId = ownerId
      ? (userIdMap.get(ownerId) || ownerId)
      : ownerByEmail;
    if (oldId && mappedOwnerId) {
      apiKeyOwnerIdMap.set(oldId, mappedOwnerId);
    }
  }

  const works = Array.isArray(data.works) ? data.works : [];
  const workUrls = new Map<string, string>();
  const workMediaShas = new Map<string, string>();
  const partialContext: ImportContext = {
    userIdMap,
    workIdMap,
    emailUserIdMap,
    apiKeyIdMap,
    apiKeyOwnerIdMap,
    media,
    columnCache: new Map(),
    defaultableColumnCache: new Map(),
  };
  for (const raw of works) {
    const row = raw as Record<string, unknown>;
    seedUuidMap(workIdMap, row.id);
    const ownerId = findImportedWorkUserId(row) || findUserIdByEmail(row, partialContext) || findUserIdByCustomModel(row, partialContext);
    const mappedOwnerId = ownerId ? (userIdMap.get(ownerId) || ownerId) : '';
    if (mappedOwnerId && typeof row.id === 'string' && typeof row.result_url === 'string' && row.result_url.trim()) {
      if (!isDataUrl(row.result_url)) {
        workUrls.set(workDedupeKey(mappedOwnerId, row.result_url.trim()), row.id);
      }
      const mediaSha = getImportMediaSha256(row.result_url, media);
      if (mediaSha) {
        workMediaShas.set(workDedupeKey(mappedOwnerId, mediaSha), row.id);
      }
    }
  }
  if (workUrls.size > 0 || workMediaShas.size > 0) {
    const urls = [...new Set([...workUrls.keys()].map(splitWorkDedupeKeyValue))];
    const shas = [...new Set([...workMediaShas.keys()].map(splitWorkDedupeKeyValue))];
    const existing = await client.query(
      `SELECT id, user_id, result_url, params
         FROM works
        WHERE result_url = ANY($1)
           OR params->>'importSourceUrl' = ANY($1)
           OR params->>'resultMediaSha256' = ANY($2)`,
      [urls, shas],
    );
    for (const row of existing.rows) {
      const existingOwnerId = row.user_id ? String(row.user_id) : '';
      const importedId = existingOwnerId && row.result_url
        ? workUrls.get(workDedupeKey(existingOwnerId, String(row.result_url)))
        : undefined;
      if (importedId && importedId !== row.id) {
        workIdMap.set(importedId, row.id);
      }
      const params = (row.params || {}) as Record<string, unknown>;
      const sourceUrl = typeof params.importSourceUrl === 'string' ? params.importSourceUrl : '';
      const sourceMatchId = existingOwnerId && sourceUrl ? workUrls.get(workDedupeKey(existingOwnerId, sourceUrl)) : undefined;
      if (sourceMatchId && sourceMatchId !== row.id) {
        workIdMap.set(sourceMatchId, row.id);
      }
      const sha = typeof params.resultMediaSha256 === 'string' ? params.resultMediaSha256 : '';
      const shaMatchId = existingOwnerId && sha ? workMediaShas.get(workDedupeKey(existingOwnerId, sha)) : undefined;
      if (shaMatchId && shaMatchId !== row.id) {
        workIdMap.set(shaMatchId, row.id);
      }
    }
  }

  return {
    userIdMap,
    workIdMap,
    emailUserIdMap,
    apiKeyIdMap,
    apiKeyOwnerIdMap,
    media,
    columnCache: new Map(),
    defaultableColumnCache: new Map(),
  };
}

async function normalizeImportRow(table: string, row: Record<string, unknown>, context: ImportContext): Promise<Record<string, unknown>> {
  const next = { ...row };

  if (typeof next.user_id === 'string' && context.userIdMap.has(next.user_id)) {
    next.user_id = context.userIdMap.get(next.user_id);
  }
  if ((!next.user_id || next.user_id === SYSTEM_USER_ID) && findUserIdByEmail(next, context)) {
    next.user_id = findUserIdByEmail(next, context);
  }
  if (typeof next.related_work_id === 'string' && context.workIdMap.has(next.related_work_id)) {
    next.related_work_id = context.workIdMap.get(next.related_work_id);
  }
  if (typeof next.work_id === 'string' && context.workIdMap.has(next.work_id)) {
    next.work_id = context.workIdMap.get(next.work_id);
  }

  if (table === 'auth.users' || table === 'profiles') {
    const currentId = typeof next.id === 'string' ? next.id : '';
    if (currentId && context.userIdMap.has(currentId)) {
      next.id = context.userIdMap.get(currentId);
    }
    if (table === 'profiles' && typeof next.referred_by_user_id === 'string' && context.userIdMap.has(next.referred_by_user_id)) {
      next.referred_by_user_id = context.userIdMap.get(next.referred_by_user_id);
    }
  }

  if (table === 'invitation_referrals') {
    if (typeof next.inviter_user_id === 'string' && context.userIdMap.has(next.inviter_user_id)) {
      next.inviter_user_id = context.userIdMap.get(next.inviter_user_id);
    }
    if (typeof next.invitee_user_id === 'string' && context.userIdMap.has(next.invitee_user_id)) {
      next.invitee_user_id = context.userIdMap.get(next.invitee_user_id);
    }
  }

  if (table === 'user_api_keys') {
    const currentId = typeof next.id === 'string' ? next.id : '';
    if (currentId && context.apiKeyIdMap.has(currentId)) {
      next.id = context.apiKeyIdMap.get(currentId);
    }
    const importedUserId = findImportedWorkUserId(next);
    const emailUserId = findUserIdByEmail(next, context);
    if (importedUserId || emailUserId) {
      next.user_id = importedUserId
        ? (context.userIdMap.get(importedUserId) || importedUserId)
        : emailUserId;
    }
  }

  if (table === 'works') {
    const currentId = typeof next.id === 'string' ? next.id : '';
    if (currentId && context.workIdMap.has(currentId)) {
      next.id = context.workIdMap.get(currentId);
    }
    const importedUserId = findImportedWorkUserId(next) || findUserIdByEmail(next, context) || findUserIdByCustomModel(next, context);
    if (importedUserId) {
      next.user_id = context.userIdMap.get(importedUserId) || importedUserId;
    }
    if (next.params && typeof next.params === 'object') {
      next.params = { ...(next.params as Record<string, unknown>) };
      remapCustomModelId(next.params as Record<string, unknown>, context);
      if ((!next.user_id || next.user_id === SYSTEM_USER_ID) && findUserIdByCustomModel(next, context)) {
        next.user_id = findUserIdByCustomModel(next, context);
      }
    } else {
      next.params = {};
    }
    if (typeof next.result_url === 'string') {
      const originalResultUrl = next.result_url;
      const mediaSha = getImportMediaSha256(originalResultUrl, context.media) || getDataUrlSha256(originalResultUrl);
      next.result_url = await persistImportMedia(originalResultUrl, getWorkMediaFolder(next.type, 'results'), context);
      if (mediaSha && next.params && typeof next.params === 'object') {
        (next.params as Record<string, unknown>).importSourceUrl = originalResultUrl;
        (next.params as Record<string, unknown>).resultMediaSha256 = mediaSha;
      }
    }
    if (typeof next.thumbnail_url === 'string') {
      next.thumbnail_url = await persistImportMedia(next.thumbnail_url, 'imported/works/thumbnails', context);
    }
    if (next.params && typeof next.params === 'object') {
      next.params = await sanitizeImportMedia(next.params, 'imported/works/references', context);
    }
  }

  if (table === 'generation_jobs') {
    if (next.payload && typeof next.payload === 'object') {
      next.payload = await sanitizeImportMedia(next.payload, 'imported/jobs/payload', context);
    }
    if (next.result && typeof next.result === 'object') {
      next.result = await sanitizeImportMedia(next.result, 'imported/jobs/results', context);
    }
  }

  if (table === 'user_api_keys') {
    if (typeof next.note !== 'string' || next.note.trim() === '') {
      next.note = '导入的 API Key';
    }
    if (typeof next.type !== 'string' || next.type.trim() === '') {
      next.type = 'image';
    }
    const rawEncrypted = typeof next.api_key_encrypted === 'string' ? next.api_key_encrypted.trim() : '';
    const rawApiKey = typeof next.apiKey === 'string' ? next.apiKey.trim() : '';
    if (rawApiKey) {
      next.api_key_encrypted = encryptSecret(rawApiKey);
      next.api_key_preview = typeof next.api_key_preview === 'string' && next.api_key_preview
        ? next.api_key_preview
        : previewSecret(rawApiKey);
    } else if (rawEncrypted) {
      next.api_key_encrypted = rawEncrypted;
      next.api_key_preview = typeof next.api_key_preview === 'string' ? next.api_key_preview : '';
    }
  }

  if (table === 'redeem_codes') {
    if (typeof next.created_by === 'string' && context.userIdMap.has(next.created_by)) {
      next.created_by = context.userIdMap.get(next.created_by);
    }
    if (typeof next.used_by === 'string' && context.userIdMap.has(next.used_by)) {
      next.used_by = context.userIdMap.get(next.used_by);
    }
    if (typeof next.normalized_code !== 'string' || next.normalized_code.trim() === '') {
      next.normalized_code = typeof next.code === 'string'
        ? next.code.replace(/[^a-z0-9]/gi, '').toUpperCase()
        : '';
    }
    if (next.code_type !== 'membership') next.code_type = 'credits';
    if (next.code_type === 'credits' && typeof next.credits_amount !== 'number') {
      next.credits_amount = Number(next.credits_amount || 0);
    }
    if (typeof next.note !== 'string') next.note = '';
  }

  if (UUID_ID_TABLES.has(table)) {
    const currentId = typeof next.id === 'string' ? next.id : '';
    if (!isUuid(currentId)) {
      next.id = crypto.randomUUID();
    }
  }

  return next;
}

function findImportedWorkUserId(row: Record<string, unknown>): string | null {
  const directKeys = ['user_id', 'userId', 'publisher_id', 'publisherId', 'owner_id', 'ownerId', 'created_by', 'createdBy'];
  for (const key of directKeys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim() && value !== 'anonymous' && value !== '00000000-0000-0000-0000-000000000000') {
      return value.trim();
    }
  }

  const params = row.params && typeof row.params === 'object' ? row.params as Record<string, unknown> : null;
  if (!params) return null;
  for (const key of directKeys) {
    const value = params[key];
    if (typeof value === 'string' && value.trim() && value !== 'anonymous' && value !== '00000000-0000-0000-0000-000000000000') {
      return value.trim();
    }
  }
  return null;
}

function findUserIdByEmail(row: Record<string, unknown>, context: ImportContext): string | null {
  const directKeys = ['email', 'user_email', 'userEmail', 'publisher_email', 'publisherEmail', 'owner_email', 'ownerEmail'];
  for (const key of directKeys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) {
      const mapped = context.emailUserIdMap.get(value.trim().toLowerCase());
      if (mapped) return mapped;
    }
  }

  const params = row.params && typeof row.params === 'object' ? row.params as Record<string, unknown> : null;
  if (!params) return null;
  for (const key of directKeys) {
    const value = params[key];
    if (typeof value === 'string' && value.trim()) {
      const mapped = context.emailUserIdMap.get(value.trim().toLowerCase());
      if (mapped) return mapped;
    }
  }
  return null;
}

function findUserIdByCustomModel(row: Record<string, unknown>, context: ImportContext): string | null {
  const params = row.params && typeof row.params === 'object' ? row.params as Record<string, unknown> : null;
  const model = typeof params?.model === 'string'
    ? params.model
    : typeof row.model === 'string'
      ? row.model
      : '';
  if (!model.startsWith('custom:')) return null;
  const oldId = model.slice('custom:'.length);
  return context.apiKeyOwnerIdMap.get(oldId) || null;
}

function remapCustomModelId(params: Record<string, unknown>, context: ImportContext): void {
  const model = typeof params.model === 'string' ? params.model : '';
  if (!model.startsWith('custom:')) return;
  const oldId = model.slice('custom:'.length);
  const newId = context.apiKeyIdMap.get(oldId);
  if (newId) {
    params.model = `custom:${newId}`;
  }
}

function getMergeAssignments(table: string, cols: string[]): string[] {
  const has = (column: string) => cols.includes(column);
  const assignments: string[] = [];

  if (table === 'auth.users') {
    if (has('email')) assignments.push(`email = COALESCE(NULLIF(target.email, ''), EXCLUDED.email)`);
    if (has('raw_user_meta_data')) assignments.push(`raw_user_meta_data = COALESCE(target.raw_user_meta_data, EXCLUDED.raw_user_meta_data)`);
    if (has('password_hash')) assignments.push(`password_hash = COALESCE(NULLIF(target.password_hash, ''), EXCLUDED.password_hash)`);
    return assignments;
  }

  if (table === 'profiles') {
    if (has('email')) assignments.push(`email = COALESCE(NULLIF(target.email, ''), EXCLUDED.email)`);
    if (has('nickname')) assignments.push(`nickname = COALESCE(NULLIF(target.nickname, ''), EXCLUDED.nickname)`);
    if (has('display_nickname')) assignments.push(`display_nickname = COALESCE(NULLIF(target.display_nickname, ''), EXCLUDED.display_nickname)`);
    if (has('avatar_url')) assignments.push(`avatar_url = COALESCE(NULLIF(target.avatar_url, ''), EXCLUDED.avatar_url)`);
    if (has('phone')) assignments.push(`phone = COALESCE(NULLIF(target.phone, ''), EXCLUDED.phone)`);
    if (has('role')) assignments.push(`role = CASE WHEN target.role = 'admin' THEN target.role ELSE COALESCE(NULLIF(target.role, ''), EXCLUDED.role) END`);
    if (has('membership_tier')) assignments.push(`membership_tier = COALESCE(NULLIF(target.membership_tier, ''), EXCLUDED.membership_tier)`);
    if (has('membership_expires_at')) assignments.push(`membership_expires_at = COALESCE(target.membership_expires_at, EXCLUDED.membership_expires_at)`);
    if (has('credits_balance')) assignments.push(`credits_balance = COALESCE(target.credits_balance, EXCLUDED.credits_balance)`);
    if (has('daily_quota_limit')) assignments.push(`daily_quota_limit = COALESCE(target.daily_quota_limit, EXCLUDED.daily_quota_limit)`);
    if (has('is_active')) assignments.push(`is_active = COALESCE(target.is_active, EXCLUDED.is_active)`);
    if (has('preferred_theme')) assignments.push(`preferred_theme = CASE WHEN EXCLUDED.preferred_theme IN ('dark', 'light') THEN EXCLUDED.preferred_theme ELSE target.preferred_theme END`);
    if (has('watermark_disabled')) assignments.push(`watermark_disabled = COALESCE(EXCLUDED.watermark_disabled, target.watermark_disabled)`);
    if (has('invite_code')) assignments.push(`invite_code = COALESCE(NULLIF(target.invite_code, ''), EXCLUDED.invite_code)`);
    if (has('referred_by_user_id')) assignments.push(`referred_by_user_id = COALESCE(target.referred_by_user_id, EXCLUDED.referred_by_user_id)`);
    if (has('updated_at')) assignments.push(`updated_at = GREATEST(COALESCE(target.updated_at, EXCLUDED.updated_at), COALESCE(EXCLUDED.updated_at, target.updated_at))`);
    return assignments;
  }

  if (table === 'works') {
    if (has('user_id')) {
      assignments.push(`user_id = CASE WHEN (target.user_id IS NULL OR target.user_id = '${SYSTEM_USER_ID}'::uuid) AND EXCLUDED.user_id IS NOT NULL AND EXCLUDED.user_id <> '${SYSTEM_USER_ID}'::uuid THEN EXCLUDED.user_id ELSE target.user_id END`);
    }
    if (has('params')) assignments.push(`params = CASE WHEN target.params IS NULL OR target.params = '{}'::jsonb THEN EXCLUDED.params ELSE target.params END`);
    if (has('thumbnail_url')) assignments.push(`thumbnail_url = COALESCE(NULLIF(target.thumbnail_url, ''), EXCLUDED.thumbnail_url)`);
    if (has('width')) assignments.push(`width = COALESCE(target.width, EXCLUDED.width)`);
    if (has('height')) assignments.push(`height = COALESCE(target.height, EXCLUDED.height)`);
    if (has('duration')) assignments.push(`duration = COALESCE(target.duration, EXCLUDED.duration)`);
    if (has('credits_cost')) assignments.push(`credits_cost = COALESCE(target.credits_cost, EXCLUDED.credits_cost)`);
    if (has('updated_at')) assignments.push(`updated_at = GREATEST(COALESCE(target.updated_at, EXCLUDED.updated_at), COALESCE(EXCLUDED.updated_at, target.updated_at))`);
    return assignments;
  }

  if (table === 'user_api_keys') {
    if (has('user_id')) assignments.push(`user_id = COALESCE(target.user_id, EXCLUDED.user_id)`);
    if (has('provider')) assignments.push(`provider = COALESCE(NULLIF(target.provider, ''), EXCLUDED.provider)`);
    if (has('supplier_name')) assignments.push(`supplier_name = COALESCE(NULLIF(target.supplier_name, ''), EXCLUDED.supplier_name)`);
    if (has('api_url')) assignments.push(`api_url = COALESCE(NULLIF(target.api_url, ''), EXCLUDED.api_url)`);
    if (has('model_name')) assignments.push(`model_name = COALESCE(NULLIF(target.model_name, ''), EXCLUDED.model_name)`);
    if (has('note')) assignments.push(`note = COALESCE(NULLIF(target.note, ''), EXCLUDED.note)`);
    if (has('manifest_path')) assignments.push(`manifest_path = COALESCE(NULLIF(target.manifest_path, ''), EXCLUDED.manifest_path)`);
    if (has('api_key_encrypted')) assignments.push(`api_key_encrypted = COALESCE(NULLIF(target.api_key_encrypted, ''), EXCLUDED.api_key_encrypted)`);
    if (has('api_key_preview')) assignments.push(`api_key_preview = COALESCE(NULLIF(target.api_key_preview, ''), EXCLUDED.api_key_preview)`);
    if (has('type')) assignments.push(`type = COALESCE(NULLIF(target.type, ''), EXCLUDED.type)`);
    if (has('is_active')) assignments.push(`is_active = COALESCE(target.is_active, EXCLUDED.is_active)`);
    if (has('updated_at')) assignments.push(`updated_at = GREATEST(COALESCE(target.updated_at, EXCLUDED.updated_at), COALESCE(EXCLUDED.updated_at, target.updated_at))`);
    return assignments;
  }

  if (table === 'system_api_configs') {
    if (has('provider')) assignments.push(`provider = COALESCE(NULLIF(target.provider, ''), EXCLUDED.provider)`);
    if (has('name')) assignments.push(`name = COALESCE(NULLIF(target.name, ''), EXCLUDED.name)`);
    if (has('api_url')) assignments.push(`api_url = COALESCE(NULLIF(target.api_url, ''), EXCLUDED.api_url)`);
    if (has('model_name')) assignments.push(`model_name = COALESCE(NULLIF(target.model_name, ''), EXCLUDED.model_name)`);
    if (has('model_group')) assignments.push(`model_group = COALESCE(NULLIF(target.model_group, ''), EXCLUDED.model_group)`);
    if (has('note')) assignments.push(`note = COALESCE(NULLIF(target.note, ''), EXCLUDED.note)`);
    if (has('manifest_path')) assignments.push(`manifest_path = COALESCE(NULLIF(target.manifest_path, ''), EXCLUDED.manifest_path)`);
    if (has('is_default')) assignments.push(`is_default = COALESCE(target.is_default, EXCLUDED.is_default)`);
    if (has('allowed_membership_tiers')) assignments.push(`allowed_membership_tiers = COALESCE(target.allowed_membership_tiers, EXCLUDED.allowed_membership_tiers)`);
    if (has('polling_mode')) assignments.push(`polling_mode = COALESCE(target.polling_mode, EXCLUDED.polling_mode)`);
    if (has('polling_order')) assignments.push(`polling_order = COALESCE(target.polling_order, EXCLUDED.polling_order)`);
    if (has('api_key_encrypted')) assignments.push(`api_key_encrypted = COALESCE(NULLIF(target.api_key_encrypted, ''), EXCLUDED.api_key_encrypted)`);
    if (has('api_key_preview')) assignments.push(`api_key_preview = COALESCE(NULLIF(target.api_key_preview, ''), EXCLUDED.api_key_preview)`);
    if (has('type')) assignments.push(`type = COALESCE(NULLIF(target.type, ''), EXCLUDED.type)`);
    if (has('credits_per_use')) assignments.push(`credits_per_use = COALESCE(target.credits_per_use, EXCLUDED.credits_per_use)`);
    if (has('billing_mode')) assignments.push(`billing_mode = COALESCE(NULLIF(target.billing_mode, ''), EXCLUDED.billing_mode)`);
    if (has('fixed_price')) assignments.push(`fixed_price = COALESCE(target.fixed_price, EXCLUDED.fixed_price)`);
    if (has('duration_price_per_second')) assignments.push(`duration_price_per_second = COALESCE(target.duration_price_per_second, EXCLUDED.duration_price_per_second)`);
    if (has('input_price_per_1k')) assignments.push(`input_price_per_1k = COALESCE(target.input_price_per_1k, EXCLUDED.input_price_per_1k)`);
    if (has('output_price_per_1k')) assignments.push(`output_price_per_1k = COALESCE(target.output_price_per_1k, EXCLUDED.output_price_per_1k)`);
    if (has('model_ratio')) assignments.push(`model_ratio = COALESCE(target.model_ratio, EXCLUDED.model_ratio)`);
    if (has('completion_ratio')) assignments.push(`completion_ratio = COALESCE(target.completion_ratio, EXCLUDED.completion_ratio)`);
    if (has('group_ratio')) assignments.push(`group_ratio = COALESCE(target.group_ratio, EXCLUDED.group_ratio)`);
    if (has('price_note')) assignments.push(`price_note = COALESCE(NULLIF(target.price_note, ''), EXCLUDED.price_note)`);
    if (has('is_active')) assignments.push(`is_active = COALESCE(target.is_active, EXCLUDED.is_active)`);
    if (has('sort_order')) assignments.push(`sort_order = COALESCE(target.sort_order, EXCLUDED.sort_order)`);
    if (has('updated_at')) assignments.push(`updated_at = GREATEST(COALESCE(target.updated_at, EXCLUDED.updated_at), COALESCE(EXCLUDED.updated_at, target.updated_at))`);
    return assignments;
  }

  if (table === 'payment_methods') {
    if (has('type')) assignments.push(`type = COALESCE(NULLIF(target.type, ''), EXCLUDED.type)`);
    if (has('name')) assignments.push(`name = COALESCE(NULLIF(target.name, ''), EXCLUDED.name)`);
    if (has('is_active')) assignments.push(`is_active = COALESCE(target.is_active, EXCLUDED.is_active)`);
    if (has('public_config')) assignments.push(`public_config = COALESCE(target.public_config, EXCLUDED.public_config)`);
    if (has('secret_config_encrypted')) assignments.push(`secret_config_encrypted = COALESCE(target.secret_config_encrypted, EXCLUDED.secret_config_encrypted)`);
    if (has('secret_config_preview')) assignments.push(`secret_config_preview = COALESCE(target.secret_config_preview, EXCLUDED.secret_config_preview)`);
    if (has('updated_at')) assignments.push(`updated_at = GREATEST(COALESCE(target.updated_at, EXCLUDED.updated_at), COALESCE(EXCLUDED.updated_at, target.updated_at))`);
    return assignments;
  }

  if (table === 'redeem_codes') {
    if (has('code_type')) assignments.push(`code_type = COALESCE(NULLIF(target.code_type, ''), EXCLUDED.code_type)`);
    if (has('credits_amount')) assignments.push(`credits_amount = COALESCE(target.credits_amount, EXCLUDED.credits_amount)`);
    if (has('membership_tier')) assignments.push(`membership_tier = COALESCE(target.membership_tier, EXCLUDED.membership_tier)`);
    if (has('membership_duration_value')) assignments.push(`membership_duration_value = COALESCE(target.membership_duration_value, EXCLUDED.membership_duration_value)`);
    if (has('membership_duration_unit')) assignments.push(`membership_duration_unit = COALESCE(target.membership_duration_unit, EXCLUDED.membership_duration_unit)`);
    if (has('note')) assignments.push(`note = COALESCE(NULLIF(target.note, ''), EXCLUDED.note)`);
    if (has('is_active')) assignments.push(`is_active = CASE WHEN target.used_at IS NOT NULL THEN target.is_active ELSE COALESCE(target.is_active, EXCLUDED.is_active) END`);
    if (has('created_by')) assignments.push(`created_by = COALESCE(target.created_by, EXCLUDED.created_by)`);
    if (has('used_by')) assignments.push(`used_by = COALESCE(target.used_by, EXCLUDED.used_by)`);
    if (has('used_at')) assignments.push(`used_at = COALESCE(target.used_at, EXCLUDED.used_at)`);
    if (has('updated_at')) assignments.push(`updated_at = GREATEST(COALESCE(target.updated_at, EXCLUDED.updated_at), COALESCE(EXCLUDED.updated_at, target.updated_at))`);
    return assignments;
  }

  return assignments;
}

async function getExistingColumns(
  client: Awaited<ReturnType<typeof getDbClient>>,
  table: string,
  context: ImportContext,
): Promise<Set<string>> {
  const cached = context.columnCache.get(table);
  if (cached) return cached;

  const [schemaName, tableName] = table.includes('.') ? table.split('.', 2) : ['public', table];
  const result = await client.query(
    'SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2',
    [schemaName, tableName],
  );
  const columns = new Set((result.rows || []).map((row: Record<string, unknown>) => String(row.column_name)));
  context.columnCache.set(table, columns);
  return columns;
}

async function getDefaultableColumns(
  client: Awaited<ReturnType<typeof getDbClient>>,
  table: string,
  context: ImportContext,
): Promise<Set<string>> {
  const cached = context.defaultableColumnCache.get(table);
  if (cached) return cached;

  const [schemaName, tableName] = table.includes('.') ? table.split('.', 2) : ['public', table];
  const result = await client.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name = $2
        AND is_nullable = 'NO'
        AND column_default IS NOT NULL`,
    [schemaName, tableName],
  );
  const columns = new Set((result.rows || []).map((row: Record<string, unknown>) => String(row.column_name)));
  context.defaultableColumnCache.set(table, columns);
  return columns;
}

function seedUuidMap(map: Map<string, string>, value: unknown): void {
  if (typeof value === 'string' && value && !isUuid(value) && !map.has(value)) {
    map.set(value, crypto.randomUUID());
  }
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

function isDataUrl(value: unknown): boolean {
  return typeof value === 'string' && /^data:[^,]+,/i.test(value);
}

function workDedupeKey(userId: string, value: string): string {
  return `${userId}\u0000${value}`;
}

function splitWorkDedupeKeyValue(key: string): string {
  return key.slice(key.indexOf('\u0000') + 1);
}

function getWorkMediaFolder(type: unknown, kind: string): string {
  const text = typeof type === 'string' ? type.toLowerCase() : '';
  const media = text.includes('video') ? 'videos' : 'images';
  return `imported/works/${kind}/${media}`;
}

function extensionFromMime(mime: string): string {
  const normalized = mime.toLowerCase();
  if (normalized.includes('png')) return 'png';
  if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'jpg';
  if (normalized.includes('webp')) return 'webp';
  if (normalized.includes('gif')) return 'gif';
  if (normalized.includes('mp4')) return 'mp4';
  if (normalized.includes('webm')) return 'webm';
  return 'bin';
}

function getImportMediaSha256(value: string, media: Record<string, ImportMediaEntry>): string | null {
  const entry = media[value];
  if (!entry) return null;
  if (typeof entry.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(entry.sha256)) {
    return entry.sha256.toLowerCase();
  }
  const decoded = decodeImportMediaEntry(entry);
  return decoded ? decoded.sha256 : null;
}

function getDataUrlSha256(value: string): string | null {
  if (!isDataUrl(value)) return null;
  const decoded = decodeDataUrl(value);
  return decoded ? decoded.sha256 : null;
}

function decodeDataUrl(value: string): { buffer: Buffer; mime: string; sha256: string } | null {
  const match = value.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/i);
  if (!match) return null;

  const mime = match[1] || 'application/octet-stream';
  const isBase64 = Boolean(match[2]);
  const payload = match[3] || '';
  const buffer = isBase64 ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload));
  return {
    buffer,
    mime,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
  };
}

function decodeImportMediaEntry(entry: ImportMediaEntry): { buffer: Buffer; mime: string; sha256: string } | null {
  if (typeof entry.dataUrl === 'string' && entry.dataUrl.trim()) {
    return decodeDataUrl(entry.dataUrl.trim());
  }
  if (entry.encoding === 'base64' && typeof entry.data === 'string') {
    const buffer = Buffer.from(entry.data, 'base64');
    return {
      buffer,
      mime: entry.contentType || 'application/octet-stream',
      sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    };
  }
  return null;
}

async function persistImportMedia(value: string, folder: string, context?: ImportContext): Promise<string> {
  const entry = context?.media[value];
  const decoded = entry ? decodeImportMediaEntry(entry) : decodeDataUrl(value);
  if (!decoded) return value;

  const { buffer, mime, sha256 } = decoded;
  const ext = extensionFromMime(mime);
  const key = `${folder}/${sha256}.${ext}`;
  const savedKey = await localStorage.uploadFile({ fileContent: buffer, fileName: key, contentType: mime });
  return localStorage.generatePresignedUrl({ key: savedKey, expireTime: 2592000 });
}

async function sanitizeImportMedia(value: unknown, folder: string, context: ImportContext): Promise<unknown> {
  if (typeof value === 'string') {
    return persistImportMedia(value, folder, context);
  }
  if (Array.isArray(value)) {
    return Promise.all(value.map(item => sanitizeImportMedia(item, folder, context)));
  }
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      output[key] = await sanitizeImportMedia(nested, folder, context);
    }
    return output;
  }
  return value;
}

async function dedupeWorks(client: Awaited<ReturnType<typeof getDbClient>>): Promise<ImportResult> {
  const errors: string[] = [];
  let removed = 0;

  for (const expression of [
    "NULLIF(result_url, '')",
    "NULLIF(params->>'importSourceUrl', '')",
    "NULLIF(params->>'resultMediaSha256', '')",
  ]) {
    try {
      await client.query(`
        WITH ranked AS (
          SELECT id,
                 FIRST_VALUE(id) OVER (
                   PARTITION BY user_id, ${expression}
                   ORDER BY is_public DESC, updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
                 ) AS keep_id,
                 ROW_NUMBER() OVER (
                   PARTITION BY user_id, ${expression}
                   ORDER BY is_public DESC, updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
                 ) AS rn
            FROM works
           WHERE ${expression} IS NOT NULL
        ),
        duplicates AS (
          SELECT id, keep_id FROM ranked WHERE rn > 1
        )
        DELETE FROM work_likes wl
         USING duplicates d, work_likes kept
         WHERE wl.work_id = d.id
           AND kept.work_id = d.keep_id
           AND kept.user_id = wl.user_id
      `);
      await client.query(`
        WITH ranked AS (
          SELECT id,
                 FIRST_VALUE(id) OVER (
                   PARTITION BY user_id, ${expression}
                   ORDER BY is_public DESC, updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
                 ) AS keep_id,
                 ROW_NUMBER() OVER (
                   PARTITION BY user_id, ${expression}
                   ORDER BY is_public DESC, updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
                 ) AS rn
            FROM works
           WHERE ${expression} IS NOT NULL
        ),
        duplicates AS (
          SELECT id, keep_id FROM ranked WHERE rn > 1
        )
        UPDATE work_likes wl
           SET work_id = d.keep_id
          FROM duplicates d
         WHERE wl.work_id = d.id
      `);
      await client.query(`
        WITH ranked AS (
          SELECT id,
                 FIRST_VALUE(id) OVER (
                   PARTITION BY user_id, ${expression}
                   ORDER BY is_public DESC, updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
                 ) AS keep_id,
                 ROW_NUMBER() OVER (
                   PARTITION BY ${expression}
                   ORDER BY is_public DESC, updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
                 ) AS rn
            FROM works
           WHERE ${expression} IS NOT NULL
        ),
        duplicates AS (
          SELECT id, keep_id FROM ranked WHERE rn > 1
        )
        UPDATE credit_transactions ct
           SET related_work_id = d.keep_id
          FROM duplicates d
         WHERE ct.related_work_id = d.id
      `);
      const result = await client.query(`
        WITH ranked AS (
          SELECT id,
                 ROW_NUMBER() OVER (
                   PARTITION BY ${expression}
                   ORDER BY is_public DESC, updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
                 ) AS rn
            FROM works
           WHERE ${expression} IS NOT NULL
        )
        DELETE FROM works
         WHERE id IN (SELECT id FROM ranked WHERE rn > 1)
      `);
      removed += result.rowCount || 0;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : '作品去重失败');
    }
  }

  return { imported: 0, skipped: removed, errors };
}
