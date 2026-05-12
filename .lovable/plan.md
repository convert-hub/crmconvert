## Causa raiz

Quando o template é enviado pelo `SendTemplateDialog`, a Edge Function `wa-meta-send` insere a row em `messages` com `content = ""` e `media_type = null` (porque template não é text nem mídia). O `ChatPanel` então renderiza um bubble **vazio** — daí a impressão de que a mensagem "não aparece".

A mensagem está no banco e chegou ao WhatsApp; falta apenas conteúdo visível e marcação semântica.

## Correção

### 1. `supabase/functions/wa-meta-send/index.ts` (persistência outbound de template)

No bloco `if (conversation?.id && !body.skip_persist)`:

- Quando `t === 'template'`, compor um **texto-preview** a partir de `body.template`:
  - Buscar o template (`whatsapp_message_templates` por `whatsapp_instance_id + name + language`) para obter os componentes originais (BODY/HEADER/FOOTER) com placeholders.
  - Substituir `{{1}}…{{n}}` e `{{nome}}` etc. pelos valores enviados em `body.template.components`.
  - Se busca falhar, usar fallback `"[Template: <nome>]"`.
- Setar `media_type = 'TemplateMessage'` (mesma string usada nos inbounds, para consistência com `hasMedia`/labels existentes).
- Adicionar em `provider_metadata`:
  ```json
  { "provider": "meta_cloud", "template_name": "...", "template_language": "...", "raw": ... }
  ```

### 2. `src/components/inbox/ChatPanel.tsx` (renderização)

- Em `hasMedia`, NÃO tratar `templatemessage` como mídia (ele não tem download; é só texto).
- Ajustar a condição da linha 514 para garantir que templates (com `media_type === 'TemplateMessage'`) renderizem o `content` (que agora vem preenchido do passo 1).
- Adicionar um pequeno selo "Template" acima do texto quando `media_type === 'TemplateMessage'` (visual leve, badge/ícone), para diferenciar de mensagens livres.

### 3. `src/components/inbox/SendTemplateDialog.tsx` (UX, opcional mas recomendado)

- Após `onSent`, disparar um refresh imediato do ChatPanel (já existe via realtime; manter como está).
- Sem mudanças funcionais além disso.

## Arquivos modificados

- `supabase/functions/wa-meta-send/index.ts` — preview text + media_type 'TemplateMessage' + metadata.
- `src/components/inbox/ChatPanel.tsx` — render correto de templates outbound + badge.

## Verificação

1. Reenviar o template `follow_up` para o mesmo contato.
2. Conferir que o bubble aparece com o texto renderizado (ex.: `Oi Maria, ...`) e o selo "Template".
3. Conferir no DB que a nova row tem `content` não-nulo e `media_type = 'TemplateMessage'`.
