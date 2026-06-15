## Diagnóstico forense — onde o `{{contact.custom.nome_para_envio}}` vazou

**Causa-raiz (1 linha):** a edge function `campaign-dispatch` resolve apenas `{{contact.<campo_direto>}}` e ignora silenciosamente `{{contact.custom.<chave>}}`, enviando o token literal para a Meta — que repassou ao destinatário.

### Cadeia de evidências

1. **Frontend (criação da campanha)** — `CampaignDetailPage` (via `useSystemVariables`/`VariableInput`) **oferece** `contact.custom.<chave>` no seletor de variáveis de template e grava em `campaigns.template_variables` o valor literal `{{contact.custom.nome_para_envio}}`. Confirmado no banco:

   ```
   campaigns.template_variables → { "1": "{{contact.custom.nome_para_envio}}" }
   tenant: S.O.S Tecnologia — 4 campanhas em 15/06 entre 09:01 e 09:05
   ```

2. **Backend (`supabase/functions/campaign-dispatch/index.ts`)**, linhas 18–24 e 156:

   ```ts
   function resolveTemplateVariable(template: string, contact: any): string {
     return template.replace(/\{\{\s*contact\.(\w+)\s*\}\}/g, (_, field) => {
       const v = contact?.[field];
       return v == null ? "" : String(v);
     });
   }
   // SELECT contact: 'id, name, phone, email, do_not_contact, consent_given'
   ```

   - Regex `contact\.(\w+)` casa **um único token** após `contact.` — não casa `contact.custom.x` (tem dois pontos). Token literal passa intacto.
   - O SELECT do contato **não inclui `custom_fields`** — mesmo se a regex casasse, o dado não estaria carregado.
   - Resultado: `resolved["1"]` = `"{{contact.custom.nome_para_envio}}"`, gravado em `campaign_recipients.variables_used` e enviado como `parameters[0].text` para `wa-meta-send` → Meta → cliente.

3. **Prova no banco** — `campaign_recipients.variables_used` para a campanha "NV 15/06 09H" mostra `{ "1": "{{contact.custom.nome_para_envio}}" }` em recipients com status `sent/delivered/read`. Confirma que **a Meta entregou o token literal ao destinatário** (não é bug de exibição do CRM).

4. **Por que o preview da campanha "parecia certo"** — o preview do frontend usa um resolvedor próprio (similar ao de `SendTemplateDialog.tsx` linhas 72–88) que sabe ler `contact.custom.*`. O divórcio entre preview-frontend e resolvedor-backend é a falha sistêmica.

### Caminho 1:1 (`SendTemplateDialog` → `wa-meta-send`) — mesmo padrão de bug

- `SendTemplateDialog` resolve `contact.custom.*` apenas no **preview** (`resolveToken`, linhas 72–88). No envio (`buildMetaComponents`, `src/lib/metaTemplateVars.ts:103`) ele manda `values[s.id]` **cru** para o `wa-meta-send`.
- O worker `send_whatsapp_template` (`worker/index.js:501–505`) só interpola `contact.name|email|phone`. Mas esse caminho hoje só é usado pelo flow builder; o `SendTemplateDialog` chama `wa-meta-send` direto.
- Conclusão: o envio 1:1 tem o mesmo defeito potencial se o operador digitar/colar um token `{{contact.custom.x}}` no campo de slot. O guard `emptyTokenCount` só bloqueia quando o valor está vazio — se estiver preenchido, o token literal vai para a Meta.

---

## Plano de correção

Escopo: apenas fluxo de envio de template (campanha + 1:1). Sem mexer em ChatPanel, whatsappRouter, wa-meta-send, webhook-meta, webhook-uazapi.

### 1. `supabase/functions/campaign-dispatch/index.ts` — resolver completo

- Trocar `resolveTemplateVariable` por um resolvedor que suporta:
  - `{{contact.name|email|phone}}`
  - `{{contact.custom.<chave>}}` (lê `contact.custom_fields[chave]`)
  - `{{opportunity.title|value}}` e `{{opportunity.custom.<chave>}}` (carrega oportunidade aberta do contato, se existir, para paridade com o seletor do frontend)
- Adicionar `custom_fields` ao SELECT de contato (linha 156).
- Carregar a oportunidade aberta mais recente do contato (`opportunities` por `contact_id`, `status='open'`, ordenado por `updated_at`) — uma query batch por tick.
- Token não resolvido (sem fallback): registrar `campaign_recipients.status='failed'` com `error='unresolved_variable:<token>'` em vez de enviar literal. Isso evita reincidência silenciosa.
- Persistir em `variables_used` o **valor já resolvido** (hoje persiste o template raw quando há falha).

### 2. Envio 1:1 — `src/components/inbox/SendTemplateDialog.tsx`

- Antes de chamar `buildMetaComponents`, substituir `values[s.id]` por `resolveToken(token)` quando o valor for um token puro `{{...}}`.
- Para slots com valor misto (texto + token), aplicar `text.replace(VAR_RE, ...)` usando o mesmo `resolveToken`.
- Manter o guard `emptyTokenCount` (bloquear envio quando resolve para vazio).
- Resultado: a UI nunca mais entrega `{{...}}` literal ao `wa-meta-send`.

### 3. Defesa-em-profundidade — `worker/index.js` (`send_whatsapp_template`, linha 501)

- Estender `interp()` para também resolver `contact.custom.<chave>` e `opportunity.*` (carregando `custom_fields` e a oportunidade aberta). Mesmo padrão da edge function — função utilitária compartilhada inline (sem novo módulo).
- Loggar warning quando uma variável não resolve (não bloquear — apenas marcar no job result).

### 4. Telemetria pontual (sem migration nova)

- Em `campaign-dispatch`, ao detectar token não resolvido, escrever em `campaigns.last_error` (ou inserir em `webhook_events`/log existente — confirmar na implementação qual já existe) para a admin SOS conseguir auditar sem abrir banco.

### Arquivos a alterar

- `supabase/functions/campaign-dispatch/index.ts` — novo resolvedor + SELECT com `custom_fields` + hidratar oportunidade + fail-on-unresolved.
- `src/components/inbox/SendTemplateDialog.tsx` — resolver tokens antes de `buildMetaComponents`.
- `worker/index.js` (`send_whatsapp_template`) — `interp` ampliado para custom/opportunity.

### Sem migration

Nenhum schema novo é necessário. `contacts.custom_fields` e `opportunities.custom_fields` (JSONB) já existem.

### Validação pós-deploy

1. Repetir o envio da campanha "NV 15/06 09H" para um contato de teste com `custom_fields.nome_para_envio = 'Maria'` → confirmar via `campaign_recipients.variables_used` que ficou `{"1":"Maria"}` e que a mensagem entregue mostra "Oi, Maria!".
2. Repetir o envio para um contato **sem** `nome_para_envio`: deve marcar `failed` com `error='unresolved_variable:contact.custom.nome_para_envio'`, **sem enviar**.
3. No 1:1 (`SendTemplateDialog`), tentar enviar com o token: confirmar que vai resolvido ou bloqueado, nunca literal.

### Comunicação à Patrícia (SOS)

- Sim, a mensagem **foi enviada com o token literal** ao cliente — não é bug de exibição no CRM. Já temos a evidência no `variables_used`.
- A correção entra em produção com o deploy; recomendamos não disparar novas campanhas com variáveis `contact.custom.*` até o deploy concluir.
