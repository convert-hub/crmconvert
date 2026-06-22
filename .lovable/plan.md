## Diagnóstico

A falha atual não vem do CSV nem dos campos personalizados. Ela vem do `upsert` de contatos com telefone.

O código usa:

```ts
.upsert(payload, { onConflict: 'tenant_id,phone' })
```

Mas no banco o índice único existente é parcial:

```sql
contacts_tenant_phone_unique ON (tenant_id, phone)
WHERE phone IS NOT NULL AND phone <> ''
```

Postgres/Supabase não aceita `ON CONFLICT (tenant_id, phone)` apontando para índice único parcial nesse formato, por isso todos os lotes com telefone falham com:

```text
there is no unique or exclusion constraint matching the ON CONFLICT specification
```

Isso explica o resultado da tela: os poucos criados foram provavelmente contatos sem telefone, enquanto os 2147 registros com telefone caíram no mesmo erro de lote.

## Plano de correção

1. Alterar o importador para não depender de `upsert(... onConflict: 'tenant_id,phone')`.
2. Manter o lookup atual por telefone para descobrir contatos existentes.
3. Separar o lote em dois grupos:
   - contatos existentes: atualizar por `id`, preservando/mesclando tags e `custom_fields`;
   - contatos novos: inserir normalmente.
4. Preservar a lógica recém-ajustada para criar `opportunities.custom_fields` quando o campo estiver marcado para oportunidade.
5. Ajustar a contagem de criados/atualizados para refletir `insert` e `update` separados.
6. Validar na tela que uma nova importação não gera mais o erro de `ON CONFLICT`.

## Arquivo afetado

- `src/components/contacts/ImportContactsDialog.tsx`

## Sem mudança de banco

Não pretendo alterar índices, constraints ou RLS agora. A correção mais segura é no código do importador, porque o índice parcial já existe para permitir múltiplos contatos sem telefone e evitar duplicidade apenas quando há telefone válido.