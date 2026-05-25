-- 1) REPLICA IDENTITY FULL so realtime emits complete rows on UPDATEs
ALTER TABLE public.campaigns REPLICA IDENTITY FULL;
ALTER TABLE public.campaign_recipients REPLICA IDENTITY FULL;

-- NOTE: REPLICA IDENTITY FULL writes the whole row to WAL on every UPDATE/DELETE.
-- For campaign_recipients this can grow with volume. The AFTER trigger early-returns
-- when status didn't change, which minimizes downstream noise. In the future, if
-- volume justifies, consider switching to REPLICA IDENTITY USING INDEX with a
-- UNIQUE composite index instead of FULL.

-- 2) Add tables to supabase_realtime publication (defensive)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='campaigns'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.campaigns';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='campaign_recipients'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.campaign_recipients';
  END IF;
END$$;

-- 3) Incremental counter trigger
-- Coordination with reaper (reap_stuck_sending): the reaper moves 'sending' -> 'pending'.
-- Both ranks are < 2 (no sent/delivered/read/replied/failed bucket affected), so the
-- delta is zero by construction. If you ever change the rank table below, recheck this.
CREATE OR REPLACE FUNCTION public.tg_campaign_recipients_counters()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  d_sent int := 0;
  d_delivered int := 0;
  d_read int := 0;
  d_replied int := 0;
  d_failed int := 0;
  r_old int;
  r_new int;
BEGIN
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  r_old := CASE OLD.status
    WHEN 'pending' THEN 0 WHEN 'sending' THEN 1 WHEN 'skipped' THEN 1
    WHEN 'sent' THEN 2 WHEN 'failed' THEN 2
    WHEN 'delivered' THEN 3 WHEN 'read' THEN 4 WHEN 'replied' THEN 5
    ELSE 0 END;
  r_new := CASE NEW.status
    WHEN 'pending' THEN 0 WHEN 'sending' THEN 1 WHEN 'skipped' THEN 1
    WHEN 'sent' THEN 2 WHEN 'failed' THEN 2
    WHEN 'delivered' THEN 3 WHEN 'read' THEN 4 WHEN 'replied' THEN 5
    ELSE 0 END;

  -- sent_count: rank >= 2 excluding 'failed'
  IF r_old < 2 AND r_new >= 2 AND NEW.status <> 'failed' THEN d_sent := 1; END IF;
  IF r_old >= 2 AND r_new < 2 AND OLD.status <> 'failed' THEN d_sent := -1; END IF;

  -- delivered_count: rank >= 3
  IF r_old < 3 AND r_new >= 3 THEN d_delivered := 1; END IF;
  IF r_old >= 3 AND r_new < 3 THEN d_delivered := -1; END IF;

  -- read_count: rank >= 4
  IF r_old < 4 AND r_new >= 4 THEN d_read := 1; END IF;
  IF r_old >= 4 AND r_new < 4 THEN d_read := -1; END IF;

  -- replied_count: exact 'replied'
  IF OLD.status <> 'replied' AND NEW.status = 'replied' THEN d_replied := 1; END IF;
  IF OLD.status = 'replied' AND NEW.status <> 'replied' THEN d_replied := -1; END IF;

  -- failed_count: exact 'failed'
  IF OLD.status <> 'failed' AND NEW.status = 'failed' THEN d_failed := 1; END IF;
  IF OLD.status = 'failed' AND NEW.status <> 'failed' THEN d_failed := -1; END IF;

  IF d_sent <> 0 OR d_delivered <> 0 OR d_read <> 0 OR d_replied <> 0 OR d_failed <> 0 THEN
    UPDATE public.campaigns
       SET sent_count      = GREATEST(sent_count      + d_sent,      0),
           delivered_count = GREATEST(delivered_count + d_delivered, 0),
           read_count      = GREATEST(read_count      + d_read,      0),
           replied_count   = GREATEST(replied_count   + d_replied,   0),
           failed_count    = GREATEST(failed_count    + d_failed,    0),
           updated_at      = now()
     WHERE id = NEW.campaign_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_campaign_recipients_counters ON public.campaign_recipients;
CREATE TRIGGER trg_campaign_recipients_counters
AFTER INSERT OR UPDATE OF status ON public.campaign_recipients
FOR EACH ROW EXECUTE FUNCTION public.tg_campaign_recipients_counters();

-- 4) Anti-regression trigger
CREATE OR REPLACE FUNCTION public.tg_campaign_recipients_no_funnel_regress()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r_old int; r_new int;
BEGIN
  IF TG_OP <> 'UPDATE' OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  r_old := CASE OLD.status WHEN 'pending' THEN 0 WHEN 'sending' THEN 1
            WHEN 'skipped' THEN 1 WHEN 'sent' THEN 2 WHEN 'failed' THEN 2
            WHEN 'delivered' THEN 3 WHEN 'read' THEN 4 WHEN 'replied' THEN 5
            ELSE 0 END;
  r_new := CASE NEW.status WHEN 'pending' THEN 0 WHEN 'sending' THEN 1
            WHEN 'skipped' THEN 1 WHEN 'sent' THEN 2 WHEN 'failed' THEN 2
            WHEN 'delivered' THEN 3 WHEN 'read' THEN 4 WHEN 'replied' THEN 5
            ELSE 0 END;

  -- exception: reaper sending -> pending allowed
  IF OLD.status = 'sending' AND NEW.status = 'pending' THEN
    RETURN NEW;
  END IF;

  -- never regress from terminal 'failed'
  IF r_new < r_old AND OLD.status <> 'failed' THEN
    NEW.status := OLD.status;
    NEW.updated_at := OLD.updated_at;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_campaign_recipients_no_regress ON public.campaign_recipients;
CREATE TRIGGER trg_campaign_recipients_no_regress
BEFORE UPDATE OF status ON public.campaign_recipients
FOR EACH ROW EXECUTE FUNCTION public.tg_campaign_recipients_no_funnel_regress();

-- 5) Recompute helper
CREATE OR REPLACE FUNCTION public.recompute_campaign_counters(_campaign_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  UPDATE public.campaigns c SET
    sent_count      = COALESCE(s.sent, 0),
    delivered_count = COALESCE(s.delivered, 0),
    read_count      = COALESCE(s.read, 0),
    replied_count   = COALESCE(s.replied, 0),
    failed_count    = COALESCE(s.failed, 0),
    updated_at      = now()
  FROM (
    SELECT
      count(*) FILTER (WHERE status IN ('sent','delivered','read','replied'))   AS sent,
      count(*) FILTER (WHERE status IN ('delivered','read','replied'))          AS delivered,
      count(*) FILTER (WHERE status IN ('read','replied'))                      AS read,
      count(*) FILTER (WHERE status = 'replied')                                AS replied,
      count(*) FILTER (WHERE status = 'failed')                                 AS failed
    FROM public.campaign_recipients WHERE campaign_id = _campaign_id
  ) s
  WHERE c.id = _campaign_id;
$$;

GRANT EXECUTE ON FUNCTION public.recompute_campaign_counters(uuid) TO authenticated;

-- 6) Backfill (most recent first so interruptions still leave fresh data on top)
DO $$
DECLARE r record; t timestamptz := clock_timestamp();
BEGIN
  FOR r IN SELECT id FROM public.campaigns ORDER BY created_at DESC LOOP
    PERFORM public.recompute_campaign_counters(r.id);
  END LOOP;
  RAISE NOTICE 'campaign counters backfill done in %', clock_timestamp() - t;
END$$;