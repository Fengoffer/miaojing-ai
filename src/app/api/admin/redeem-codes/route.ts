import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/session-auth';
import { getDbClient } from '@/storage/database/local-db';
import {
  createRedeemCodes,
  deleteUnusedRedeemCode,
  listRedeemCodes,
  setRedeemCodeActive,
} from '@/lib/redeem-code-service';

export async function GET(request: NextRequest) {
  const admin = await requireAdminUser(request);
  if (admin instanceof NextResponse) return admin;

  try {
    const client = await getDbClient();
    try {
      const params = request.nextUrl.searchParams;
      const status = params.get('status') || 'all';
      const codes = await listRedeemCodes(client, {
        search: params.get('search') || '',
        status: status === 'unused' || status === 'used' || status === 'inactive' ? status : 'all',
        limit: Number(params.get('limit') || 100),
      });
      return NextResponse.json({ codes });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('[admin/redeem-codes] GET error:', error);
    return NextResponse.json({ error: '获取兑换码失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const admin = await requireAdminUser(request);
  if (admin instanceof NextResponse) return admin;

  try {
    const body = await request.json().catch(() => ({}));
    const count = Number(body.count || 1);
    const codeType = body.codeType === 'membership' || body.code_type === 'membership' ? 'membership' : 'credits';
    const creditsAmount = Number(body.creditsAmount || body.credits_amount || 0);
    const membershipTier = typeof body.membershipTier === 'string' ? body.membershipTier : body.membership_tier;
    const membershipDurationValue = Number(body.membershipDurationValue || body.membership_duration_value || 0);
    const membershipDurationUnit = typeof body.membershipDurationUnit === 'string'
      ? body.membershipDurationUnit
      : body.membership_duration_unit;
    const note = typeof body.note === 'string' ? body.note : '';

    const client = await getDbClient();
    try {
      const result = await createRedeemCodes(client, {
        count,
        codeType,
        creditsAmount,
        membershipTier,
        membershipDurationValue,
        membershipDurationUnit,
        note,
        createdBy: admin.userId,
      });
      return NextResponse.json(result, { status: 201 });
    } finally {
      client.release();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '生成兑换码失败';
    console.error('[admin/redeem-codes] POST error:', message);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PUT(request: NextRequest) {
  const admin = await requireAdminUser(request);
  if (admin instanceof NextResponse) return admin;

  try {
    const body = await request.json().catch(() => ({}));
    const id = typeof body.id === 'string' ? body.id : '';
    const isActive = body.isActive === true || body.is_active === true;
    if (!id) return NextResponse.json({ error: '缺少兑换码ID' }, { status: 400 });

    const client = await getDbClient();
    try {
      const code = await setRedeemCodeActive(client, id, isActive);
      if (!code) return NextResponse.json({ error: '兑换码不存在' }, { status: 404 });
      return NextResponse.json({ code });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('[admin/redeem-codes] PUT error:', error);
    return NextResponse.json({ error: '更新兑换码失败' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const admin = await requireAdminUser(request);
  if (admin instanceof NextResponse) return admin;

  try {
    const body = await request.json().catch(() => ({}));
    const id = String(body.id || request.nextUrl.searchParams.get('id') || '');
    if (!id) return NextResponse.json({ error: '缺少兑换码ID' }, { status: 400 });

    const client = await getDbClient();
    try {
      const deleted = await deleteUnusedRedeemCode(client, id);
      if (!deleted) return NextResponse.json({ error: '兑换码不存在或已被使用，不能删除' }, { status: 400 });
      return NextResponse.json({ success: true });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('[admin/redeem-codes] DELETE error:', error);
    return NextResponse.json({ error: '删除兑换码失败' }, { status: 500 });
  }
}
