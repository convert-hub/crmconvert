
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS tick_lock_until timestamptz;

CREATE INDEX IF NOT EXISTS idx_campaign_recipients_claim
  ON public.campaign_recipients (campaign_id, created_at)
  WHERE status = 'pending';

-- Acquire lease (90s). Returns true if acquired.
CREATE OR REPLACE FUNCTION public.acquire_campaign_tick_lease(_campaign_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_locked uuid;
BEGIN
  UPDATE public.campaigns
     SET tick_lock_until = now() + interval '90 seconds'
   WHERE id = _campaign_id
     AND (tick_lock_until IS NULL OR tick_lock_until < now())
  RETURNING id INTO v_locked;

  RETURN v_locked IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_campaign_tick_lease(_campaign_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.campaigns SET tick_lock_until = NULL WHERE id = _campaign_id;
$$;

CREATE OR REPLACE FUNCTION public.claim_campaign_recipients(_campaign_id uuid, _limit int)
RETURNS TABLE(id uuid, contact_id uuid, variables_used jsonb)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.campaign_recipients
     SET status = 'sending', updated_at = now()
   WHERE id IN (
     SELECT cr.id FROM public.campaign_recipients cr
      WHERE cr.campaign_id = _campaign_id AND cr.status = 'pending'
      ORDER BY cr.created_at ASC
      LIMIT _limit
      FOR UPDATE SKIP LOCKED
   )
  RETURNING campaign_recipients.id, campaign_recipients.contact_id, campaign_recipients.variables_used;
$$;

CREATE OR REPLACE FUNCTION public.reap_stuck_sending(_campaign_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.campaign_recipients
     SET status = 'pending', updated_at = now()
   WHERE campaign_id = _campaign_id
     AND status = 'sending'
     AND updated_at < now() - interval '10 minutes';
$$;

REVOKE ALL ON FUNCTION public.acquire_campaign_tick_lease(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_campaign_tick_lease(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_campaign_recipients(uuid, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reap_stuck_sending(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.acquire_campaign_tick_lease(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_campaign_tick_lease(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_campaign_recipients(uuid, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.reap_stuck_sending(uuid) TO service_role;
