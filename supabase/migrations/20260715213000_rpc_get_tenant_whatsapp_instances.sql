-- Já aplicada no banco em 2026-07-15 (via MCP). Registro para histórico do repo.
--
-- Atendentes não conseguem ler whatsapp_instances (RLS = admin/manager) e o
-- "Nova Conversa" criava conversas sem instância — sem botão de template e com
-- envio roteado errado em tenant Meta. Mesma solução do get_conversation_provider:
-- RPC SECURITY DEFINER que devolve só os campos seguros (nunca o token) pra
-- qualquer membro do tenant.
--
-- Junto com esta migration foi feito o backfill (one-off, não repetir): conversas
-- whatsapp com whatsapp_instance_id NULL em tenants com exatamente 1 instância
-- ativa foram vinculadas a ela (SOS 21, Instituto Bignoto 10, Precatorizei 7).
CREATE OR REPLACE FUNCTION public.get_tenant_whatsapp_instances(p_tenant_id uuid)
 RETURNS TABLE(id uuid, display_name text, instance_name text, provider text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT wi.id, wi.display_name, wi.instance_name, wi.provider::text
  FROM public.whatsapp_instances wi
  WHERE wi.tenant_id = p_tenant_id
    AND wi.is_active
    AND (public.is_saas_admin() OR public.is_member_of_tenant(p_tenant_id));
$function$;
