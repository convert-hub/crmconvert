-- Retenção automática de logs/filas (pg_cron, madrugada BRT)
-- (aplicada em produção via MCP em 2026-07-14; arquivo para versionamento)
--
-- Contexto: webhook_events tinha 412MB/250k payloads brutos acumulados,
-- job_queue 72k jobs concluídos e cron.job_run_details 314MB de histórico.
--   webhook_events (log bruto de payloads): 30 dias
--   job_queue concluídos/mortos: 30 dias
--   cron.job_run_details (histórico do pg_cron): 7 dias
DO $$ BEGIN PERFORM cron.unschedule('retencao-webhook-events'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('retencao-job-queue'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('retencao-cron-history'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule('retencao-webhook-events', '10 6 * * *',
  $$DELETE FROM public.webhook_events WHERE created_at < now() - interval '30 days'$$);
SELECT cron.schedule('retencao-job-queue', '20 6 * * *',
  $$DELETE FROM public.job_queue WHERE status IN ('done','dead') AND created_at < now() - interval '30 days'$$);
SELECT cron.schedule('retencao-cron-history', '30 6 * * *',
  $$DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days'$$);
