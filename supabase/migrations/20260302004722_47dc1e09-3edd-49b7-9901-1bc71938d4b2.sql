
-- Table to store chatbot/automation flows
CREATE TABLE public.chatbot_flows (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  trigger_type TEXT NOT NULL DEFAULT 'manual',
  trigger_config JSONB DEFAULT '{}'::jsonb,
  nodes JSONB NOT NULL DEFAULT '[]'::jsonb,
  edges JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES public.tenant_memberships(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.chatbot_flows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members view flows"
  ON public.chatbot_flows FOR SELECT
  USING (is_member_of_tenant(tenant_id));

CREATE POLICY "Admin/Manager creates flows"
  ON public.chatbot_flows FOR INSERT
  WITH CHECK (is_admin_or_manager(tenant_id));

CREATE POLICY "Admin/Manager updates flows"
  ON public.chatbot_flows FOR UPDATE
  USING (is_admin_or_manager(tenant_id));

CREATE POLICY "Admin deletes flows"
  ON public.chatbot_flows FOR DELETE
  USING (has_tenant_role(tenant_id, 'admin'::tenant_role));

-- Flow execution log
CREATE TABLE public.flow_executions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  flow_id UUID NOT NULL REFERENCES public.chatbot_flows(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id),
  conversation_id UUID REFERENCES public.conversations(id),
  status TEXT NOT NULL DEFAULT 'running',
  current_node_id TEXT,
  context JSONB DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  error TEXT
);

ALTER TABLE public.flow_executions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members view flow executions"
  ON public.flow_executions FOR SELECT
  USING (is_member_of_tenant(tenant_id));

CREATE POLICY "System inserts flow executions"
  ON public.flow_executions FOR INSERT
  WITH CHECK (is_member_of_tenant(tenant_id));

CREATE POLICY "System updates flow executions"
  ON public.flow_executions FOR UPDATE
  USING (is_member_of_tenant(tenant_id));

-- Trigger for updated_at
CREATE TRIGGER update_chatbot_flows_updated_at
  BEFORE UPDATE ON public.chatbot_flows
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Index for active flows by trigger
CREATE INDEX idx_chatbot_flows_active_trigger ON public.chatbot_flows(tenant_id, trigger_type) WHERE is_active = true;
CREATE INDEX idx_flow_executions_status ON public.flow_executions(flow_id, status) WHERE status = 'running';
