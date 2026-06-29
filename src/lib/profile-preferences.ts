import type { PoolClient } from 'pg';

export type PreferredTheme = 'dark' | 'light';

let profilePreferenceSchemaReady = false;
let profilePreferenceSchemaWarned = false;

export function normalizePreferredTheme(value: unknown): PreferredTheme {
  return value === 'light' ? 'light' : 'dark';
}

export async function ensureProfilePreferenceSchema(client: PoolClient): Promise<void> {
  if (profilePreferenceSchemaReady) return;
  try {
    await client.query(`
      ALTER TABLE profiles
        ADD COLUMN IF NOT EXISTS preferred_theme VARCHAR(16) NOT NULL DEFAULT 'dark',
        ADD COLUMN IF NOT EXISTS watermark_disabled BOOLEAN NOT NULL DEFAULT false
    `);
    await client.query(`
      UPDATE profiles
         SET preferred_theme = 'dark'
       WHERE preferred_theme IS NULL
          OR preferred_theme NOT IN ('dark', 'light')
    `);
    profilePreferenceSchemaReady = true;
  } catch (error) {
    if (error && typeof error === 'object' && (error as { code?: string }).code === '42501') {
      if (!profilePreferenceSchemaWarned) {
        console.warn('[profile-preferences] skipped optional schema check because the database user is not the table owner');
        profilePreferenceSchemaWarned = true;
      }
      profilePreferenceSchemaReady = true;
      return;
    }
    throw error;
  }
}
