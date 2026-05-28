# Persistir conversa aberta ao trocar de aba

## Diagnóstico (causa raiz)

Ao voltar para a aba, o Supabase Auth dispara `TOKEN_REFRESHED` (e às vezes `SIGNED_IN`) em `onAuthStateChange`. No `AuthContext`:

- `handleSession` roda para **todo** evento e, quando o evento é `SIGNED_IN`, recarrega `loadUserData` e seta `loading = true`.
- Em `App.tsx`, `AppRoutes` faz `if (loading) return null;` — isso **desmonta toda a árvore de rotas**, incluindo `InboxPage`.
- Ao remontar, `InboxPage` lê `selectedConv` de `searchParams.get('conv')`, mas o próprio componente limpa a URL com `setSearchParams({}, { replace: true })` logo após abrir a conversa. Resultado: a conversa selecionada (e o scroll/estado do chat) se perdem e o usuário cai na tela "Selecione uma conversa".

## Correção (mínima e cirúrgica)

### 1. `src/contexts/AuthContext.tsx`
Evitar derrubar `loading` em refreshes/focus:
- Adicionar flag `initialLoadDone` (ref ou variável do effect).
- Em `handleSession`, só setar `setLoading(true)` na primeira carga. Para eventos posteriores (`TOKEN_REFRESHED`, `SIGNED_IN` quando já temos dados), apenas atualizar `session/user` em silêncio, sem recarregar `loadUserData` e sem mexer em `loading`.
- Manter o recarregamento total apenas em `SIGNED_OUT` ou troca real de usuário (`sess?.user?.id` diferente do atual).

### 2. `src/pages/InboxPage.tsx`
Persistir a conversa aberta na URL para sobreviver a qualquer remount/refresh:
- Remover o `setSearchParams({}, { replace: true })` que limpa `?conv=`.
- Em vez disso, ao trocar `selectedConv`, sincronizar com a URL: `setSearchParams(conv ? { conv } : {}, { replace: true })`.
- Inicialização continua a partir de `searchParams.get('conv')`.

## Fora de escopo
- Sem mudanças em backend, RLS, edge functions ou roteador WhatsApp.
- Sem alterações visuais.

## Verificação
- Abrir uma conversa no Inbox, trocar de aba por >30s, voltar: a conversa deve permanecer aberta, sem flash de loading global.
- Recarregar a página (F5) com `?conv=<id>` na URL: a conversa abre direto.
