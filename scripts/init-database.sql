-- ============================================================
-- 妙境 AI 创作平台 — 数据库初始化脚本
-- 适用于: PostgreSQL 14+ (Supabase / 自托管)
-- 执行方式: 在 Supabase SQL Editor 或 psql 中运行
-- ============================================================

-- 0. 启用必要扩展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. 创建 auth 模式和 users 表
CREATE SCHEMA IF NOT EXISTS auth;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'auth' AND p.proname = 'uid'
  ) THEN
    EXECUTE 'CREATE FUNCTION auth.uid() RETURNS UUID AS $fn$ SELECT NULLIF(current_setting(''request.jwt.claim.sub'', true), '''')::UUID; $fn$ LANGUAGE SQL STABLE';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'auth' AND p.proname = 'role'
  ) THEN
    EXECUTE 'CREATE FUNCTION auth.role() RETURNS TEXT AS $fn$ SELECT COALESCE(NULLIF(current_setting(''request.jwt.claim.role'', true), ''''), ''anon''); $fn$ LANGUAGE SQL STABLE';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE,
  password_hash TEXT,
  raw_user_meta_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_users_email_idx ON auth.users (email);

-- ============================================================
-- 1. 用户资料表 (profiles)
-- 与 Supabase Auth 的 auth.users 表关联
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  nickname VARCHAR(128),
  display_nickname VARCHAR(128),
  avatar_url TEXT,
  phone VARCHAR(20),
  role VARCHAR(32) NOT NULL DEFAULT 'user',        -- guest, user, vip, enterprise_admin, enterprise_member, admin
  membership_tier VARCHAR(32) NOT NULL DEFAULT 'free', -- free, basic, pro, enterprise
  membership_expires_at TIMESTAMPTZ,
  credits_balance INTEGER NOT NULL DEFAULT 0,
  invite_code VARCHAR(32),
  referred_by_user_id UUID,
  daily_quota_used INTEGER NOT NULL DEFAULT 0,
  daily_quota_limit INTEGER NOT NULL DEFAULT 5,
  is_active BOOLEAN NOT NULL DEFAULT true,
  email_verified BOOLEAN NOT NULL DEFAULT false,
  email_verified_at TIMESTAMPTZ,
  email_bound_at TIMESTAMPTZ,
  email_sender_domain VARCHAR(255),
  preferred_theme VARCHAR(16) NOT NULL DEFAULT 'dark',
  watermark_disabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS profiles_email_idx ON profiles (email);
CREATE INDEX IF NOT EXISTS profiles_role_idx ON profiles (role);
CREATE UNIQUE INDEX IF NOT EXISTS profiles_invite_code_unique_idx ON profiles (invite_code) WHERE invite_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS profiles_referred_by_user_id_idx ON profiles (referred_by_user_id);

-- ============================================================
-- 2. 创作作品表 (works)
-- ============================================================
CREATE TABLE IF NOT EXISTS works (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID DEFAULT auth.uid(),
  title VARCHAR(255),
  type VARCHAR(32) NOT NULL,           -- text2img, img2img, text2video, img2video
  prompt TEXT,
  negative_prompt TEXT,
  params JSONB,                         -- 生成参数 (画面比例、分辨率、模型等)
  result_url TEXT,                      -- 生成文件的 URL
  thumbnail_url TEXT,
  width INTEGER,
  height INTEGER,
  duration NUMERIC(6, 2),              -- 视频时长 (秒)
  is_public BOOLEAN NOT NULL DEFAULT false,
  likes_count INTEGER NOT NULL DEFAULT 0,
  views_count INTEGER NOT NULL DEFAULT 0,
  credits_cost INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL DEFAULT 'completed', -- pending, processing, completed, failed
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS works_user_id_idx ON works (user_id);
CREATE INDEX IF NOT EXISTS works_type_idx ON works (type);
CREATE INDEX IF NOT EXISTS works_is_public_idx ON works (is_public);
CREATE INDEX IF NOT EXISTS works_created_at_idx ON works (created_at);
CREATE INDEX IF NOT EXISTS works_status_idx ON works (status);

-- ============================================================
-- 3. 积分记录表 (credit_transactions)
-- ============================================================
CREATE TABLE IF NOT EXISTS credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID DEFAULT auth.uid(),
  amount INTEGER NOT NULL,              -- 正数=入账, 负数=消费
  balance_after INTEGER NOT NULL,
  type VARCHAR(32) NOT NULL,            -- purchase, consume, gift, reward, refund
  description VARCHAR(500),
  related_work_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS credit_transactions_user_id_idx ON credit_transactions (user_id);
CREATE INDEX IF NOT EXISTS credit_transactions_type_idx ON credit_transactions (type);
CREATE INDEX IF NOT EXISTS credit_transactions_created_at_idx ON credit_transactions (created_at);

-- ============================================================
-- 4. 邀请注册记录表 (invitation_referrals)
-- ============================================================
CREATE TABLE IF NOT EXISTS invitation_referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_code VARCHAR(32) NOT NULL,
  inviter_user_id UUID NOT NULL,
  invitee_user_id UUID NOT NULL UNIQUE,
  inviter_bonus_credits INTEGER NOT NULL DEFAULT 50,
  invitee_bonus_credits INTEGER NOT NULL DEFAULT 50,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invitation_referrals_inviter_idx ON invitation_referrals (inviter_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS invitation_referrals_invitee_idx ON invitation_referrals (invitee_user_id);
CREATE INDEX IF NOT EXISTS invitation_referrals_created_at_idx ON invitation_referrals (created_at DESC);

-- ============================================================
-- 5. 兑换码表 (redeem_codes)
-- ============================================================
CREATE TABLE IF NOT EXISTS redeem_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(64) NOT NULL UNIQUE,
  normalized_code VARCHAR(64) NOT NULL UNIQUE,
  code_type VARCHAR(16) NOT NULL DEFAULT 'credits',
  credits_amount INTEGER NOT NULL DEFAULT 0,
  membership_tier VARCHAR(32),
  membership_duration_value INTEGER,
  membership_duration_unit VARCHAR(16),
  batch_id UUID NOT NULL DEFAULT gen_random_uuid(),
  note VARCHAR(255) NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID,
  used_by UUID,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ
);

ALTER TABLE redeem_codes DROP CONSTRAINT IF EXISTS redeem_codes_credits_amount_check;
ALTER TABLE redeem_codes DROP CONSTRAINT IF EXISTS redeem_codes_payload_check;
ALTER TABLE redeem_codes
  ADD CONSTRAINT redeem_codes_payload_check CHECK (
    (code_type = 'credits' AND credits_amount > 0)
    OR (
      code_type = 'membership'
      AND credits_amount >= 0
      AND membership_tier IN ('pro', 'max', 'ultra', 'enterprise')
      AND membership_duration_value > 0
      AND membership_duration_unit IN ('day', 'month', 'year')
    )
  );

CREATE INDEX IF NOT EXISTS redeem_codes_created_at_idx ON redeem_codes (created_at DESC);
CREATE INDEX IF NOT EXISTS redeem_codes_batch_id_idx ON redeem_codes (batch_id);
CREATE INDEX IF NOT EXISTS redeem_codes_used_by_idx ON redeem_codes (used_by);
CREATE INDEX IF NOT EXISTS redeem_codes_status_idx ON redeem_codes (is_active, used_at);
CREATE INDEX IF NOT EXISTS redeem_codes_type_idx ON redeem_codes (code_type);

-- ============================================================
-- 5. 订单表 (orders)
-- ============================================================
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID DEFAULT auth.uid(),
  order_no VARCHAR(64) NOT NULL UNIQUE,
  product_type VARCHAR(32) NOT NULL,    -- membership, credits, api
  product_name VARCHAR(255) NOT NULL,
  amount NUMERIC(10, 2) NOT NULL,
  credits_amount INTEGER,               -- 购买的积分数
  status VARCHAR(32) NOT NULL DEFAULT 'pending', -- pending, paid, cancelled, refunded
  payment_method VARCHAR(32),           -- wechat, alipay, stripe
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS orders_user_id_idx ON orders (user_id);
CREATE INDEX IF NOT EXISTS orders_order_no_idx ON orders (order_no);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status);
CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders (created_at);

-- ============================================================
-- 5. 生成任务队列表 (generation_jobs)
-- ============================================================
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

CREATE INDEX IF NOT EXISTS generation_jobs_status_created_idx ON generation_jobs (status, created_at DESC);
CREATE INDEX IF NOT EXISTS generation_jobs_status_updated_idx ON generation_jobs (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS generation_jobs_running_timeout_idx ON generation_jobs (updated_at) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS generation_jobs_created_idx ON generation_jobs (created_at DESC);
CREATE INDEX IF NOT EXISTS generation_jobs_user_created_idx ON generation_jobs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS generation_jobs_provider_model_created_idx ON generation_jobs (type, provider, model_name, created_at DESC);

-- ============================================================
-- 6. 模型调用记录表 (model_call_records)
-- ============================================================
CREATE TABLE IF NOT EXISTS model_call_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  source VARCHAR(64) NOT NULL DEFAULT '',
  operation VARCHAR(64) NOT NULL DEFAULT '',
  generation_job_id UUID REFERENCES generation_jobs(id) ON DELETE SET NULL,
  type VARCHAR(32) NOT NULL DEFAULT 'text',
  provider VARCHAR(128) NOT NULL DEFAULT '',
  model_name VARCHAR(255) NOT NULL DEFAULT '',
  api_url TEXT NOT NULL DEFAULT '',
  system_api_id UUID,
  custom_api_key_id UUID,
  status VARCHAR(16) NOT NULL DEFAULT 'queued',
  credits_cost INTEGER NOT NULL DEFAULT 0,
  result_count INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS model_call_records_generation_job_uidx
  ON model_call_records (generation_job_id)
  WHERE generation_job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS model_call_records_created_idx ON model_call_records (created_at DESC);
CREATE INDEX IF NOT EXISTS model_call_records_user_created_idx ON model_call_records (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS model_call_records_status_created_idx ON model_call_records (status, created_at DESC);
CREATE INDEX IF NOT EXISTS model_call_records_model_created_idx ON model_call_records (type, provider, model_name, created_at DESC);
CREATE INDEX IF NOT EXISTS model_call_records_source_created_idx ON model_call_records (source, created_at DESC);
CREATE INDEX IF NOT EXISTS model_call_records_system_api_idx ON model_call_records (system_api_id, created_at DESC);
CREATE INDEX IF NOT EXISTS model_call_records_custom_api_idx ON model_call_records (custom_api_key_id, created_at DESC);

-- ============================================================
-- 7. 用户自定义 API 密钥表 (user_api_keys)
-- ============================================================
CREATE TABLE IF NOT EXISTS user_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID DEFAULT auth.uid(),
  provider VARCHAR(64) NOT NULL,        -- openai, stabilityai, runway, etc.
  api_url TEXT,                         -- 完整 API 端点 URL
  model_name VARCHAR(128),              -- 具体模型名称
  api_key_encrypted TEXT NOT NULL,       -- 加密存储的 API Key
  api_key_preview VARCHAR(20),          -- Key 尾号 (如 sk-...4f3e)
  supplier_name VARCHAR(128),
  note TEXT NOT NULL DEFAULT '',
  manifest_path TEXT,
  type VARCHAR(16) NOT NULL DEFAULT 'image',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS user_api_keys_user_id_idx ON user_api_keys (user_id);
CREATE INDEX IF NOT EXISTS user_api_keys_provider_idx ON user_api_keys (provider);

-- ============================================================
-- 8. 作品点赞表 (work_likes)
-- ============================================================
CREATE TABLE IF NOT EXISTS work_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID DEFAULT auth.uid(),
  work_id UUID NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS work_likes_user_id_idx ON work_likes (user_id);
CREATE INDEX IF NOT EXISTS work_likes_work_id_idx ON work_likes (work_id);

-- 唯一约束：每个用户对每个作品只能点赞一次
CREATE UNIQUE INDEX IF NOT EXISTS work_likes_user_work_uniq ON work_likes (user_id, work_id);

-- ============================================================
-- 9. 网站配置表 (site_config)
-- ============================================================
CREATE TABLE IF NOT EXISTS site_config (
  id INTEGER PRIMARY KEY DEFAULT 1,
  site_name VARCHAR(128) NOT NULL DEFAULT '妙境',
  site_tab_title VARCHAR(255) NOT NULL DEFAULT '妙境 - AI创作平台',
  site_description TEXT NOT NULL DEFAULT '',
  site_keywords TEXT NOT NULL DEFAULT '',
  logo_url TEXT,
  favicon_url TEXT,
  announcement TEXT NOT NULL DEFAULT '',
  membership_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  terms_of_service TEXT NOT NULL DEFAULT '',
  privacy_policy TEXT NOT NULL DEFAULT '',
  about_us TEXT NOT NULL DEFAULT '',
  help_center TEXT NOT NULL DEFAULT '',
  filing_info TEXT NOT NULL DEFAULT '',
  filing_url TEXT NOT NULL DEFAULT '',
  public_security_filing_info TEXT NOT NULL DEFAULT '',
  public_security_filing_url TEXT NOT NULL DEFAULT '',
  redeem_code_mall_url TEXT NOT NULL DEFAULT '',
  log_retention_days INTEGER NOT NULL DEFAULT 30,
  image_composition_skill_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ
);

-- 插入默认配置
INSERT INTO site_config (id, site_name, site_tab_title)
VALUES (1, '妙境', '妙境 - AI创作平台')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 9. 公告表 (announcements)
-- ============================================================
CREATE TABLE IF NOT EXISTS announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,                 -- 支持 Markdown
  type VARCHAR(32) NOT NULL DEFAULT 'site',
  is_active BOOLEAN NOT NULL DEFAULT true,
  starts_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS announcements_is_active_idx ON announcements (is_active);
CREATE INDEX IF NOT EXISTS announcements_expires_at_idx ON announcements (expires_at);

-- ============================================================
-- 10. 网站统计表 (site_stats)
-- ============================================================
CREATE TABLE IF NOT EXISTS site_stats (
  id INTEGER PRIMARY KEY DEFAULT 1,
  total_visits BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO site_stats (id, total_visits) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 11. 平台日志
-- ============================================================
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

-- ============================================================
-- 12. API 供应商与推荐模型配置
-- ============================================================
CREATE TABLE IF NOT EXISTS api_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(128) NOT NULL UNIQUE,
  default_api_url TEXT,
  default_model VARCHAR(255),
  type VARCHAR(16) NOT NULL DEFAULT 'image',
  website TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS model_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_name VARCHAR(255) NOT NULL,
  display_name VARCHAR(255),
  type VARCHAR(16) NOT NULL DEFAULT 'image',
  provider_id UUID REFERENCES api_providers(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS api_providers_active_sort_idx ON api_providers (is_active, sort_order);
CREATE INDEX IF NOT EXISTS model_recommendations_active_type_sort_idx ON model_recommendations (is_active, type, sort_order);
CREATE INDEX IF NOT EXISTS model_recommendations_provider_idx ON model_recommendations (provider_id);

CREATE TABLE IF NOT EXISTS image_style_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label VARCHAR(128) NOT NULL UNIQUE,
  prompt TEXT NOT NULL,
  usage_count INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS image_style_presets_active_usage_idx ON image_style_presets (is_active, usage_count DESC, sort_order ASC);

INSERT INTO api_providers (name, default_api_url, default_model, type, website, is_active, sort_order)
VALUES
  ('硅基流动', 'https://api.siliconflow.cn/v1/images/generations', 'black-forest-labs/FLUX.1-schnell', 'image', 'https://cloud.siliconflow.cn', true, 10),
  ('mozheAPI', 'https://openai.mozhevip.top', '', 'image', 'https://openai.mozhevip.top', true, 20),
  ('New API', 'https://your-newapi-domain.com/v1/images/generations', 'gpt-image-1', 'image', 'https://docs.newapi.pro', true, 25),
  ('OpenAI', 'https://api.openai.com/v1/images/generations', 'dall-e-3', 'image', NULL, true, 30),
  ('Stability AI', 'https://api.stability.ai/v1/generation/stable-diffusion-xl/text-to-image', 'stable-diffusion-xl', 'image', NULL, true, 40),
  ('Midjourney', '', 'midjourney-v6', 'image', NULL, true, 50),
  ('Runway', 'https://api.runwayml.com/v1/image_to_video', 'gen-3-alpha', 'video', NULL, true, 60),
  ('Pika', '', 'pika-1.0', 'video', NULL, true, 70),
  ('Kling', '', 'kling-v1', 'video', NULL, true, 80),
  ('DeepSeek', 'https://api.deepseek.com/v1/chat/completions', 'deepseek-chat', 'text', NULL, true, 90),
  ('OpenAI GPT', 'https://api.openai.com/v1/chat/completions', 'gpt-4o', 'text', NULL, true, 100),
  ('自定义', '', '', 'image', NULL, true, 999)
ON CONFLICT (name) DO NOTHING;

INSERT INTO model_recommendations (model_name, display_name, type, provider_id, is_active, sort_order)
SELECT 'gpt-image-2', 'gpt-image-2', 'image', NULL, true, 10
WHERE NOT EXISTS (
  SELECT 1 FROM model_recommendations
  WHERE model_name = 'gpt-image-2' AND type = 'image' AND provider_id IS NULL
);

-- ============================================================
-- 兼容旧版本库结构的幂等补丁
-- ============================================================
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS display_nickname VARCHAR(128),
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_bound_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_sender_domain VARCHAR(255),
  ADD COLUMN IF NOT EXISTS preferred_theme VARCHAR(16) NOT NULL DEFAULT 'dark',
  ADD COLUMN IF NOT EXISTS watermark_disabled BOOLEAN NOT NULL DEFAULT false;

UPDATE profiles
   SET display_nickname = COALESCE(NULLIF(display_nickname, ''), NULLIF(nickname, ''), split_part(email, '@', 1))
 WHERE display_nickname IS NULL OR display_nickname = '';

UPDATE profiles
   SET preferred_theme = 'dark'
 WHERE preferred_theme IS NULL
    OR preferred_theme NOT IN ('dark', 'light');

ALTER TABLE works
  ADD COLUMN IF NOT EXISTS views_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

ALTER TABLE user_api_keys
  ADD COLUMN IF NOT EXISTS supplier_name VARCHAR(128),
  ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS manifest_path TEXT,
  ADD COLUMN IF NOT EXISTS type VARCHAR(16) NOT NULL DEFAULT 'image';

ALTER TABLE site_config
  ADD COLUMN IF NOT EXISTS site_description TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS site_keywords TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS announcement TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS membership_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS terms_of_service TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS privacy_policy TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS about_us TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS help_center TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS filing_info TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS filing_url TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS public_security_filing_info TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS public_security_filing_url TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS redeem_code_mall_url TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS log_retention_days INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS image_composition_skill_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE generation_jobs
  ADD COLUMN IF NOT EXISTS user_id UUID,
  ADD COLUMN IF NOT EXISTS provider VARCHAR(128),
  ADD COLUMN IF NOT EXISTS model_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS api_url TEXT,
  ADD COLUMN IF NOT EXISTS progress JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS generation_jobs_user_created_idx ON generation_jobs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS generation_jobs_provider_model_created_idx ON generation_jobs (type, provider, model_name, created_at DESC);

CREATE TABLE IF NOT EXISTS model_call_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  source VARCHAR(64) NOT NULL DEFAULT '',
  operation VARCHAR(64) NOT NULL DEFAULT '',
  generation_job_id UUID REFERENCES generation_jobs(id) ON DELETE SET NULL,
  type VARCHAR(32) NOT NULL DEFAULT 'text',
  provider VARCHAR(128) NOT NULL DEFAULT '',
  model_name VARCHAR(255) NOT NULL DEFAULT '',
  api_url TEXT NOT NULL DEFAULT '',
  system_api_id UUID,
  custom_api_key_id UUID,
  status VARCHAR(16) NOT NULL DEFAULT 'queued',
  credits_cost INTEGER NOT NULL DEFAULT 0,
  result_count INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE model_call_records
  ADD COLUMN IF NOT EXISTS user_id UUID,
  ADD COLUMN IF NOT EXISTS source VARCHAR(64) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS operation VARCHAR(64) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS generation_job_id UUID,
  ADD COLUMN IF NOT EXISTS type VARCHAR(32) NOT NULL DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS provider VARCHAR(128) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS model_name VARCHAR(255) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS api_url TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS system_api_id UUID,
  ADD COLUMN IF NOT EXISTS custom_api_key_id UUID,
  ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'queued',
  ADD COLUMN IF NOT EXISTS credits_cost INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS result_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS duration_ms INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS model_call_records_generation_job_uidx
  ON model_call_records (generation_job_id)
  WHERE generation_job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS model_call_records_created_idx ON model_call_records (created_at DESC);
CREATE INDEX IF NOT EXISTS model_call_records_user_created_idx ON model_call_records (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS model_call_records_status_created_idx ON model_call_records (status, created_at DESC);
CREATE INDEX IF NOT EXISTS model_call_records_model_created_idx ON model_call_records (type, provider, model_name, created_at DESC);
CREATE INDEX IF NOT EXISTS model_call_records_source_created_idx ON model_call_records (source, created_at DESC);
CREATE INDEX IF NOT EXISTS model_call_records_system_api_idx ON model_call_records (system_api_id, created_at DESC);
CREATE INDEX IF NOT EXISTS model_call_records_custom_api_idx ON model_call_records (custom_api_key_id, created_at DESC);

CREATE TABLE IF NOT EXISTS system_api_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider VARCHAR(128),
  name VARCHAR(255) NOT NULL,
  api_url TEXT NOT NULL DEFAULT '',
  model_name VARCHAR(255) NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  manifest_path TEXT NOT NULL DEFAULT '',
  is_default BOOLEAN NOT NULL DEFAULT true,
  allowed_membership_tiers JSONB NOT NULL DEFAULT '["free","pro","max","ultra"]'::jsonb,
  polling_mode VARCHAR(16) NOT NULL DEFAULT 'sequential',
  polling_order INTEGER NOT NULL DEFAULT 0,
  api_key_encrypted TEXT NOT NULL DEFAULT '',
  api_key_preview VARCHAR(64) NOT NULL DEFAULT '',
  type VARCHAR(16) NOT NULL DEFAULT 'image',
  credits_per_use INTEGER NOT NULL DEFAULT 10,
  billing_mode VARCHAR(24) NOT NULL DEFAULT 'fixed',
  fixed_price NUMERIC(12, 4) NOT NULL DEFAULT 0,
  duration_price_per_second NUMERIC(12, 6) NOT NULL DEFAULT 0,
  input_price_per_1k NUMERIC(12, 6) NOT NULL DEFAULT 0,
  output_price_per_1k NUMERIC(12, 6) NOT NULL DEFAULT 0,
  model_ratio NUMERIC(12, 6) NOT NULL DEFAULT 1,
  completion_ratio NUMERIC(12, 6) NOT NULL DEFAULT 1,
  group_ratio NUMERIC(12, 6) NOT NULL DEFAULT 1,
  price_note TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS system_api_configs_active_type_sort_idx ON system_api_configs (is_active, type, sort_order);
CREATE INDEX IF NOT EXISTS system_api_configs_default_sort_idx ON system_api_configs (is_default, is_active, sort_order);
CREATE INDEX IF NOT EXISTS system_api_configs_polling_idx ON system_api_configs (type, model_name, is_default, is_active, polling_order, sort_order);

CREATE TABLE IF NOT EXISTS payment_methods (
  id VARCHAR(64) PRIMARY KEY,
  type VARCHAR(32) NOT NULL,
  name VARCHAR(128) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  public_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  secret_config_encrypted JSONB NOT NULL DEFAULT '{}'::jsonb,
  secret_config_preview JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

INSERT INTO payment_methods (id, type, name, is_active) VALUES
  ('pm-alipay', 'alipay', '支付宝', true),
  ('pm-wechat', 'wechat', '微信支付', false),
  ('pm-manual', 'manual', '手动转账', false),
  ('pm-stripe', 'stripe', 'Stripe', false)
ON CONFLICT (id) DO NOTHING;

CREATE INDEX IF NOT EXISTS platform_logs_user_name_idx ON platform_logs (LOWER(COALESCE(user_name, '')));
CREATE INDEX IF NOT EXISTS platform_logs_user_email_idx ON platform_logs (LOWER(COALESCE(user_email, '')));

ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS type VARCHAR(32) NOT NULL DEFAULT 'site';

ALTER TABLE platform_log_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_api_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Row Level Security (RLS) 策略
-- ============================================================

-- 启用所有表的 RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE works ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE redeem_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_read_own" ON profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
DROP POLICY IF EXISTS "profiles_admin_all" ON profiles;
DROP POLICY IF EXISTS "works_read_public" ON works;
DROP POLICY IF EXISTS "works_insert_own" ON works;
DROP POLICY IF EXISTS "works_update_own" ON works;
DROP POLICY IF EXISTS "works_delete_own" ON works;
DROP POLICY IF EXISTS "works_admin_all" ON works;
DROP POLICY IF EXISTS "credit_transactions_read_own" ON credit_transactions;
DROP POLICY IF EXISTS "credit_transactions_admin_all" ON credit_transactions;
DROP POLICY IF EXISTS "redeem_codes_admin_all" ON redeem_codes;
DROP POLICY IF EXISTS "orders_read_own" ON orders;
DROP POLICY IF EXISTS "orders_insert_own" ON orders;
DROP POLICY IF EXISTS "orders_admin_all" ON orders;
DROP POLICY IF EXISTS "user_api_keys_read_own" ON user_api_keys;
DROP POLICY IF EXISTS "user_api_keys_insert_own" ON user_api_keys;
DROP POLICY IF EXISTS "user_api_keys_update_own" ON user_api_keys;
DROP POLICY IF EXISTS "user_api_keys_delete_own" ON user_api_keys;
DROP POLICY IF EXISTS "work_likes_read_all" ON work_likes;
DROP POLICY IF EXISTS "work_likes_insert_own" ON work_likes;
DROP POLICY IF EXISTS "work_likes_delete_own" ON work_likes;
DROP POLICY IF EXISTS "site_config_read_all" ON site_config;
DROP POLICY IF EXISTS "site_config_write_auth" ON site_config;
DROP POLICY IF EXISTS "site_config_admin_write" ON site_config;
DROP POLICY IF EXISTS "announcements_read_all" ON announcements;
DROP POLICY IF EXISTS "announcements_write_auth" ON announcements;
DROP POLICY IF EXISTS "announcements_admin_write" ON announcements;
DROP POLICY IF EXISTS "site_stats_read_all" ON site_stats;
DROP POLICY IF EXISTS "site_stats_write_auth" ON site_stats;

-- profiles: 用户可读自己的资料，管理员可读写所有
CREATE POLICY "profiles_read_own" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "profiles_admin_all" ON profiles FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
) WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- works: 用户可管理自己的作品，公开作品所有人可读
CREATE POLICY "works_read_public" ON works FOR SELECT USING (is_public = true OR auth.uid() = user_id);
CREATE POLICY "works_insert_own" ON works FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "works_update_own" ON works FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "works_delete_own" ON works FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "works_admin_all" ON works FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
) WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- credit_transactions: 用户可读自己的记录
CREATE POLICY "credit_transactions_read_own" ON credit_transactions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "credit_transactions_admin_all" ON credit_transactions FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
) WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- redeem_codes: 只有管理员可直接管理，用户兑换走后端服务事务
CREATE POLICY "redeem_codes_admin_all" ON redeem_codes FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
) WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- orders: 用户可读自己的订单
CREATE POLICY "orders_read_own" ON orders FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "orders_insert_own" ON orders FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "orders_admin_all" ON orders FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
) WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- user_api_keys: 用户可管理自己的密钥
CREATE POLICY "user_api_keys_read_own" ON user_api_keys FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "user_api_keys_insert_own" ON user_api_keys FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "user_api_keys_update_own" ON user_api_keys FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "user_api_keys_delete_own" ON user_api_keys FOR DELETE USING (auth.uid() = user_id);

-- work_likes: 认证用户可点赞，所有人可读
CREATE POLICY "work_likes_read_all" ON work_likes FOR SELECT USING (true);
CREATE POLICY "work_likes_insert_own" ON work_likes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "work_likes_delete_own" ON work_likes FOR DELETE USING (auth.uid() = user_id);

-- site_config: 所有人可读，认证用户可写 (管理员操作通过 service role key)
CREATE POLICY "site_config_read_all" ON site_config FOR SELECT USING (true);
CREATE POLICY "site_config_admin_write" ON site_config FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
) WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- announcements: 所有人可读，认证用户可写 (管理员操作)
CREATE POLICY "announcements_read_all" ON announcements FOR SELECT USING (true);
CREATE POLICY "announcements_admin_write" ON announcements FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
) WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- site_stats: 公开读，访问量递增走 SECURITY DEFINER 函数
CREATE POLICY "site_stats_read_all" ON site_stats FOR SELECT USING (true);

-- ============================================================
-- Supabase Storage 桶 (通过 Supabase Dashboard 或 API 创建)
-- ============================================================
-- 需要在 Supabase Dashboard 中手动创建以下 Storage 桶:
-- 1. site-assets (公开读) — 存放网站 Logo、Favicon
-- 2. works (私有) — 存放用户生成的图片/视频文件
--
-- 或者通过 SQL (需要 service_role 权限):
-- INSERT INTO storage.buckets (id, name, public) VALUES ('site-assets', 'site-assets', true) ON CONFLICT DO NOTHING;
-- INSERT INTO storage.buckets (id, name, public) VALUES ('works', 'works', false) ON CONFLICT DO NOTHING;

-- ============================================================
-- 触发器: 自动更新 updated_at 字段
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS profiles_updated_at ON profiles;
DROP TRIGGER IF EXISTS works_updated_at ON works;
DROP TRIGGER IF EXISTS orders_updated_at ON orders;
DROP TRIGGER IF EXISTS user_api_keys_updated_at ON user_api_keys;
DROP TRIGGER IF EXISTS site_config_updated_at ON site_config;
DROP TRIGGER IF EXISTS announcements_updated_at ON announcements;

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER works_updated_at BEFORE UPDATE ON works FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER orders_updated_at BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER user_api_keys_updated_at BEFORE UPDATE ON user_api_keys FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER site_config_updated_at BEFORE UPDATE ON site_config FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER announcements_updated_at BEFORE UPDATE ON announcements FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 触发器: 新用户注册时自动创建 profile
-- (仅在使用 Supabase Auth 时生效)
-- ============================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, nickname, display_nickname, avatar_url, role, membership_tier, credits_balance, daily_quota_limit)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'nickname', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'display_nickname', NEW.raw_user_meta_data->>'nickname', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url',
    'user',
    'free',
    10,  -- 新用户赠送 10 积分
    5    -- 每日配额 5 次
  )
  ON CONFLICT (id) DO NOTHING;
  -- 记录注册赠送积分
  INSERT INTO credit_transactions (user_id, amount, balance_after, type, description)
  SELECT NEW.id, 10, 10, 'gift', '新用户注册奖励'
  WHERE NOT EXISTS (
    SELECT 1 FROM credit_transactions
    WHERE user_id = NEW.id AND type = 'gift' AND description = '新用户注册奖励'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- 初始化管理员账户 (可选)
-- 请在注册管理员后，手动执行以下 SQL 将角色设为 admin:
-- UPDATE profiles SET role = 'admin' WHERE email = 'your-admin@example.com';
-- ============================================================

-- ============================================================
-- 原子递增访问量的 SQL 函数
-- ============================================================
CREATE OR REPLACE FUNCTION increment_visits()
RETURNS BIGINT AS $$
DECLARE
  new_count BIGINT;
BEGIN
  UPDATE site_stats SET total_visits = total_visits + 1, updated_at = now() WHERE id = 1
  RETURNING total_visits INTO new_count;
  RETURN new_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 完成
SELECT 'Database initialization completed successfully!' AS status;
