-- =====================================================================
-- Correção de isolamento entre tenants (revisão de segurança 2026-08-16)
-- =====================================================================
-- Problema comum a todos os itens abaixo: funções SECURITY DEFINER rodam
-- com o privilégio do dono e IGNORAM RLS. Várias estavam executáveis por
-- anon/authenticated (default do Postgres: EXECUTE para PUBLIC) e recebiam
-- o tenant_id por parâmetro sem conferir se quem chamou pertence ao tenant.
-- Como a chave anon é pública (embarcada no frontend), isso permitia ler
-- dados de outros clientes.
--
-- Duas estratégias, escolhidas por quem chama cada função (grep no repo):
--   "tranca"   -> REVOKE de anon/authenticated (função é só do worker/edge)
--   "porteiro" -> continua acessível, mas valida o tenant do chamador
-- Toda função tratada aqui recebe o porteiro, mesmo quando também é
-- trancada (defesa em profundidade: se um GRANT voltar por engano, a
-- checagem interna continua barrando).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0) Porteiro compartilhado
-- ---------------------------------------------------------------------
-- Regra única usada por todas as RPCs abaixo:
--   anon                      -> nunca passa
--   service_role / interno    -> passa (worker, edge functions, pg_cron,
--                                triggers; nesses contextos auth.role() é
--                                'service_role' ou NULL)
--   authenticated             -> só passa se for membro ativo do tenant
--                                (ou saas_admin)
-- SECURITY INVOKER de propósito: não precisa de privilégio elevado, pois
-- is_saas_admin()/is_member_of_tenant() já são SECURITY DEFINER.
CREATE OR REPLACE FUNCTION public.can_act_for_tenant(_tenant_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN COALESCE(auth.role(), '') = 'anon' THEN false
    WHEN COALESCE(auth.role(), '') IN ('', 'service_role') THEN true
    ELSE public.is_saas_admin() OR public.is_member_of_tenant(_tenant_id)
  END
$function$;

COMMENT ON FUNCTION public.can_act_for_tenant(uuid) IS
  'Porteiro das RPCs SECURITY DEFINER: anon nunca passa; service_role/cron passam; authenticated precisa ser membro ativo do tenant (ou saas_admin).';


-- ---------------------------------------------------------------------
-- 1) Fila de jobs — job_queue  (achado CRÍTICO C1)
-- ---------------------------------------------------------------------
-- acquire_next_job devolvia a linha inteira do job (payload com telefone e
-- conteúdo de mensagem) de QUALQUER tenant para qualquer chamador, além de
-- marcá-lo como 'running' (roubo de jobs = DoS do processamento de todos).
-- Chamadas: apenas worker/index.js (service_role) -> TRANCA.

REVOKE ALL ON FUNCTION public.acquire_next_job(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_next_job(text[]) TO service_role;

REVOKE ALL ON FUNCTION public.complete_job(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_job(uuid, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.fail_job(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_job(uuid, text) TO service_role;

-- enqueue_job NÃO pode ser trancada: o frontend a usa legitimamente
-- (ChatPanel.tsx:573 e :760 no envio de mídia, PipelinePage.tsx:798 nas
-- automações de etapa). Trancar derrubaria o envio do chat.
-- Portanto: anon perde o acesso e authenticated ganha porteiro.
CREATE OR REPLACE FUNCTION public.enqueue_job(_type text, _payload jsonb, _tenant_id uuid DEFAULT NULL::uuid, _idempotency_key text DEFAULT NULL::text, _run_after timestamp with time zone DEFAULT now(), _max_attempts integer DEFAULT 3)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _job_id UUID;
BEGIN
  -- Porteiro: impede enfileirar job em nome de outro tenant.
  IF NOT public.can_act_for_tenant(_tenant_id) THEN
    RAISE EXCEPTION 'forbidden: sem permissão para enfileirar job neste tenant';
  END IF;

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
$function$;

REVOKE ALL ON FUNCTION public.enqueue_job(text, jsonb, uuid, text, timestamp with time zone, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enqueue_job(text, jsonb, uuid, text, timestamp with time zone, integer) TO authenticated, service_role;


-- ---------------------------------------------------------------------
-- 2) Base de conhecimento — search_knowledge  (achado CRÍTICO C2)
-- ---------------------------------------------------------------------
-- Recebia _tenant_id e devolvia knowledge_chunks.content sem conferir
-- associação. Com match_count alto + threshold negativo, retornava o texto
-- integral dos documentos de outro cliente.
-- Chamadas: ai-generate/index.ts:277 e worker/index.js:1502, ambas com
-- service_role -> TRANCA + porteiro. São 3 overloads; todos tratados.

CREATE OR REPLACE FUNCTION public.search_knowledge(_tenant_id uuid, _query_embedding vector, _match_count integer DEFAULT 5, _match_threshold double precision DEFAULT 0.7)
 RETURNS TABLE(id uuid, content text, document_id uuid, similarity double precision)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    kc.id,
    kc.content,
    kc.document_id,
    (1 - (kc.embedding <=> _query_embedding))::FLOAT AS similarity
  FROM public.knowledge_chunks kc
  WHERE kc.tenant_id = _tenant_id
    AND public.can_act_for_tenant(_tenant_id)
    AND (1 - (kc.embedding <=> _query_embedding)) > _match_threshold
  ORDER BY kc.embedding <=> _query_embedding
  LIMIT _match_count;
$function$;

CREATE OR REPLACE FUNCTION public.search_knowledge(_tenant_id uuid, _query_embedding vector, _match_count integer DEFAULT 5, _match_threshold double precision DEFAULT 0.7, _category text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, content text, document_id uuid, similarity double precision, document_name text, category text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    kc.id, kc.content, kc.document_id,
    (1 - (kc.embedding <=> _query_embedding))::FLOAT AS similarity,
    kc.document_name,
    kd.category
  FROM public.knowledge_chunks kc
  JOIN public.knowledge_documents kd ON kd.id = kc.document_id
  WHERE kc.tenant_id = _tenant_id
    AND public.can_act_for_tenant(_tenant_id)
    AND (1 - (kc.embedding <=> _query_embedding)) > _match_threshold
    AND (_category IS NULL OR kd.category = _category)
  ORDER BY kc.embedding <=> _query_embedding
  LIMIT _match_count;
$function$;

CREATE OR REPLACE FUNCTION public.search_knowledge(_tenant_id uuid, _query_embedding vector, _match_count integer DEFAULT 5, _match_threshold double precision DEFAULT 0.7, _category text DEFAULT NULL::text, _document_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(id uuid, content text, document_id uuid, similarity double precision, document_name text, category text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    kc.id, kc.content, kc.document_id,
    (1 - (kc.embedding <=> _query_embedding))::FLOAT AS similarity,
    kc.document_name,
    kd.category
  FROM public.knowledge_chunks kc
  JOIN public.knowledge_documents kd ON kd.id = kc.document_id
  WHERE kc.tenant_id = _tenant_id
    AND public.can_act_for_tenant(_tenant_id)
    AND (1 - (kc.embedding <=> _query_embedding)) > _match_threshold
    AND (_category IS NULL OR kd.category = _category)
    AND (_document_ids IS NULL OR kc.document_id = ANY(_document_ids))
  ORDER BY kc.embedding <=> _query_embedding
  LIMIT _match_count;
$function$;

REVOKE ALL ON FUNCTION public.search_knowledge(uuid, vector, integer, double precision) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_knowledge(uuid, vector, integer, double precision) TO service_role;

REVOKE ALL ON FUNCTION public.search_knowledge(uuid, vector, integer, double precision, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_knowledge(uuid, vector, integer, double precision, text) TO service_role;

REVOKE ALL ON FUNCTION public.search_knowledge(uuid, vector, integer, double precision, text, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_knowledge(uuid, vector, integer, double precision, text, uuid[]) TO service_role;


-- ---------------------------------------------------------------------
-- 3) Carga dos atendentes — get_member_workload  (achado ALTO A3)
-- ---------------------------------------------------------------------
-- Recebia p_tenant_id e devolvia user_id, papel e carga dos membros sem
-- conferir associação: permitia enumerar a equipe de outro cliente.
-- Chamadas: worker/index.js:1174 e worker/automation-handler.js:301,
-- ambas com service_role -> TRANCA + porteiro.

CREATE OR REPLACE FUNCTION public.get_member_workload(p_tenant_id uuid)
 RETURNS TABLE(membership_id uuid, user_id uuid, role text, open_opportunities bigint, open_conversations bigint, total_load bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    AND public.can_act_for_tenant(p_tenant_id)
    AND tm.is_active = true
    AND tm.role IN ('attendant', 'manager', 'admin')
  ORDER BY total_load ASC;
$function$;

REVOKE ALL ON FUNCTION public.get_member_workload(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_member_workload(uuid) TO service_role;


-- ---------------------------------------------------------------------
-- 4) Templates compartilhados — flow_shares  (achado ALTO A2)
-- ---------------------------------------------------------------------
-- A policy antiga liberava SELECT de TODA linha ativa para anon/authenticated
-- (RLS não consegue filtrar "só a linha cujo token o visitante conhece").
-- Resultado: qualquer um listava snapshot + token + tenant_id de todos os
-- tenants — inclusive os tenant_id que municiavam os ataques acima.
-- Solução: o acesso público passa a ser por RPC que exige o token exato.

DROP POLICY IF EXISTS "public can read active shares" ON public.flow_shares;
REVOKE ALL ON TABLE public.flow_shares FROM anon;

-- Retorna no máximo 1 linha, e só mediante o token exato.
-- Não expõe tenant_id/flow_id/created_by (minimização: era justamente o
-- tenant_id vazado aqui que abria as portas de C1/C2/A3).
CREATE OR REPLACE FUNCTION public.get_flow_share(_token text)
 RETURNS TABLE(id uuid, token text, title text, description text, snapshot jsonb, cloned_count integer, is_active boolean, expires_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT fs.id, fs.token, fs.title, fs.description, fs.snapshot,
         fs.cloned_count, fs.is_active, fs.expires_at
  FROM public.flow_shares fs
  WHERE fs.token = _token
    AND fs.is_active = true
    AND (fs.expires_at IS NULL OR fs.expires_at > now())
  LIMIT 1;
$function$;

COMMENT ON FUNCTION public.get_flow_share(text) IS
  'Preview público de um template de fluxo. Exige o token exato; substitui a leitura direta da tabela flow_shares por anon.';

REVOKE ALL ON FUNCTION public.get_flow_share(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_flow_share(text) TO anon, authenticated, service_role;

-- Nota: os membros do tenant continuam gerenciando os próprios links pela
-- policy "tenant members manage own shares" (ALL, authenticated), e a
-- instalação continua por install_flow_share(), que é SECURITY DEFINER e
-- valida o tenant de destino — nenhuma das duas depende da policy removida.
