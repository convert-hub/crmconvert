# Áudio indisponível em outro computador — causa raiz e correção

## Diagnóstico forense

O sintoma "funciona em um computador e em outro não" tem uma causa única e bem identificada no código:

**Os áudios nunca são armazenados de forma persistente.** Eles são baixados sob demanda da UAZAPI/Meta toda vez que alguém abre a conversa, e ficam apenas em cache de memória do navegador.

Trecho relevante (`src/components/inbox/ChatPanel.tsx`):

```ts
// linha 34 — cache vive apenas na aba aberta
const mediaCache = new Map<string, string>();

// linha 92+ — toda renderização chama downloadMedia() na UAZAPI/Meta
const res = await downloadMedia({ conversationId, tenantId, providerMessageId, ... });
if (!res.ok) { mediaCache.set(id, 'expired'); ... }
```

No banco (`messages.media_url`) salvamos apenas a URL temporária que a UAZAPI devolveu no webhook (`worker/index.js` linha 297, `webhook-uazapi` linha 170). Essa URL e o próprio arquivo na UAZAPI **expiram** (WhatsApp mantém mídia por ~14 dias; URLs assinadas da UAZAPI expiram bem antes).

Sequência exata do bug:

```text
Dia 1, Computador A:
  - mensagem chega → webhook salva media_url temporária
  - usuário abre a conversa → ChatPanel baixa via UAZAPI → toca o áudio
  - cache em memória (Map) guarda o data:base64 → toca instantaneamente nas próximas vezes

Dia 10, Computador B (ou aba nova / outro navegador / após F5):
  - mediaCache está vazio (é só RAM)
  - ChatPanel chama downloadMedia → UAZAPI já apagou o arquivo
  - retorna ok:false → exibe "Áudio expirado ou indisponível no WhatsApp"
```

Não há nada de específico do "outro computador" — é sempre o mesmo bug. O computador A só "funciona" porque pegou o áudio enquanto ainda estava vivo na UAZAPI e manteve em RAM. Qualquer computador (inclusive o A após recarregar a aba muitos dias depois) vai falhar igual.

Confirmações adicionais:
- Não existe bucket/Storage de mídia recebida (busquei `storage`/`bucket` no worker — só aparece para `documents` do RAG, não para mensagens).
- A transcrição via Whisper é salva em `provider_metadata.audio_transcription`, mas o binário do áudio é descartado.
- O `AudioPlayer` é puramente client-side e não tem nenhum problema de gesto/permissão — o áudio simplesmente não chega até ele.

## Correção proposta

Persistir o binário do áudio no Supabase Storage assim que ele entra, e servir dali para sempre. Duas frentes:

### 1. Bucket privado para mídia recebida

Migration: criar bucket `whatsapp-media` (privado), com policies que permitem ao tenant ler apenas seus próprios arquivos (`tenant_id/...` no path). Coluna nova `messages.storage_path text` para guardar o caminho.

### 2. Worker: salvar o áudio no momento em que processa a mensagem

No `worker/index.js`, no fluxo de inbound de áudio (já existente, perto da linha 184 onde transcreve), após baixar o blob para o Whisper:

- Subir o mesmo blob para `whatsapp-media/{tenant_id}/{message_id}.{ext}`
- Gravar `storage_path` na linha de `messages`
- Reaproveitar o download que já fazemos hoje para transcrição (não baixa duas vezes)

Fazer o mesmo para áudios já transcritos antigos é opcional — explico abaixo.

### 3. Frontend: ler do Storage primeiro, UAZAPI como fallback

Em `ChatPanel.tsx` / `whatsappRouter.downloadMedia`:

- Se `msg.storage_path` existe → gerar signed URL do bucket e tocar direto (sem chamar UAZAPI nunca mais)
- Se não existe (mensagens antigas) → tenta UAZAPI como hoje; se vier ok, faz upload oportunístico para o Storage e atualiza `storage_path` (self-healing para mensagens recentes que ainda não expiraram)

### 4. Limites e custos

- Aplicar apenas a `audio`/`ptt` nesta fase (o que o usuário reportou). Imagens/vídeos/documentos podem entrar em fase seguinte com o mesmo padrão.
- Áudio de WhatsApp é opus/ogg, ~6 KB/s → conversas inteiras pesam pouco. Sem limite agressivo nesta fase.

## Detalhes técnicos

**Arquivos a alterar:**

- `supabase/migrations/<novo>.sql` — bucket `whatsapp-media` + policies (RLS no storage por `tenant_id` do path, helper já existente `is_member_of_tenant`); `ALTER TABLE messages ADD COLUMN storage_path text`.
- `worker/index.js` — no bloco de inbound de áudio: após obter o `audioBlob` (hoje só usado por `transcribe-audio`), fazer `supabase.storage.from('whatsapp-media').upload(...)` e `UPDATE messages SET storage_path=...`. Refatorar levemente para reaproveitar o download que `transcribe-audio` já faz (ou mover o download para o worker e passar base64 pronto para a edge function).
- `supabase/functions/transcribe-audio/index.ts` — opcional: aceitar `audio_base64` já baixado para evitar segunda chamada à UAZAPI.
- `src/components/inbox/ChatPanel.tsx` (`MediaBubble`/`loadMedia`) — prioridade: `storage_path` → signed URL; fallback: UAZAPI + upload oportunístico.
- `src/lib/whatsappRouter.ts` — pequeno helper `getStorageSignedUrl(storagePath)` ou tratar direto no ChatPanel.
- `src/integrations/supabase/types.ts` — regenerado.

**Fora do escopo (desta fase):**

- Backfill de áudios antigos que já expiraram na UAZAPI (não há como recuperar — perdidos).
- Persistência de imagens/vídeos/documentos (mesma solução, fase seguinte).
- Mudanças no `AudioPlayer`, no fluxo de gravação, ou no envio outbound (não são a causa).

Após aprovar, implemento exatamente isso.
