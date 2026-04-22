-- Remove existing job if present
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'campaigns-tick-every-minute') THEN
    PERFORM cron.unschedule('campaigns-tick-every-minute');
  END IF;
END $$;

-- Schedule campaign auto-dispatch every minute
SELECT cron.schedule(
  'campaigns-tick-every-minute',
  '* * * * *',
  $$
  WITH due AS (
    SELECT id, status FROM public.campaigns
    WHERE (status = 'scheduled' AND scheduled_at <= now())
       OR status = 'running'
    LIMIT 20
  )
  SELECT net.http_post(
    url := 'https://zhywwrhzaqfcjcwywkwf.supabase.co/functions/v1/campaign-dispatch',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpoeXd3cmh6YXFmY2pjd3l3a3dmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1NTMwMzQsImV4cCI6MjA4NzEyOTAzNH0.ug2WalWQHWWG6I7Hzu2-GGTlsmbKlkWtez1nKkp4U1Y"}'::jsonb,
    body := jsonb_build_object(
      'action', CASE WHEN due.status = 'scheduled' THEN 'start' ELSE 'tick' END,
      'campaign_id', due.id
    )
  )
  FROM due;
  $$
);