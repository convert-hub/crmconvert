Corrigir vazamento cross-tenant na subscription real-time de mensagens do `OpportunityDetail.tsx`.

### Problema
O `useEffect` em src/components/crm/OpportunityDetail.tsx (linhas ~172-178) cria um canal real-time baseado em `opportunityId` e escuta **todos** os INSERTs na tabela `messages` sem filtro por `conversation_id`. Isso faz com que mensagens de conversas de outros tenants (ou de outras oportunidades) sejam inseridas no timeline da oportunidade aberta.

### Solução
1. Remover o `useEffect` de real-time atual que depende de `opportunityId`.
2. Adicionar um novo `useEffect` que dependa exclusivamente de `chatConvId`.
3. Dentro desse novo efeito, quando `chatConvId` existir, criar um canal `supabase.channel(`conv-messages-${chatConvId}`)`.
4. Inscrever em `postgres_changes` com filtro `conversation_id=eq.${chatConvId}` para que apenas mensagens da conversa vinculada sejam adicionadas ao estado `messages`.
5. Garantir cleanup com `supabase.removeChannel(channel)` no retorno do efeito.

### Código esperado
```typescript
useEffect(() => {
  if (!chatConvId) return;
  const channel = supabase.channel(`conv-messages-${chatConvId}`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'messages',
      filter: `conversation_id=eq.${chatConvId}`,
    }, payload => {
      setMessages(prev => [...prev, payload.new as unknown as Message]);
    }).subscribe();
  return () => { supabase.removeChannel(channel); };
}, [chatConvId]);
```

### Escopo
- Alterar apenas `src/components/crm/OpportunityDetail.tsx`.
- Não modificar carregamento inicial, ChatPanel, envio de mensagens ou outros efeitos.

### Risco
- A subscription só iniciará depois que `chatConvId` for resolvido. Como ele já é carregado no primeiro `useEffect`, a janela sem real-time é pequena. Se necessário, pode-se adicionar um pequeno refresh no carregamento da conversa, mas o filtro é a prioridade de segurança.