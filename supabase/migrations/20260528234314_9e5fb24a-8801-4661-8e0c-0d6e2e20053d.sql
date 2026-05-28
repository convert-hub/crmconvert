
-- Phase 5: Public flow templates (shareable links)
CREATE TABLE public.flow_shares (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  flow_id UUID NOT NULL REFERENCES public.chatbot_flows(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,
  created_by UUID,
  title TEXT,
  description TEXT,
  snapshot JSONB NOT NULL,
  cloned_count INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_flow_shares_token ON public.flow_shares(token);
CREATE INDEX idx_flow_shares_tenant ON public.flow_shares(tenant_id);

GRANT SELECT ON public.flow_shares TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.flow_shares TO authenticated;
GRANT ALL ON public.flow_shares TO service_role;

ALTER TABLE public.flow_shares ENABLE ROW LEVEL SECURITY;

-- Public can read active, non-expired shares (preview by token)
CREATE POLICY "public can read active shares" ON public.flow_shares
  FOR SELECT TO anon, authenticated
  USING (is_active = true AND (expires_at IS NULL OR expires_at > now()));

-- Tenant members manage their shares
CREATE POLICY "tenant members manage own shares" ON public.flow_shares
  FOR ALL TO authenticated
  USING (public.is_member_of_tenant(tenant_id) OR public.is_saas_admin())
  WITH CHECK (public.is_member_of_tenant(tenant_id) OR public.is_saas_admin());

CREATE TRIGGER trg_flow_shares_updated
  BEFORE UPDATE ON public.flow_shares
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Clone helper: lets authenticated users clone a share's snapshot into their tenant
CREATE OR REPLACE FUNCTION public.install_flow_share(_token TEXT, _target_tenant_id UUID, _target_folder_id UUID DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _share public.flow_shares;
  _new_flow_id UUID;
  _snap JSONB;
BEGIN
  IF NOT public.is_member_of_tenant(_target_tenant_id) AND NOT public.is_saas_admin() THEN
    RAISE EXCEPTION 'Sem permissão para instalar no tenant alvo';
  END IF;

  SELECT * INTO _share FROM public.flow_shares
   WHERE token = _token
     AND is_active = true
     AND (expires_at IS NULL OR expires_at > now())
   LIMIT 1;
  IF _share.id IS NULL THEN RAISE EXCEPTION 'Template não encontrado ou expirado'; END IF;

  _snap := _share.snapshot;

  INSERT INTO public.chatbot_flows (
    tenant_id, name, description, trigger_type, trigger_config,
    nodes, edges, is_active, folder_id
  ) VALUES (
    _target_tenant_id,
    COALESCE(_snap->>'name','Template instalado'),
    _snap->>'description',
    COALESCE(_snap->>'trigger_type','message_received'),
    COALESCE(_snap->'trigger_config','{}'::jsonb),
    COALESCE(_snap->'nodes','[]'::jsonb),
    COALESCE(_snap->'edges','[]'::jsonb),
    false,
    _target_folder_id
  ) RETURNING id INTO _new_flow_id;

  UPDATE public.flow_shares SET cloned_count = cloned_count + 1 WHERE id = _share.id;
  RETURN _new_flow_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.install_flow_share(TEXT, UUID, UUID) TO authenticated;
