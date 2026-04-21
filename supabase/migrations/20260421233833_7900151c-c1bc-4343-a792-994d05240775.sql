
-- Campaigns table
CREATE TABLE public.campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','running','paused','completed','failed','cancelled')),
  whatsapp_instance_id UUID REFERENCES public.whatsapp_instances(id) ON DELETE RESTRICT,
  template_id UUID REFERENCES public.whatsapp_message_templates(id) ON DELETE RESTRICT,
  template_variables JSONB NOT NULL DEFAULT '{}'::jsonb,
  audience_filter JSONB NOT NULL DEFAULT '{}'::jsonb,
  scheduled_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  throttle_per_minute INTEGER NOT NULL DEFAULT 60,
  total_recipients INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  delivered_count INTEGER NOT NULL DEFAULT 0,
  read_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  replied_count INTEGER NOT NULL DEFAULT 0,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_campaigns_tenant_status ON public.campaigns(tenant_id, status);
CREATE INDEX idx_campaigns_scheduled ON public.campaigns(scheduled_at) WHERE status = 'scheduled';

ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members view campaigns" ON public.campaigns
  FOR SELECT TO authenticated
  USING (is_member_of_tenant(tenant_id));

CREATE POLICY "Admin/Manager creates campaigns" ON public.campaigns
  FOR INSERT TO authenticated
  WITH CHECK (is_admin_or_manager(tenant_id));

CREATE POLICY "Admin/Manager updates campaigns" ON public.campaigns
  FOR UPDATE TO authenticated
  USING (is_admin_or_manager(tenant_id));

CREATE POLICY "Admin/Manager deletes campaigns" ON public.campaigns
  FOR DELETE TO authenticated
  USING (is_admin_or_manager(tenant_id));

CREATE POLICY "SaaS admin manages campaigns" ON public.campaigns
  FOR ALL TO public
  USING (is_saas_admin())
  WITH CHECK (is_saas_admin());

CREATE TRIGGER trg_campaigns_updated_at
  BEFORE UPDATE ON public.campaigns
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Campaign recipients table
CREATE TABLE public.campaign_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  provider_message_id TEXT,
  variables_used JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','delivered','read','failed','replied','skipped')),
  error TEXT,
  scheduled_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  replied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(campaign_id, contact_id)
);

CREATE INDEX idx_campaign_recipients_campaign_status ON public.campaign_recipients(campaign_id, status);
CREATE INDEX idx_campaign_recipients_provider_msg ON public.campaign_recipients(provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE INDEX idx_campaign_recipients_pending ON public.campaign_recipients(scheduled_at) WHERE status = 'pending';

ALTER TABLE public.campaign_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members view recipients" ON public.campaign_recipients
  FOR SELECT TO authenticated
  USING (is_member_of_tenant(tenant_id));

CREATE POLICY "Admin/Manager creates recipients" ON public.campaign_recipients
  FOR INSERT TO authenticated
  WITH CHECK (is_admin_or_manager(tenant_id));

CREATE POLICY "Admin/Manager updates recipients" ON public.campaign_recipients
  FOR UPDATE TO authenticated
  USING (is_admin_or_manager(tenant_id));

CREATE POLICY "Admin/Manager deletes recipients" ON public.campaign_recipients
  FOR DELETE TO authenticated
  USING (is_admin_or_manager(tenant_id));

CREATE POLICY "SaaS admin manages recipients" ON public.campaign_recipients
  FOR ALL TO public
  USING (is_saas_admin())
  WITH CHECK (is_saas_admin());

CREATE TRIGGER trg_campaign_recipients_updated_at
  BEFORE UPDATE ON public.campaign_recipients
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
