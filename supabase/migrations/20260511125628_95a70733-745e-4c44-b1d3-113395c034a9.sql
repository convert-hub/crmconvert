ALTER TABLE public.whatsapp_instances
  ADD COLUMN IF NOT EXISTS meta_token_status text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS meta_token_last_error_at timestamptz,
  ADD COLUMN IF NOT EXISTS meta_token_last_error text,
  ADD COLUMN IF NOT EXISTS meta_token_type text;