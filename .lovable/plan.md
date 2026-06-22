## Diagnóstico

O importador hoje só lê `tenants.settings.custom_contact_fields` e grava valores em `contacts.custom_fields`. A inserção de oportunidades (linhas 590–626 de `ImportContactsDialog.tsx`) cria a opp com `tenant_id`, `contact_id`, `pipeline_id`, `stage_id`, `title`, `value`, `priority`, `status` — **nunca toca em `opportunities.custom_fields`**, mesmo quando o campo está marcado também como "Oportunidade" em Configurações.

Resultado: CPF/Devedor aparecem no contato (correto), mas a oportunidade fica com `custom_fields = {}`.

## Mudança

`src/components/contacts/ImportContactsDialog.tsx`:

1. Carregar também `custom_opportunity_fields` em paralelo com `custom_contact_fields` (mesmo `useEffect` do tenant settings). Manter um `Set<string>` com as `key`s que existem em ambas as listas (campos de escopo duplo).
2. Na construção do dropdown de mapeamento, unir as duas listas por `key` (dedupe) — assim um campo marcado só pra "Oportunidade" também fica selecionável.
3. No bloco de inserção de oportunidades (`toInsert.push({...})`), montar `opp.custom_fields` filtrando `b.custom` pelas keys presentes em `custom_opportunity_fields`. Se vazio, omitir.
4. No bloco de conflito de etapa (opp já existe), **não** sobrescrever silenciosamente — manter comportamento atual (entra na lista de conflitos). Custom fields só são gravados em opps novas criadas pelo importador, para evitar sobrescrever dados já editados pelo usuário.

Sem mudança em DB, RLS ou outras telas. Tabela `opportunities.custom_fields` (JSONB) já existe e já é renderizada em `OpportunityDetail.tsx`.

## Validação após implementar

- Reimportar o mesmo CSV. Os 124 contatos já existentes não geram opp nova (já têm). Para testar de verdade: apagar 2-3 opps de teste e reimportar → verificar via SQL que `opportunities.custom_fields` veio com `cpf` e `devedor`.
- Confirmar que abrir a oportunidade no app mostra os campos preenchidos.