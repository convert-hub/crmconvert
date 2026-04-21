-- 1. whatsapp_instances: colunas aditivas (todas opcionais ou com default)
ALTER TABLE public.whatsapp_instances
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'uazapi'
    CHECK (provider IN ('uazapi','meta_cloud')),
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS meta_phone_number_id TEXT,
  ADD COLUMN IF NOT EXISTS meta_waba_id TEXT,
  ADD COLUMN IF NOT EXISTS meta_access_token_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS meta_app_secret_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS meta_verify_token TEXT;

CREATE INDEX IF NOT EXISTS idx_whatsapp_instances_meta_phone_id
  ON public.whatsapp_instances(meta_phone_number_id)
  WHERE provider = 'meta_cloud';

-- 2. conversations: vínculo opcional à instância
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS whatsapp_instance_id UUID
    REFERENCES public.whatsapp_instances(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_whatsapp_instance
  ON public.conversations(whatsapp_instance_id);

-- 3. whatsapp_message_templates: nova tabela isolada
CREATE TABLE IF NOT EXISTS public.whatsapp_message_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  whatsapp_instance_id UUID NOT NULL REFERENCES public.whatsapp_instances(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'pt_BR',
  category TEXT,
  status TEXT,
  components JSONB NOT NULL DEFAULT '[]'::jsonb,
  meta_template_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(whatsapp_instance_id, name, language)
);

CREATE INDEX IF NOT EXISTS idx_wa_templates_tenant
  ON public.whatsapp_message_templates(tenant_id);
CREATE INDEX IF NOT EXISTS idx_wa_templates_instance
  ON public.whatsapp_message_templates(whatsapp_instance_id);

ALTER TABLE public.whatsapp_message_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members view wa templates"
  ON public.whatsapp_message_templates
  FOR SELECT TO authenticated
  USING (is_member_of_tenant(tenant_id));

CREATE POLICY "Admin/Manager creates wa templates"
  ON public.whatsapp_message_templates
  FOR INSERT TO authenticated
  WITH CHECK (is_admin_or_manager(tenant_id));

CREATE POLICY "Admin/Manager updates wa templates"
  ON public.whatsapp_message_templates
  FOR UPDATE TO authenticated
  USING (is_admin_or_manager(tenant_id));

CREATE POLICY "Admin/Manager deletes wa templates"
  ON public.whatsapp_message_templates
  FOR DELETE TO authenticated
  USING (is_admin_or_manager(tenant_id));

CREATE POLICY "SaaS admin manages wa templates"
  ON public.whatsapp_message_templates
  FOR ALL
  USING (is_saas_admin())
  WITH CHECK (is_saas_admin());

-- Trigger updated_at
CREATE TRIGGER update_wa_templates_updated_at
  BEFORE UPDATE ON public.whatsapp_message_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();