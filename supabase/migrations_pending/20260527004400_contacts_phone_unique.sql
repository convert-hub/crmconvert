-- Migration 3 (PENDING — aplicar via SQL Editor APÓS a Migration 2 ser rodada e revisada).
-- Adiciona índice único parcial e trigger defensivo que re-normaliza phone antes de cada write.

BEGIN;

-- Índice único parcial (sem CONCURRENTLY para rodar dentro de transação)
CREATE UNIQUE INDEX IF NOT EXISTS contacts_tenant_phone_unique
  ON public.contacts (tenant_id, phone)
  WHERE phone IS NOT NULL AND phone <> '';

-- Trigger defensivo: garante que qualquer write futuro armazene phone normalizado
CREATE OR REPLACE FUNCTION public.tg_contacts_normalize_phone()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.phone IS NOT NULL THEN
    NEW.phone := public.normalize_brazil_phone(NEW.phone);
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.tg_contacts_normalize_phone() SET search_path = pg_catalog, public;

DROP TRIGGER IF EXISTS trg_contacts_normalize_phone ON public.contacts;
CREATE TRIGGER trg_contacts_normalize_phone
BEFORE INSERT OR UPDATE OF phone ON public.contacts
FOR EACH ROW EXECUTE FUNCTION public.tg_contacts_normalize_phone();

COMMIT;
