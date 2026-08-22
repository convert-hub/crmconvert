-- =====================================================================
-- Segredos no Supabase Vault — parte 2/2: ATIVAÇÃO
-- =====================================================================
-- ⚠️  ORDEM DE PUBLICAÇÃO (obrigatória):
--   1) publicar as edge functions e o worker desta entrega — eles leem os
--      segredos via reveal_secret() e aceitam tanto texto puro quanto
--      referência "vault:<uuid>";
--   2) SÓ ENTÃO aplicar esta migration.
--
-- Antes dela, nada muda (20260822120000 é inerte). Depois dela, as colunas
-- *_encrypted passam a conter "vault:<uuid>": código ANTIGO que lia o valor
-- direto da coluna deixaria de autenticar na UAZAPI, na Meta e na OpenAI
-- (envio e recebimento de WhatsApp e IA parariam até o deploy).
--
-- Depois de aplicada, recomenda-se ROTACIONAR os tokens (Meta, OpenAI,
-- UAZAPI): os valores antigos passaram meses em texto puro no banco.
-- =====================================================================

-- 1) Triggers de escrita (encaixam o cofre sem mudar quem grava)
DROP TRIGGER IF EXISTS vault_secrets_whatsapp_instances ON public.whatsapp_instances;
CREATE TRIGGER vault_secrets_whatsapp_instances
  BEFORE INSERT OR UPDATE ON public.whatsapp_instances
  FOR EACH ROW EXECUTE FUNCTION public.tg_vault_whatsapp_instances();

DROP TRIGGER IF EXISTS vault_secrets_global_api_keys ON public.global_api_keys;
CREATE TRIGGER vault_secrets_global_api_keys
  BEFORE INSERT OR UPDATE ON public.global_api_keys
  FOR EACH ROW EXECUTE FUNCTION public.tg_vault_global_api_keys();

DROP TRIGGER IF EXISTS vault_secrets_ai_configs ON public.ai_configs;
CREATE TRIGGER vault_secrets_ai_configs
  BEFORE INSERT OR UPDATE ON public.ai_configs
  FOR EACH ROW EXECUTE FUNCTION public.tg_vault_ai_configs();

-- 2) Triggers de limpeza (apagar a linha apaga os segredos dela no cofre)
DROP TRIGGER IF EXISTS vault_cleanup_whatsapp_instances ON public.whatsapp_instances;
CREATE TRIGGER vault_cleanup_whatsapp_instances
  AFTER DELETE ON public.whatsapp_instances
  FOR EACH ROW EXECUTE FUNCTION public.tg_vault_delete_secrets(
    'api_token_encrypted', 'meta_access_token_encrypted', 'meta_app_secret_encrypted', 'webhook_secret');

DROP TRIGGER IF EXISTS vault_cleanup_global_api_keys ON public.global_api_keys;
CREATE TRIGGER vault_cleanup_global_api_keys
  AFTER DELETE ON public.global_api_keys
  FOR EACH ROW EXECUTE FUNCTION public.tg_vault_delete_secrets('api_key_encrypted');

DROP TRIGGER IF EXISTS vault_cleanup_ai_configs ON public.ai_configs;
CREATE TRIGGER vault_cleanup_ai_configs
  AFTER DELETE ON public.ai_configs
  FOR EACH ROW EXECUTE FUNCTION public.tg_vault_delete_secrets('api_key_encrypted');

-- 3) Backfill: um UPDATE "no lugar" faz o trigger mover cada valor em texto
--    puro para o cofre. Linhas já convertidas (vault:%) são ignoradas pelo
--    vault_store.
UPDATE public.whatsapp_instances
   SET api_token_encrypted = api_token_encrypted
 WHERE (api_token_encrypted IS NOT NULL AND api_token_encrypted <> '' AND api_token_encrypted NOT LIKE 'vault:%')
    OR (meta_access_token_encrypted IS NOT NULL AND meta_access_token_encrypted <> '' AND meta_access_token_encrypted NOT LIKE 'vault:%')
    OR (meta_app_secret_encrypted IS NOT NULL AND meta_app_secret_encrypted <> '' AND meta_app_secret_encrypted NOT LIKE 'vault:%')
    OR (webhook_secret IS NOT NULL AND webhook_secret <> '' AND webhook_secret NOT LIKE 'vault:%');

UPDATE public.global_api_keys
   SET api_key_encrypted = api_key_encrypted
 WHERE api_key_encrypted IS NOT NULL AND api_key_encrypted <> '' AND api_key_encrypted NOT LIKE 'vault:%';

UPDATE public.ai_configs
   SET api_key_encrypted = api_key_encrypted
 WHERE api_key_encrypted IS NOT NULL AND api_key_encrypted <> '' AND api_key_encrypted NOT LIKE 'vault:%';

-- 4) Verificação: nenhum segredo pode ter sobrado em texto puro.
DO $$
DECLARE
  _n integer;
BEGIN
  SELECT count(*) INTO _n FROM (
    SELECT 1 FROM public.whatsapp_instances
     WHERE (api_token_encrypted IS NOT NULL AND api_token_encrypted <> '' AND api_token_encrypted NOT LIKE 'vault:%')
        OR (meta_access_token_encrypted IS NOT NULL AND meta_access_token_encrypted <> '' AND meta_access_token_encrypted NOT LIKE 'vault:%')
        OR (meta_app_secret_encrypted IS NOT NULL AND meta_app_secret_encrypted <> '' AND meta_app_secret_encrypted NOT LIKE 'vault:%')
        OR (webhook_secret IS NOT NULL AND webhook_secret <> '' AND webhook_secret NOT LIKE 'vault:%')
    UNION ALL
    SELECT 1 FROM public.global_api_keys
     WHERE api_key_encrypted IS NOT NULL AND api_key_encrypted <> '' AND api_key_encrypted NOT LIKE 'vault:%'
    UNION ALL
    SELECT 1 FROM public.ai_configs
     WHERE api_key_encrypted IS NOT NULL AND api_key_encrypted <> '' AND api_key_encrypted NOT LIKE 'vault:%'
  ) s;
  IF _n > 0 THEN
    RAISE EXCEPTION 'Backfill do Vault incompleto: % segredo(s) ainda em texto puro', _n;
  END IF;
END $$;
