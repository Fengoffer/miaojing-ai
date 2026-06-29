import { NextRequest, NextResponse } from 'next/server';
import { getDbClient } from '@/storage/database/local-db';
import { getAuthenticatedUserId } from '@/lib/session-auth';
import { ensureProfilePreferenceSchema, normalizePreferredTheme } from '@/lib/profile-preferences';

export async function PUT(request: NextRequest) {
  const tokenUserId = await getAuthenticatedUserId(request);
  if (!tokenUserId) {
    return NextResponse.json({ error: 'Please log in again' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const preferredTheme = normalizePreferredTheme(body?.theme);
    const client = await getDbClient();

    try {
      await ensureProfilePreferenceSchema(client);
      const result = await client.query(
        `UPDATE profiles
            SET preferred_theme = $1,
                updated_at = NOW()
          WHERE id = $2
          RETURNING preferred_theme`,
        [preferredTheme, tokenUserId],
      );

      if (result.rows.length === 0) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }

      return NextResponse.json({
        success: true,
        preferred_theme: normalizePreferredTheme(result.rows[0].preferred_theme),
      });
    } finally {
      client.release();
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to save theme';
    console.error('[Profile Theme Error]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
