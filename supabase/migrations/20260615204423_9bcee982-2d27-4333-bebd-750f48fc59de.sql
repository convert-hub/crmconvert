DROP INDEX IF EXISTS public.idx_conversations_unanswered;

ALTER TABLE public.conversations
DROP COLUMN IF EXISTS is_unanswered;

ALTER TABLE public.conversations
ADD COLUMN is_unanswered boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.conversation_needs_company_reply(_conversation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT m.direction = 'inbound'
    FROM public.messages m
    WHERE m.conversation_id = _conversation_id
      AND COALESCE(m.is_internal, false) = false
      AND COALESCE(m.media_type, '') NOT ILIKE '%template%'
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT 1
  ), false)
$$;

CREATE OR REPLACE FUNCTION public.tg_messages_sync_conversation_timestamps()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Ignore internal notes — they are not real customer/agent traffic.
  IF COALESCE(NEW.is_internal, false) = true THEN
    RETURN NEW;
  END IF;

  IF NEW.direction = 'inbound' THEN
    UPDATE public.conversations
       SET last_customer_message_at = GREATEST(COALESCE(last_customer_message_at, NEW.created_at), NEW.created_at),
           last_message_at = GREATEST(COALESCE(last_message_at, NEW.created_at), NEW.created_at),
           is_unanswered = public.conversation_needs_company_reply(NEW.conversation_id)
     WHERE id = NEW.conversation_id;
  ELSIF NEW.direction = 'outbound' THEN
    UPDATE public.conversations
       SET last_agent_message_at = GREATEST(COALESCE(last_agent_message_at, NEW.created_at), NEW.created_at),
           last_message_at = GREATEST(COALESCE(last_message_at, NEW.created_at), NEW.created_at),
           is_unanswered = public.conversation_needs_company_reply(NEW.conversation_id)
     WHERE id = NEW.conversation_id;
  ELSE
    UPDATE public.conversations
       SET is_unanswered = public.conversation_needs_company_reply(NEW.conversation_id)
     WHERE id = NEW.conversation_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS messages_sync_conversation_timestamps ON public.messages;
CREATE TRIGGER messages_sync_conversation_timestamps
AFTER INSERT ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.tg_messages_sync_conversation_timestamps();

WITH agg AS (
  SELECT
    conversation_id,
    MAX(created_at) FILTER (WHERE direction = 'inbound') AS max_in,
    MAX(created_at) FILTER (WHERE direction = 'outbound') AS max_out,
    MAX(created_at) AS max_any
  FROM public.messages
  WHERE COALESCE(is_internal, false) = false
  GROUP BY conversation_id
)
UPDATE public.conversations c
   SET last_customer_message_at = agg.max_in,
       last_agent_message_at = agg.max_out,
       last_message_at = agg.max_any,
       is_unanswered = public.conversation_needs_company_reply(c.id)
  FROM agg
 WHERE c.id = agg.conversation_id;

UPDATE public.conversations c
   SET is_unanswered = false
 WHERE NOT EXISTS (
   SELECT 1
   FROM public.messages m
   WHERE m.conversation_id = c.id
     AND COALESCE(m.is_internal, false) = false
 );

CREATE INDEX IF NOT EXISTS idx_conversations_unanswered
ON public.conversations (tenant_id, last_customer_message_at)
WHERE is_unanswered = true;