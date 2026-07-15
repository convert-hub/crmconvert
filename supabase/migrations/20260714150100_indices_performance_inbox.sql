-- Índices para os padrões de acesso quentes do inbox/pipeline
-- (aplicada em produção via MCP em 2026-07-14; arquivo para versionamento)

-- Lista do inbox: WHERE tenant_id = X ORDER BY last_message_at DESC
CREATE INDEX IF NOT EXISTS idx_conversations_tenant_last_msg
  ON public.conversations (tenant_id, last_message_at DESC NULLS LAST);

-- Timeline do chat: WHERE conversation_id = X ORDER BY created_at
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
  ON public.messages (conversation_id, created_at DESC);

-- Varreduras por tenant + período (engagement/relatórios/última direção)
CREATE INDEX IF NOT EXISTS idx_messages_tenant_created
  ON public.messages (tenant_id, created_at DESC);

-- FKs quentes sem índice (joins e updates frequentes)
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_contact ON public.campaign_recipients (contact_id);
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_conversation ON public.campaign_recipients (conversation_id);
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_tenant ON public.campaign_recipients (tenant_id);
CREATE INDEX IF NOT EXISTS idx_activities_conversation ON public.activities (conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversations_opportunity ON public.conversations (opportunity_id) WHERE opportunity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_opportunities_contact ON public.opportunities (contact_id);
CREATE INDEX IF NOT EXISTS idx_flow_executions_conversation ON public.flow_executions (conversation_id);
CREATE INDEX IF NOT EXISTS idx_flow_executions_contact ON public.flow_executions (contact_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_messages_conversation ON public.scheduled_messages (conversation_id);
CREATE INDEX IF NOT EXISTS idx_stage_moves_from_stage ON public.stage_moves (from_stage_id);
CREATE INDEX IF NOT EXISTS idx_stage_moves_to_stage ON public.stage_moves (to_stage_id);
CREATE INDEX IF NOT EXISTS idx_stages_tenant ON public.stages (tenant_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_instances_tenant ON public.whatsapp_instances (tenant_id);
CREATE INDEX IF NOT EXISTS idx_conversation_reviews_conversation ON public.conversation_reviews (conversation_id);

-- FK webhook_events.job_id sem índice: cada DELETE em job_queue varria a tabela
-- inteira de webhook_events para validar a FK
CREATE INDEX IF NOT EXISTS idx_webhook_events_job ON public.webhook_events (job_id) WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_webhook_events_processed_created ON public.webhook_events (processed, created_at);
