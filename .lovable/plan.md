# Preview real + campos personalizados de contato

Dois ajustes complementares ao envio de template Meta para que disparos em base apenas de contatos (sem oportunidade ainda) funcionem corretamente e o operador veja o conteúdo final antes de enviar.

## 1. Preview com dados reais resolvidos

Hoje o bloco cinza do `SendTemplateDialog` mostra `{{contact.name}}` literal porque o operador digitou o token como valor. Vamos resolver tokens contra os dados reais da conversa **só na visualização** (o que é enviado para a Meta continua sendo o valor literal digitado — a Meta/worker resolve no envio).

Mudanças, somente em `src/components/inbox/SendTemplateDialog.tsx`:

- Ao abrir o dialog, buscar uma única vez:
  - `conversations` → `contact_id`, `opportunity_id` pela `conversationId`.
  - `contacts` → `name`, `email`, `phone`, `custom_fields` (sempre que houver `contact_id`).
  - `opportunities` → `title`, `value`, `custom_fields` (só se houver `opportunity_id`).
- Criar `resolveToken(token)` que entende `contact.name|email|phone`, `contact.custom.<key>`, `opportunity.title|value`, `opportunity.custom.<key>`.
- No `valuesByKey` usado pelo `renderPreview`, se o valor digitado for um token `{{x}}` puro, substituir por `resolveToken('x')` (com fallback para o próprio token se o dado real estiver vazio — assim o operador vê "—" mas sabe qual variável está faltando).
- Adicionar pequena badge/texto sob o preview: "Pré-visualizando com dados de: {contact.name}" para deixar explícito que é o contato real da conversa.

Não tocar em `wa-meta-send`, worker, nem na lógica de envio. O `buildMetaComponents` continua mandando o que o operador digitou — o backend já resolve `{{contact.*}}` e `{{opportunity.*}}` no envio real.

## 2. Campos personalizados de Contato

Hoje só existem campos personalizados de Oportunidade. Para uma base que ainda é só contatos, precisamos do mesmo recurso em Contato.

### 2a. Settings — nova seção espelhada

Em `src/pages/SettingsPage.tsx`, na aba "Campos":

- Renomear o card atual para "Campos Personalizados de Oportunidade" (já está) e adicionar **segundo card** "Campos Personalizados de Contato".
- Novo state `contactCustomFields`, carregado de `tenants.settings.custom_contact_fields` em `loadAll()`.
- Funções `addContactCustomField` / `removeContactCustomField` espelhando as de oportunidade, mas escrevendo em `custom_contact_fields`.
- UI 100% idêntica à de oportunidade (tabela + form), só trocando o destino.

### 2b. Edição de valores no Contato

Em `src/pages/ContactsPage.tsx`, no Dialog de criar/editar contato:

- Carregar uma vez `tenants.settings.custom_contact_fields` no mount (ou via hook leve compartilhado).
- Adicionar, abaixo das Tags, uma seção "Campos personalizados" que renderiza um input por campo definido, conforme `type` (text/number/date/select/boolean — mesmo switch do `OpportunityDetail`).
- Estado `customFieldsValues` no `form`; ao salvar, incluir `custom_fields: customFieldsValues` no payload de `insert`/`update`.
- No editar, pré-popular a partir de `editingContact.custom_fields`.

### 2c. Hook de variáveis

`useSystemVariables` já lê `custom_contact_fields` e, em escopo `template-meta`, já injeta `contact.custom.*`. Nada a mudar aqui — a nova seção de Settings vai popular automaticamente o picker do `SendTemplateDialog`.

## Fora de escopo

- Resolução server-side de `{{contact.custom.*}}` e `{{opportunity.custom.*}}` no `wa-meta-send`/worker (já existe ou é assumida funcional). Caso o teste mostre que esses tokens não são resolvidos no envio, abrimos uma issue separada.
- Importação CSV de campos personalizados de contato.
- Migração SQL — `contacts.custom_fields` (jsonb) já existe.

## Validação

1. Settings → Campos: criar "CPF" em Contato.
2. Contatos → editar contato: preencher CPF, salvar.
3. Inbox → enviar template: selecionar template com `{{contact.name}}` e `{{contact.custom.cpf}}` no picker; o preview deve mostrar o nome real e o CPF salvos. Enviar e conferir mensagem entregue.
