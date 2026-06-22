## Objetivo

Importação de 2.000+ linhas precisa **terminar sempre**, mesmo com re-renders, perda de conexão momentânea ou aba em background. Reduzir 8 mil requests serializados para ~20 batches paralelizáveis.

## Diagnóstico confirmado

- 119/124 contatos criados (5% do total), 0 atualizados, **sem mensagem de erro**, tela resetou sozinha
- Causa: loop sequencial 1-linha-por-vez com 3-4 awaits por linha. Componente desmontou (Dialog perdeu state) ou request ficou pendente indefinidamente
- Bug secundário latente: `insert` simples (não upsert) numa tabela com unique `(tenant_id, phone)` + trigger `tg_contacts_normalize_phone` → race condition cliente↔servidor em duplicatas

## Mudanças (todas em `src/components/contacts/ImportContactsDialog.tsx`)

### 1. Batching com upsert (núcleo do fix)

Substituir o loop atual por processamento em lotes de **200 linhas**:

```text
[parse rows] → [pre-process all rows in memory] → [chunk de 200]
   → upsert batch em contacts (onConflict: tenant_id,phone)
   → coletar IDs retornados
   → upsert batch em opportunities (quando aplicável)
   → setProgress + console.log do batch
```

- `supabase.from('contacts').upsert(batch, { onConflict: 'tenant_id,phone', ignoreDuplicates: false }).select('id, phone, email')`
- Merge de tags/custom_fields **antes** do upsert (dedup em memória por phone/email)
- Opps em batch separado, depois do contacts batch (precisa dos IDs)
- Cada batch tem seu try/catch — falha de 1 batch não derruba os outros (padrão do `lovable-stack-overflow`)

### 2. Blindagem do Dialog durante import

- `handleClose` ignora `open=false` quando `step==='importing'` (precisa confirmação explícita pra cancelar)
- Botão "Cancelar importação" visível, com `AbortController` pra parar o loop limpa­mente
- `setProgress` complementado com `setProgressDetail` (`"batch 3/11 — 600/2141 linhas"`)

### 3. Checkpoint em localStorage

- A cada batch concluído, salvar `{ tenantId, fileHash, processedCount, errors }` em `localStorage`
- Se usuário reabrir o Dialog após crash, oferecer "Retomar importação de XX% que foi interrompida"
- Limpar checkpoint ao concluir 100%

### 4. Tratamento de telefone vazio/lixo

- Lista de valores "nulos" reconhecidos: `''`, `'-'`, `'—'`, `'()'`, `'n/a'`, `'sem'`, `'sem telefone'`
- Se phone reconhecido como nulo → contato importado **sem** telefone (não vai pra `errors[]`)
- Se phone tem dígitos mas `normalizeBrazilPhone` devolve `''` → vai pra `errors[]` como hoje, mas com motivo "telefone com menos de 8 dígitos"

### 5. Relatório de erros agrupado

- Tela final mostra **top 5 motivos com contagem** (`"1843× duplicate key on phone"`, `"117× telefone com menos de 8 dígitos"`)
- Lista detalhada das 20 primeiras linhas + botão "Baixar CSV completo" (já existe)
- Adicionar contador "Tempo total: 12s" pra forensic visibility

### 6. Logs estruturados pra forensic futuro

- `console.log('[ImportContacts] start', { rows: N, batches: M, pipeline: id })`
- `console.log('[ImportContacts] batch', i, '/', total, 'done in', ms, 'ms')`
- `console.error('[ImportContacts] batch failed', i, err)` em vez de stack traces individuais

## Fora de escopo

- Não mexer no edge function `campaign-dispatch` nem em migrações
- Não alterar a UI da `ContactsPage` (parent)
- Não tocar em `normalize_brazil_phone` SQL (alinhamento client↔server fica resolvido pelo upsert)

## Arquivos afetados

- `src/components/contacts/ImportContactsDialog.tsx` — refator do `handleImport` + UI de progresso/cancelamento/retomada
- Sem mudanças em DB, edge functions, ou RLS

## Validação

Após implementar:
1. Reimportar o mesmo CSV de 2141 linhas
2. Esperado: ~10 segundos, 119 atualizados + ~2000 criados (ou todos atualizados se rodar 2x), 0 erros de "duplicate key"
3. Checar `console` por logs `[ImportContacts] batch N/M done`
4. Tentar fechar o Dialog no meio — deve pedir confirmação
