ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS password_hash TEXT;
