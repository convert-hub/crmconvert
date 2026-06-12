
ALTER TABLE public.webhook_events
  ADD COLUMN IF NOT EXISTS external_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_webhook_events_tenant_source_extid
  ON public.webhook_events(tenant_id, source, external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_opportunities_tenant_contact_open
  ON public.opportunities(tenant_id, contact_id)
  WHERE status = 'open';
