import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/session-auth';
import { getDbClient } from '@/storage/database/local-db';
import { redeemCodeForUser } from '@/lib/redeem-code-service';

export async function POST(request: NextRequest) {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) {
    return NextResponse.json({ error: '请先登录后再兑换' }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const code = typeof body.code === 'string' ? body.code : '';
    const client = await getDbClient();
    try {
      const result = await redeemCodeForUser(client, { code, userId });
      return NextResponse.json({
        success: true,
        code: result.code,
        codeType: result.codeType,
        creditsAmount: result.creditsAmount,
        creditsBalance: result.creditsBalance,
        membershipTier: result.membershipTier,
        membershipExpiresAt: result.membershipExpiresAt,
        membershipDurationValue: result.membershipDurationValue,
        membershipDurationUnit: result.membershipDurationUnit,
      });
    } finally {
      client.release();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '兑换失败';
    console.error('[redeem-codes/redeem] POST error:', message);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
