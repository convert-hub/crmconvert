# Acompanhamento em tempo real de campanhas Meta

Implementação em uma branch única, sem tocar em envio/RLS/schema de campaigns/recipients (apenas leitura) nem em pg_cron.

## 1) Migration `supabase/migrations/<ts>_campaign_realtime_tracking.sql`

- `ALTER TABLE campaigns / campaign_recipients REPLICA IDENTITY FULL`.
- `DO $$ ... $$` defensivo adicionando ambas as tabelas à publicação `supabase_realtime` apenas se ainda não estiverem.
- Função `tg_campaign_recipients_counters()` (SECURITY DEFINER, search_path=public): em `AFTER INSERT OR UPDATE OF status`, calcula deltas usando os ranks de funil (`pending=0, sending/skipped=1, sent/failed=2, delivered=3, read=4, replied=5`) e aplica `UPDATE campaigns SET sent_count/delivered_count/read_count/replied_count/failed_count = GREATEST(... + delta, 0), updated_at=now()` apenas para colunas com delta ≠ 0. Regras cumulativas: `sent` conta todos rank ≥ 2 exceto `failed`; `delivered` rank ≥ 3; `read` rank ≥ 4; `replied` exato; `failed` exato.
- Função `tg_campaign_recipients_no_funnel_regress()` em `BEFORE UPDATE OF status`: se `r_new < r_old`, reescreve `NEW.status := OLD.status` e `NEW.updated_at := OLD.updated_at`, exceto nas duas exceções: `sending→pending` (reaper) permitido, e nunca regredir a partir de `failed`.
- Triggers correspondentes (`trg_campaign_recipients_counters` AFTER, `trg_campaign_recipients_no_regress` BEFORE).
- Função `recompute_campaign_counters(_campaign_id uuid)` em SQL (SECURITY DEFINER) com `count(*) FILTER (...)` cumulativo, `GRANT EXECUTE ... TO authenticated`.
- `DO $$ FOR r IN SELECT id FROM campaigns LOOP PERFORM recompute_campaign_counters(r.id); END LOOP $$` para backfill one-shot.

> Observação: ordem de criação importa — `BEFORE` (anti-regress) executa primeiro, então o `AFTER` só vê transições válidas. Apenas leitura de schema; nenhuma coluna nova.

## 2) Hook `src/hooks/useCampaignRealtime.ts`

Genérico, padrão idêntico ao `InboxPage.tsx`:

```text
useCampaignRealtime({
  tenantId, campaignId?,
  onCampaignChange?(row), onRecipientChange?(rows[])
}) → { connected }
```

- Canal `campaigns:${tenantId}` com `postgres_changes` filtro `tenant_id=eq.${tenantId}`, evento `UPDATE` → `onCampaignChange(payload.new)`.
- Se `campaignId`, canal `recipients:${campaignId}` filtro `campaign_id=eq.${campaignId}`, eventos `INSERT|UPDATE`.
- Buffer: `bufferRef[]` + `timerRef` com `setTimeout(flush, 250)`; `flush` envia array e zera. Evita meltdown em campanhas grandes.
- Cleanup: `clearTimeout` + `supabase.removeChannel` para ambos os canais.
- Estado `connected` atualizado nos callbacks de `subscribe`.

## 3) `src/pages/CampaignsPage.tsx`

- Importa e usa `useCampaignRealtime({ tenantId, onCampaignChange })` para mesclar updates no estado `campaigns` por id.
- `useEffect` adicional cria `setInterval(load, 15000)` somente se `campaigns.some(c => c.status === 'running')`; depende do array de status. Limpo no cleanup.
- Cada `Card` de campanha vira clicável navegando para `/campaigns/:id` (preserva botões Play/Pause/Delete via `stopPropagation`).

## 4) `src/pages/CampaignDetailPage.tsx` + rota `/campaigns/:id` em `App.tsx`

- Header: nome, badge de status (reutiliza `STATUS_LABELS`), instância, template, link "Voltar".
- 6 cards de funil (Pendentes/Enviadas/Entregues/Lidas/Respondidas/Falhas) lendo `campaigns.*`. "Pendentes" = `total_recipients - sent_count - failed_count`.
- `Progress` com `value = sent_count / total_recipients * 100`.
- Tabela paginada (50/página) de `campaign_recipients` join `contacts(name, phone)`: colunas contato, status badge, sent_at, delivered_at, read_at, error.
- Filtros: multi-select por status, busca por nome/telefone (server-side via `ilike`).
- Botão "Recalcular contadores" (visível se admin/manager via `useAuth` membership role) chama `supabase.rpc('recompute_campaign_counters', { _campaign_id })` e recarrega.
- `useCampaignRealtime({ tenantId, campaignId, onCampaignChange, onRecipientChange })` aplicando deltas in-memory (merge por id, prepend novos), já bufferizado.

## Critério de pronto

- UI atualiza sozinha quando webhook-meta muda recipients.
- Detalhe mostra status mudando ao vivo.
- `recompute_campaign_counters` não altera nada quando triggers estão corretos.
- Webhook `delivered` após `read` não regride.
- 5k+ recipients sem travar (buffer 250ms).

## Fora de escopo

Envio/wa-meta-send, RLS, schema de campaigns/recipients, pg_cron, deploy.  
  
Antes de gerar o código, incorpore os 5 pontos abaixo. Eles complementam

o plano sem mudar seu escopo:

1) Padronização de parâmetros das RPCs.

   A RPC recompute_campaign_counters deve declarar o parâmetro como

   *campaign*id (com underscore inicial). A chamada em CampaignDetailPage

   deve ser exatamente:

     supabase.rpc('recompute_campaign_counters', { *campaign*id: id })

   Não use "campaignid" sem underscore — quebra a chamada.

2) Compatibilidade com o gap C (reaper / lease).

   O trigger BEFORE de anti-regressão JÁ prevê a exceção 'sending' → 'pending'

   (reaper). Garanta também que a função do gap C que estamos implementando

   em paralelo (reap_stuck_sending) NÃO incrementa nenhum contador no

   trigger AFTER. Como ela move 'sending' → 'pending' (ambos rank<2), o

   delta é zero pelos ranks atuais — então está OK por construção. Apenas

   adicione um comentário no topo do trigger AFTER explicitando essa

   coordenação para o próximo dev não quebrar.

3) RLS no canal Realtime do Supabase.

   O Realtime do Supabase respeita RLS APENAS se o cliente estiver

   autenticado com JWT (não service-role) E se a opção "Send via WAL"

   estiver acompanhada de checagem de SELECT policy. Garanta que:

   a) As policies SELECT em campaigns e campaign_recipients permitem

      ao membership do tenant ler suas próprias linhas (já existem como

      "Members view recipients" / equivalente em campaigns — verifique

      e, se não houver SELECT policy em campaigns para membership comum,

      adicione uma policy SELECT is_member_of_tenant(tenant_id)).

   b) O hook useCampaignRealtime cria os channels SEM service-role

      (cliente padrão supabase do front, que usa o JWT do usuário logado).

4) Custo do REPLICA IDENTITY FULL.

   FULL faz o WAL gravar a linha inteira em todo UPDATE/DELETE. Em

   campaign_recipients isso pode crescer rápido com volume. Para minimizar:

   no trigger AFTER, mantenha o early-return quando NEW.status IS NOT

   DISTINCT FROM OLD.status (já está no plano) — perfeito.

   Adicionalmente, deixe um comentário no migration sugerindo que, no

   futuro, podemos trocar FULL por uma índice UNIQUE composto +

   REPLICA IDENTITY USING INDEX se o volume justificar. Não implemente

   isso agora, apenas documente.

5) Backfill seguro em produção.

   O DO $$ que faz PERFORM recompute_campaign_counters(id) para todas as

   campanhas pode demorar se houver muitas. Envolva em:

     DO $$

     DECLARE r record; t timestamptz := clock_timestamp();

     BEGIN

       FOR r IN SELECT id FROM public.campaigns ORDER BY created_at DESC LOOP

         PERFORM public.recompute_campaign_counters([r.id](http://r.id));

       END LOOP;

       RAISE NOTICE 'backfill done in %', clock_timestamp() - t;

     END$$;

   Ordenando DESC para que campanhas recentes (mais relevantes para o

   usuário) sejam recalculadas primeiro caso a migration seja interrompida.

6) Polling de fallback no CampaignsPage.

   O plano fala em setInterval(load, 15000) se há campaign 'running'.

   Cuidado para não criar tempestade de requests: use uma flag isLoading

   que impede chamadas concorrentes (se a request anterior ainda não

   resolveu, pula esse tick). Use AbortController para cancelar a request

   anterior no cleanup do useEffect.

7) Acessibilidade da nova rota.

   Adicione a rota /campaigns/:id em App.tsx dentro do mesmo bloco

   protegido (require auth + tenant) onde /campaigns já vive. Reusar

   o layout pai (com sidebar).

Critérios de pronto adicionais:

- Abrindo a tela em duas abas com o mesmo usuário logado, uma mudança

  em recipients via SQL Editor (UPDATE direto) é refletida em ambas as

  abas em <2s.

- Logout durante a subscription não vaza canal (cleanup chama

  removeChannel — confirme com console.log temporário durante teste).

- recompute_campaign_counters chamado duas vezes em sequência não muda

  os valores na segunda execução (idempotência).

- Trigger de anti-regress: UPDATE campaign_recipients SET status='delivered'

  WHERE status='read' não muda o status (NEW.status fica = OLD.status).