-- RPCs agregadas para o PipelinePage: substituem o download de TODAS as
-- mensagens/conversas do tenant para o navegador (que rodava a cada 2s).
-- (aplicada em produção via MCP em 2026-07-14; arquivo para versionamento)
-- SECURITY INVOKER: a RLS do usuário continua valendo dentro das funções.

-- Não-lidas por contato: conversas abertas cuja ÚLTIMA mensagem é inbound;
-- waiting_agent conta pelo menos 1 (mesma semântica do cálculo antigo no front)
CREATE OR REPLACE FUNCTION public.get_unread_by_contact(_tenant_id uuid)
RETURNS TABLE (contact_id uuid, unread_signal bigint)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT cv.contact_id,
         sum(CASE WHEN cv.status = 'waiting_agent' THEN greatest(coalesce(cv.unread_count, 0), 1) ELSE coalesce(cv.unread_count, 0) END)::bigint AS unread_signal
  FROM conversations cv
  WHERE cv.tenant_id = _tenant_id
    AND cv.status IN ('open', 'waiting_customer', 'waiting_agent')
    AND cv.contact_id IS NOT NULL
    AND (SELECT m.direction FROM messages m WHERE m.conversation_id = cv.id ORDER BY m.created_at DESC LIMIT 1) = 'inbound'
  GROUP BY cv.contact_id
  HAVING sum(CASE WHEN cv.status = 'waiting_agent' THEN greatest(coalesce(cv.unread_count, 0), 1) ELSE coalesce(cv.unread_count, 0) END) > 0
$$;

-- Engagement: mensagens por contato nos últimos 30 dias
CREATE OR REPLACE FUNCTION public.get_msg_counts_by_contact_30d(_tenant_id uuid)
RETURNS TABLE (contact_id uuid, msg_count bigint)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT cv.contact_id, count(m.id)::bigint AS msg_count
  FROM conversations cv
  JOIN messages m ON m.conversation_id = cv.id
  WHERE cv.tenant_id = _tenant_id
    AND cv.contact_id IS NOT NULL
    AND m.created_at >= now() - interval '30 days'
  GROUP BY cv.contact_id
$$;
