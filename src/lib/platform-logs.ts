import { NextRequest } from 'next/server';
import type { PoolClient } from 'pg';
import { getDbClient } from '@/storage/database/local-db';

export type PlatformLogType =
  | 'auth'
  | 'generation'
  | 'admin'
  | 'database'
  | 'storage'
  | 'security'
  | 'system';

export type PlatformLogLevel = 'info' | 'warning' | 'error';

export interface PlatformLogInput {
  type: PlatformLogType;
  level?: PlatformLogLevel;
  action: string;
  message: string;
  userId?: string | null;
  userName?: string | null;
  userEmail?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown> | null;
  request?: NextRequest;
}

const DEFAULT_RETENTION_DAYS = 30;
const MAX_RETENTION_DAYS = 90;
let lastCleanupAt = 0;

function clampRetentionDays(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_RETENTION_DAYS;
  return Math.min(MAX_RETENTION_DAYS, Math.max(1, Math.floor(parsed)));
}

function getRequestIp(request?: NextRequest): string | null {
  if (!request) return null;
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() || null;
  return request.headers.get('x-real-ip') || null;
}

export async function ensurePlatformLogSchema(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS platform_log_settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      retention_days INTEGER NOT NULL DEFAULT 30,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    INSERT INTO platform_log_settings (id, retention_days)
    VALUES (1, 30)
    ON CONFLICT (id) DO NOTHING;

    CREATE TABLE IF NOT EXISTS platform_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      type VARCHAR(32) NOT NULL,
      level VARCHAR(16) NOT NULL DEFAULT 'info',
      action VARCHAR(128) NOT NULL,
      message TEXT NOT NULL,
      user_id UUID,
      user_name VARCHAR(255),
      user_email VARCHAR(255),
      target_type VARCHAR(64),
      target_id VARCHAR(255),
      ip_address VARCHAR(64),
      user_agent TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS platform_logs_type_created_idx ON platform_logs (type, created_at DESC);
    CREATE INDEX IF NOT EXISTS platform_logs_level_created_idx ON platform_logs (level, created_at DESC);
    CREATE INDEX IF NOT EXISTS platform_logs_user_created_idx ON platform_logs (user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS platform_logs_created_idx ON platform_logs (created_at DESC);
    CREATE INDEX IF NOT EXISTS platform_logs_user_name_idx ON platform_logs (LOWER(COALESCE(user_name, '')));
    CREATE INDEX IF NOT EXISTS platform_logs_user_email_idx ON platform_logs (LOWER(COALESCE(user_email, '')));
  `);
}

export async function getPlatformLogRetentionDays(client: PoolClient): Promise<number> {
  await ensurePlatformLogSchema(client);
  const result = await client.query(
    'SELECT retention_days FROM platform_log_settings WHERE id = 1 LIMIT 1',
  );
  return clampRetentionDays(result.rows[0]?.retention_days);
}

export async function setPlatformLogRetentionDays(client: PoolClient, days: number): Promise<number> {
  await ensurePlatformLogSchema(client);
  const retentionDays = clampRetentionDays(days);
  await client.query(
    `INSERT INTO platform_log_settings (id, retention_days, updated_at)
     VALUES (1, $1, NOW())
     ON CONFLICT (id) DO UPDATE SET retention_days = $1, updated_at = NOW()`,
    [retentionDays],
  );
  return retentionDays;
}

export async function cleanupExpiredPlatformLogs(client: PoolClient): Promise<number> {
  const retentionDays = await getPlatformLogRetentionDays(client);
  const result = await client.query(
    `DELETE FROM platform_logs
     WHERE created_at < NOW() - ($1::int * INTERVAL '1 day')`,
    [retentionDays],
  );
  return result.rowCount || 0;
}

export async function writePlatformLog(input: PlatformLogInput): Promise<void> {
  const client = await getDbClient();
  try {
    await ensurePlatformLogSchema(client);
    if (Date.now() - lastCleanupAt > 60 * 60 * 1000) {
      lastCleanupAt = Date.now();
      await cleanupExpiredPlatformLogs(client);
    }
    await client.query(
      `INSERT INTO platform_logs (
         type, level, action, message, user_id, user_name, user_email,
         target_type, target_id, ip_address, user_agent, metadata
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)`,
      [
        input.type,
        input.level || 'info',
        input.action,
        input.message,
        input.userId || null,
        input.userName || null,
        input.userEmail || null,
        input.targetType || null,
        input.targetId || null,
        getRequestIp(input.request),
        input.request?.headers.get('user-agent') || null,
        JSON.stringify(input.metadata || {}),
      ],
    );
  } catch (error) {
    console.error('[platform-log] write failed:', error);
  } finally {
    client.release();
  }
}
