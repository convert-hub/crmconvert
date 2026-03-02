
-- Enable pg_cron and pg_net for scheduled message processing
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Schedule check-scheduled-messages every minute
SELECT cron.schedule(
  'check-scheduled-messages',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://zhywwrhzaqfcjcwywkwf.supabase.co/functions/v1/check-scheduled-messages',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpoeXd3cmh6YXFmY2pjd3l3a3dmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1NTMwMzQsImV4cCI6MjA4NzEyOTAzNH0.ug2WalWQHWWG6I7Hzu2-GGTlsmbKlkWtez1nKkp4U1Y"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
