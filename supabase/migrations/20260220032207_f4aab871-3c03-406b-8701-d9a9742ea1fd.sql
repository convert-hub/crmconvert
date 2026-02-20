
-- =============================================
-- CRM MULTI-TENANT: COMPLETE SCHEMA
-- Fases 1-4: Base + CRM + WhatsApp + Webhooks
-- =============================================

-- 1. ENUMS
CREATE TYPE public.tenant_role AS ENUM ('admin', 'manager', 'attendant', 'readonly');
CREATE TYPE public.contact_status AS ENUM ('lead', 'customer', 'churned', 'inactive');
CREATE TYPE public.opportunity_priority AS ENUM ('low', 'medium', 'high', 'urgent');
CREATE TYPE public.opportunity_status AS ENUM ('open', 'won', 'lost');
CREATE TYPE public.conversation_status AS ENUM ('open', 'waiting_customer', 'waiting_agent', 'closed');
CREATE TYPE public.conversation_channel AS ENUM ('whatsapp', 'email', 'phone', 'web', 'facebook');
CREATE TYPE public.message_direction AS ENUM ('inbound', 'outbound');
CREATE TYPE public.activity_type AS ENUM ('call', 'task', 'note', 'email', 'meeting', 'follow_up');
CREATE TYPE public.job_status AS ENUM ('queued', 'running', 'done', 'failed', 'dead');
CREATE TYPE public.automation_trigger AS ENUM (
  'lead_created', 'opportunity_stage_changed', 'conversation_no_customer_reply',
  'conversation_no_agent_reply', 'conversation_closed', 'tag_added', 'tag_removed'
);
CREATE TYPE public.ai_task_type AS ENUM ('message_generation', 'qa_review', 'qualification', 'stage_classifier');
CREATE TYPE public.ai_move_mode AS ENUM ('suggest_only', 'auto_with_guard', 'auto_free');

-- 2. TENANTS
CREATE TABLE public.tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  settings JSONB NOT NULL DEFAULT '{}',
  ai_move_mode public.ai_move_mode NOT NULL DEFAULT 'suggest_only',
  ai_confidence_threshold NUMERIC(3,2) NOT NULL DEFAULT 0.7,
  business_hours JSONB DEFAULT '{"mon":{"start":"09:00","end":"18:00"},"tue":{"start":"09:00","end":"18:00"},"wed":{"start":"09:00","end":"18:00"},"thu":{"start":"09:00","end":"18:00"},"fri":{"start":"09:00","end":"18:00"}}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. TENANT MEMBERSHIPS (roles table - separate from profiles)
CREATE TABLE public.tenant_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.tenant_role NOT NULL DEFAULT 'attendant',
  is_active BOOLEAN NOT NULL DEFAULT true,
  invited_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, user_id)
);

-- 4. PROFILES (basic user info, not roles)
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  avatar_url TEXT,
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. CONTACTS
CREATE TABLE public.contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT, -- E.164 format
  email TEXT,
  city TEXT,
  state TEXT,
  tags TEXT[] DEFAULT '{}',
  source TEXT, -- e.g. 'facebook_lead_ads', 'form_webhook', 'whatsapp', 'manual'
  status public.contact_status NOT NULL DEFAULT 'lead',
  consent_given BOOLEAN DEFAULT false,
  do_not_contact BOOLEAN DEFAULT false,
  notes TEXT,
  custom_fields JSONB DEFAULT '{}',
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_term TEXT,
  campaign_id TEXT,
  adset_id TEXT,
  ad_id TEXT,
  company_id UUID,
  assigned_to UUID, -- references tenant_memberships.id
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. COMPANIES
CREATE TABLE public.companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  website TEXT,
  industry TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  notes TEXT,
  custom_fields JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add FK after companies table exists
ALTER TABLE public.contacts ADD CONSTRAINT contacts_company_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE SET NULL;
ALTER TABLE public.contacts ADD CONSTRAINT contacts_assigned_fk FOREIGN KEY (assigned_to) REFERENCES public.tenant_memberships(id) ON DELETE SET NULL;

-- 7. PIPELINES
CREATE TABLE public.pipelines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_default BOOLEAN DEFAULT false,
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 8. STAGES
CREATE TABLE public.stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  pipeline_id UUID NOT NULL REFERENCES public.pipelines(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INT NOT NULL DEFAULT 0,
  color TEXT DEFAULT '#6366f1',
  is_won BOOLEAN DEFAULT false,
  is_lost BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 9. OPPORTUNITIES
CREATE TABLE public.opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  pipeline_id UUID NOT NULL REFERENCES public.pipelines(id) ON DELETE CASCADE,
  stage_id UUID NOT NULL REFERENCES public.stages(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  value NUMERIC(15,2) DEFAULT 0,
  priority public.opportunity_priority DEFAULT 'medium',
  status public.opportunity_status NOT NULL DEFAULT 'open',
  assigned_to UUID REFERENCES public.tenant_memberships(id) ON DELETE SET NULL,
  source TEXT,
  loss_reason TEXT,
  next_action TEXT,
  next_action_date TIMESTAMPTZ,
  expected_close_date TIMESTAMPTZ,
  qualification_data JSONB DEFAULT '{}',
  conversation_state JSONB DEFAULT '{}', -- incremental AI state
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  position INT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 10. CONVERSATIONS
CREATE TABLE public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  opportunity_id UUID REFERENCES public.opportunities(id) ON DELETE SET NULL,
  channel public.conversation_channel NOT NULL DEFAULT 'whatsapp',
  status public.conversation_status NOT NULL DEFAULT 'open',
  assigned_to UUID REFERENCES public.tenant_memberships(id) ON DELETE SET NULL,
  unread_count INT DEFAULT 0,
  last_message_at TIMESTAMPTZ,
  last_customer_message_at TIMESTAMPTZ,
  last_agent_message_at TIMESTAMPTZ,
  provider_chat_id TEXT, -- external chat ID from UAZAPI
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 11. MESSAGES
CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  direction public.message_direction NOT NULL,
  content TEXT,
  media_url TEXT,
  media_type TEXT,
  sender_membership_id UUID REFERENCES public.tenant_memberships(id),
  provider_message_id TEXT, -- external msg ID
  provider_metadata JSONB DEFAULT '{}',
  is_ai_generated BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 12. ACTIVITIES
CREATE TABLE public.activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  type public.activity_type NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  opportunity_id UUID REFERENCES public.opportunities(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  assigned_to UUID REFERENCES public.tenant_memberships(id) ON DELETE SET NULL,
  due_date TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  is_completed BOOLEAN DEFAULT false,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 13. AUDIT LOG
CREATE TABLE public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  action TEXT NOT NULL,
  target_table TEXT,
  target_id UUID,
  old_data JSONB,
  new_data JSONB,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 14. JOB QUEUE
CREATE TABLE public.job_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- 'send_whatsapp', 'run_ai', 'process_webhook', etc.
  status public.job_status NOT NULL DEFAULT 'queued',
  payload JSONB NOT NULL DEFAULT '{}',
  result JSONB,
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,
  run_after TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_error TEXT,
  idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 15. WEBHOOK EVENTS
CREATE TABLE public.webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  source TEXT NOT NULL, -- 'uazapi', 'facebook_lead_ads', 'generic_form'
  raw_payload JSONB NOT NULL,
  processed BOOLEAN DEFAULT false,
  processing_error TEXT,
  job_id UUID REFERENCES public.job_queue(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 16. AUTOMATIONS
CREATE TABLE public.automations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  trigger_type public.automation_trigger NOT NULL,
  conditions JSONB DEFAULT '{}',
  actions JSONB DEFAULT '[]', -- array of action objects
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 17. AI CONFIG (per tenant)
CREATE TABLE public.ai_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  task_type public.ai_task_type NOT NULL,
  provider TEXT NOT NULL DEFAULT 'openai', -- 'openai', 'gemini', 'anthropic'
  model TEXT NOT NULL DEFAULT 'gpt-4o-mini',
  api_key_encrypted TEXT, -- encrypted, only accessed via edge function
  daily_limit INT DEFAULT 100,
  monthly_limit INT DEFAULT 3000,
  daily_usage INT DEFAULT 0,
  monthly_usage INT DEFAULT 0,
  usage_reset_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, task_type)
);

-- 18. PROMPT TEMPLATES
CREATE TABLE public.prompt_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  task_type public.ai_task_type NOT NULL,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  variables TEXT[] DEFAULT '{}', -- available placeholders
  version INT NOT NULL DEFAULT 1,
  is_active BOOLEAN DEFAULT true,
  forbidden_terms TEXT[] DEFAULT '{}',
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 19. CONVERSATION REVIEWS (QA)
CREATE TABLE public.conversation_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  rating NUMERIC(3,1), -- 0-10
  strengths TEXT,
  weaknesses TEXT,
  suggestions TEXT,
  comments TEXT,
  ai_model_used TEXT,
  ai_cost_estimate NUMERIC(10,6),
  reviewed_by TEXT, -- 'ai' or user name
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 20. AI EXECUTION LOGS
CREATE TABLE public.ai_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  task_type public.ai_task_type NOT NULL,
  input_data JSONB,
  output_data JSONB,
  model TEXT,
  provider TEXT,
  tokens_used INT,
  cost_estimate NUMERIC(10,6),
  duration_ms INT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 21. UAZAPI INSTANCES (WhatsApp integration config per tenant)
CREATE TABLE public.whatsapp_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  instance_name TEXT NOT NULL,
  api_url TEXT NOT NULL,
  api_token_encrypted TEXT, -- encrypted
  webhook_secret TEXT,
  is_active BOOLEAN DEFAULT true,
  phone_number TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 22. STAGE MOVE LOG (for AI pipeline assistant)
CREATE TABLE public.stage_moves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  opportunity_id UUID NOT NULL REFERENCES public.opportunities(id) ON DELETE CASCADE,
  from_stage_id UUID REFERENCES public.stages(id),
  to_stage_id UUID NOT NULL REFERENCES public.stages(id),
  moved_by UUID REFERENCES auth.users(id),
  is_ai_move BOOLEAN DEFAULT false,
  confidence_score NUMERIC(3,2),
  ai_reason TEXT,
  criteria_met JSONB,
  undone BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================
-- INDEXES
-- =============================================
CREATE INDEX idx_memberships_tenant ON public.tenant_memberships(tenant_id);
CREATE INDEX idx_memberships_user ON public.tenant_memberships(user_id);
CREATE INDEX idx_contacts_tenant ON public.contacts(tenant_id);
CREATE INDEX idx_contacts_phone ON public.contacts(tenant_id, phone);
CREATE INDEX idx_contacts_email ON public.contacts(tenant_id, email);
CREATE INDEX idx_contacts_tags ON public.contacts USING GIN(tags);
CREATE INDEX idx_companies_tenant ON public.companies(tenant_id);
CREATE INDEX idx_pipelines_tenant ON public.pipelines(tenant_id);
CREATE INDEX idx_stages_pipeline ON public.stages(pipeline_id);
CREATE INDEX idx_opportunities_tenant ON public.opportunities(tenant_id);
CREATE INDEX idx_opportunities_stage ON public.opportunities(stage_id);
CREATE INDEX idx_opportunities_pipeline ON public.opportunities(pipeline_id);
CREATE INDEX idx_opportunities_assigned ON public.opportunities(assigned_to);
CREATE INDEX idx_conversations_tenant ON public.conversations(tenant_id);
CREATE INDEX idx_conversations_contact ON public.conversations(contact_id);
CREATE INDEX idx_conversations_assigned ON public.conversations(assigned_to);
CREATE INDEX idx_conversations_status ON public.conversations(tenant_id, status);
CREATE INDEX idx_messages_conversation ON public.messages(conversation_id);
CREATE INDEX idx_messages_tenant ON public.messages(tenant_id);
CREATE INDEX idx_activities_tenant ON public.activities(tenant_id);
CREATE INDEX idx_activities_contact ON public.activities(contact_id);
CREATE INDEX idx_activities_opportunity ON public.activities(opportunity_id);
CREATE INDEX idx_audit_tenant ON public.audit_log(tenant_id);
CREATE INDEX idx_audit_target ON public.audit_log(target_table, target_id);
CREATE INDEX idx_jobs_status ON public.job_queue(status, run_after);
CREATE INDEX idx_jobs_tenant ON public.job_queue(tenant_id);
CREATE INDEX idx_jobs_idempotency ON public.job_queue(idempotency_key);
CREATE INDEX idx_webhook_events_tenant ON public.webhook_events(tenant_id);
CREATE INDEX idx_automations_tenant ON public.automations(tenant_id);
CREATE INDEX idx_automations_trigger ON public.automations(tenant_id, trigger_type);
CREATE INDEX idx_ai_configs_tenant ON public.ai_configs(tenant_id);
CREATE INDEX idx_prompt_templates_tenant ON public.prompt_templates(tenant_id);
CREATE INDEX idx_ai_logs_tenant ON public.ai_logs(tenant_id);
CREATE INDEX idx_stage_moves_opp ON public.stage_moves(opportunity_id);

-- =============================================
-- HELPER FUNCTIONS (SECURITY DEFINER)
-- =============================================

-- Get user's tenant_id (first active membership)
CREATE OR REPLACE FUNCTION public.get_user_tenant_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tenant_id FROM public.tenant_memberships
  WHERE user_id = auth.uid() AND is_active = true
  LIMIT 1
$$;

-- Check if user is member of a specific tenant
CREATE OR REPLACE FUNCTION public.is_member_of_tenant(_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_memberships
    WHERE user_id = auth.uid()
      AND tenant_id = _tenant_id
      AND is_active = true
  )
$$;

-- Get user role in tenant
CREATE OR REPLACE FUNCTION public.get_user_role_in_tenant(_tenant_id UUID)
RETURNS public.tenant_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.tenant_memberships
  WHERE user_id = auth.uid()
    AND tenant_id = _tenant_id
    AND is_active = true
  LIMIT 1
$$;

-- Get user's membership ID for a tenant
CREATE OR REPLACE FUNCTION public.get_user_membership_id(_tenant_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.tenant_memberships
  WHERE user_id = auth.uid()
    AND tenant_id = _tenant_id
    AND is_active = true
  LIMIT 1
$$;

-- Check role helper
CREATE OR REPLACE FUNCTION public.has_tenant_role(_tenant_id UUID, _role public.tenant_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_memberships
    WHERE user_id = auth.uid()
      AND tenant_id = _tenant_id
      AND role = _role
      AND is_active = true
  )
$$;

-- Check if user has admin or manager role
CREATE OR REPLACE FUNCTION public.is_admin_or_manager(_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_memberships
    WHERE user_id = auth.uid()
      AND tenant_id = _tenant_id
      AND role IN ('admin', 'manager')
      AND is_active = true
  )
$$;

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- =============================================
-- TRIGGERS
-- =============================================
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TRIGGER update_tenants_updated_at BEFORE UPDATE ON public.tenants FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_memberships_updated_at BEFORE UPDATE ON public.tenant_memberships FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_contacts_updated_at BEFORE UPDATE ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_companies_updated_at BEFORE UPDATE ON public.companies FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_pipelines_updated_at BEFORE UPDATE ON public.pipelines FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_stages_updated_at BEFORE UPDATE ON public.stages FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_opportunities_updated_at BEFORE UPDATE ON public.opportunities FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_conversations_updated_at BEFORE UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_activities_updated_at BEFORE UPDATE ON public.activities FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_jobs_updated_at BEFORE UPDATE ON public.job_queue FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_automations_updated_at BEFORE UPDATE ON public.automations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_ai_configs_updated_at BEFORE UPDATE ON public.ai_configs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_prompt_templates_updated_at BEFORE UPDATE ON public.prompt_templates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_whatsapp_instances_updated_at BEFORE UPDATE ON public.whatsapp_instances FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================
-- ENABLE RLS ON ALL TABLES
-- =============================================
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipelines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompt_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stage_moves ENABLE ROW LEVEL SECURITY;

-- =============================================
-- RLS POLICIES
-- =============================================

-- PROFILES
CREATE POLICY "Users view own profile" ON public.profiles FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "System inserts profile" ON public.profiles FOR INSERT WITH CHECK (user_id = auth.uid());

-- TENANTS
CREATE POLICY "Members view tenant" ON public.tenants FOR SELECT USING (public.is_member_of_tenant(id));
CREATE POLICY "Admin updates tenant" ON public.tenants FOR UPDATE USING (public.has_tenant_role(id, 'admin'));
CREATE POLICY "Anyone creates tenant" ON public.tenants FOR INSERT WITH CHECK (true); -- signup flow

-- TENANT MEMBERSHIPS
CREATE POLICY "Members view memberships" ON public.tenant_memberships FOR SELECT USING (public.is_member_of_tenant(tenant_id));
CREATE POLICY "Admin/Manager creates membership" ON public.tenant_memberships FOR INSERT WITH CHECK (public.is_admin_or_manager(tenant_id));
CREATE POLICY "Admin/Manager updates membership" ON public.tenant_memberships FOR UPDATE USING (public.is_admin_or_manager(tenant_id));
CREATE POLICY "Admin deletes membership" ON public.tenant_memberships FOR DELETE USING (public.has_tenant_role(tenant_id, 'admin') AND user_id != auth.uid());
-- Allow first membership (tenant creator)
CREATE POLICY "Creator first membership" ON public.tenant_memberships FOR INSERT WITH CHECK (
  NOT EXISTS (SELECT 1 FROM public.tenant_memberships WHERE tenant_id = tenant_memberships.tenant_id)
  AND user_id = auth.uid()
  AND role = 'admin'
);

-- CONTACTS
CREATE POLICY "Members view contacts" ON public.contacts FOR SELECT USING (public.is_member_of_tenant(tenant_id));
CREATE POLICY "Members create contacts" ON public.contacts FOR INSERT WITH CHECK (public.is_member_of_tenant(tenant_id) AND public.get_user_role_in_tenant(tenant_id) != 'readonly');
CREATE POLICY "Members update contacts" ON public.contacts FOR UPDATE USING (public.is_member_of_tenant(tenant_id) AND public.get_user_role_in_tenant(tenant_id) != 'readonly');
CREATE POLICY "Admin/Manager deletes contacts" ON public.contacts FOR DELETE USING (public.is_admin_or_manager(tenant_id));

-- COMPANIES
CREATE POLICY "Members view companies" ON public.companies FOR SELECT USING (public.is_member_of_tenant(tenant_id));
CREATE POLICY "Members create companies" ON public.companies FOR INSERT WITH CHECK (public.is_member_of_tenant(tenant_id) AND public.get_user_role_in_tenant(tenant_id) != 'readonly');
CREATE POLICY "Members update companies" ON public.companies FOR UPDATE USING (public.is_member_of_tenant(tenant_id) AND public.get_user_role_in_tenant(tenant_id) != 'readonly');
CREATE POLICY "Admin/Manager deletes companies" ON public.companies FOR DELETE USING (public.is_admin_or_manager(tenant_id));

-- PIPELINES
CREATE POLICY "Members view pipelines" ON public.pipelines FOR SELECT USING (public.is_member_of_tenant(tenant_id));
CREATE POLICY "Admin/Manager creates pipelines" ON public.pipelines FOR INSERT WITH CHECK (public.is_admin_or_manager(tenant_id));
CREATE POLICY "Admin/Manager updates pipelines" ON public.pipelines FOR UPDATE USING (public.is_admin_or_manager(tenant_id));
CREATE POLICY "Admin deletes pipelines" ON public.pipelines FOR DELETE USING (public.has_tenant_role(tenant_id, 'admin'));

-- STAGES
CREATE POLICY "Members view stages" ON public.stages FOR SELECT USING (public.is_member_of_tenant(tenant_id));
CREATE POLICY "Admin/Manager creates stages" ON public.stages FOR INSERT WITH CHECK (public.is_admin_or_manager(tenant_id));
CREATE POLICY "Admin/Manager updates stages" ON public.stages FOR UPDATE USING (public.is_admin_or_manager(tenant_id));
CREATE POLICY "Admin deletes stages" ON public.stages FOR DELETE USING (public.has_tenant_role(tenant_id, 'admin'));

-- OPPORTUNITIES
CREATE POLICY "Members view opportunities" ON public.opportunities FOR SELECT USING (public.is_member_of_tenant(tenant_id));
CREATE POLICY "Members create opportunities" ON public.opportunities FOR INSERT WITH CHECK (public.is_member_of_tenant(tenant_id) AND public.get_user_role_in_tenant(tenant_id) != 'readonly');
CREATE POLICY "Members update opportunities" ON public.opportunities FOR UPDATE USING (public.is_member_of_tenant(tenant_id) AND public.get_user_role_in_tenant(tenant_id) != 'readonly');
CREATE POLICY "Admin/Manager deletes opportunities" ON public.opportunities FOR DELETE USING (public.is_admin_or_manager(tenant_id));

-- CONVERSATIONS
CREATE POLICY "Members view conversations" ON public.conversations FOR SELECT USING (public.is_member_of_tenant(tenant_id));
CREATE POLICY "Members create conversations" ON public.conversations FOR INSERT WITH CHECK (public.is_member_of_tenant(tenant_id) AND public.get_user_role_in_tenant(tenant_id) != 'readonly');
CREATE POLICY "Members update conversations" ON public.conversations FOR UPDATE USING (public.is_member_of_tenant(tenant_id) AND public.get_user_role_in_tenant(tenant_id) != 'readonly');
CREATE POLICY "Admin closes conversations" ON public.conversations FOR DELETE USING (public.is_admin_or_manager(tenant_id));

-- MESSAGES
CREATE POLICY "Members view messages" ON public.messages FOR SELECT USING (public.is_member_of_tenant(tenant_id));
CREATE POLICY "Members create messages" ON public.messages FOR INSERT WITH CHECK (public.is_member_of_tenant(tenant_id) AND public.get_user_role_in_tenant(tenant_id) != 'readonly');

-- ACTIVITIES
CREATE POLICY "Members view activities" ON public.activities FOR SELECT USING (public.is_member_of_tenant(tenant_id));
CREATE POLICY "Members create activities" ON public.activities FOR INSERT WITH CHECK (public.is_member_of_tenant(tenant_id) AND public.get_user_role_in_tenant(tenant_id) != 'readonly');
CREATE POLICY "Members update activities" ON public.activities FOR UPDATE USING (public.is_member_of_tenant(tenant_id) AND public.get_user_role_in_tenant(tenant_id) != 'readonly');
CREATE POLICY "Admin/Manager deletes activities" ON public.activities FOR DELETE USING (public.is_admin_or_manager(tenant_id));

-- AUDIT LOG (read only for members)
CREATE POLICY "Members view audit log" ON public.audit_log FOR SELECT USING (public.is_member_of_tenant(tenant_id));
CREATE POLICY "System inserts audit" ON public.audit_log FOR INSERT WITH CHECK (public.is_member_of_tenant(tenant_id));

-- JOB QUEUE
CREATE POLICY "Admin views jobs" ON public.job_queue FOR SELECT USING (tenant_id IS NULL OR public.is_member_of_tenant(tenant_id));
CREATE POLICY "System inserts jobs" ON public.job_queue FOR INSERT WITH CHECK (tenant_id IS NULL OR public.is_member_of_tenant(tenant_id));
CREATE POLICY "Admin updates jobs" ON public.job_queue FOR UPDATE USING (tenant_id IS NULL OR public.is_admin_or_manager(tenant_id));

-- WEBHOOK EVENTS
CREATE POLICY "Admin views webhooks" ON public.webhook_events FOR SELECT USING (public.is_member_of_tenant(tenant_id));
CREATE POLICY "System inserts webhooks" ON public.webhook_events FOR INSERT WITH CHECK (true); -- edge functions with service role

-- AUTOMATIONS
CREATE POLICY "Members view automations" ON public.automations FOR SELECT USING (public.is_member_of_tenant(tenant_id));
CREATE POLICY "Admin/Manager creates automations" ON public.automations FOR INSERT WITH CHECK (public.is_admin_or_manager(tenant_id));
CREATE POLICY "Admin/Manager updates automations" ON public.automations FOR UPDATE USING (public.is_admin_or_manager(tenant_id));
CREATE POLICY "Admin deletes automations" ON public.automations FOR DELETE USING (public.has_tenant_role(tenant_id, 'admin'));

-- AI CONFIGS
CREATE POLICY "Members view ai configs" ON public.ai_configs FOR SELECT USING (public.is_member_of_tenant(tenant_id));
CREATE POLICY "Admin creates ai configs" ON public.ai_configs FOR INSERT WITH CHECK (public.has_tenant_role(tenant_id, 'admin'));
CREATE POLICY "Admin updates ai configs" ON public.ai_configs FOR UPDATE USING (public.has_tenant_role(tenant_id, 'admin'));
CREATE POLICY "Admin deletes ai configs" ON public.ai_configs FOR DELETE USING (public.has_tenant_role(tenant_id, 'admin'));

-- PROMPT TEMPLATES
CREATE POLICY "Members view prompts" ON public.prompt_templates FOR SELECT USING (public.is_member_of_tenant(tenant_id));
CREATE POLICY "Admin/Manager creates prompts" ON public.prompt_templates FOR INSERT WITH CHECK (public.is_admin_or_manager(tenant_id));
CREATE POLICY "Admin/Manager updates prompts" ON public.prompt_templates FOR UPDATE USING (public.is_admin_or_manager(tenant_id));
CREATE POLICY "Admin deletes prompts" ON public.prompt_templates FOR DELETE USING (public.has_tenant_role(tenant_id, 'admin'));

-- CONVERSATION REVIEWS
CREATE POLICY "Members view reviews" ON public.conversation_reviews FOR SELECT USING (public.is_member_of_tenant(tenant_id));
CREATE POLICY "Members create reviews" ON public.conversation_reviews FOR INSERT WITH CHECK (public.is_member_of_tenant(tenant_id) AND public.get_user_role_in_tenant(tenant_id) != 'readonly');

-- AI LOGS
CREATE POLICY "Members view ai logs" ON public.ai_logs FOR SELECT USING (public.is_member_of_tenant(tenant_id));
CREATE POLICY "System inserts ai logs" ON public.ai_logs FOR INSERT WITH CHECK (public.is_member_of_tenant(tenant_id));

-- WHATSAPP INSTANCES
CREATE POLICY "Members view whatsapp instances" ON public.whatsapp_instances FOR SELECT USING (public.is_member_of_tenant(tenant_id));
CREATE POLICY "Admin creates whatsapp instances" ON public.whatsapp_instances FOR INSERT WITH CHECK (public.has_tenant_role(tenant_id, 'admin'));
CREATE POLICY "Admin updates whatsapp instances" ON public.whatsapp_instances FOR UPDATE USING (public.has_tenant_role(tenant_id, 'admin'));
CREATE POLICY "Admin deletes whatsapp instances" ON public.whatsapp_instances FOR DELETE USING (public.has_tenant_role(tenant_id, 'admin'));

-- STAGE MOVES
CREATE POLICY "Members view stage moves" ON public.stage_moves FOR SELECT USING (public.is_member_of_tenant(tenant_id));
CREATE POLICY "Members create stage moves" ON public.stage_moves FOR INSERT WITH CHECK (public.is_member_of_tenant(tenant_id) AND public.get_user_role_in_tenant(tenant_id) != 'readonly');

-- =============================================
-- JOB QUEUE FUNCTIONS (for Worker consumption)
-- =============================================

-- Acquire next job (atomic, for worker)
CREATE OR REPLACE FUNCTION public.acquire_next_job(_types TEXT[] DEFAULT NULL)
RETURNS public.job_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _job public.job_queue;
BEGIN
  SELECT * INTO _job
  FROM public.job_queue
  WHERE status = 'queued'
    AND run_after <= now()
    AND attempts < max_attempts
    AND (_types IS NULL OR type = ANY(_types))
  ORDER BY run_after ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF _job.id IS NOT NULL THEN
    UPDATE public.job_queue
    SET status = 'running', started_at = now(), attempts = attempts + 1, updated_at = now()
    WHERE id = _job.id;
    _job.status := 'running';
    _job.attempts := _job.attempts + 1;
  END IF;

  RETURN _job;
END;
$$;

-- Complete job
CREATE OR REPLACE FUNCTION public.complete_job(_job_id UUID, _result JSONB DEFAULT NULL)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.job_queue
  SET status = 'done', completed_at = now(), result = _result, updated_at = now()
  WHERE id = _job_id;
$$;

-- Fail job (with retry logic)
CREATE OR REPLACE FUNCTION public.fail_job(_job_id UUID, _error TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _job public.job_queue;
BEGIN
  SELECT * INTO _job FROM public.job_queue WHERE id = _job_id;
  
  IF _job.attempts >= _job.max_attempts THEN
    UPDATE public.job_queue
    SET status = 'dead', last_error = _error, updated_at = now()
    WHERE id = _job_id;
  ELSE
    UPDATE public.job_queue
    SET status = 'queued',
        last_error = _error,
        run_after = now() + (POWER(2, _job.attempts) * INTERVAL '1 minute'),
        updated_at = now()
    WHERE id = _job_id;
  END IF;
END;
$$;

-- Enqueue job helper
CREATE OR REPLACE FUNCTION public.enqueue_job(
  _type TEXT,
  _payload JSONB,
  _tenant_id UUID DEFAULT NULL,
  _idempotency_key TEXT DEFAULT NULL,
  _run_after TIMESTAMPTZ DEFAULT now(),
  _max_attempts INT DEFAULT 3
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _job_id UUID;
BEGIN
  -- Idempotency check
  IF _idempotency_key IS NOT NULL THEN
    SELECT id INTO _job_id FROM public.job_queue WHERE idempotency_key = _idempotency_key LIMIT 1;
    IF _job_id IS NOT NULL THEN
      RETURN _job_id;
    END IF;
  END IF;

  INSERT INTO public.job_queue (type, payload, tenant_id, idempotency_key, run_after, max_attempts)
  VALUES (_type, _payload, _tenant_id, _idempotency_key, _run_after, _max_attempts)
  RETURNING id INTO _job_id;

  -- Notify worker
  PERFORM pg_notify('new_job', json_build_object('id', _job_id, 'type', _type)::text);

  RETURN _job_id;
END;
$$;

-- =============================================
-- STORAGE BUCKET
-- =============================================
INSERT INTO storage.buckets (id, name, public) VALUES ('crm-files', 'crm-files', false);

CREATE POLICY "Tenant members upload files"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'crm-files'
  AND public.is_member_of_tenant((storage.foldername(name))[1]::uuid)
);

CREATE POLICY "Tenant members view files"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'crm-files'
  AND public.is_member_of_tenant((storage.foldername(name))[1]::uuid)
);

CREATE POLICY "Admin deletes files"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'crm-files'
  AND public.is_member_of_tenant((storage.foldername(name))[1]::uuid)
);
