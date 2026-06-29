import { NextResponse } from 'next/server';
import { getStorageHealthStatus } from '@/lib/local-storage';
import { getDbClient } from '@/storage/database/local-db';

export async function GET() {
  const checks: Record<string, { ok: boolean; message?: string }> = {
    database: { ok: false },
    storage: { ok: false },
    secrets: {
      ok: Boolean(
        process.env.JWT_SECRET
        && process.env.DATA_ENCRYPTION_KEY
        && process.env.GENERATION_INTERNAL_SECRET,
      ),
    },
  };

  let client: Awaited<ReturnType<typeof getDbClient>> | null = null;
  try {
    client = await getDbClient();
    await client.query('SELECT 1');
    checks.database.ok = true;
  } catch (error) {
    checks.database.message = error instanceof Error ? error.message : 'database check failed';
  } finally {
    client?.release();
  }

  const storageStatus = await getStorageHealthStatus();
  checks.storage.ok = storageStatus.ok;
  if (!storageStatus.ok) {
    checks.storage.message = storageStatus.object.message || storageStatus.local.message || 'storage check failed';
  }

  const ok = Object.values(checks).every(check => check.ok);
  return NextResponse.json(
    {
      ok,
      service: 'miaojing',
      role: process.env.APP_RUNTIME_ROLE || 'full',
      timestamp: new Date().toISOString(),
      checks,
      storage: storageStatus,
    },
    { status: ok ? 200 : 503 },
  );
}
