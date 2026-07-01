
CREATE OR REPLACE FUNCTION public.backfill_ai_stage_classify(_tenant_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  _count integer := 0;
  _conv RECORD;
BEGIN
  IF NOT public.is_member_of_tenant(_tenant_id) AND NOT public.is_saas_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  FOR _conv IN
    SELECT DISTINCT c.id AS conversation_id
    FROM public.conversations c
    JOIN public.opportunities o ON (
      o.id = c.opportunity_id
      OR (c.contact_id IS NOT NULL AND o.contact_id = c.contact_id AND o.status = 'open')
    )
    WHERE c.tenant_id = _tenant_id
      AND o.tenant_id = _tenant_id
      AND o.status = 'open'
      AND EXISTS (
        SELECT 1 FROM public.messages m
        WHERE m.conversation_id = c.id
          AND m.is_internal = false
        LIMIT 1
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.job_queue jq
        WHERE jq.type = 'ai_stage_classify'
          AND jq.tenant_id = _tenant_id
          AND (jq.payload->>'conversation_id') = c.id::text
          AND jq.status IN ('queued', 'running')
      )
  LOOP
    PERFORM public.enqueue_job(
      'ai_stage_classify',
      jsonb_build_object('tenant_id', _tenant_id, 'conversation_id', _conv.conversation_id),
      _tenant_id,
      'ai_classify_bf_' || _conv.conversation_id::text || '_' || to_char(now(), 'YYYYMMDD_HH24MI')
    );
    _count := _count + 1;
  END LOOP;

  RETURN _count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.backfill_ai_stage_classify(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_ai_stage_classify(uuid) TO service_role;
