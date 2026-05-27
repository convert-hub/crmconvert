-- Migration 2 (PENDING — revisar antes de aplicar manualmente via SQL Editor)
-- Dedupa contatos por (tenant_id, phone) reapontando 5 FKs e mesclando campos.
--
-- FKs detectadas em public.contacts.id:
--   conversations.contact_id       ON DELETE SET NULL
--   opportunities.contact_id       ON DELETE SET NULL
--   activities.contact_id          ON DELETE SET NULL
--   flow_executions.contact_id     ON DELETE SET NULL
--   campaign_recipients.contact_id ON DELETE CASCADE   <-- CRÍTICO: reapontar antes de deletar
--
-- Idempotente: rodar duas vezes não destrói nada (na 2ª passada não restam duplicatas).
-- NÃO inclui CREATE UNIQUE INDEX — isso fica para a Migration 3.

BEGIN;

-- Eleição do contato canônico por (tenant_id, phone):
--   1) mais antigo (MIN created_at)
--   2) desempate: source NULL ou NOT LIKE 'whatsapp_%' (cadastro manual) vence sobre webhook
WITH ranked AS (
  SELECT
    id,
    tenant_id,
    phone,
    name,
    email,
    notes,
    utm_source, utm_medium, utm_campaign, utm_content, utm_term,
    ad_id, adset_id, campaign_id,
    avatar_url,
    custom_fields,
    company_id,
    assigned_to,
    ROW_NUMBER() OVER (
      PARTITION BY tenant_id, phone
      ORDER BY
        CASE WHEN source IS NULL OR source NOT LIKE 'whatsapp_%' THEN 0 ELSE 1 END,
        created_at ASC,
        id ASC
    ) AS rn,
    FIRST_VALUE(id) OVER (
      PARTITION BY tenant_id, phone
      ORDER BY
        CASE WHEN source IS NULL OR source NOT LIKE 'whatsapp_%' THEN 0 ELSE 1 END,
        created_at ASC,
        id ASC
    ) AS canonical_id
  FROM public.contacts
  WHERE phone IS NOT NULL AND phone <> ''
),
dups AS (
  SELECT id AS dup_id, canonical_id, tenant_id, phone,
         name, email, notes, utm_source, utm_medium, utm_campaign,
         utm_content, utm_term, ad_id, adset_id, campaign_id,
         avatar_url, custom_fields, company_id, assigned_to
    FROM ranked
   WHERE rn > 1
),
dup_map AS (
  SELECT dup_id, canonical_id FROM dups
)
SELECT count(*) AS dups_found INTO TEMP TABLE _dedup_report FROM dups;

-- 1) Reapontar FKs
UPDATE public.conversations c
   SET contact_id = dm.canonical_id
  FROM (SELECT dup_id, canonical_id FROM ranked WHERE rn > 1) dm
 WHERE c.contact_id = dm.dup_id;

UPDATE public.opportunities o
   SET contact_id = dm.canonical_id
  FROM (SELECT dup_id, canonical_id FROM ranked WHERE rn > 1) dm
 WHERE o.contact_id = dm.dup_id;

UPDATE public.activities a
   SET contact_id = dm.canonical_id
  FROM (SELECT dup_id, canonical_id FROM ranked WHERE rn > 1) dm
 WHERE a.contact_id = dm.dup_id;

UPDATE public.flow_executions fe
   SET contact_id = dm.canonical_id
  FROM (SELECT dup_id, canonical_id FROM ranked WHERE rn > 1) dm
 WHERE fe.contact_id = dm.dup_id;

UPDATE public.campaign_recipients cr
   SET contact_id = dm.canonical_id
  FROM (SELECT dup_id, canonical_id FROM ranked WHERE rn > 1) dm
 WHERE cr.contact_id = dm.dup_id;

-- 2) Mesclar campos úteis do duplicado para o canônico (sem sobrescrever info melhor existente)
UPDATE public.contacts c SET
    name         = COALESCE(NULLIF(c.name, c.phone), d.name, c.name),
    email        = COALESCE(c.email, d.email),
    notes        = COALESCE(c.notes, d.notes),
    utm_source   = COALESCE(c.utm_source, d.utm_source),
    utm_medium   = COALESCE(c.utm_medium, d.utm_medium),
    utm_campaign = COALESCE(c.utm_campaign, d.utm_campaign),
    utm_content  = COALESCE(c.utm_content, d.utm_content),
    utm_term     = COALESCE(c.utm_term, d.utm_term),
    ad_id        = COALESCE(c.ad_id, d.ad_id),
    adset_id     = COALESCE(c.adset_id, d.adset_id),
    campaign_id  = COALESCE(c.campaign_id, d.campaign_id),
    avatar_url   = COALESCE(c.avatar_url, d.avatar_url),
    company_id   = COALESCE(c.company_id, d.company_id),
    assigned_to  = COALESCE(c.assigned_to, d.assigned_to),
    custom_fields = COALESCE(d.custom_fields, '{}'::jsonb) || COALESCE(c.custom_fields, '{}'::jsonb)
  FROM (
    SELECT canonical_id, name, email, notes,
           utm_source, utm_medium, utm_campaign, utm_content, utm_term,
           ad_id, adset_id, campaign_id, avatar_url, company_id,
           assigned_to, custom_fields
      FROM ranked
     WHERE rn > 1
  ) d
 WHERE c.id = d.canonical_id;

-- 3) Deletar duplicados (já não referenciados; CASCADE em campaign_recipients seguro porque reapontamos antes)
DELETE FROM public.contacts
 WHERE id IN (SELECT dup_id FROM ranked WHERE rn > 1);

SELECT * FROM _dedup_report;

COMMIT;
