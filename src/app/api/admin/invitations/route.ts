import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getDbClient } from '@/storage/database/local-db';
import { listInvitationReferrals } from '@/lib/invitation-service';

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const client = await getDbClient();
  try {
    const params = request.nextUrl.searchParams;
    const result = await listInvitationReferrals(client, {
      search: params.get('search') || params.get('q') || '',
      page: Number(params.get('page') || '1'),
      pageSize: Number(params.get('pageSize') || params.get('limit') || '20'),
    });
    return NextResponse.json(result);
  } finally {
    client.release();
  }
}
