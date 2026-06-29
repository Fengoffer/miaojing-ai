-- Idempotent local PostgreSQL patch for production maintenance.
-- It creates missing application tables and adds indexes used by hot paths.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

CREATE TABLE IF NOT EXISTS works (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  title VARCHAR(255),
  type VARCHAR(32) NOT NULL,
  prompt TEXT,
  negative_prompt TEXT,
  params JSONB DEFAULT '{}'::jsonb,
  result_url TEXT,
  thumbnail_url TEXT,
  width INTEGER,
  height INTEGER,
  duration NUMERIC(6, 2),
  is_public BOOLEAN NOT NULL DEFAULT false,
  likes_count INTEGER NOT NULL DEFAULT 0,
  credits_cost INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL DEFAULT 'completed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  order_no VARCHAR(64) NOT NULL UNIQUE,
  product_type VARCHAR(32) NOT NULL,
  product_name VARCHAR(255) NOT NULL,
  amount NUMERIC(10, 2) NOT NULL,
  credits_amount INTEGER,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  payment_method VARCHAR(32),
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS user_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  provider VARCHAR(64) NOT NULL,
  api_url TEXT,
  model_name VARCHAR(128),
  api_key_encrypted TEXT NOT NULL,
  api_key_preview VARCHAR(20),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS work_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  work_id UUID NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS generation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(16) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'queued',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB,
  error TEXT,
  user_id UUID,
  provider VARCHAR(128),
  model_name VARCHAR(255),
  api_url TEXT,
  progress JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS provider VARCHAR(128);
ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS model_name VARCHAR(255);
ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS api_url TEXT;
ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS progress JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS works_user_created_idx ON works (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS works_public_status_created_idx ON works (is_public, status, created_at DESC);
CREATE INDEX IF NOT EXISTS works_public_status_likes_idx ON works (is_public, status, likes_count DESC);
CREATE INDEX IF NOT EXISTS works_type_created_idx ON works (type, created_at DESC);
CREATE INDEX IF NOT EXISTS works_status_created_idx ON works (status, created_at DESC);

CREATE INDEX IF NOT EXISTS credit_transactions_user_created_idx ON credit_transactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS credit_transactions_type_created_idx ON credit_transactions (type, created_at DESC);

CREATE INDEX IF NOT EXISTS orders_user_created_idx ON orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_status_created_idx ON orders (status, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_order_no_idx ON orders (order_no);

CREATE INDEX IF NOT EXISTS user_api_keys_user_active_idx ON user_api_keys (user_id, is_active);
CREATE INDEX IF NOT EXISTS user_api_keys_provider_idx ON user_api_keys (provider);

CREATE INDEX IF NOT EXISTS work_likes_user_id_idx ON work_likes (user_id);
CREATE INDEX IF NOT EXISTS work_likes_work_id_idx ON work_likes (work_id);
CREATE UNIQUE INDEX IF NOT EXISTS work_likes_user_work_uniq ON work_likes (user_id, work_id);

CREATE INDEX IF NOT EXISTS announcements_active_window_idx ON announcements (is_active, starts_at, expires_at);
CREATE INDEX IF NOT EXISTS profiles_email_trgm_idx ON profiles USING GIN (LOWER(email) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS profiles_nickname_trgm_idx ON profiles USING GIN (LOWER(COALESCE(nickname, '')) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS profiles_phone_trgm_idx ON profiles USING GIN (LOWER(COALESCE(phone, '')) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS generation_jobs_status_created_idx ON generation_jobs (status, created_at DESC);
CREATE INDEX IF NOT EXISTS generation_jobs_status_updated_idx ON generation_jobs (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS generation_jobs_running_timeout_idx ON generation_jobs (updated_at) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS generation_jobs_created_idx ON generation_jobs (created_at DESC);
CREATE INDEX IF NOT EXISTS generation_jobs_user_created_idx ON generation_jobs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS generation_jobs_provider_model_created_idx ON generation_jobs (type, provider, model_name, created_at DESC);

CREATE TABLE IF NOT EXISTS platform_log_settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  retention_days INTEGER NOT NULL DEFAULT 30,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO platform_log_settings (id, retention_days)
VALUES (1, 30)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS platform_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(32) NOT NULL,
  level VARCHAR(16) NOT NULL DEFAULT 'info',
  action VARCHAR(128) NOT NULL,
  message TEXT NOT NULL,
  user_id UUID,
  user_name VARCHAR(255),
  user_email VARCHAR(255),
  target_type VARCHAR(64),
  target_id VARCHAR(255),
  ip_address VARCHAR(64),
  user_agent TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS platform_logs_type_created_idx ON platform_logs (type, created_at DESC);
CREATE INDEX IF NOT EXISTS platform_logs_level_created_idx ON platform_logs (level, created_at DESC);
CREATE INDEX IF NOT EXISTS platform_logs_user_created_idx ON platform_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS platform_logs_created_idx ON platform_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS platform_logs_user_name_idx ON platform_logs (LOWER(COALESCE(user_name, '')));
CREATE INDEX IF NOT EXISTS platform_logs_user_email_idx ON platform_logs (LOWER(COALESCE(user_email, '')));

DROP POLICY IF EXISTS "site_config_write_auth" ON site_config;
DROP POLICY IF EXISTS "announcements_write_auth" ON announcements;
DROP POLICY IF EXISTS "site_stats_write_auth" ON site_stats;

DROP POLICY IF EXISTS "site_config_admin_write" ON site_config;
DROP POLICY IF EXISTS "announcements_admin_write" ON announcements;

CREATE POLICY "site_config_admin_write" ON site_config FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
) WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

CREATE POLICY "announcements_admin_write" ON announcements FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
) WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

ANALYZE;
