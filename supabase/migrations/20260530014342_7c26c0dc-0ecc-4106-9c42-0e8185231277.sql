-- Idempotência para webhooks inbound da Meta:
-- impede duplicatas quando a Meta reenvia o mesmo provider_message_id.

BEGIN;

-- Remove duplicatas existentes (somente inbound, mesma provider_message_id no mesmo tenant)
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY tenant_id, provider_message_id
           ORDER BY created_at ASC, id ASC
         ) AS rn
  FROM public.messages
  WHERE direction = 'inbound' AND provider_message_id IS NOT NULL
)
DELETE FROM public.messages
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Índice único parcial: impede inserção duplicada futura
CREATE UNIQUE INDEX IF NOT EXISTS messages_inbound_provider_unique
  ON public.messages (tenant_id, provider_message_id)
  WHERE provider_message_id IS NOT NULL AND direction = 'inbound';

COMMIT;