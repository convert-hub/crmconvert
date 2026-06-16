
## 1) Risco de mensagem cruzando tenant — diagnóstico

Não, não há cruzamento de tenant possível hoje no fluxo da Clara. Verifiquei:

- `src/lib/whatsappRouter.ts` SEMPRE envia `tenant_id: params.tenantId` ao `uazapi-proxy` (linhas 85, 169, 217). O `tenantId` vem do `AuthContext` do tenant ativo selecionado no header.
- `supabase/functions/uazapi-proxy/index.ts` (após o fix anterior) valida membership **exatamente** contra esse `tenant_id` e usa `effectiveTenantId` em todas as buscas de instância. O fallback "qualquer membership" só dispararia se o front omitisse `tenant_id`, o que não ocorre.
- Em campanhas, `campaign-dispatch` usa `campaign.tenant_id` e `campaign.whatsapp_instance_id` da própria campanha — instância e conversa são filtradas por esse `tenant_id`. Não há como uma campanha do Instituto pegar a instância da Clicenter.

Conclusão: o número usado é sempre o vinculado à instância da campanha/conversa do tenant ativo. Não há vetor de cruzamento.

## 2) Causas-raiz dos problemas de campanha

Investiguei `campaign-dispatch`, o cron e as atualizações de recipiente. Achei 4 bugs reais que explicam, juntos, todos os sintomas da Patrícia:

**A. O cron de campanhas está 100% quebrado (causa primária do "throttle não funciona" e "pausa parece não pausar").**
A migração `20260422142123_*.sql` agenda `campaigns-tick-every-minute` chamando `campaign-dispatch` com **anon key** no `Authorization`. Mas `campaign-dispatch` (linha 70) faz `isServiceRole = token === SERVICE_ROLE` e, caindo no else, valida o JWT com `getClaims`. O anon não tem `sub` → retorna **401 em todas as execuções do cron**.

Consequência: quando a Patrícia clica "Iniciar", o front faz **uma única** chamada manual, o dispatch processa até `throttle_per_minute` destinatários em um burst e termina. Nada mais é executado depois — não há tick a cada minuto. Então:
- O throttle parece ignorado (na verdade só o 1º "minuto" é executado, em rajada).
- A campanha some do "em execução" sem nunca completar (fica com `pending` parado).
- Pausar não mostra efeito porque os envios do único tick já foram disparados antes do clique.

**B. O loop do dispatch não respeita "paused" em tempo real.**
`campaign-dispatch` lê `campaign.status` uma vez (linha 81). Dentro do `for (const rcp of pending)` (linhas 191–315), ele não re-verifica se a campanha foi pausada/cancelada entre os envios. Resultado: depois que o tick começa, ele dispara todos os ≤ throttle recipientes daquele lote, mesmo se a Patrícia clicar "pausar" no meio.

**C. UAZAPI não tem dispatch nem tracking — funciona só para Meta.**
- `campaign-dispatch` rejeita explicitamente instâncias UAZAPI (linha 129: `if (instance.provider !== "meta_cloud") → status=failed`).
- `webhook-uazapi` nunca atualiza `campaign_recipients` (somente `webhook-meta` o faz, linhas 391–409). Mesmo se o dispatch passasse, "entregue/lido/respondido" nunca subiria para campanhas via UAZAPI.

Se a SOS está em UAZAPI, a campanha dela nem chega a enviar via cron (e o tick manual da Patrícia provavelmente caiu em "failed" no momento que detectou provider != meta_cloud).

**D. Dupla escrita dos contadores cria flicker e divergência.**
A trigger `tg_campaign_recipients_counters` já mantém `sent/delivered/read/replied/failed_count` incrementalmente. O `campaign-dispatch` (linhas 318–333) recalcula e sobrescreve os mesmos campos a cada tick, podendo regredir números em corrida com webhooks. Realtime fica oscilante.

Realtime do `useCampaignRealtime` está OK (canais corretos, publication inclui as duas tabelas) — o problema é que **as linhas não estão sendo atualizadas** (B+C) e quando são, são sobrescritas (D).

## 3) Plano de correção

### Backend

1. **Arrumar o cron** — nova migração que recria `cron.schedule` usando o `SERVICE_ROLE_KEY` no header `Authorization` (não o anon). Sem isso, nada mais ticka. Vou usar `supabase--insert` (não migration) já que o SQL contém a service key e não deve viajar no histórico de migrations compartilhado.

2. **Tornar pause/cancel responsivos no loop** — em `campaign-dispatch`, dentro do `for` de envio, re-ler `campaigns.status` a cada N (ex: 10) recipientes ou a cada iteração via `select status` leve; abortar o loop se virou `paused`/`cancelled`, devolvendo os recipientes já marcados "sending" não enviados para `pending`.

3. **Suportar UAZAPI no dispatch** — quando `instance.provider === 'uazapi'`, em vez de chamar `wa-meta-send`, chamar `uazapi-proxy` (`action: 'send_message'` ou `send_template_text` com o corpo já renderizado a partir de `template.components`). Persistir `provider_message_id` retornado e marcar `sent`.

4. **Tracking UAZAPI em webhook-uazapi** — quando o evento for de status de mensagem outbound (`messages.update` / `ack` da UAZAPI), atualizar `campaign_recipients` por `tenant_id + provider_message_id` com `delivered_at`/`read_at`/`status` (espelhando webhook-meta linhas 391–409).

5. **Remover a sobrescrita de contadores no dispatch** — deletar o bloco das linhas 318–333; deixar a trigger `tg_campaign_recipients_counters` ser a fonte única. Manter apenas o auto-complete (linhas 336–346).

### Frontend

6. Nenhuma mudança de UI necessária — `useCampaignRealtime` já está correto. Os números vão começar a se mover sozinhos assim que (1)–(5) estiverem no ar.

## 4) Fora de escopo

- Não tocar em `whatsappRouter`, `ChatPanel`, RLS, ou `uazapi-proxy` para mensagens 1-a-1 (já corrigidos no turno anterior).
- Não mexer em `wa-meta-send`.
- Não alterar throttle nem schema de `campaigns`/`campaign_recipients`.

## 5) Validação após implementar

- Disparar uma campanha de teste meta_cloud com throttle = 5 e 20 recipientes; observar 4 ticks ao longo de 4 minutos via `supabase--edge_function_logs campaign-dispatch`.
- Pausar no meio do 2º tick → confirmar que do 3º minuto em diante não há mais envios.
- Repetir o teste em uma instância UAZAPI.
- Conferir `campaigns.sent_count / delivered_count / read_count` em realtime no CampaignDetailPage.

Confirma que posso implementar?
