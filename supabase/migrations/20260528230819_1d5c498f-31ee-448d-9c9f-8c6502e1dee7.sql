-- Pastas de fluxos
CREATE TABLE public.flow_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.flow_folders TO authenticated;
GRANT ALL ON public.flow_folders TO service_role;

ALTER TABLE public.flow_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view folders in their tenant"
  ON public.flow_folders FOR SELECT TO authenticated
  USING (public.is_member_of_tenant(tenant_id) OR public.is_saas_admin());

CREATE POLICY "Members can create folders in their tenant"
  ON public.flow_folders FOR INSERT TO authenticated
  WITH CHECK (public.is_member_of_tenant(tenant_id) OR public.is_saas_admin());

CREATE POLICY "Members can update folders in their tenant"
  ON public.flow_folders FOR UPDATE TO authenticated
  USING (public.is_member_of_tenant(tenant_id) OR public.is_saas_admin());

CREATE POLICY "Members can delete folders in their tenant"
  ON public.flow_folders FOR DELETE TO authenticated
  USING (public.is_member_of_tenant(tenant_id) OR public.is_saas_admin());

CREATE TRIGGER update_flow_folders_updated_at
  BEFORE UPDATE ON public.flow_folders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_flow_folders_tenant ON public.flow_folders(tenant_id, position);

-- Adicionar folder_id em chatbot_flows
ALTER TABLE public.chatbot_flows
  ADD COLUMN folder_id UUID REFERENCES public.flow_folders(id) ON DELETE SET NULL;

CREATE INDEX idx_chatbot_flows_folder ON public.chatbot_flows(folder_id);
