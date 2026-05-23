## Objetivo

Eliminar race condition no `campaign-dispatch` (cron + clique manual em paralelo) sem alterar payload Meta, RLS, schema de `campaigns` (exceto adicionar uma coluna de lease), `wa-meta-send`, `webhook-meta`, nem a UI.

## Decisão técnica (correções ao plano anterior)

- `pg_try_advisory_xact_lock` via `supabase.rpc()` é inútil aqui: o lock é da transação da própria RPC e libera imediatamente no retorno. **Substituir** por lease em coluna que sobrevive a timeout da edge function.
- Trigger `trg_campaign_recipients_updated_at` já existe (confirmado em `20260421233833_*.sql`), então o reaper baseado em `updated_at` funciona — apenas reusar.

## Migration `supabase/migrations/<timestamp>_campaign_dispatch_concurrency.sql`

### Coluna de lease

```sql
ALTER TABLE public.campaigns
  ADD COLUMN tick_lock_until timestamptz;
```

Nullable, sem default. Não toca em RLS nem em índices existentes.

### Índice parcial para claim

```sql
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_claim
  ON public.campaign_recipients (campaign_id, created_at)
  WHERE status = 'pending';
```

### RPC `acquire_campaign_tick_lease(_campaign_id uuid) RETURNS boolean`

`SECURITY DEFINER`, `search_path=public`.

```sql
UPDATE public.campaigns
   SET tick_lock_until = now() + interval '90 seconds'
 WHERE id = _campaign_id
   AND (tick_lock_until IS NULL OR tick_lock_until < now())
RETURNING 1;
-- retorna true se afetou linha, false caso contrário
```

### RPC `release_campaign_tick_lease(_campaign_id uuid) RETURNS void`

```sql
UPDATE public.campaigns SET tick_lock_until = NULL WHERE id = _campaign_id;
```

### RPC `claim_campaign_recipients(_campaign_id uuid, _limit int)`

`SECURITY DEFINER`, `search_path=public`. Retorna `TABLE(id uuid, contact_id uuid, variables_used jsonb)`.

```sql
UPDATE public.campaign_recipients
   SET status = 'sending', updated_at = now()
 WHERE id IN (
   SELECT id FROM public.campaign_recipients
    WHERE campaign_id = _campaign_id AND status = 'pending'
    ORDER BY created_at ASC
    LIMIT _limit
    FOR UPDATE SKIP LOCKED
 )
RETURNING id, contact_id, variables_used;
```

### RPC `reap_stuck_sending(_campaign_id uuid) RETURNS void`

```sql
UPDATE public.campaign_recipients
   SET status = 'pending', updated_at = now()
 WHERE campaign_id = _campaign_id
   AND status = 'sending'
   AND updated_at < now() - interval '10 minutes';
```

(Trigger BEFORE UPDATE em `campaign_recipients` já mantém `updated_at`; o `SET updated_at = now()` é defensivo.)

### Permissões

Para as 4 RPCs:

```sql
REVOKE ALL ON FUNCTION public.<fn>(...) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.<fn>(...) TO service_role;
```

## `supabase/functions/campaign-dispatch/index.ts`

Comentário no topo: "múltiplas invocações concorrentes (cron + manual) são esperadas; segurança via lease em `campaigns.tick_lock_until` + `claim_campaign_recipients` com `FOR UPDATE SKIP LOCKED`."

Ordem no handler, depois de carregar `campaign` e validar `instance`/`template`:

1. **Adquirir lease**:
  ```ts
   const { data: gotLease } = await supabase.rpc('acquire_campaign_tick_lease', { _campaign_id: campaignId });
   if (!gotLease) return jsonOk({ ok: true, skipped: 'locked', processed: 0 });
  ```
2. **Try/finally** garantindo release:
  ```ts
   try {
     // 3 + 4 + 5 abaixo
   } finally {
     await supabase.rpc('release_campaign_tick_lease', { _campaign_id: campaignId });
   }
  ```
3. **Reaper** (só o dono do lease recicla):
  ```ts
   await supabase.rpc('reap_stuck_sending', { _campaign_id: campaignId });
  ```
4. **Claim atômico** (substitui o `SELECT pending`):
  ```ts
   const { data: claimed } = await supabase.rpc('claim_campaign_recipients',
     { _campaign_id: campaignId, _limit: throttle });
  ```
   Auto-complete preservado: se `claimed` vazio, manter a lógica atual que checa se ainda há `pending|sending` e, se não, marca `completed`.
5. **Hidratar contatos preservando FIFO**:
  ```ts
   const ids = (claimed ?? []).map((r:any) => r.id);
   const { data: pending } = await supabase
     .from('campaign_recipients')
     .select('id, contact_id, variables_used, contact:contacts(id, name, phone, email, do_not_contact, consent_given)')
     .in('id', ids)
     .order('created_at', { ascending: true });
  ```
6. **Remover** o `UPDATE ... status='sending'` que existia dentro do loop antes do envio (o claim já fez). Manter apenas os `UPDATE` finais por recipient para `sent`/`failed`/`skipped` e os contadores agregados.

Nomes de parâmetros padronizados com underscore (`_campaign_id`, `_limit`) tanto no SQL quanto nas chamadas `supabase.rpc(...)`.

## Cron

Sem mudanças no SQL do `campaigns-tick-every-minute`. Proteção 100% dentro da função.

## Fora de escopo

- Payload Meta, `wa-meta-send`, `webhook-meta`.
- RLS, demais colunas de `campaigns`, schema de `campaign_recipients`.
- UI / frontend.
- Deploy automático ou validação contra ambiente rodando — apenas escrever o código e avisar.

## Critério de pronto

- 2 invocações simultâneas na mesma campanha: 1 retorna `processed>0`, a outra `{skipped:'locked'}`.
- Nenhum `campaign_recipient` é enviado em duplicado (garantido por `UPDATE...RETURNING` + `FOR UPDATE SKIP LOCKED`).
- Edge function caindo no meio do tick: o lease vence em 90 s e os `sending` zumbis voltam para `pending` após 10 min via `reap_stuck_sending` no próximo tick válido.  
  
Plano aprovado, com 3 microajustes obrigatórios antes de gerar:
  1. Padronize TODOS os parâmetros das RPCs como *campaign*id e _limit
     (com underscore), tanto no SQL quanto em supabase.rpc({...}).
     Não use "campaignid".
  2. acquire_campaign_tick_lease deve ser LANGUAGE plpgsql RETURNS boolean,
     capturando o id atualizado em variável local com RETURNING id INTO
     v_locked e retornando v_locked IS NOT NULL. Evita ambiguidade de
     tipo em LANGUAGE sql RETURNING 1.
  3. release_campaign_tick_lease no finally deve ser envolvido em try/catch
     interno que apenas loga em caso de falha (nunca relança). Se o release
     falhar, o lease vence sozinho em 90s.
  Pode prosseguir com a geração do código depois desses ajustes.