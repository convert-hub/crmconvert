## Escopo

1. Aplicar A+B+C+D do diagnóstico anterior (pause limpo, reaper sempre, UI com distribuição completa, backfill de órfãos).
2. Botão **Exportar** por campanha → planilha com 1 linha por destinatário.
3. Reenvio gradual das mensagens que faltaram.

---

## 1. Correções do bug de "destinatários perdidos"

### A. `supabase/functions/campaign-dispatch/index.ts`
- No `action === 'pause'`, **antes** de devolver a resposta, executar `UPDATE campaign_recipients SET status='pending', updated_at=now() WHERE campaign_id=:id AND status='sending'` para soltar imediatamente quem estava claimado.
- Mover `reap_stuck_sending` para **antes** do curto-circuito de `paused/cancelled/completed`, garantindo que órfãos sejam devolvidos mesmo em campanhas pausadas.

### B. Backfill one-shot (via `supabase--insert`)
```sql
UPDATE public.campaign_recipients
   SET status='pending', updated_at=now()
 WHERE status='sending';
```
Solta todos os órfãos agora; nenhum dano se algum estiver legitimamente em envio (próximo tick reclama de novo via `claim_campaign_recipients`).

### C. UI — `src/pages/CampaignDetailPage.tsx`
Adicionar uma faixa densa de distribuição real abaixo dos contadores cumulativos:

```
Pendentes 40 · Em envio 0 · Puladas 0 · Total 58
```

Tooltip discreto nos contadores cumulativos: "Inclui as etapas seguintes (entregue ⊂ enviada)". Sem labels redundantes.

---

## 2. Exportar planilha por campanha

### Backend — nova função client-side (sem edge function)
No `CampaignDetailPage.tsx` (e botão também na lista `CampaignsPage.tsx`), botão **Exportar** que:

1. Busca via `supabase`:
   ```ts
   supabase.from('campaign_recipients')
     .select('status, sent_at, delivered_at, read_at, replied_at, error, contact:contacts(name, phone, email)')
     .eq('campaign_id', id)
     .eq('tenant_id', tenantId)
     .order('created_at')
   ```
   Paginação em chunks de 1000 para campanhas grandes (limite default do PostgREST).

2. Gera CSV (UTF-8 com BOM para Excel abrir acentos corretamente). Colunas:

   | Campanha | Nome | Telefone | Email | Status | Enviado em | Entregue em | Lido em | Respondido em | Erro |

   Status traduzido em pt-BR via map: `pending→Pendente, sending→Em envio, sent→Enviada, delivered→Entregue, read→Lida, replied→Respondeu, failed→Falhou, skipped→Pulada`.

3. Download via `Blob` + `URL.createObjectURL`. Nome do arquivo: `campanha-{slug-do-nome}-{YYYYMMDD}.csv`.

CSV resolve para Excel/Sheets, não precisa de xlsx (mais leve, sem dependência nova). Se preferir `.xlsx` real, posso usar a lib `xlsx` (SheetJS) já comum — diga e eu troco.

---

## 3. Reenvio gradual dos que faltaram

**Não precisa código novo.** O fluxo já existe e o throttle já é gradual:

- Após o backfill (item B), todos os órfãos `sending` voltam para `pending`.
- Clicar **Iniciar** em cada campanha pausada → o dispatcher pega os `pending` respeitando `throttle_per_minute` (campo já configurável por campanha) e o cron faz ticks de 1 em 1 minuto.
- Para reenviar de forma **mais lenta**, basta editar a campanha e reduzir o `throttle_per_minute` antes de iniciar (ex: 10/min em vez de 60/min).

Vou adicionar ao modal de detalhes / lista um botão **Continuar envio** (alias visual de "Iniciar" quando `status='paused'` e existem `pending`), deixando claro que ele pega só o que faltou — sem reenviar quem já recebeu (a tabela `campaign_recipients` é idempotente por linha).

### Bônus opcional — fora deste plano se não pedir
Campo "limite por minuto" inline na barra de ação da campanha pausada, para o usuário ajustar a velocidade sem entrar em edição.

---

## Ordem de execução
1. Editar `campaign-dispatch/index.ts` (A) e fazer deploy.
2. Rodar backfill (B).
3. Editar `CampaignDetailPage.tsx` / `CampaignsPage.tsx` (C + botão Exportar + label "Continuar envio").
4. Validar com a campanha "NV 17/06 14H" que aparece "Pendentes 40" e o export traz as 58 linhas.

## Fora do escopo
- Não vou criar edge function para o export (client-side basta; menos latência, sem custo de função).
- Não vou tocar na trigger de contadores.
- Reenvio gradual = throttle existente; nada novo no backend.
