
-- Trigger to keep conversation last_*_message_at in sync with actual messages.
-- Source of truth = messages table. Removes the dependency on every send path
-- to update the conversation row correctly.

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
           last_message_at = GREATEST(COALESCE(last_message_at, NEW.created_at), NEW.created_at)
     WHERE id = NEW.conversation_id;
  ELSIF NEW.direction = 'outbound' THEN
    UPDATE public.conversations
       SET last_agent_message_at = GREATEST(COALESCE(last_agent_message_at, NEW.created_at), NEW.created_at),
           last_message_at = GREATEST(COALESCE(last_message_at, NEW.created_at), NEW.created_at)
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

-- Backfill: recompute last_customer_message_at / last_agent_message_at from real messages
-- (excluding internal notes) so that conversations with stale timestamps get corrected.
WITH agg AS (
  SELECT
    conversation_id,
    MAX(created_at) FILTER (WHERE direction = 'inbound')  AS max_in,
    MAX(created_at) FILTER (WHERE direction = 'outbound') AS max_out,
    MAX(created_at) AS max_any
  FROM public.messages
  WHERE COALESCE(is_internal, false) = false
  GROUP BY conversation_id
)
UPDATE public.conversations c
   SET last_customer_message_at = agg.max_in,
       last_agent_message_at    = agg.max_out,
       last_message_at          = GREATEST(COALESCE(c.last_message_at, agg.max_any), agg.max_any)
  FROM agg
 WHERE c.id = agg.conversation_id
   AND (
        c.last_customer_message_at IS DISTINCT FROM agg.max_in
     OR c.last_agent_message_at    IS DISTINCT FROM agg.max_out
   );
