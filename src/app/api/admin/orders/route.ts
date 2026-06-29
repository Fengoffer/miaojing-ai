import { NextRequest, NextResponse } from 'next/server';
import { getDbClient } from '@/storage/database/local-db';
import { requireAdmin } from '@/lib/admin-auth';

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const client = await getDbClient();
    try {
      const result = await client.query('SELECT * FROM orders ORDER BY created_at DESC LIMIT 100');
      return NextResponse.json({ orders: result.rows || [] });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[admin/orders] GET error:', err);
    return NextResponse.json({ error: '获取订单列表失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const client = await getDbClient();
    try {
      const id = crypto.randomUUID();
      const { user_id, order_no, product_type, product_name, amount, credits_amount, status, payment_method } = body;
      await client.query(
        'INSERT INTO orders (id, user_id, order_no, product_type, product_name, amount, credits_amount, status, payment_method) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [id, user_id, order_no, product_type, product_name, amount, credits_amount, status || 'pending', payment_method]
      );
      return NextResponse.json({ success: true });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[admin/orders] POST error:', err);
    return NextResponse.json({ error: '创建订单失败' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { orderId, ...updates } = body;

    if (!orderId) {
      return NextResponse.json({ error: '缺少订单ID' }, { status: 400 });
    }

    const client = await getDbClient();
    try {
      const setClauses: string[] = [];
      const params: unknown[] = [];
      let paramIdx = 1;

      if (updates.status !== undefined) { setClauses.push(`status = $${paramIdx++}`); params.push(updates.status); }
      if (updates.payment_method !== undefined) { setClauses.push(`payment_method = $${paramIdx++}`); params.push(updates.payment_method); }
      if (updates.paid_at !== undefined) { setClauses.push(`paid_at = $${paramIdx++}`); params.push(updates.paid_at); }
      setClauses.push('updated_at = NOW()');

      params.push(orderId);
      await client.query(`UPDATE orders SET ${setClauses.join(', ')} WHERE id = $${paramIdx}`, params);
      return NextResponse.json({ success: true });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[admin/orders] PUT error:', err);
    return NextResponse.json({ error: '更新订单失败' }, { status: 500 });
  }
}
