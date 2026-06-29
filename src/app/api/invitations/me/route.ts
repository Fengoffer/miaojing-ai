import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/session-auth';
import { getDbClient } from '@/storage/database/local-db';
import { getOrCreateInviteCode, listInvitationReferrals } from '@/lib/invitation-service';

export async function GET(request: NextRequest) {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) return NextResponse.json({ error: '请先登录' }, { status: 401 });

  const client = await getDbClient();
  try {
    const inviteCode = await getOrCreateInviteCode(client, userId);
    const referrals = await listInvitationReferrals(client, { inviterUserId: userId, page: 1, pageSize: 100 });
    return NextResponse.json({
      inviteCode,
      referrals: referrals.referrals,
      referralCount: referrals.total,
    });
  } finally {
    client.release();
  }
}
