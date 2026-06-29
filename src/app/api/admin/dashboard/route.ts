import { NextRequest, NextResponse } from 'next/server';
import type { PoolClient, QueryResult } from 'pg';
import { requireAdmin } from '@/lib/admin-auth';
import { getStorageHealthStatus } from '@/lib/local-storage';
import { getDbClient } from '@/storage/database/local-db';

type DbRow = Record<string, unknown>;

async function safeQuery(client: PoolClient, label: string, sql: string, params: unknown[] = []): Promise<QueryResult<DbRow>> {
  try {
    return await client.query(sql, params);
  } catch (error) {
    console.error(`[admin/dashboard] ${label} failed:`, error);
    return { rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] };
  }
}

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function firstRow(result: QueryResult<DbRow>): DbRow {
  return result.rows[0] || {};
}

function statusCount(rows: DbRow[], status: string): number {
  const row = rows.find(item => item.status === status);
  return numberValue(row?.count);
}

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const client = await getDbClient();
  try {
    const [
      platformResult,
      userResult,
      workResult,
      taskStatusResult,
      latestTaskResult,
      orderStatusResult,
      orderRevenueResult,
      latestOrderResult,
      storageResult,
      logResult,
      providerResult,
      recommendationResult,
      userApiKeyResult,
      announcementResult,
    ] = await Promise.all([
      safeQuery(client, 'platform summary', `
        SELECT
          COALESCE((SELECT total_visits FROM site_stats WHERE id = 1 LIMIT 1), 0)::bigint AS total_visits,
          NOW() AS database_time
      `),
      safeQuery(client, 'user summary', `
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE COALESCE(is_active, true) = true)::int AS active,
          COUNT(*) FILTER (WHERE COALESCE(is_active, true) = false)::int AS disabled,
          COUNT(*) FILTER (WHERE COALESCE(role, 'user') IN ('admin', 'enterprise_admin'))::int AS admins,
          COUNT(*) FILTER (
            WHERE COALESCE(role, 'user') = 'vip'
              OR COALESCE(membership_tier, 'free') NOT IN ('free', '')
          )::int AS members,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS created_7d
        FROM profiles
      `),
      safeQuery(client, 'work summary', `
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE is_public = true)::int AS public,
          COUNT(*) FILTER (WHERE is_public = false)::int AS private,
          COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
          COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
          COUNT(*) FILTER (WHERE result_url IS NOT NULL AND result_url <> '')::int AS with_result_url,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS created_7d,
          COUNT(*) FILTER (WHERE type = 'text2img')::int AS text2img,
          COUNT(*) FILTER (WHERE type = 'img2img')::int AS img2img,
          COUNT(*) FILTER (WHERE type = 'text2video')::int AS text2video,
          COUNT(*) FILTER (WHERE type = 'img2video')::int AS img2video
        FROM works
      `),
      safeQuery(client, 'task status summary', `
        SELECT status, COUNT(*)::int AS count
        FROM generation_jobs
        GROUP BY status
      `),
      safeQuery(client, 'latest tasks', `
        SELECT id, type, status, error, created_at, updated_at
        FROM generation_jobs
        ORDER BY created_at DESC
        LIMIT 6
      `),
      safeQuery(client, 'order status summary', `
        SELECT status, COUNT(*)::int AS count
        FROM orders
        GROUP BY status
      `),
      safeQuery(client, 'order revenue summary', `
        SELECT
          COALESCE(SUM(amount) FILTER (WHERE status = 'paid'), 0)::numeric AS paid_revenue,
          COALESCE(SUM(amount) FILTER (
            WHERE status = 'paid' AND COALESCE(paid_at, created_at) >= NOW() - INTERVAL '7 days'
          ), 0)::numeric AS paid_revenue_7d
        FROM orders
      `),
      safeQuery(client, 'latest orders', `
        SELECT id, order_no, product_name, amount, status, created_at
        FROM orders
        ORDER BY created_at DESC
        LIMIT 6
      `),
      safeQuery(client, 'storage health', `
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE result_url IS NOT NULL AND result_url <> '')::int AS persisted
        FROM works
      `),
      safeQuery(client, 'log health', `
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE level = 'error')::int AS errors,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours')::int AS created_24h
        FROM platform_logs
      `),
      safeQuery(client, 'provider summary', `
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE is_active = true)::int AS active,
          COUNT(*) FILTER (WHERE is_active = false)::int AS inactive,
          COUNT(*) FILTER (WHERE type = 'image')::int AS image,
          COUNT(*) FILTER (WHERE type = 'video')::int AS video,
          COUNT(*) FILTER (WHERE type = 'text')::int AS text,
          COUNT(*) FILTER (
            WHERE is_active = true
              AND (COALESCE(default_api_url, '') = '' OR COALESCE(default_model, '') = '')
          )::int AS incomplete
        FROM api_providers
      `),
      safeQuery(client, 'model recommendation summary', `
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE is_active = true)::int AS active
        FROM model_recommendations
      `),
      safeQuery(client, 'user api key summary', `
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE is_active = true)::int AS active
        FROM user_api_keys
      `),
      safeQuery(client, 'announcement summary', `
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (
            WHERE is_active = true
              AND (starts_at IS NULL OR starts_at <= NOW())
              AND (expires_at IS NULL OR expires_at >= NOW())
          )::int AS active,
          COUNT(*) FILTER (WHERE is_active = true AND starts_at > NOW())::int AS scheduled,
          COUNT(*) FILTER (WHERE expires_at < NOW())::int AS expired
        FROM announcements
      `),
    ]);

    const platform = firstRow(platformResult);
    const users = firstRow(userResult);
    const works = firstRow(workResult);
    const orderRevenue = firstRow(orderRevenueResult);
    const storage = firstRow(storageResult);
    const logs = firstRow(logResult);
    const providers = firstRow(providerResult);
    const recommendations = firstRow(recommendationResult);
    const userApiKeys = firstRow(userApiKeyResult);
    const announcements = firstRow(announcementResult);
    const storageStatus = await getStorageHealthStatus();
    const taskRows = taskStatusResult.rows;
    const orderRows = orderStatusResult.rows;

    const totalTasks = taskRows.reduce((sum, row) => sum + numberValue(row.count), 0);
    const totalOrders = orderRows.reduce((sum, row) => sum + numberValue(row.count), 0);
    const totalWorks = numberValue(works.total);

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      platform: {
        totalVisits: numberValue(platform.total_visits),
        databaseTime: platform.database_time || null,
      },
      users: {
        total: numberValue(users.total),
        active: numberValue(users.active),
        disabled: numberValue(users.disabled),
        admins: numberValue(users.admins),
        members: numberValue(users.members),
        created7d: numberValue(users.created_7d),
      },
      works: {
        total: totalWorks,
        public: numberValue(works.public),
        private: numberValue(works.private),
        completed: numberValue(works.completed),
        failed: numberValue(works.failed),
        withResultUrl: numberValue(works.with_result_url),
        created7d: numberValue(works.created_7d),
        resultUrlCoverage: totalWorks > 0 ? numberValue(works.with_result_url) / totalWorks : 1,
        byType: {
          text2img: numberValue(works.text2img),
          img2img: numberValue(works.img2img),
          text2video: numberValue(works.text2video),
          img2video: numberValue(works.img2video),
        },
      },
      tasks: {
        total: totalTasks,
        queued: statusCount(taskRows, 'queued'),
        running: statusCount(taskRows, 'running'),
        succeeded: statusCount(taskRows, 'succeeded'),
        failed: statusCount(taskRows, 'failed'),
        latest: latestTaskResult.rows.map(row => ({
          id: String(row.id || ''),
          type: String(row.type || ''),
          status: String(row.status || ''),
          error: row.error ? String(row.error) : null,
          createdAt: row.created_at || null,
          updatedAt: row.updated_at || null,
        })),
      },
      orders: {
        total: totalOrders,
        pending: statusCount(orderRows, 'pending'),
        paid: statusCount(orderRows, 'paid'),
        cancelled: statusCount(orderRows, 'cancelled'),
        refunded: statusCount(orderRows, 'refunded'),
        paidRevenue: numberValue(orderRevenue.paid_revenue),
        paidRevenue7d: numberValue(orderRevenue.paid_revenue_7d),
        latest: latestOrderResult.rows.map(row => ({
          id: String(row.id || ''),
          orderNo: String(row.order_no || ''),
          productName: String(row.product_name || ''),
          amount: numberValue(row.amount),
          status: String(row.status || ''),
          createdAt: row.created_at || null,
        })),
      },
      providers: {
        total: numberValue(providers.total),
        active: numberValue(providers.active),
        inactive: numberValue(providers.inactive),
        image: numberValue(providers.image),
        video: numberValue(providers.video),
        text: numberValue(providers.text),
        incomplete: numberValue(providers.incomplete),
        recommendationsTotal: numberValue(recommendations.total),
        recommendationsActive: numberValue(recommendations.active),
        userApiKeysTotal: numberValue(userApiKeys.total),
        userApiKeysActive: numberValue(userApiKeys.active),
      },
      announcements: {
        total: numberValue(announcements.total),
        active: numberValue(announcements.active),
        scheduled: numberValue(announcements.scheduled),
        expired: numberValue(announcements.expired),
      },
      system: {
        apiHealth: true,
        databaseHealth: true,
        storageHealth: storageStatus.ok,
        storageDirConfigured: storageStatus.local.ok || storageStatus.object.configured,
        storageBackend: storageStatus.mode,
        worksPersisted: numberValue(storage.persisted),
        worksTotal: numberValue(storage.total),
        logsTotal: numberValue(logs.total),
        logsErrors: numberValue(logs.errors),
        logsCreated24h: numberValue(logs.created_24h),
      },
    });
  } catch (error) {
    console.error('[admin/dashboard] GET error:', error);
    return NextResponse.json({ error: '获取仪表盘数据失败' }, { status: 500 });
  } finally {
    client.release();
  }
}
