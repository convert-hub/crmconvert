## Objetivo

Quando a Meta recusar uma mensagem **fora da janela de 24h** (cliente não interagiu nas últimas 24h e não é template), exibir mensagem clara em pt-BR: "Cliente fora da janela de 24h. Envie um template." Com ação rápida para abrir o diálogo de templates. Vale para `ChatPanel` (usado tanto no Inbox quanto no chat lateral do CRM/Pipeline — mesmo componente).

## Diagnóstico forense

- `wa-meta-send` (linha 443-451): qualquer falha do Graph hoje devolve `{ ok: false, error: sendData.error.message }` cru, sem classificação.
- Meta retorna **`error.code = 131047`** para "Re-engagement message" (janela de 24h expirada) — mensagem oficial: *"Message failed to send because more than 24 hours have passed since the customer last replied to this number."* Outros códigos correlatos:
  - `131026` "Message Undeliverable"
  - `131051` "Unsupported message type"
  - `131056` (pair rate limit)
- `ChatPanel.handleSend` (linha 377-381) e `handleSendMedia` (linha 464-465) só mostram `toast.warning('Falha ao enviar via WhatsApp: ' + res.error)`. Mensagem chega ao usuário em inglês e sem contexto.
- A mensagem persistida (linha 356-359 e 437-442) **não é removida** quando o envio falha — isso cria a ilusão visual de que o cliente recebeu. Vamos corrigir junto, pois é a causa-raiz da percepção do usuário ("não retornou nenhuma mensagem dizendo que não enviou").

## Mudanças

### 1. `supabase/functions/wa-meta-send/index.ts`
- Adicionar helper `classifyGraphError(data)` que mapeia `error.code` para `{ code, error }` em pt-BR:
  - `131047` → `outside_24h_window`, "Cliente fora da janela de 24h. Envie um template para reativar a conversa."
  - `131026` → `message_undeliverable`, "Mensagem não pôde ser entregue (número inválido ou sem WhatsApp)."
  - `131051` → `unsupported_message_type`, "Tipo de mensagem não suportado pela Meta."
  - Fallback: `meta_send_failed` com a mensagem original.
- Aplicar nos dois pontos onde o Graph retorna erro de envio: `sendR.ok === false` em `text/template/media` (linha 443) e em `send_media_base64` (linha 373).
- Manter `200 OK` no transporte HTTP (padrão do projeto para não derrubar o SDK).

### 2. `src/components/inbox/ChatPanel.tsx`
- Em `handleSend`, ao receber `res.ok === false`:
  - Se `res.code === 'outside_24h_window'`: `toast.error(res.error, { action: { label: 'Enviar template', onClick: () => setShowTemplate(true) }, duration: 8000 })`.
  - Outros códigos: `toast.error(res.error ?? 'Falha ao enviar')`.
  - Em qualquer falha: deletar a row persistida (`supabase.from('messages').delete().eq('id', savedMsg.id)`) e remover do `setMessages` local — assim o usuário vê claramente que não foi entregue.
  - Restaurar o conteúdo no input (`setNewMsg(msgContent)`) para o usuário poder reaproveitar.
- Mesma lógica em `handleSendMedia` (sem restaurar input, óbvio).
- Não alterar o caminho de sucesso nem o de notas internas.

### 3. Sem alterações
- `OpportunityDetail`/CRM: reusa `ChatPanel`, então herda automaticamente.
- `uazapi-proxy`: instância UAZAPI não tem janela de 24h da Meta — não tocar.
- Banco, RLS, schema: nada.

## Garantias de não-regressão
- Códigos novos são opcionais; consumidores existentes ignoram `res.code`.
- Sucesso e fluxo de templates continuam idênticos.
- Apenas mensagens com falha confirmada são removidas; sucesso e otimismo permanecem.
- Toasts pt-BR alinhados ao restante do sistema (`src/lib/labels.ts` style).

## Texto final exibido
> "Cliente fora da janela de 24h. Envie um template para reativar a conversa." [Enviar template]
