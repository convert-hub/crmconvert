ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS ctwa_clid text;
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS ctwa_clid text;
ALTER TABLE public.opportunities ADD COLUMN IF NOT EXISTS ctwa_clid text;
CREATE INDEX IF NOT EXISTS idx_contacts_ctwa_clid ON public.contacts(ctwa_clid) WHERE ctwa_clid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conversations_ctwa_clid ON public.conversations(ctwa_clid) WHERE ctwa_clid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_opportunities_ctwa_clid ON public.opportunities(ctwa_clid) WHERE ctwa_clid IS NOT NULL;