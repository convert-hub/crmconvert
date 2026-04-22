-- Enable pg_cron and pg_net for scheduled campaign dispatch
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Index to speed up scheduled-campaign lookups
CREATE INDEX IF NOT EXISTS idx_campaigns_scheduled_lookup
  ON public.campaigns (status, scheduled_at)
  WHERE status IN ('scheduled', 'running');

-- Index to speed up recipient delivery updates from webhook
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_provider_msg
  ON public.campaign_recipients (tenant_id, provider_message_id)
  WHERE provider_message_id IS NOT NULL;