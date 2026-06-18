## Diagnóstico forense confirmado

O problema não é mais destinatário “sumido”. Os destinatários estão `pending` nas campanhas antigas e novas.

A causa raiz encontrada nos dados/logs é dupla:

1. **O cron está chamando `campaign-dispatch` com token inválido/antigo**
   - `cron.job` executa todo minuto e retorna “8 rows”, mas `net._http_response` mostra `401 Unauthorized` para todas as chamadas recentes.
   - Por isso campanhas em `running` com pendentes não continuam automaticamente.

2. **O botão “Continuar” muda para `running`, mas não processa imediatamente em algumas campanhas**
   - Em `campaign-dispatch`, depois do `start`, o objeto `campaign` ainda contém status antigo `paused`.
   - Logo em seguida existe um bloqueio que retorna se `campaign.status === 'paused'`, podendo impedir o processamento real no mesmo clique.

## Plano de correção

### 1. Corrigir `campaign-dispatch`
- Após `action === 'start'`, usar um `effectiveStatus = 'running'` em vez do status antigo carregado antes do update.
- Garantir que `start`/`continue` sempre tente processar destinatários `pending` imediatamente.
- Adicionar logs objetivos no backend:
  - campanha, ação, status original, status efetivo
  - quantidade reivindicada (`claimed`)
  - motivo quando não processar (`locked`, `no_pending`, `paused`, erro de envio)

### 2. Corrigir o cron da campanha
- Criar migração para recriar o job de campanhas com um token válido do ambiente do banco, em vez do JWT anon hardcoded antigo.
- Manter a frequência de 1 minuto.
- Limitar apenas campanhas `scheduled` e `running`, como hoje.

### 3. Backfill operacional seguro
- Não mexer em entregues/lidas/respondidas.
- Garantir apenas que destinatários presos em `sending` voltem para `pending`.
- Manter campanhas com pendentes em `running` ou permitir que o botão “Continuar” as retome.

### 4. Validação antes de dizer que está resolvido
- Consultar `net._http_response` após a correção e confirmar que `campaign-dispatch` não retorna mais `401`.
- Conferir uma campanha real com pendentes antes/depois e validar que o número de `pending` diminui e `sent/failed` aumenta.
- Conferir logs da edge function com `claimed > 0`.

## Arquivos/áreas afetadas
- `supabase/functions/campaign-dispatch/index.ts`
- Migração SQL para recriar o cron job de campanhas
- Sem alteração visual desnecessária.