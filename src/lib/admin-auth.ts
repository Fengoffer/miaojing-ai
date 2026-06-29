import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/session-auth';

export async function requireAdmin(request: NextRequest): Promise<NextResponse | null> {
  const result = await requireAdminUser(request);
  return result instanceof NextResponse ? result : null;
}
