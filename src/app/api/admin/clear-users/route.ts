import { NextRequest, NextResponse } from 'next/server';
import { getDbClient } from '@/storage/database/local-db';
import { requireAdmin } from '@/lib/admin-auth';

const DEFAULT_ADMIN_EMAIL = 'admin@example.com';

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    if (process.env.ENABLE_DANGER_ADMIN_CLEAR_USERS !== 'true') {
      return NextResponse.json(
        { error: '生产环境已默认禁用清空用户数据功能。如确需执行，请临时设置 ENABLE_DANGER_ADMIN_CLEAR_USERS=true 并完成备份后再操作。' },
        { status: 403 },
      );
    }

    const body = await request.json();
    const { password } = body;

    const adminPassword = process.env.ADMIN_DEFAULT_PASSWORD || 'admin123';

    if (password !== adminPassword) {
      return NextResponse.json({ error: '管理员密码错误' }, { status: 401 });
    }

    const client = await getDbClient();

    try {
      await client.query('BEGIN');

      const adminResult = await client.query(
        `SELECT id, email, nickname FROM profiles
         WHERE role = 'admin' AND is_active = true
         ORDER BY CASE WHEN email = $1 THEN 0 ELSE 1 END, created_at ASC
         LIMIT 1`,
        [DEFAULT_ADMIN_EMAIL],
      );

      if (adminResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: '未找到可保留的系统管理员账号，已拒绝清理' }, { status: 409 });
      }

      const admin = adminResult.rows[0];

      await client.query('DELETE FROM credit_transactions WHERE user_id <> $1', [admin.id]);
      await client.query('DELETE FROM work_likes WHERE user_id <> $1', [admin.id]);
      await client.query('DELETE FROM works WHERE user_id <> $1', [admin.id]);
      await client.query('DELETE FROM user_api_keys WHERE user_id <> $1', [admin.id]);
      await client.query('DELETE FROM orders WHERE user_id IS NOT NULL AND user_id <> $1', [admin.id]);
      await client.query('DELETE FROM profiles WHERE id <> $1', [admin.id]);
      await client.query('DELETE FROM auth.users WHERE id <> $1', [admin.id]);

      await client.query(
        `UPDATE profiles
         SET email = $2,
             nickname = COALESCE(NULLIF(nickname, ''), $3),
             role = 'admin',
             membership_tier = 'enterprise',
             credits_balance = GREATEST(COALESCE(credits_balance, 0), 9999),
             daily_quota_limit = GREATEST(COALESCE(daily_quota_limit, 0), 999),
             daily_quota_used = 0,
             is_active = true,
             updated_at = NOW()
         WHERE id = $1`,
        [admin.id, admin.email || DEFAULT_ADMIN_EMAIL, admin.nickname || '管理员'],
      );

      await client.query('COMMIT');
      return NextResponse.json({ success: true, message: '所有非系统管理员用户数据已清除，系统管理员已保留' });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '清除用户数据失败';
    console.error('[Clear Users Error]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
