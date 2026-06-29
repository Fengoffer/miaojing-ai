import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getDbClient } from '@/storage/database/local-db';
import { listPaymentMethods, savePaymentMethod } from '@/lib/server-payment-config';

async function readBody(request: NextRequest) {
  return request.json().catch(() => ({}));
}

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const client = await getDbClient();
  try {
    return NextResponse.json({ paymentMethods: await listPaymentMethods(client) });
  } finally {
    client.release();
  }
}

export async function PUT(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const body = await readBody(request);
  if (typeof body.id !== 'string' || !body.id.trim()) {
    return NextResponse.json({ error: '缺少支付方式 ID' }, { status: 400 });
  }

  const client = await getDbClient();
  try {
    const paymentMethods = await savePaymentMethod(client, body.id.trim(), {
      name: typeof body.name === 'string' ? body.name : undefined,
      isActive: typeof body.isActive === 'boolean' ? body.isActive : undefined,
      config: body.config && typeof body.config === 'object' ? body.config : undefined,
    });
    return NextResponse.json({ paymentMethods });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '保存失败' },
      { status: 400 },
    );
  } finally {
    client.release();
  }
}
