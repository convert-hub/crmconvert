
-- =============================================
-- FASE 1.1: Tabela quick_replies (Respostas Rápidas)
-- =============================================
CREATE TABLE public.quick_replies (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  shortcut TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  variables TEXT[] DEFAULT '{}'::TEXT[],
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES public.tenant_memberships(id),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, shortcut)
);

ALTER TABLE public.quick_replies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members view quick replies"
  ON public.quick_replies FOR SELECT
  USING (is_member_of_tenant(tenant_id));

CREATE POLICY "Admin/Manager creates quick replies"
  ON public.quick_replies FOR INSERT
  WITH CHECK (is_admin_or_manager(tenant_id));

CREATE POLICY "Admin/Manager updates quick replies"
  ON public.quick_replies FOR UPDATE
  USING (is_admin_or_manager(tenant_id));

CREATE POLICY "Admin deletes quick replies"
  ON public.quick_replies FOR DELETE
  USING (has_tenant_role(tenant_id, 'admin'::tenant_role));

CREATE TRIGGER update_quick_replies_updated_at
  BEFORE UPDATE ON public.quick_replies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================
-- FASE 1.2: Coluna is_internal em messages (Notas Internas)
-- =============================================
ALTER TABLE public.messages
  ADD COLUMN is_internal BOOLEAN NOT NULL DEFAULT false;
