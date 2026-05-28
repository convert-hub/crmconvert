## Diagnóstico forense

A mensagem foi enviada com sucesso (chegou ao contato), mas não pode ser reproduzida porque a UI mostra "Áudio expirado ou indisponível no WhatsApp".

**Causa-raiz (não é expiração real):**

1. `MediaBubble` em `src/components/inbox/ChatPanel.tsx` (linhas 90-141) chama `downloadMedia(...)` para tocar áudios outbound. Para `provider = meta_cloud`, `whatsappRouter.downloadMedia` exige `metaMediaId`. Se vier `null`, devolve `{ ok: false }` imediatamente e o bubble cai no estado `expired` (linha 162 do router).

2. No envio outbound de mídia via Meta:
   - `ChatPanel.handleSendMedia` pré-insere a row em `messages` (linhas 437-442) sem `provider_metadata`.
   - Chama `sendMedia` → `wa-meta-send` com `skip_persist: true`.
   - `wa-meta-send` faz upload → recebe `media_id` da Meta → envia a mensagem → retorna **apenas** `provider_message_id`. O `media_id` é descartado.
   - O `ChatPanel` então só faz `update({ provider_message_id })` (linha 467). **Nunca grava `provider_metadata.meta_media_id`.**

3. Resultado: ao tentar reabrir, `metaMediaId` é `null` → "expirado". O mesmo bug afeta imagem, vídeo e documento outbound via Meta (não só áudio).

UAZAPI não é afetado: `downloadMedia` no UAZAPI usa `provider_message_id` (não exige media_id próprio).

## Correção

Mínima, restrita à camada de envio Meta. Sem mexer em UAZAPI, recepção, transcrição, player ou worker.

### 1. `supabase/functions/wa-meta-send/index.ts`
No branch `send_media_base64`, depois do upload bem-sucedido, propagar o `media_id` da Meta na resposta final:
- Guardar `uploadedMediaId = upData.id` antes de cair no fluxo de envio.
- Incluir `meta_media_id: uploadedMediaId` no JSON de retorno (junto com `provider_message_id`).
- Também incluí-lo no `provider_metadata` quando `skip_persist` for `false` (persistência server-side), para paridade.

### 2. `src/lib/whatsappRouter.ts`
Expor `meta_media_id` no `SendResult`:
- Adicionar campo opcional `meta_media_id?: string | null` em `SendResult`.
- Em `sendMedia` (branch `meta_cloud`), repassar `data?.meta_media_id ?? null`.

### 3. `src/components/inbox/ChatPanel.tsx`
Em `handleSendMedia`, após `res.ok` e antes/junto do update de `provider_message_id`:
- Atualizar a row de `messages` com `provider_metadata: { provider: 'meta_cloud', meta_media_id: res.meta_media_id }` quando vier preenchido.
- Manter `media_type` minúsculo (`'audio'`/`'image'`/...) **não** é necessário mudar — o `MediaBubble` já normaliza com `toLowerCase()` e usa `includes('audio')`, então `'AudioMessage'` continua funcionando.

## Impacto e riscos

- Áudios/imagens/vídeos/documentos **novos** enviados via Meta passam a reabrir e tocar normalmente.
- Mensagens **antigas** outbound (já no banco sem `meta_media_id`) continuam mostrando "expirado" — não é possível recuperar o `media_id` retroativamente. Sem backfill.
- Nenhuma mudança em recepção (inbound), UAZAPI, player, worker ou esquema do banco.
- A Meta mantém o `media_id` baixável por ~30 dias usando o mesmo token.

## Validação

1. Enviar áudio no tenant SOS via API oficial.
2. Confirmar que após o envio a bolha mostra o player (não "expirado").
3. Recarregar a conversa → o áudio continua tocando (re-download via `download_media` usa o `meta_media_id` salvo).
4. Repetir com imagem e documento para confirmar paridade.