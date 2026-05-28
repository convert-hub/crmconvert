## Objetivo

Adicionar um badge discreto que mostra há quanto tempo o **contato** (apenas mensagens `direction = inbound`) enviou a última mensagem. Deve aparecer em:

1. Cada item da lista de conversas no Inbox (`src/pages/InboxPage.tsx`).
2. Cada card de oportunidade no Pipeline (`src/pages/PipelinePage.tsx`).

## Fonte de dados (sem migração)

A coluna `conversations.last_customer_message_at` já existe e é mantida pelo backend a cada mensagem inbound (webhook-meta / webhook-uazapi). Usaremos ela como verdade — sem novas queries em `messages`, sem migração de schema.

- **Inbox**: a query atual de `conversations` já retorna o campo. Basta consumir.
- **Pipeline**: hoje carrega `opportunities` + `contact`, mas não puxa `last_customer_message_at`. Vamos adicionar um único `select` agregado em `conversations` (filtrado por `tenant_id` e `contact_id IN (...)`) e montar um mapa `contactId → maxLastCustomerAt` para enriquecer cada card.

## Mudanças

### 1. `src/pages/InboxPage.tsx`
- No item da lista (dentro do `flex` que já tem o status badge), renderizar um `Badge` outline pequeno com ícone `Clock` e texto `formatDistanceToNow(last_customer_message_at, { locale: ptBR, addSuffix: true })`.
- Se `last_customer_message_at` for nulo, não renderizar.
- Reutilizar tokens semânticos (`bg-muted/40 text-muted-foreground border-border/50`), tamanho `text-[10px] rounded-full`, alinhado aos demais badges.

### 2. `src/pages/PipelinePage.tsx`
- Em `loadOpps()` (linha ~464), após carregar `opportunities`, fazer uma segunda query:
  ```ts
  supabase.from('conversations')
    .select('contact_id, last_customer_message_at')
    .eq('tenant_id', tenant.id)
    .in('contact_id', contactIds)
    .not('last_customer_message_at', 'is', null)
  ```
  Reduzir para `Record<contactId, ISOString>` mantendo o maior valor.
- Guardar em novo state `lastContactInteractionByContact`.
- Propagar via prop `lastContactInteractionAt?: string | null` para `SortableOppCard`.
- No card, abaixo do bloco de contato (linha ~192-197), adicionar uma linha discreta:
  ```
  <Clock className="h-3 w-3" /> <span>{formatDistanceToNow(...)}</span>
  ```
  Padrão `text-[11px] text-muted-foreground pl-5`, só renderiza quando há valor.
- O realtime já existente em `conversations` (linha 638) dispara `loadOpps()`, então o badge atualiza automaticamente quando chega mensagem nova.

### 3. Sem alterações em
- Backend, webhooks, RLS, schema.
- Lógica de inatividade (`alertStatus`), drag-and-drop, filtros, contadores, busca por nome/telefone.
- `ChatPanel`, `OpportunityDetail`.

## Garantias de não-regressão
- Apenas leitura adicional + render condicional.
- A query extra usa `.in('contact_id', contactIds)` com array possivelmente vazio — tratar com early-return para evitar request inútil.
- Nenhuma prop existente alterada; novas props são opcionais.
- Tokens semânticos preservados (sem cores hardcoded).
- Sem mudanças no fluxo de envio/recebimento de mensagens.

## Texto exibido (pt-BR)
Usa `date-fns` com `ptBR` já importado nesses dois arquivos: ex. "há 3 minutos", "há 2 horas", "há 1 dia". Tooltip (`title`) com data/hora completa para precisão.
