import { NextRequest, NextResponse } from 'next/server';
import { getDbClient } from '@/storage/database/local-db';
import { requireAdmin } from '@/lib/admin-auth';
import { requireAdminUser } from '@/lib/session-auth';
import { deleteAdminUser, listAdminUsers, updateAdminUser } from '@/lib/admin-users-service';

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const client = await getDbClient();
    try {
      const params = request.nextUrl.searchParams;
      const result = await listAdminUsers(client, {
        search: params.get('search') || params.get('q') || '',
        page: Number(params.get('page') || '1'),
        pageSize: Number(params.get('pageSize') || params.get('limit') || '20'),
      });

      return NextResponse.json(result);
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[admin/users] GET error:', err);
    return NextResponse.json({ error: '获取用户列表失败' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const client = await getDbClient();
    try {
      const result = await updateAdminUser(client, body);
      return NextResponse.json(result.body, { status: result.status });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[admin/users] PUT error:', err);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const admin = await requireAdminUser(request);
  if (admin instanceof NextResponse) return admin;

  try {
    const body = await request.json().catch(() => ({}));
    const userId = body.userId || body.id || request.nextUrl.searchParams.get('userId') || request.nextUrl.searchParams.get('id');
    const client = await getDbClient();
    try {
      const result = await deleteAdminUser(client, String(userId || ''), admin.userId);
      return NextResponse.json(result.body, { status: result.status });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[admin/users] DELETE error:', err);
    return NextResponse.json({ error: '删除用户失败' }, { status: 500 });
  }
}
