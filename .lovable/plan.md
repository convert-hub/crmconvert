## Objetivo
Quando o usuário importa contatos via CSV, puxar do UAZAPI o histórico (30 dias) de cada telefone importado e gravar `conversations` + `messages`. Também permitir backfill manual para contatos **já importados** anteriormente.

## Diagnóstico do estado atual
- `uazapi-history-sync` existe, mas roda **uma única vez por instância** (disparada por `webhook-uazapi` na conexão), varrendo toda a instância nos últimos 30 dias.
- `webhook-uazapi` grava em tempo real toda mensagem nova após a conexão, criando contato pelo telefone normalizado.
- Importação atual (`ImportContactsDialog.tsx`) deduplica por telefone normalizado mas **não dispara fetch de histórico**.
- Conversas e mensagens são idempotentes: `conversations` por `(tenant_id, instance_id, provider_chat_id)` e `messages` por `(tenant_id, provider_message_id)`. Rodar backfill duas vezes não duplica.

## Plano

### 1. Nova edge function `uazapi-history-sync-contacts`
Backfill **por lista de telefones**, reaproveitando a persistência da `uazapi-history-sync`.

Input:
```json
{ "tenant_id": "...", "instance_id": "...", "phones": ["5511999...", ...] }
```

Fluxo:
1. Resolver `apiBase` + `instToken` (mesma lógica da função existente).
2. Para cada telefone normalizado:
   - Montar `chatid = <phone>@s.whatsapp.net`.
   - `POST /message/find` com `{ chatid, limit: 100 }`, paginando até esgotar ou cutoff de **30 dias**.
   - Persistir igual à função atual (upsert idempotente).
3. Retornar `{ ok, contacts_processed, chats_found, messages_inserted, messages_skipped, errors }`.

Limites:
- Máx. 500 telefones por chamada (cliente quebra em lotes).
- Máx. 10 páginas de 100 mensagens por telefone.
- Prefixo de log: `uazapi-history-sync-contacts:`.

### 2. UI — opção no `ImportContactsDialog`
- Antes de importar:
  - Checkbox **"Puxar histórico do WhatsApp (30 dias)"** — default ligado.
  - Se houver mais de uma `whatsapp_instances` ativa, mostrar `Select` compacto; se houver apenas uma, seleção silenciosa.
- Após import bem-sucedido, se ligado:
  - Coleta telefones normalizados que entraram (novos + atualizados).
  - Chama `uazapi-history-sync-contacts` em lotes de 100.
  - Progresso no modal ("Buscando histórico: X/Y"), e contadores finais (`conversas encontradas`, `mensagens importadas`).
- Falhas do backfill não invalidam o import — viram aviso.

### 3. Ação manual por contato
- **Em `ContactsPage`** (menu da linha): item **"Importar histórico WhatsApp"** → chama a função para 1 telefone, mostra toast com resultado.
- **Em `OpportunityDetail`** (header de ações): mesmo item.
- Se houver múltiplas instâncias, abre `Select` rápido antes de disparar.

### 4. Backfill em lote para contatos já importados
Para resolver os contatos que **já foram importados antes deste recurso existir**:

- **Em `ContactsPage` (header de ações):** botão **"Importar histórico WhatsApp"**.
- Modal compacto:
  - `Select` da instância (se >1).
  - Escopo: `Todos os contatos filtrados` (respeita filtros atuais de busca/status/tags) **ou** `Apenas contatos sem conversa nesta instância` (default).
  - Contador estimado de telefones que serão processados.
  - Botão **Iniciar**.
- Executa em lotes de 100 telefones via mesma função, com barra de progresso e resumo final.

### 5. Sem mudanças de schema
Nenhuma migração necessária — tudo reaproveita constraints/índices existentes.

## Resultado esperado
- Imports novos: histórico chega automático.
- Imports antigos: usuário roda o "Importar histórico WhatsApp" da página de contatos uma vez (ou ação individual por contato).
- Tudo idempotente: pode rodar de novo sem duplicar nada.

## Premissas confirmadas
- Janela fixa de **30 dias** (limite da API UAZAPI no plano atual).
- Item 3 (ação por contato) e item 4 (lote para já-importados) entram juntos no mesmo PR.
