
-- ================================================================
-- AUTOMAÇÕES UNIFICADAS: palavras-chave, webhooks, sequências
-- ================================================================

-- 1) keyword_automations
CREATE TABLE IF NOT EXISTS public.keyword_automations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  flow_id uuid NOT NULL,
  keywords text[] NOT NULL DEFAULT '{}',
  match text NOT NULL DEFAULT 'contains',
  case_sensitive boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  executions_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_keyword_automations_tenant ON public.keyword_automations(tenant_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_keyword_automations_flow ON public.keyword_automations(flow_id);

ALTER TABLE public.keyword_automations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members view keyword automations" ON public.keyword_automations
  FOR SELECT TO authenticated USING (is_member_of_tenant(tenant_id));
CREATE POLICY "Admin/Manager creates keyword automations" ON public.keyword_automations
  FOR INSERT TO authenticated WITH CHECK (is_admin_or_manager(tenant_id));
CREATE POLICY "Admin/Manager updates keyword automations" ON public.keyword_automations
  FOR UPDATE TO authenticated USING (is_admin_or_manager(tenant_id));
CREATE POLICY "Admin/Manager deletes keyword automations" ON public.keyword_automations
  FOR DELETE TO authenticated USING (is_admin_or_manager(tenant_id));
CREATE POLICY "SaaS admin manages keyword automations" ON public.keyword_automations
  FOR ALL USING (is_saas_admin()) WITH CHECK (is_saas_admin());

CREATE TRIGGER trg_keyword_automations_updated
  BEFORE UPDATE ON public.keyword_automations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) webhook_endpoints
CREATE TABLE IF NOT EXISTS public.webhook_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  secret text NOT NULL,
  flow_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  test_mode boolean NOT NULL DEFAULT true,
  sample_payload jsonb,
  sample_received_at timestamptz,
  request_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_tenant ON public.webhook_endpoints(tenant_id);
CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_slug ON public.webhook_endpoints(slug);

ALTER TABLE public.webhook_endpoints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members view webhook endpoints" ON public.webhook_endpoints
  FOR SELECT TO authenticated USING (is_member_of_tenant(tenant_id));
CREATE POLICY "Admin/Manager creates webhook endpoints" ON public.webhook_endpoints
  FOR INSERT TO authenticated WITH CHECK (is_admin_or_manager(tenant_id));
CREATE POLICY "Admin/Manager updates webhook endpoints" ON public.webhook_endpoints
  FOR UPDATE TO authenticated USING (is_admin_or_manager(tenant_id));
CREATE POLICY "Admin/Manager deletes webhook endpoints" ON public.webhook_endpoints
  FOR DELETE TO authenticated USING (is_admin_or_manager(tenant_id));
CREATE POLICY "SaaS admin manages webhook endpoints" ON public.webhook_endpoints
  FOR ALL USING (is_saas_admin()) WITH CHECK (is_saas_admin());

CREATE TRIGGER trg_webhook_endpoints_updated
  BEFORE UPDATE ON public.webhook_endpoints
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3) message_sequences (drip WhatsApp) — base mínima
CREATE TABLE IF NOT EXISTS public.message_sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  enrollment_trigger text NOT NULL DEFAULT 'manual', -- manual | tag_added | lead_created
  enrollment_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  exit_on_reply boolean NOT NULL DEFAULT true,
  exit_on_tag text,
  respect_business_hours boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.message_sequences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members view sequences" ON public.message_sequences
  FOR SELECT TO authenticated USING (is_member_of_tenant(tenant_id));
CREATE POLICY "Admin/Manager creates sequences" ON public.message_sequences
  FOR INSERT TO authenticated WITH CHECK (is_admin_or_manager(tenant_id));
CREATE POLICY "Admin/Manager updates sequences" ON public.message_sequences
  FOR UPDATE TO authenticated USING (is_admin_or_manager(tenant_id));
CREATE POLICY "Admin/Manager deletes sequences" ON public.message_sequences
  FOR DELETE TO authenticated USING (is_admin_or_manager(tenant_id));
CREATE POLICY "SaaS admin manages sequences" ON public.message_sequences
  FOR ALL USING (is_saas_admin()) WITH CHECK (is_saas_admin());
CREATE TRIGGER trg_message_sequences_updated
  BEFORE UPDATE ON public.message_sequences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.sequence_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id uuid NOT NULL REFERENCES public.message_sequences(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  position integer NOT NULL DEFAULT 0,
  delay_minutes integer NOT NULL DEFAULT 0,
  message_type text NOT NULL DEFAULT 'text', -- text | template
  content text,
  template_id uuid,
  template_variables jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sequence_steps_seq ON public.sequence_steps(sequence_id, position);
ALTER TABLE public.sequence_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members view sequence steps" ON public.sequence_steps
  FOR SELECT TO authenticated USING (is_member_of_tenant(tenant_id));
CREATE POLICY "Admin/Manager manages sequence steps" ON public.sequence_steps
  FOR ALL TO authenticated USING (is_admin_or_manager(tenant_id)) WITH CHECK (is_admin_or_manager(tenant_id));
CREATE POLICY "SaaS admin manages sequence steps" ON public.sequence_steps
  FOR ALL USING (is_saas_admin()) WITH CHECK (is_saas_admin());

-- 4) Porta keyword_match e webhook existentes em chatbot_flows para as novas tabelas
INSERT INTO public.keyword_automations (tenant_id, flow_id, keywords, match, case_sensitive, is_active)
SELECT
  f.tenant_id,
  f.id,
  COALESCE(
    ARRAY(SELECT jsonb_array_elements_text(f.trigger_config->'keywords')),
    '{}'::text[]
  ),
  COALESCE(f.trigger_config->>'match', 'contains'),
  COALESCE((f.trigger_config->>'case_sensitive')::boolean, false),
  f.is_active
FROM public.chatbot_flows f
WHERE f.trigger_type = 'keyword_match'
  AND NOT EXISTS (SELECT 1 FROM public.keyword_automations k WHERE k.flow_id = f.id);

INSERT INTO public.webhook_endpoints (tenant_id, name, slug, secret, flow_id, is_active, test_mode)
SELECT
  f.tenant_id,
  f.name,
  encode(gen_random_bytes(8), 'hex'),
  COALESCE(f.trigger_config->>'secret', 'whsec_' || encode(gen_random_bytes(16), 'hex')),
  f.id,
  f.is_active,
  false
FROM public.chatbot_flows f
WHERE f.trigger_type = 'webhook'
  AND NOT EXISTS (SELECT 1 FROM public.webhook_endpoints w WHERE w.flow_id = f.id);
