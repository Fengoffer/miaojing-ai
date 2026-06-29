ALTER TABLE user_api_keys ADD COLUMN IF NOT EXISTS supplier_name VARCHAR(128);
ALTER TABLE user_api_keys ADD COLUMN IF NOT EXISTS type VARCHAR(16) NOT NULL DEFAULT 'image';
CREATE INDEX IF NOT EXISTS user_api_keys_user_active_idx ON user_api_keys (user_id, is_active);
CREATE INDEX IF NOT EXISTS works_user_result_url_idx ON works (user_id, result_url);
