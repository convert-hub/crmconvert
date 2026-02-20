-- Add metadata jsonb column to global_api_keys for storing extra config like base_url
ALTER TABLE public.global_api_keys ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;

-- Add comment for clarity
COMMENT ON COLUMN public.global_api_keys.metadata IS 'Extra config like base_url for UAZAPI servers';