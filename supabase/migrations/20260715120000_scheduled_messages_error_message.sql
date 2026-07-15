-- Já aplicada no banco em 2026-07-15 (via MCP). Registro para histórico do repo.

-- Motivo da falha visível na gestão de mensagens agendadas
ALTER TABLE public.scheduled_messages ADD COLUMN IF NOT EXISTS error_message text;

-- Listagem da UI (tenant + status + ordenação por data agendada)
CREATE INDEX IF NOT EXISTS idx_scheduled_messages_tenant_status_time
  ON public.scheduled_messages (tenant_id, status, scheduled_at DESC);
