## Causa-raiz

A função `uazapi-history-sync-contacts` chama `POST /message/find` passando `{ chatid: "55XXX@s.whatsapp.net", limit, offset }`. Logs mostram apenas `booted` — nenhuma falha de HTTP nem erro de upsert: a UAZAPI está respondendo **200 com lista vazia**, porque o filtro por `chatid` está silenciosamente ignorado ou usa outro nome/formato. A função antiga (`uazapi-history-sync`) funciona justamente porque **não** passa filtro: ela puxa tudo da instância e agrupa por chat no servidor.

Portanto, o problema é o contrato do endpoint `/message/find` com filtro por chat — não a persistência.

## Correção

### 1. Instrumentar a função para diagnóstico imediato
Adicionar logs `console.log` na primeira chamada de cada telefone:
- payload enviado
- status HTTP
- chaves do JSON de resposta e tamanho da lista detectada

Isso confirma em uma nova execução qual variante o servidor aceita.

### 2. Sondar variantes de payload e usar a primeira que retorna mensagens
Para o primeiro telefone do lote, tentar em sequência (parando na primeira que vier não-vazia):

1. `{ chatid: "55XXX@s.whatsapp.net", limit, offset }` — atual
2. `{ chatid: "55XXX", limit, offset }` — só dígitos
3. `{ chatId: "55XXX@s.whatsapp.net", limit, offset }` — camelCase
4. `{ number: "55XXX", limit, offset }` — nome alternativo comum em UAZAPI v2
5. `{ jid: "55XXX@s.whatsapp.net", limit, offset }`

Guardar a variante vencedora em memória do request e usar para os demais telefones do mesmo lote. Logar `winner_variant`.

### 3. Fallback de segurança (modo "varredura")
Se nenhuma variante retornar mensagens para os 3 primeiros telefones, cair para o modo da função antiga: uma única chamada `POST /message/find` sem `chatid`, paginando até 10 páginas de 100, e filtrar localmente pelos `chatid` correspondentes aos telefones pedidos. É mais caro, mas garante o backfill.

Ativar esse fallback automaticamente após a sondagem; logar `fallback_scan: true` quando usado.

### 4. Resposta e UI
Incluir `winner_variant` e `fallback_scan` no JSON de retorno. Expor esses campos como toast/dica no `BulkHistorySyncDialog` para o usuário ver qual caminho foi tomado.

### 5. Validação
Após o deploy, rodar novamente o "Histórico WA" com escopo "Apenas contatos sem conversa". Esperado:
- nos logs: `winner_variant` definido ou `fallback_scan: true`
- toast: número > 0 de conversas e mensagens, se de fato houver histórico nos 30 dias.

Se ainda voltar 0 mesmo com fallback de varredura, a causa estará confirmada como ausência de histórico na própria UAZAPI (mensagens >30 dias, ou instância recém-conectada sem cache), e ajustamos a mensagem na UI.

## Arquivos tocados

- `supabase/functions/uazapi-history-sync-contacts/index.ts` — sondagem de variantes, fallback de varredura, logs
- `src/lib/historySync.ts` — propagar `winner_variant` e `fallback_scan`
- `src/components/contacts/BulkHistorySyncDialog.tsx` — exibir o caminho usado no resultado

Nenhuma mudança em schema, RLS, contratos públicos ou na função antiga `uazapi-history-sync`.