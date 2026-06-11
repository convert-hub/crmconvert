# Diagnóstico forense

**Sintoma:** Campos personalizados criados em *Configurações → Campos* não aparecem no picker de variáveis ao enviar um template Meta no Inbox.

**Causa raiz (3 problemas encadeados em `src/hooks/useSystemVariables.ts`):**

1. **Fonte errada de descoberta.** `discoverCustomKeys()` faz `SELECT custom_fields FROM contacts/opportunities` e extrai chaves dos JSONB **já preenchidos**. Quem nunca preencheu o campo em nenhum registro, nunca vê a chave no picker. As **definições** dos campos vivem em outro lugar: `tenants.settings.custom_opportunity_fields` (gravado em `SettingsPage.tsx` linha 522).

2. **Escopo do picker omite oportunidade.** No ramo `scope === 'template-meta'`, o hook só chama `customFieldVars('contact.custom', custom.contact, …)`. Os campos definidos como `custom_opportunity_fields` ficam de fora mesmo se houvesse dados — não há `customFieldVars('opportunity.custom', …)` nesse ramo.

3. **Cache de 5 min mascara o problema.** Mesmo se os pontos 1 e 2 fossem corrigidos via dado real, a chave nova só apareceria depois do TTL do cache em memória.

**Observação extra (não é o bug, mas convém alinhar):** a chave usada hoje em `tenants.settings` é `custom_opportunity_fields`, mas o painel em `SettingsPage` é genérico ("Campos") e o usuário pode esperar que valha para contato também. O nome atual é herdado; mantenho-o para não quebrar dados existentes, mas exponho como `opportunity.custom.*` no picker.

# Plano de correção (mínimo, cirúrgico)

Alterar **apenas** `src/hooks/useSystemVariables.ts`. Nenhum outro arquivo precisa mudar — `SendTemplateDialog` e `MessageNodeEditor` já consomem o hook.

### Mudanças

1. **Trocar a fonte de descoberta** de `contacts/opportunities.custom_fields` para `tenants.settings`:
   - Ler `tenants.settings.custom_opportunity_fields` (definições oficiais).
   - Ler também `tenants.settings.custom_contact_fields` caso exista no futuro (forward-compatible; hoje retorna vazio).
   - Cada definição expõe `key` e `label` — usar `label` no `SystemVariable.label` (melhor UX que slug).

2. **Incluir `opportunity.custom.*` no escopo `template-meta`.** Hoje só inclui `contact.custom.*`. Passar a adicionar ambos.

3. **Reduzir o TTL do cache** de 5 min → 30 s, e invalidar quando o `tenantId` muda (já faz). Mantém leveza sem prender chave nova por muito tempo.

### Por que não tocar no backend

O `wa-meta-send` envia os valores do template já resolvidos pelo frontend (o usuário digita ou seleciona um valor concreto via `VariableInput`). O picker é puramente UI — corrigir a fonte de dados do picker resolve o sintoma sem mexer em envio, interpolação no worker, nem RLS.

### Validação

- Em Configurações → Campos, criar um campo novo (ex.: "CPF").
- Em Inbox → enviar template → o picker dentro de cada slot deve listar `opportunity.custom.cpf` no grupo *Personalizado*, mesmo sem nenhuma oportunidade preenchida.

### Fora de escopo

- Renomear `custom_opportunity_fields` para algo neutro (migração de dados — não pediu).
- Resolver `{{opportunity.custom.*}}` server-side em templates Meta (hoje o usuário cola o valor literal; mudança maior).
- Mexer no `MessageNodeEditor`, `wa-meta-send`, ou worker.
