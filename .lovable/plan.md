## Plano

Sim, dá pra fazer e funciona igual nos dois provedores (Meta Cloud e UAZAPI) — emojis são apenas caracteres Unicode no texto, então o fluxo de envio atual não muda.

### Implementação

1. Adicionar dependência `emoji-picker-react` (leve, sem libs nativas).
2. Em `src/components/inbox/ChatPanel.tsx`:
   - Novo botão ícone `Smile` (lucide) na barra do input, ao lado do anexo/áudio.
   - Popover com o `EmojiPicker` (tema seguindo o design system, busca em pt-BR).
   - Ao selecionar, insere o emoji na posição atual do cursor do `Textarea` (`newMsg`), preservando seleção.
   - Fechar ao clicar fora ou ao enviar.
3. Sem mudanças em edge functions, banco, roteador ou nota interna — o emoji entra como texto normal.

### Arquivos

- `src/components/inbox/ChatPanel.tsx` (UI + handler).
- `package.json` (dependência nova).