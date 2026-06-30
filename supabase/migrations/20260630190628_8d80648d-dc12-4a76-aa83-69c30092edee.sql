CREATE OR REPLACE FUNCTION public.get_conversation_provider(p_conversation_id uuid)
RETURNS TABLE(instance_id uuid, provider text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT wi.id AS instance_id, wi.provider::text AS provider
  FROM public.conversations c
  JOIN public.whatsapp_instances wi
    ON wi.id = c.whatsapp_instance_id
   AND wi.tenant_id = c.tenant_id
  WHERE c.id = p_conversation_id
    AND (public.is_saas_admin() OR public.is_member_of_tenant(c.tenant_id));
$$;

REVOKE ALL ON FUNCTION public.get_conversation_provider(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_conversation_provider(uuid) TO authenticated;