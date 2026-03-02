
-- =============================================
-- FASE 4.1: scheduled_messages table
-- =============================================
CREATE TABLE public.scheduled_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id),
  content TEXT,
  media_url TEXT,
  media_type TEXT,
  scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'cancelled', 'failed')),
  sent_at TIMESTAMP WITH TIME ZONE,
  created_by UUID REFERENCES public.tenant_memberships(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.scheduled_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members view scheduled messages"
  ON public.scheduled_messages FOR SELECT
  USING (is_member_of_tenant(tenant_id));

CREATE POLICY "Members create scheduled messages"
  ON public.scheduled_messages FOR INSERT
  WITH CHECK (is_member_of_tenant(tenant_id) AND get_user_role_in_tenant(tenant_id) <> 'readonly');

CREATE POLICY "Members update scheduled messages"
  ON public.scheduled_messages FOR UPDATE
  USING (is_member_of_tenant(tenant_id) AND get_user_role_in_tenant(tenant_id) <> 'readonly');

CREATE POLICY "Admin/Manager deletes scheduled messages"
  ON public.scheduled_messages FOR DELETE
  USING (is_admin_or_manager(tenant_id));

CREATE INDEX idx_scheduled_messages_pending ON public.scheduled_messages (scheduled_at) WHERE status = 'pending';
CREATE INDEX idx_scheduled_messages_tenant ON public.scheduled_messages (tenant_id);

-- =============================================
-- FASE 4.3: Round-robin workload function
-- =============================================
CREATE OR REPLACE FUNCTION public.get_member_workload(p_tenant_id UUID)
RETURNS TABLE (
  membership_id UUID,
  user_id UUID,
  role TEXT,
  open_opportunities BIGINT,
  open_conversations BIGINT,
  total_load BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    tm.id AS membership_id,
    tm.user_id,
    tm.role::TEXT,
    COALESCE(opp.cnt, 0) AS open_opportunities,
    COALESCE(conv.cnt, 0) AS open_conversations,
    COALESCE(opp.cnt, 0) + COALESCE(conv.cnt, 0) AS total_load
  FROM public.tenant_memberships tm
  LEFT JOIN (
    SELECT assigned_to, COUNT(*) AS cnt
    FROM public.opportunities
    WHERE tenant_id = p_tenant_id AND status = 'open'
    GROUP BY assigned_to
  ) opp ON opp.assigned_to = tm.id
  LEFT JOIN (
    SELECT assigned_to, COUNT(*) AS cnt
    FROM public.conversations
    WHERE tenant_id = p_tenant_id AND status IN ('open', 'waiting_customer', 'waiting_agent')
    GROUP BY assigned_to
  ) conv ON conv.assigned_to = tm.id
  WHERE tm.tenant_id = p_tenant_id
    AND tm.is_active = true
    AND tm.role IN ('attendant', 'manager', 'admin')
  ORDER BY total_load ASC;
$$;
