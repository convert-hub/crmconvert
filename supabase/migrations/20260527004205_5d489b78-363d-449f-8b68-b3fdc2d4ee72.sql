-- Migration 1: normalize_brazil_phone() function + backfill contacts.phone
-- Paridade com src/lib/phone.ts e supabase/functions/_shared/phone.ts.

CREATE OR REPLACE FUNCTION public.normalize_brazil_phone(input text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  d text;
  ddd text;
  first_local text;
  valid_ddds text[] := ARRAY[
    '11','12','13','14','15','16','17','18','19',
    '21','22','24','27','28',
    '31','32','33','34','35','37','38',
    '41','42','43','44','45','46','47','48','49',
    '51','53','54','55',
    '61','62','63','64','65','66','67','68','69',
    '71','73','74','75','77','79',
    '81','82','83','84','85','86','87','88','89',
    '91','92','93','94','95','96','97','98','99'
  ];
BEGIN
  IF input IS NULL THEN RETURN ''; END IF;
  d := regexp_replace(input, '\D', '', 'g');
  IF length(d) = 0 THEN RETURN ''; END IF;
  d := regexp_replace(d, '^0+', '');
  IF length(d) < 8 THEN RETURN ''; END IF;

  -- 55 + 12 dígitos com 5º ∈ {6,7,8,9}: inserir 9 após DDD
  IF length(d) = 12 AND left(d, 2) = '55' THEN
    ddd := substring(d, 3, 2);
    first_local := substring(d, 5, 1);
    IF ddd = ANY(valid_ddds) AND first_local ~ '[6789]' THEN
      RETURN '55' || ddd || '9' || substring(d, 5);
    END IF;
    RETURN d;
  END IF;

  -- 55 + 13: já normalizado
  IF length(d) = 13 AND left(d, 2) = '55' THEN
    RETURN d;
  END IF;

  -- 11 dígitos com DDD válido + celular (3º dígito = 9)
  IF length(d) = 11 THEN
    ddd := substring(d, 1, 2);
    IF ddd = ANY(valid_ddds) AND substring(d, 3, 1) = '9' THEN
      RETURN '55' || d;
    END IF;
  END IF;

  -- 10 dígitos com DDD válido + local 6..9
  IF length(d) = 10 THEN
    ddd := substring(d, 1, 2);
    first_local := substring(d, 3, 1);
    IF ddd = ANY(valid_ddds) AND first_local ~ '[6789]' THEN
      RETURN '55' || ddd || '9' || substring(d, 3);
    END IF;
  END IF;

  RETURN d;
END;
$$;

-- Backup da coluna antes do backfill
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS phone_raw_pre_normalization text;
UPDATE public.contacts
   SET phone_raw_pre_normalization = phone
 WHERE phone_raw_pre_normalization IS NULL;

-- Backfill
UPDATE public.contacts
   SET phone = public.normalize_brazil_phone(phone)
 WHERE phone IS NOT NULL
   AND phone <> ''
   AND phone <> public.normalize_brazil_phone(phone);