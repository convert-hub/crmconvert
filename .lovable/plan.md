## Filtro de "Não lidas" na Inbox

Adicionar um toggle simples no topo da lista de conversas (`src/pages/InboxPage.tsx`) para mostrar apenas conversas com `unread_count > 0`.

### UX

Logo abaixo do campo de busca, dois chips minimalistas lado a lado:

```
[ Todas ]  [ Não lidas (12) ]
```

- O contador em "Não lidas" mostra o total de conversas com `unread_count > 0` carregadas.
- Estado ativo destacado (mesmo padrão visual dos badges já existentes).
- Persistir escolha em `localStorage` (`inbox:filter`) para a Patrícia não ter que reativar a cada visita.

### Comportamento

- **Filtro client-side por padrão**: aplicado sobre `conversations` já carregadas (mesma lista paginada de 300), combinando com busca textual quando houver.
- **Quando "Não lidas" está ativo + busca vazia**: a query base ganha `.gt('unread_count', 0)` no Supabase, para que a paginação ("Carregar mais") traga apenas não lidas e o contador `totalCount` reflita o total real de não lidas no tenant — evita o caso "tenho 50 não lidas mas só vejo 8 nas 300 carregadas".
- **Quando "Não lidas" + busca ativa**: mantém busca server-side por contato e aplica `unread_count > 0` no filtro de conversas.
- **Realtime**: ao receber update de `conversations`, recarrega respeitando o filtro atual (já existe esse fluxo, só precisa repassar o flag).
- **Abrir conversa**: ao zerar `unread_count` (linha 223), se filtro "Não lidas" estiver ativo a conversa **permanece visível** enquanto selecionada, mas some da lista ao trocar de seleção (evita "pular" item embaixo do cursor da usuária).

### Arquivos

- `src/pages/InboxPage.tsx` — único arquivo alterado. Novo estado `filterMode: 'all' | 'unread'`, ajuste em `baseQuery()`/`loadConversations`, no `useMemo` de `filtered`, e UI dos chips.

### Fora de escopo

- Filtros adicionais (por status, por responsável, por tag) — pode virar próximo passo se a Patrícia pedir.
- Notificação sonora / badge no menu lateral.
