## Diagnóstico forense

**Mensagem exata:** `"Envio de mídia só disponível para WhatsApp"` — origem única em `src/components/inbox/ChatPanel.tsx:472`:

```ts
const isWhatsApp = channel === 'whatsapp';
if (!isWhatsApp || !contactPhone) {
  toast.error('Envio de mídia só disponível para WhatsApp'); return;
}
```

**Causa raiz (confirmada por inspeção de dados):**

O `ChatPanel` recebe `contact` e `channel` como **props** dos seus 3 chamadores (`InboxPage`, `PipelinePage`, `OpportunityDetail`). Quando qualquer um desses chamadores ainda não populou o objeto `contact` (ou está renderizando antes do `select(..., contact:contacts(*))` resolver / o objeto foi substituído por um payload de realtime que não trouxe o join / a conversa selecionada não está na página atual de `conversations`), os dois sintomas aparecem juntos:

- `contact?.phone` → `undefined` → bloqueia o envio de mídia.
- `contact?.name` → fallback `'Conversa'` em `InboxPage.tsx:67` e fallback `'Contato'` em `PipelinePage.tsx:963`.

Verificado no banco para o contato "36500 - Ednalva" (tenant SOS):
- `conversations.contact_id` está preenchido, `channel='whatsapp'`, contato existe no tenant correto, RLS idêntica entre `contacts` e `conversations`. **Os dados estão íntegros — o problema é exclusivamente de propagação de prop no cliente.**

**Não é reflexo das alterações recentes.** Os commits dos últimos dias tocaram apenas `BulkHistorySyncDialog`, `historySync.ts`, edge function `uazapi-history-sync-contacts`, `ImportContactsDialog` e o botão "Histórico WA" em `OpportunityDetail`. Nenhum desses arquivos altera o `ChatPanel`, o select de conversas no Inbox, ou a regra `channel === 'whatsapp'`. O `git log` por arquivo confirma — `ChatPanel.tsx` não é tocado desde `dee45f7` (anterior a esta série), `InboxPage.tsx` idem. A falha já existia; ficou visível agora porque um membro do SOS abriu uma conversa cujo `contact` não estava no estado do componente pai no momento do clique.

## Correção (mínima, cirúrgica)

Tornar o `ChatPanel` **autossuficiente** para envio de mídia e exibição do nome, eliminando dependência frágil de props transitórias. Sem alterar back-end nem RLS.

### 1. `src/components/inbox/ChatPanel.tsx`

Adicionar um estado local `resolvedContact` / `resolvedChannel` que, ao montar (e quando `conversationId` muda), faz **um único** select:

```ts
supabase.from('conversations')
  .select('channel, contact:contacts(id,name,phone,email)')
  .eq('id', conversationId).maybeSingle()
```

Regras:
- Se `props.contact` chega populado, usa ele (rápido, sem flicker).
- Se chega vazio, usa o resultado do fetch como fonte de verdade.
- `handleSendMedia` e `handleSendMessage` passam a ler `effectiveContact = props.contact ?? resolvedContact` e `effectiveChannel = props.channel ?? resolvedChannel`. Só bloqueia o envio quando **ambas as fontes** estiverem vazias.
- Header (linha 593) também usa o fallback resolvido — corrige o "?" e o subtítulo "conversa".

### 2. Nenhum outro arquivo é alterado

`InboxPage`, `PipelinePage`, `OpportunityDetail` continuam passando as props como hoje. A diferença é que o `ChatPanel` deixa de **depender** delas para operar.

## Validação

1. Abrir a conversa da Ednalva como membro do SOS → header mostra "36500 - Ednalva" + telefone (não mais "?" / "Conversa").
2. Gravar e enviar áudio → não dispara o toast; mídia sobe normalmente via `whatsapp-media` bucket.
3. Mensagens de texto continuam funcionando.
4. Conferir logs do `uazapi-send-media` no Supabase após o teste para confirmar que o payload chegou com `phone` correto.

## Por que não mexer no chamador?

Cada chamador tem racing diferente (URL deep-link no Inbox, realtime sem join no realtime payload, opp carregada async em Pipeline/Opportunity). Centralizar a resolução no `ChatPanel` resolve os três de uma vez e blinda contra qualquer chamador futuro.