## Diagnóstico

Hoje, no `ImportContactsDialog`, a lista `CONTACT_FIELDS` é estática e contém apenas campos nativos (nome, telefone, email, status, tags, nascimento, cidade, estado, origem, notas). Não há como direcionar uma coluna da planilha para um campo personalizado definido em Configurações → Contatos (`tenants.settings.custom_contact_fields`, persistidos em `contacts.custom_fields` JSONB). Resultado: colunas extras só podem ser ignoradas.

## O que vamos construir

Adicionar suporte a campos personalizados como destinos válidos do mapeamento, gravando os valores no JSONB `custom_fields` do contato, respeitando o tipo de cada campo.

## Mudanças

**`src/components/contacts/ImportContactsDialog.tsx`**

1. Carregar `custom_contact_fields` de `tenants.settings` ao abrir o diálogo (mesmo padrão de `ContactsPage`).
2. Estender o `Select` de destino: após os campos nativos, adicionar um grupo "Campos personalizados" listando cada definição com `value = "custom:<key>"` e `label = fd.label`.
3. Melhorar `guessMapping` para também tentar casar headers pelo `label` ou `key` dos campos personalizados (match case-insensitive, sem acentos, ignorando espaços) antes de retornar `skip`.
4. No `handleImport`, ao processar cada coluna mapeada:
   - Se `field` começa com `custom:`, extrair a `key`, localizar a definição e coercer o valor conforme o tipo:
     - `text` → string
     - `number` → `parseFloat`, ignora se `NaN`
     - `date` → reutiliza `parseDateBR`; valor inválido vira erro de linha igual ao `birth_date`
     - `select` → aceita só se valor estiver em `options` (case-insensitive); caso contrário, erro de linha
     - `boolean` → normalizar `sim/true/1/yes` → true, `não/nao/false/0/no` → false; outros viram erro
   - Acumular em um objeto `customFields` local e, ao final, setar `c.custom_fields = customFields` (apenas se houver pelo menos uma chave).
5. No fluxo de update de contato existente, fazer **merge raso** com `custom_fields` atual do banco (buscar junto no `select('id, tags, custom_fields')`) para não apagar chaves que não vieram no CSV.
6. No preview da etapa de mapeamento, exibir o label do campo personalizado quando selecionado (ex.: "CPF" em vez de `custom:cpf`).

## Detalhes técnicos

- Sem migration: `contacts.custom_fields` já existe como JSONB e `ContactsPage` já lê/grava nele.
- Sem mudança em RLS: a importação usa o cliente autenticado e as policies de `contacts` já cobrem insert/update por tenant.
- Sem mudanças em outras telas, edge functions ou worker.

## Fora de escopo

- Não criar definições de campos personalizados a partir da planilha (campos precisam existir previamente em Configurações).
- Não alterar o export CSV (pode ser próximo passo se desejar).
