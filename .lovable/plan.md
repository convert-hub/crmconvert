# Campos Personalizados unificados com escopo

Substituir os dois cards atuais ("Campos Personalizados de Contato" e "Campos Personalizados de Oportunidade") por **um único card "Campos Personalizados"**, onde cada campo declara em quais entidades aparece via dois toggles: **Contato** e **Oportunidade**.

Por baixo, a estrutura de dados continua sendo dois conjuntos separados (`custom_contact_fields` / `custom_opportunity_fields` em `tenants.settings`) — assim:
- O valor de um campo "CPF" marcado só em Contato vive em `contacts.custom_fields.cpf`.
- O valor de "Valor do contrato" marcado só em Oportunidade vive em `opportunities.custom_fields.valor_contrato`.
- Um campo marcado nos dois (ex.: "Origem") existe nas duas tabelas com valores independentes — é raro, mas suportado sem ambiguidade no envio Meta (cada token tem seu prefixo).

Sem migração SQL. Sem mudança no worker / `wa-meta-send`. Sem mudança no `useSystemVariables`.

## Mudanças

### 1. `src/pages/SettingsPage.tsx` — card único

- Remover o card "Campos Personalizados de Oportunidade" e o card "Campos Personalizados de Contato" criados antes.
- Substituir por **um card "Campos Personalizados"** com uma tabela única listando todos os campos das duas listas, mesclados por `key`.
- Formulário "Adicionar campo" ganha duas checkboxes: ☐ Contato ☐ Oportunidade (pelo menos uma obrigatória).
- Cada linha da tabela mostra: chave, label, tipo, badges "Contato" / "Oportunidade", botão remover.
- Ao salvar:
  - Se marcado Contato → grava em `custom_contact_fields`.
  - Se marcado Oportunidade → grava em `custom_opportunity_fields`.
  - Edição de escopo (marcar/desmarcar) move o registro entre as duas listas.
- Validação: bloquear `key` duplicada **dentro do mesmo escopo** (não impedir a mesma key em ambos).
- Aviso inline ao desmarcar um escopo de um campo existente: "Os valores já preenchidos em {Contato|Oportunidade} serão mantidos no banco, mas não aparecerão mais nas telas nem no picker de variáveis."

### 2. `src/pages/ContactsPage.tsx` — sem mudança estrutural

Já lê de `custom_contact_fields`. Nada a alterar — a unificação acontece só na UI de Settings.

### 3. `src/components/crm/OpportunityDetail.tsx` — sem mudança estrutural

Já lê de `custom_opportunity_fields`. Nada a alterar.

### 4. `src/hooks/useSystemVariables.ts` — sem mudança

Já consome as duas listas separadamente do `tenants.settings`. O picker do `SendTemplateDialog` continua mostrando `contact.custom.*` e `opportunity.custom.*` como grupos distintos — o que está certo, porque no envio cada um resolve contra a tabela correspondente.

### 5. `SendTemplateDialog.tsx` — sem mudança

Resolução de preview já distingue `contact.custom.X` de `opportunity.custom.X` corretamente.

## Detalhes técnicos

**Forma do `tenants.settings`:**
```json
{
  "custom_contact_fields": [
    { "key": "cpf", "label": "CPF", "type": "text" }
  ],
  "custom_opportunity_fields": [
    { "key": "valor_contrato", "label": "Valor do contrato", "type": "number" },
    { "key": "cpf", "label": "CPF", "type": "text" }  // mesma key, escopo duplo
  ]
}
```

**Merge para a tabela única em Settings:**
```ts
type Row = { key: string; label: string; type: string; inContact: boolean; inOpportunity: boolean };
// Mescla por key; se a mesma key existe em ambos, label/type vêm do registro de Contato (precedência arbitrária e documentada na UI).
```

**Save:** ao adicionar/editar/remover, recomputar as duas arrays do zero a partir do estado local e fazer `update` em `tenants.settings`.

## Fora de escopo

- Migração para uma única tabela `custom_field_definitions` (overkill agora; pode entrar numa v2 se aparecer demanda de campos compartilhados de verdade).
- Sincronização automática de valores entre contato e oportunidade quando o mesmo campo é marcado em ambos (decisão consciente: valores ficam independentes para evitar race conditions e ambiguidade no envio Meta).

## Validação

1. Settings → criar "CPF" marcando só Contato → conferir que aparece em Contatos mas não em Oportunidade.
2. Criar "Valor do contrato" marcando só Oportunidade → conferir o oposto.
3. Criar "Origem" marcando ambos → conferir que aparece nas duas telas e que `{{contact.custom.origem}}` e `{{opportunity.custom.origem}}` existem como variáveis distintas no picker do template Meta.
4. Desmarcar "Contato" de "Origem" → campo some da tela de Contatos; valores antigos permanecem no banco.
