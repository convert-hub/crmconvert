ALTER TABLE public.flow_executions
  ADD COLUMN IF NOT EXISTS pending_queue jsonb,
  ADD COLUMN IF NOT EXISTS pending_save_field text,
  ADD COLUMN IF NOT EXISTS pending_custom_field_key text;

CREATE INDEX IF NOT EXISTS idx_flow_executions_awaiting_input
  ON public.flow_executions (tenant_id, conversation_id)
  WHERE status = 'awaiting_input';