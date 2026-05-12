# Variable Picker — inserção com 1 clique + descoberta automática de variáveis

## Problema

Hoje os campos que aceitam variáveis (`{{contact.name}}`, `{{nome}}`, `{{1}}`...) só mostram a sintaxe num texto auxiliar — o usuário tem que digitar e adivinhar o nome. Além disso, novos campos personalizados criados no sistema (custom_fields de contato/oportunidade, variáveis de templates Meta, slots de quick reply) precisam aparecer automaticamente nos pickers, sem alteração de código.

## Solução

1. **Componente único `<VariablePicker>`** (botão `{ }` em popover com busca, agrupado) + wrappers `VariableInput` / `VariableTextarea` que inserem o token no cursor.
2. **Registro dinâmico de variáveis** carregado por hook `useSystemVariables(scope)` que combina:
   - **Built-ins** já resolvidos pelo backend: `contact.name`, `contact.email`, `contact.phone` (worker `index.js` 640-713 e `wa-meta-send` 511-515) e os aliases curtos `nome`, `telefone`, `email` (resolvidos em `ChatPanel.replaceVariables`).
   - **Campos personalizados de contatos** (`contacts.custom_fields` JSONB): chaves descobertas via consulta agregada por tenant.
   - **Campos personalizados de oportunidades** (`opportunities.custom_fields`).
   - **Variáveis declaradas em templates Meta** (`whatsapp_message_templates.components` → `extractTemplateSlots`) quando o picker é aberto dentro do contexto de um template específico.
   - **Variáveis declaradas em quick replies** (coluna `quick_replies.variables ARRAY` já existente).

## Backend — apenas resolução, sem novas tabelas

Atualmente o worker só resolve `contact.name|email|phone`. Para que `{{contact.custom.<chave>}}` funcione no envio do fluxo, estender a interpolação:

- Em `worker/index.js` (interpolação do nó `message`, linha ~708, e do template handler, linha ~511): após carregar o contato, popular `ctx.variables['contact.custom.<key>']` para cada chave em `contacts.custom_fields`. Mesma lógica para `opportunity.custom.<key>` quando a conversa tiver `opportunity_id`.
- Sem mudança de schema. Sem mudança de RLS.

Se o usuário inserir uma variável cujo backend ainda não resolve (ex.: `opportunity.value` num quick reply enviado pela inbox), o token será mantido literal — comportamento já existente. Vou marcar essas variáveis no picker com badge "fluxo" para evitar uso indevido fora do contexto certo.

## Arquivos a criar

- `src/lib/systemVariables.ts`
  - `type SystemVariable = { token: string; label: string; description?: string; group: string; scopes: VariableScope[] }`
  - `type VariableScope = 'flow' | 'template-meta' | 'quick-reply' | 'inbox-composer' | 'campaign'`
  - Built-ins exportados como const.
  - Helpers: `templateSlotVars(components)`, `customFieldVars(prefix, keys)`.
- `src/hooks/useSystemVariables.ts`
  - Args: `{ tenantId, scope, templateComponents?, includeCustomFields? }`.
  - Carrega 1x por sessão (com cache em memória) as chaves distintas de `custom_fields` via duas queries:
    - `select custom_fields from contacts where tenant_id = ? and custom_fields <> '{}' limit 500` → agrega Object.keys.
    - idem para `opportunities`.
  - Filtra por `scope` (ex.: quick-reply só mostra built-ins curtos + custom de contato).
  - Retorna `SystemVariable[]` agrupado.
- `src/components/shared/VariablePicker.tsx` — botão (`Braces` 14px, ghost) + Popover + cmdk Command com busca, agrupado por `group`. Props: `variables`, `onPick(token)`.
- `src/components/shared/VariableTextarea.tsx` e `VariableInput.tsx` — wrappers finos sobre `Textarea`/`Input` shadcn. Picker ancorado absoluto no canto superior direito; `insertAtCursor` preserva seleção e dispara onChange sintético.

## Plugar nos campos existentes

Cada local recebe um `scope` que determina o conjunto exibido pelo hook:

| Arquivo | Campos | Scope |
|---|---|---|
| `src/components/flow-builder/MessageNodeEditor.tsx` | textarea de mensagem, slots de template, fallback | `flow` |
| `src/components/inbox/SendTemplateDialog.tsx` | inputs de slot | `template-meta` (recebe `templateComponents`) |
| `src/pages/AutomationsPage.tsx` | textarea de mensagem livre + slots | `flow` |
| `src/pages/CampaignsPage.tsx` | inputs por parâmetro do template | `campaign` |
| `src/components/settings/QuickRepliesSettings.tsx` | textarea de conteúdo | `quick-reply` |
| `src/components/inbox/ChatPanel.tsx` | composer de nova mensagem | `inbox-composer` |
| `src/components/inbox/ScheduleMessageDialog.tsx` | textarea (se existir) | `inbox-composer` |

Em todos eles, remover o bloco auxiliar "Variáveis dinâmicas: ..." (vira redundante).

## Backend — alterações pontuais no worker

Arquivo `worker/index.js`:

1. Bloco "Enrich context with contact fields" (linha 640): após popular as 3 chaves, percorrer `ctc.custom_fields` (selecionar `name, email, phone, custom_fields`) e setar `ctx.variables['contact.custom.<k>'] = String(v ?? '')`.
2. Quando `ctx.conversation_id`, carregar `opportunity_id` da conversa e, se existir, ler `opportunities.custom_fields` e popular `opportunity.custom.<k>` + `opportunity.value`, `opportunity.title`.
3. Em `wa-meta-send/index.ts` (`interp`, linha 511): substituir o trio de `replace` literal por uma função genérica que troca `{{contact.custom.X}}` e `{{opportunity.custom.X}}` consultando os mesmos dicionários carregados.

Sem migração. Sem nova tabela. Sem RLS.

## Detalhes de UX

- Botão picker: ícone `Braces` 14px, `variant="ghost"`, posicionado absoluto top-right do campo (sem deslocar layout). `aria-label="Inserir variável"`.
- Popover: ~280px, busca `Command` por label/token, agrupado (Contato, Oportunidade, Personalizado, Template, Conversa). Cada item mostra `label` + `{{token}}` em mono pequeno e descrição opcional. Click insere e fecha mantendo foco.
- Variáveis fora do escopo de envio do contexto atual ficam ocultas — não exibimos `opportunity.*` num quick reply, por exemplo.
- Loading: enquanto custom_fields carrega, mostra apenas built-ins (não bloqueia).

## Fora de escopo

- Editor visual para criar/renomear chaves de `custom_fields` a partir do picker.
- Sintaxe destacada dentro do textarea (syntax highlight).
- Variáveis derivadas (`{{contact.first_name}}`, formatação de data/moeda).
