
-- Global API keys managed by SaaS Admin
CREATE TABLE public.global_api_keys (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  provider text NOT NULL,
  label text NOT NULL,
  api_key_encrypted text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.global_api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SaaS admin manages global keys" ON public.global_api_keys
  FOR ALL USING (is_saas_admin()) WITH CHECK (is_saas_admin());

-- Add reference from ai_configs to global key
ALTER TABLE public.ai_configs
  ADD COLUMN global_api_key_id uuid REFERENCES public.global_api_keys(id) ON DELETE SET NULL;

-- Allow ai_configs to work without per-tenant key when using global key
-- (api_key_encrypted already nullable)

-- Trigger for updated_at
CREATE TRIGGER update_global_api_keys_updated_at
  BEFORE UPDATE ON public.global_api_keys
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
