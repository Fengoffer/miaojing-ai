import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getDbClient } from '@/storage/database/local-db';

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const client = await getDbClient();
    try {
      const result = await client.query(`
        SELECT
          COALESCE((SELECT total_visits FROM site_stats WHERE id = 1 LIMIT 1), 0)::int AS total_visits,
          COALESCE((
            SELECT COUNT(*)
            FROM profiles
            WHERE COALESCE(role, 'user') NOT IN ('admin', 'enterprise_admin')
          ), 0)::int AS total_users,
          COALESCE((
            SELECT COUNT(*)
            FROM works
            WHERE is_public = true AND status = 'completed'
          ), 0)::int AS total_works
      `);
      const row = result.rows[0] || {};
      return NextResponse.json({
        totalVisits: Number(row.total_visits || 0),
        totalUsers: Number(row.total_users || 0),
        totalWorks: Number(row.total_works || 0),
      });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[admin/stats] GET error:', err);
    return NextResponse.json({ error: '获取统计数据失败' }, { status: 500 });
  }
}
