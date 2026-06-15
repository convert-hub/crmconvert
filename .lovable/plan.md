## Filtro "Sem resposta" na Inbox

Adicionar terceiro chip ao filtro da lista de conversas (`src/pages/InboxPage.tsx`), usando `status = 'waiting_agent'` — sinal canônico que os webhooks já mantêm: marcado quando o cliente envia mensagem, limpo para `open` quando o atendente responde.

### UX

Chip extra na mesma linha dos atuais:

```
[ Todas ]  [ Não lidas (12) ]  [ Sem resposta (8) ]
```

- Mesma persistência em `localStorage` (`inbox:filter`).
- Mutuamente exclusivos (mesmo `filterMode`).
- Contador = conversas com `status='waiting_agent'` dentro das carregadas.

### Comportamento

- `filterMode` passa a aceitar `'all' | 'unread' | 'unanswered'`.
- `baseQuery()` e a query de busca por contato aplicam `.eq('status', 'waiting_agent')` quando `'unanswered'`.
- **Ordenação muda no modo "Sem resposta"**: por `last_customer_message_at asc` (quem está esperando há mais tempo aparece primeiro). Nos demais modos mantém `last_message_at desc` (atividade mais recente no topo).
- "Carregar mais" e contador total respeitam o filtro.

### Diferença vs. "Não lidas"

- **Não lidas**: `unread_count > 0` — atendente ainda não abriu.
- **Sem resposta**: `status = 'waiting_agent'` — pode ter aberto (zerou unread) mas ainda não respondeu.

### Arquivo

- `src/pages/InboxPage.tsx` — única alteração: expandir `filterMode`, ajustar `baseQuery()`/busca, alternar ordenação, adicionar chip.

### Fora de escopo

- Badge/alerta de SLA estourado (ex: vermelho se >1h sem resposta).
