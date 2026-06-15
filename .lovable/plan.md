# Diagnóstico — SOS Tecnologia

## 1) Causa raiz: conversas "sumindo" da Inbox

**Não estão sumindo.** A consulta em `src/pages/InboxPage.tsx:101` traz no máximo **100 conversas**, ordenadas por `last_message_at DESC`:

```ts
supabase.from('conversations')
  .select('*, contact:contacts(*)')
  .eq('tenant_id', tenant.id)
  .order('last_message_at', { ascending: false })
  .limit(100);
```

Estado real do tenant SOS no banco (consulta agora):

| Janela              | Conversas |
| ------------------- | --------- |
| Total no tenant     | **218**   |
| Últimos 7 dias      | 199       |
| Últimas 24 horas    | **146**   |
| Últimas 6 horas     | 79        |

Como há **146 conversas movimentadas nas últimas 24h** e o limite é 100, todas as posições 101+ ficam de fora — coincidentemente o "corte" cai por volta de 6h atrás (varia conforme o ritmo de mensagens). Patrícia não está perdendo conversa nenhuma: elas existem, só não cabem na listagem. Filtrar/buscar por nome do contato também não acha, porque o filtro roda sobre o array já truncado em 100 itens.

Não há nenhum job, trigger ou política de RLS apagando/escondendo conversas — verificado.

## 2) Correção proposta (Inbox)

Frontend apenas, sem mudança de schema:

1. **Subir o limite padrão** para 300 (cobre o tenant com folga, mantém payload aceitável — `contact` é join leve).
2. **Paginação "Carregar mais"** no fim da lista: botão que faz nova query com `range()` em incrementos de 200, acumulando no estado. Mantém ordenação por `last_message_at DESC`.
3. **Busca server-side quando há termo digitado**: se `search.length >= 2`, refazer a query com `.or('contact.name.ilike.%X%,contact.phone.ilike.%X%')` em vez de filtrar o array local — assim a busca encontra conversa antiga mesmo que não esteja carregada.
4. Indicador discreto "mostrando N de M" no rodapé da lista (M vem de um `count: 'exact', head: true` separado).

Arquivo afetado: `src/pages/InboxPage.tsx` (e tipos relacionados se necessário).

## 3) Mensagens "Message undeliverable" — investigação e resposta à Patrícia

Inspecionei as mensagens com falha do tenant SOS. Todas as falhas recentes vêm do **Meta Cloud API** (não UAZAPI), com `error_code = 131026` ("Message undeliverable"), em templates como `sos_nutricao_geral_09_06` e `sos_resgate_negociacao`.

**Cobrança:** o código 131026 da Meta é falha de entrega no lado do destinatário (número sem WhatsApp ativo, bloqueio, conta desativada, etc.). A Meta documenta que **conversas com status final `failed` não geram cobrança** — só são faturadas conversas efetivamente abertas/entregues. Portanto **essas mensagens não foram cobradas**.

Causas típicas do 131026 para o padrão observado (vários números 5531... falhando em sequência):
- Número não tem WhatsApp ativo.
- Contato bloqueou o número da clínica.
- Qualidade do número (quality rating) caiu e a Meta está bloqueando entregas para parte da base.

**Entregável extra (opcional):** posso gerar um CSV com os contatos que receberam 131026 nos últimos 7 dias para a Patrícia auditar a base — sem alteração de código, só consulta. Me avise se quer junto.

## Detalhes técnicos

- `messages` não tem coluna `status`; o estado de entrega vive em `provider_metadata.last_status` e `provider_metadata.statuses[]`. A listagem de falhas usa `provider_metadata::text ILIKE '%undeliver%'` ou `provider_metadata->>'last_status' = 'failed'`.
- A paginação no Inbox precisa preservar o comportamento atual de realtime (canal `inbox-convs-${tenant.id}`): ao receber INSERT/UPDATE, recarregar **a primeira página** e mesclar mantendo as páginas extras já carregadas, para não perder o scroll.
- A política RLS de `conversations` já permite ao papel `attendant` ver não-atribuídas + próprias — o `.or(...)` atual continua válido após paginação.

## Fora de escopo

- Não vou mexer no schema do banco.
- Não vou tocar no fluxo de envio de templates (problema da variável já foi corrigido em entrega anterior).
- Não vou implementar dashboard de entregabilidade agora — se Patrícia quiser, abrimos como tarefa separada.
