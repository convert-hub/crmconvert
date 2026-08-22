-- =====================================================================
-- Segredos no Supabase Vault — parte 1/2: infraestrutura (INERTE)
-- Revisão de segurança 2026-08-16, achado A1.
-- =====================================================================
-- Problema: as colunas *_encrypted (tokens UAZAPI/Meta, app secret da Meta,
-- chaves OpenAI) guardavam o valor em TEXTO PURO. A RLS impedia um tenant de
-- ver o de outro, mas qualquer acesso com service_role, um backup ou uma
-- regressão de RLS entregava todos os tokens de uma vez.
--
-- Modelo: a coluna passa a guardar só a referência "vault:<uuid>"; o valor
-- cifrado vive em vault.secrets. Quem ESCREVE não muda nada (frontend e
-- uazapi-proxy continuam gravando o texto na coluna): um trigger BEFORE
-- INSERT/UPDATE move o valor para o cofre e troca pela referência. Quem LÊ
-- (edge functions e worker, sempre service_role) chama reveal_secret(ref).
--
-- Esta migration só CRIA as funções — não anexa trigger nem converte dados.
-- Aplicá-la não muda comportamento algum. A ativação (triggers + backfill)
-- está em 20260822120100_vault_segredos_ativacao.sql e SÓ pode rodar depois
-- que edge functions e worker desta entrega estiverem publicados.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) reveal_secret — única porta de leitura
-- ---------------------------------------------------------------------
-- SECURITY DEFINER (dono postgres, que tem acesso ao vault). Só service_role
-- executa: anon/authenticated nunca conseguem revelar um segredo, mesmo
-- tendo a referência. Valor legado em texto puro passa direto — é o que
-- permite publicar os leitores antes da ativação.
CREATE OR REPLACE FUNCTION public.reveal_secret(_ref text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _val text;
BEGIN
  IF _ref IS NULL OR _ref = '' THEN
    RETURN NULL;
  END IF;
  IF left(_ref, 6) <> 'vault:' THEN
    RETURN _ref;  -- legado (texto puro, anterior à ativação)
  END IF;
  SELECT decrypted_secret INTO _val
  FROM vault.decrypted_secrets
  WHERE id = substr(_ref, 7)::uuid;
  RETURN _val;
END;
$function$;

COMMENT ON FUNCTION public.reveal_secret(text) IS
  'Revela um segredo do Vault a partir da referência "vault:<uuid>" guardada na coluna *_encrypted. Só service_role.';

REVOKE ALL ON FUNCTION public.reveal_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reveal_secret(text) TO service_role;


-- ---------------------------------------------------------------------
-- 2) vault_store — grava/atualiza/apaga um segredo e devolve a referência
-- ---------------------------------------------------------------------
-- Usada só pelos triggers abaixo (ninguém executa diretamente).
--   _prev: valor anterior da coluna (NULL em INSERT)
--   _val : valor novo vindo do escritor (texto puro ou já uma referência)
--   _name: nome único no cofre (tabela.coluna.id_da_linha)
CREATE OR REPLACE FUNCTION public.vault_store(_prev text, _val text, _name text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _id uuid;
BEGIN
  -- Coluna limpa: remove o segredo antigo do cofre.
  IF _val IS NULL OR _val = '' THEN
    IF _prev LIKE 'vault:%' THEN
      DELETE FROM vault.secrets WHERE id = substr(_prev, 7)::uuid;
    END IF;
    RETURN _val;
  END IF;

  -- Já é referência (UPDATE que não mexeu na coluna): nada a fazer.
  IF _val LIKE 'vault:%' THEN
    RETURN _val;
  END IF;

  -- Troca de segredo numa linha que já tinha referência: atualiza no lugar.
  IF _prev LIKE 'vault:%'
     AND EXISTS (SELECT 1 FROM vault.secrets WHERE id = substr(_prev, 7)::uuid) THEN
    PERFORM vault.update_secret(substr(_prev, 7)::uuid, _val);
    RETURN _prev;
  END IF;

  -- Novo segredo. O nome é único no cofre; remove órfão homônimo antes.
  DELETE FROM vault.secrets WHERE name = _name;
  _id := vault.create_secret(_val, _name);
  RETURN 'vault:' || _id::text;
END;
$function$;

REVOKE ALL ON FUNCTION public.vault_store(text, text, text) FROM PUBLIC, anon, authenticated, service_role;


-- ---------------------------------------------------------------------
-- 3) Triggers BEFORE INSERT/UPDATE (um por tabela, colunas explícitas)
-- ---------------------------------------------------------------------
-- SECURITY DEFINER porque o escritor pode ser um usuário authenticated
-- (frontend gravando token da Meta) e o corpo precisa chegar ao cofre.
-- CASE ... THEN OLD.x só é avaliado em UPDATE (em INSERT, OLD não existe).
CREATE OR REPLACE FUNCTION public.tg_vault_whatsapp_instances()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _upd boolean := (TG_OP = 'UPDATE');
BEGIN
  NEW.api_token_encrypted := public.vault_store(
    CASE WHEN _upd THEN OLD.api_token_encrypted END, NEW.api_token_encrypted,
    'whatsapp_instances.api_token_encrypted.' || NEW.id);
  NEW.meta_access_token_encrypted := public.vault_store(
    CASE WHEN _upd THEN OLD.meta_access_token_encrypted END, NEW.meta_access_token_encrypted,
    'whatsapp_instances.meta_access_token_encrypted.' || NEW.id);
  NEW.meta_app_secret_encrypted := public.vault_store(
    CASE WHEN _upd THEN OLD.meta_app_secret_encrypted END, NEW.meta_app_secret_encrypted,
    'whatsapp_instances.meta_app_secret_encrypted.' || NEW.id);
  NEW.webhook_secret := public.vault_store(
    CASE WHEN _upd THEN OLD.webhook_secret END, NEW.webhook_secret,
    'whatsapp_instances.webhook_secret.' || NEW.id);
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_vault_global_api_keys()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.api_key_encrypted := public.vault_store(
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.api_key_encrypted END, NEW.api_key_encrypted,
    'global_api_keys.api_key_encrypted.' || NEW.id);
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_vault_ai_configs()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.api_key_encrypted := public.vault_store(
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.api_key_encrypted END, NEW.api_key_encrypted,
    'ai_configs.api_key_encrypted.' || NEW.id);
  RETURN NEW;
END;
$function$;

-- AFTER DELETE genérico: colunas vêm como argumentos do trigger.
-- Apagar a linha apaga os segredos dela no cofre (sem isso ficariam órfãos).
CREATE OR REPLACE FUNCTION public.tg_vault_delete_secrets()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _col text;
  _ref text;
  _row jsonb := to_jsonb(OLD);
BEGIN
  FOREACH _col IN ARRAY TG_ARGV LOOP
    _ref := _row->>_col;
    IF _ref LIKE 'vault:%' THEN
      DELETE FROM vault.secrets WHERE id = substr(_ref, 7)::uuid;
    END IF;
  END LOOP;
  RETURN OLD;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_vault_whatsapp_instances() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_vault_global_api_keys() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_vault_ai_configs() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_vault_delete_secrets() FROM PUBLIC, anon, authenticated;


-- ---------------------------------------------------------------------
-- 4) Limpeza do token UAZAPI gravado em logs (achado C3, dados históricos)
-- ---------------------------------------------------------------------
-- Todo evento da UAZAPI traz o token da instância no corpo, e o webhook
-- gravava o corpo inteiro em webhook_events.raw_payload (93k linhas) e em
-- messages.provider_metadata (143k linhas) — ambos legíveis por qualquer
-- membro do tenant. O webhook novo remove o token antes de gravar; esta
-- função remove dos registros já existentes.
--
-- Em lotes e de madrugada: messages está na publicação realtime, e uma única
-- UPDATE de 143k linhas geraria uma rajada de eventos para os navegadores
-- abertos. 2.000 mensagens/min na janela 02:00–04:59 BRT limpa tudo em uma
-- noite. O job é barato quando não há mais nada a fazer e pode ser removido
-- depois: SELECT cron.unschedule('scrub-uazapi-tokens');
CREATE OR REPLACE FUNCTION public.scrub_uazapi_tokens_batch(_msg_limit integer DEFAULT 2000, _evt_limit integer DEFAULT 10000)
 RETURNS TABLE(messages_scrubbed integer, events_scrubbed integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _m integer;
  _e integer;
BEGIN
  WITH c AS (
    SELECT id FROM public.messages WHERE provider_metadata ? 'token' LIMIT _msg_limit
  )
  UPDATE public.messages p SET provider_metadata = p.provider_metadata - 'token'
  FROM c WHERE p.id = c.id;
  GET DIAGNOSTICS _m = ROW_COUNT;

  WITH c AS (
    SELECT id FROM public.webhook_events WHERE source = 'uazapi' AND raw_payload ? 'token' LIMIT _evt_limit
  )
  UPDATE public.webhook_events p SET raw_payload = p.raw_payload - 'token'
  FROM c WHERE p.id = c.id;
  GET DIAGNOSTICS _e = ROW_COUNT;

  RETURN QUERY SELECT _m, _e;
END;
$function$;

REVOKE ALL ON FUNCTION public.scrub_uazapi_tokens_batch(integer, integer) FROM PUBLIC, anon, authenticated;

DO $$ BEGIN PERFORM cron.unschedule('scrub-uazapi-tokens'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('scrub-uazapi-tokens', '* 5-7 * * *',
  $$SELECT public.scrub_uazapi_tokens_batch()$$);
