import { NextResponse } from 'next/server';
import { getDbClient } from '@/storage/database/local-db';
import { ensureEmailSchema } from '@/lib/email-service';
import { getRequiredProductionSecret, isProductionRuntime } from '@/lib/runtime-env';
import { ensureProfilePreferenceSchema } from '@/lib/profile-preferences';

const ADMIN_EMAIL = 'admin@miaojing.ai';

export async function GET() {
  try {
    const client = await getDbClient();

    try {
      await ensureEmailSchema(client);
      await ensureProfilePreferenceSchema(client);
      const result = await client.query(
        'SELECT id, nickname FROM profiles WHERE role = $1 LIMIT 1',
        ['admin']
      );

      if (result.rows.length > 0) {
        return NextResponse.json({ exists: true, nickname: result.rows[0].nickname });
      }

      if (isProductionRuntime()) {
        return NextResponse.json({ exists: false, autoCreated: false });
      }

      getRequiredProductionSecret('ADMIN_DEFAULT_PASSWORD', 'admin123');

      // Development only: bootstrap the default admin profile.
      const userId = crypto.randomUUID();

      await client.query(
        'INSERT INTO auth.users (id, email, created_at) VALUES ($1, $2, NOW())',
        [userId, ADMIN_EMAIL]
      );

      await client.query(
        `INSERT INTO profiles (
           id, email, nickname, role, membership_tier, credits_balance,
           daily_quota_limit, daily_quota_used, is_active, email_verified,
           email_verified_at, email_bound_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET
           role = $4,
           membership_tier = $5,
           credits_balance = $6,
           daily_quota_limit = $7,
           nickname = $3,
           email_verified = true,
           email_verified_at = COALESCE(profiles.email_verified_at, NOW()),
           email_bound_at = COALESCE(profiles.email_bound_at, NOW())`,
        [userId, ADMIN_EMAIL, '管理员', 'admin', 'enterprise', 9999, 999, 0, true]
      );

      try {
        await client.query(
          'INSERT INTO credit_transactions (user_id, amount, balance_after, type, description) VALUES ($1, $2, $3, $4, $5)',
          [userId, 9999, 9999, 'gift', '管理员初始积分']
        );
      } catch { /* non-critical */ }

      console.log('[admin-exists] Default admin account created: account=admin, password=***');
      return NextResponse.json({
        exists: true,
        autoCreated: true,
        nickname: '管理员',
      });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[admin-exists] Error:', err);
    return NextResponse.json({ exists: false, error: '数据库连接失败' });
  }
}
