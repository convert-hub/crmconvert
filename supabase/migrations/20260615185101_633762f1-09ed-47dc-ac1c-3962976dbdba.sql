ALTER TABLE public.conversations
ADD COLUMN IF NOT EXISTS is_unanswered boolean
GENERATED ALWAYS AS (
  last_customer_message_at IS NOT NULL
  AND (last_agent_message_at IS NULL OR last_customer_message_at > last_agent_message_at)
) STORED;

CREATE INDEX IF NOT EXISTS idx_conversations_unanswered
ON public.conversations (tenant_id, last_customer_message_at)
WHERE is_unanswered = true;