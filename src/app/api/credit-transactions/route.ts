import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/session-auth';
import { getDbClient } from '@/storage/database/local-db';

export async function GET(request: NextRequest) {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) {
    return NextResponse.json({ error: '请先登录' }, { status: 401 });
  }

  try {
    const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get('limit') || 100), 20), 300);
    const client = await getDbClient();
    try {
      const result = await client.query(
        `SELECT id, amount, balance_after, type, description, created_at
           FROM credit_transactions
          WHERE user_id = $1
          ORDER BY created_at DESC
          LIMIT $2`,
        [userId, limit],
      );
      return NextResponse.json({
        records: result.rows.map(row => ({
          id: row.id,
          amount: Number(row.amount || 0),
          balanceAfter: Number(row.balance_after || 0),
          type: row.type || '',
          description: row.description || '',
          createdAt: row.created_at ? new Date(row.created_at).toISOString() : '',
        })),
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('[credit-transactions] GET error:', error);
    return NextResponse.json({ error: '获取积分记录失败' }, { status: 500 });
  }
}
