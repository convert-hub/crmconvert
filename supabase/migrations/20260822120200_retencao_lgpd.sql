-- =====================================================================
-- Retenção de dados pessoais (LGPD) — revisão de segurança, achado A6
-- =====================================================================
-- Até aqui só registros técnicos tinham expurgo (webhook_events 30d,
-- job_queue 30d). Conteúdo de conversas, telefones, logs de IA e execuções
-- de fluxo eram guardados para sempre.
--
-- Duas camadas:
--   (a) registros técnicos, para todos os tenants, sem configuração:
--       ai_logs (entrada/saída bruta enviada à IA)          -> 90 dias
--       flow_executions finalizadas (completed/expired/...)  -> 90 dias
--   (b) dados de negócio, CONFIGURÁVEL POR TENANT e desligado por padrão.
--       Nada some sem decisão explícita. Liga-se gravando em
--       tenants.settings:
--         "retention": { "conversations_days": 730, "contacts_days": 730 }
--       conversations_days: apaga conversas sem nenhuma mensagem há N dias
--         (messages vai por ON DELETE CASCADE; as mídias do bucket são
--         removidas pelo worker via job purge_storage_paths — SQL não apaga
--         o arquivo físico do storage).
--       contacts_days: apaga contatos sem atualização há N dias que não têm
--         mais nenhuma conversa, oportunidade ou atividade.
--       Ausente, 0 ou null = não apaga.
-- =====================================================================


-- ---------------------------------------------------------------------
-- (a) Registros técnicos — 90 dias
-- ---------------------------------------------------------------------
DO $$ BEGIN PERFORM cron.unschedule('retencao-ai-logs'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('retencao-flow-executions'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule('retencao-ai-logs', '40 6 * * *',
  $$DELETE FROM public.ai_logs WHERE created_at < now() - interval '90 days'$$);
SELECT cron.schedule('retencao-flow-executions', '50 6 * * *',
  $$DELETE FROM public.flow_executions
     WHERE status NOT IN ('running', 'awaiting_input')
       AND coalesce(completed_at, started_at) < now() - interval '90 days'$$);


-- ---------------------------------------------------------------------
-- (b) Retenção por tenant
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_tenant_retention()
 RETURNS TABLE(tenant_id uuid, conversations_deleted integer, contacts_deleted integer, media_jobs integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _t record;
  _cdays integer;
  _kdays integer;
  _conv_ids uuid[];
  _paths text[];
  _chunk text[];
  _i integer;
  _n integer;
  _k integer;
  _jobs integer;
BEGIN
  FOR _t IN
    SELECT t.id, t.settings->'retention' AS r
    FROM public.tenants t
    WHERE jsonb_typeof(t.settings->'retention') = 'object'
  LOOP
    _cdays := NULLIF(NULLIF(_t.r->>'conversations_days', '')::integer, 0);
    _kdays := NULLIF(NULLIF(_t.r->>'contacts_days', '')::integer, 0);
    _n := 0; _k := 0; _jobs := 0;

    IF _cdays IS NOT NULL AND _cdays > 0 THEN
      SELECT array_agg(c.id) INTO _conv_ids
      FROM public.conversations c
      WHERE c.tenant_id = _t.id
        AND coalesce(c.last_message_at, c.created_at) < now() - make_interval(days => _cdays);

      IF _conv_ids IS NOT NULL THEN
        -- Mídias: coletadas ANTES do DELETE (messages cai em cascata) e
        -- enviadas ao worker em lotes de 500 caminhos.
        SELECT array_agg(m.storage_path) INTO _paths
        FROM public.messages m
        WHERE m.conversation_id = ANY(_conv_ids) AND m.storage_path IS NOT NULL;

        IF _paths IS NOT NULL THEN
          _i := 1;
          WHILE _i <= array_length(_paths, 1) LOOP
            _chunk := _paths[_i : _i + 499];
            PERFORM public.enqueue_job(
              'purge_storage_paths',
              jsonb_build_object('tenant_id', _t.id, 'paths', to_jsonb(_chunk)),
              _t.id,
              'retention-media-' || _t.id::text || '-' || md5(array_to_string(_chunk, ','))
            );
            _jobs := _jobs + 1;
            _i := _i + 500;
          END LOOP;
        END IF;

        DELETE FROM public.conversations WHERE id = ANY(_conv_ids);
        GET DIAGNOSTICS _n = ROW_COUNT;
      END IF;
    END IF;

    IF _kdays IS NOT NULL AND _kdays > 0 THEN
      DELETE FROM public.contacts k
      WHERE k.tenant_id = _t.id
        AND k.updated_at < now() - make_interval(days => _kdays)
        AND NOT EXISTS (SELECT 1 FROM public.conversations c WHERE c.contact_id = k.id)
        AND NOT EXISTS (SELECT 1 FROM public.opportunities o WHERE o.contact_id = k.id)
        AND NOT EXISTS (SELECT 1 FROM public.activities a WHERE a.contact_id = k.id);
      GET DIAGNOSTICS _k = ROW_COUNT;
    END IF;

    tenant_id := _t.id;
    conversations_deleted := _n;
    contacts_deleted := _k;
    media_jobs := _jobs;
    RETURN NEXT;
  END LOOP;
END;
$function$;

COMMENT ON FUNCTION public.apply_tenant_retention() IS
  'Expurgo LGPD por tenant, guiado por tenants.settings->retention ({conversations_days, contacts_days}). Roda diariamente via pg_cron.';

REVOKE ALL ON FUNCTION public.apply_tenant_retention() FROM PUBLIC, anon, authenticated;

DO $$ BEGIN PERFORM cron.unschedule('retencao-por-tenant'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('retencao-por-tenant', '0 7 * * *',
  $$SELECT public.apply_tenant_retention()$$);
