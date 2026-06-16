## Esclarecimento sobre o throttle

Hoje `throttle_per_minute` é apenas o **limite máximo de mensagens por tick** (e o cron roda 1 tick/minuto). Então com 60 configurado, o sistema dispara **até 60 mensagens em rajada** no início do minuto, sem espaçamento real entre elas, e fica os ~55 segundos restantes parado. Isso explica:
- Sensação de que o throttle não funciona (chega tudo junto).
- Pausa parece demorar (entre claim e fim do for, todas já saíram).
- Risco de ban por burst no WhatsApp.

## Correção — espaçar de fato

Tornar `throttle_per_minute` literal: **N mensagens por minuto = 1 mensagem a cada `60/N` segundos**.

### Mudança única em `supabase/functions/campaign-dispatch/index.ts`

No loop `for (const rcp of pending)` (linha ~205):

1. Calcular `intervalMs = Math.round(60000 / throttle)` antes do loop.
2. Registrar `loopStart = Date.now()` antes do loop e `sendStart = Date.now()` no início de cada iteração.
3. **Após cada envio** (sucesso ou falha), antes do `processed++`, dormir o restante: `await sleep(Math.max(0, intervalMs - (Date.now() - sendStart)))`.
4. **Antes de cada sleep**, fazer um re-check leve de `campaigns.status` (já existe no topo da iteração); se vier pause/cancel durante o sleep, abortar imediatamente.
5. **Teto de duração do tick**: se `Date.now() - loopStart > 55_000`, sair do loop e devolver recipients restantes ainda não processados (não há — só os já reclamados/enviados ficam). O cron seguinte continua. Isso evita ultrapassar o limite de 60s entre cron ticks.
6. Reduzir o `_limit` do `claim_campaign_recipients` para `Math.min(throttle, Math.floor(55000 / intervalMs) || 1)` — assim o tick só reclama o que cabe em ~55s, sem deixar recipients presos em `sending` esperando o próximo tick.

### Texto auxiliar na UI

Em `src/pages/CampaignsPage.tsx` (linha 237), ajustar o helper text do input para deixar explícito: "mensagens por minuto (distribuídas uniformemente; ex.: 60 = 1/seg)".

## Por que essa abordagem

- Não exige nova tabela, RPC ou schema — só lógica no edge.
- Lease já existe (90s), mas fica folgado: tick de 55s + release antes do próximo cron.
- Pausa responsiva preservada (re-check antes de enviar **e** antes do sleep).
- Trigger de contadores e webhooks continuam funcionando exatamente como antes.

## Fora de escopo

- Não mexer em `wa-meta-send`, `uazapi-proxy`, `webhook-uazapi`.
- Não alterar schema de `campaigns` (sem campos novos).
- Sem mudança no cron schedule (continua 1/min).
