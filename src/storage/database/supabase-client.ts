import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabase client for the MiaoJing AI Creation Platform.
 *
 * Environment variables for local deployment:
 * - LOCAL_DB_URL: Local PostgreSQL database URL (e.g., postgresql://postgres:postgres@localhost:5432/miaojing)
 * - LOCAL_DB_ANON_KEY: Supabase anon key (for local Supabase or mock)
 * - LOCAL_DB_SERVICE_ROLE_KEY: Supabase service role key (for local Supabase or mock)
 *
 * Environment variables for Supabase cloud:
 * - COZE_SUPABASE_URL: Supabase project URL
 * - COZE_SUPABASE_ANON_KEY: Supabase anon/public key
 * - COZE_SUPABASE_SERVICE_ROLE_KEY: Supabase service role key
 *
 * If no database configuration is set, getSupabaseClient() will throw,
 * and callers should fall back to demo mode.
 */

// Lazy-load dotenv only if available (development convenience)
let dotenvLoaded = false;
function loadDotenv(): void {
  if (dotenvLoaded) return;
  dotenvLoaded = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('dotenv').config();
  } catch {
    // dotenv not installed — env vars must be set externally
  }
}

function getSupabaseUrl(): string {
  loadDotenv();
  const url = process.env.LOCAL_DB_URL || process.env.COZE_SUPABASE_URL || process.env.SUPABASE_URL;
  if (!url) throw new Error('Database URL is not set. Please set LOCAL_DB_URL or COZE_SUPABASE_URL');
  return url;
}

function getSupabaseAnonKey(): string {
  loadDotenv();
  const key = process.env.LOCAL_DB_ANON_KEY || process.env.COZE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!key) throw new Error('Database anon key is not set. Please set LOCAL_DB_ANON_KEY or COZE_SUPABASE_ANON_KEY');
  return key;
}

function getSupabaseServiceRoleKey(): string | undefined {
  loadDotenv();
  return process.env.LOCAL_DB_SERVICE_ROLE_KEY || process.env.COZE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
}

/**
 * Get a Supabase client instance.
 *
 * @param token - Optional user JWT token for authenticated requests.
 *                When provided, uses anon key + Authorization header.
 *                When omitted, uses service role key (if available) or anon key.
 * @throws Error if database configuration is not set.
 */
function getSupabaseClient(token?: string): SupabaseClient {
  const url = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();

  // Use service role key for server-side operations (no token = admin context)
  // Use anon key for user-context operations (with token)
  let key: string;
  if (token) {
    key = anonKey;
  } else {
    const serviceRoleKey = getSupabaseServiceRoleKey();
    key = serviceRoleKey ?? anonKey;
  }

  const globalOptions: Record<string, unknown> = {};
  if (token) {
    globalOptions.headers = { Authorization: `Bearer ${token}` };
  }

  return createClient(url, key, {
    global: globalOptions,
    db: {
      timeout: 60000,
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export { getSupabaseUrl, getSupabaseAnonKey, getSupabaseServiceRoleKey, getSupabaseClient };
