import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { isValidEmail, normalizeEmail } from '@/lib/email-service';
import { getDbClient } from '@/storage/database/local-db';

export const runtime = 'nodejs';

function mapRecipient(row: Record<string, unknown>) {
  const email = normalizeEmail(row.email);
  if (!isValidEmail(email)) return null;
  return {
    id: String(row.id),
    email,
    nickname: typeof row.display_nickname === 'string' && row.display_nickname.trim()
      ? row.display_nickname.trim()
      : typeof row.nickname === 'string' && row.nickname.trim() ? row.nickname.trim() : email.split('@')[0],
    phone: typeof row.phone === 'string' ? row.phone : null,
    avatarUrl: typeof row.avatar_url === 'string' ? row.avatar_url : null,
    emailVerified: row.email_verified === true,
  };
}

export async function GET(request: NextRequest) {
  const adminError = await requireAdmin(request);
  if (adminError) return adminError;

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') || '').trim().toLowerCase().slice(0, 80);
  const limit = Math.min(80, Math.max(1, Number(searchParams.get('limit') || 30)));

  const client = await getDbClient();
  try {
    const params: unknown[] = [];
    let filter = `
      WHERE COALESCE(role, 'user') NOT IN ('admin', 'enterprise_admin')
        AND COALESCE(is_active, true) = true
        AND COALESCE(email, '') <> ''
    `;

    if (q) {
      params.push(`%${q}%`);
      filter += `
        AND (
          LOWER(email) LIKE $${params.length}
          OR LOWER(COALESCE(display_nickname, '')) LIKE $${params.length}
          OR LOWER(COALESCE(nickname, '')) LIKE $${params.length}
          OR COALESCE(phone, '') LIKE $${params.length}
        )
      `;
    }

    const result = await client.query(
      `SELECT id, email, nickname, display_nickname, phone, avatar_url, email_verified
       FROM profiles
       ${filter}
       ORDER BY created_at DESC
       LIMIT ${limit}`,
      params,
    );

    const countResult = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM profiles
       WHERE COALESCE(role, 'user') NOT IN ('admin', 'enterprise_admin')
         AND COALESCE(is_active, true) = true
         AND COALESCE(email, '') <> ''`,
    );

    const users = result.rows
      .map(mapRecipient)
      .filter((item): item is NonNullable<ReturnType<typeof mapRecipient>> => Boolean(item));

    return NextResponse.json({
      users,
      total: Number(countResult.rows[0]?.count || 0),
    });
  } finally {
    client.release();
  }
}
