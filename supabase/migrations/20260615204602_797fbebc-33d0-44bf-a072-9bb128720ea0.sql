CREATE OR REPLACE FUNCTION public.conversation_needs_company_reply(_conversation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT m.direction = 'inbound'
           AND COALESCE(m.media_type, '') NOT ILIKE '%template%'
    FROM public.messages m
    WHERE m.conversation_id = _conversation_id
      AND COALESCE(m.is_internal, false) = false
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT 1
  ), false)
$$;

REVOKE EXECUTE ON FUNCTION public.conversation_needs_company_reply(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.conversation_needs_company_reply(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.conversation_needs_company_reply(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.conversation_needs_company_reply(uuid) TO service_role;

UPDATE public.conversations c
   SET is_unanswered = public.conversation_needs_company_reply(c.id);