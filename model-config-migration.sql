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

INSERT INTO api_providers (name, default_api_url, default_model, type, website, is_active, sort_order)
VALUES
  ('硅基流动', 'https://api.siliconflow.cn/v1/images/generations', 'black-forest-labs/FLUX.1-schnell', 'image', 'https://cloud.siliconflow.cn', true, 10),
  ('mozheAPI', 'https://openai.mozhevip.top', '', 'image', 'https://openai.mozhevip.top', true, 20),
  ('OpenAI', 'https://api.openai.com/v1/images/generations', 'dall-e-3', 'image', NULL, true, 30),
  ('Stability AI', 'https://api.stability.ai/v1/generation/stable-diffusion-xl/text-to-image', 'stable-diffusion-xl', 'image', NULL, true, 40),
  ('Midjourney', '', 'midjourney-v6', 'image', NULL, true, 50),
  ('Runway', 'https://api.runwayml.com/v1/image_to_video', 'gen-3-alpha', 'video', NULL, true, 60),
  ('Pika', '', 'pika-1.0', 'video', NULL, true, 70),
  ('Kling', '', 'kling-v1', 'video', NULL, true, 80),
  ('DeepSeek', 'https://api.deepseek.com/v1/chat/completions', 'deepseek-chat', 'text', NULL, true, 90),
  ('OpenAI GPT', 'https://api.openai.com/v1/chat/completions', 'gpt-4o', 'text', NULL, true, 100),
  ('自定义', '', '', 'image', NULL, true, 999)
ON CONFLICT (name) DO UPDATE SET
  default_api_url = EXCLUDED.default_api_url,
  default_model = EXCLUDED.default_model,
  type = EXCLUDED.type,
  website = EXCLUDED.website,
  is_active = EXCLUDED.is_active,
  sort_order = EXCLUDED.sort_order,
  updated_at = NOW();

INSERT INTO model_recommendations (model_name, display_name, type, provider_id, is_active, sort_order)
SELECT 'gpt-image-2', 'gpt-image-2', 'image', NULL, true, 10
WHERE NOT EXISTS (
  SELECT 1 FROM model_recommendations
  WHERE model_name = 'gpt-image-2' AND type = 'image' AND provider_id IS NULL
);
