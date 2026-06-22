## Objetivo

Substituir a heurística atual (sonda 5 variantes + fallback de varredura) por uma estratégia que descobre os chatids reais da instância e só depois busca mensagens — eliminando a causa raiz dos 0 retornos e tornando o resultado explicável.

## Estratégia em 2 fases

**Fase 1 — listar chats reais da instância** via `POST /chat/find` (paginado, até ~50 páginas de 100). Para cada chat individual (descartar `@g.us`, `@newsletter`, `@broadcast`), extrair o número do telefone do `wa_chatid` (independente do sufixo: `@s.whatsapp.net`, `@c.us`, `@lid`) e normalizar. Resultado: um mapa `telefone → chatid real`.

**Fase 2 — backfill por chat conhecido.** Para cada telefone pedido, consultar o mapa. Se encontrar, paginar `POST /message/find` com `{ chatid: <real>, limit: 100, offset }` dentro da janela de 30 dias. Se não encontrar, registrar como `sem_chat_na_instancia` (não é erro — é informação).

## Diagnóstico de saída

A função passa a retornar e a UI passa a exibir:

- `chats_listed` — quantos chats individuais a instância tem
- `phones_requested` — quantos telefones recebidos
- `phones_matched` — quantos têm chat na instância
- `phones_without_chat` — quantos não têm (esperado para leads antigos)
- `chats_found` / `messages_inserted` — totais persistidos

Isso responde de cara: "dos 148 contatos, 23 têm chat na instância, 125 não têm histórico armazenado pela UAZAPI".

## Esclarecer o filtro de escopo

Na UI, adicionar texto auxiliar sob cada radio:

- "Apenas contatos sem conversa nesta instância" → "Pula contatos que já têm uma conversa registrada no CRM para esse número."
- "Todos os contatos filtrados" → "Inclui contatos que já têm conversa (reprocessa)."

E quando a estimativa é igual nas duas opções, mostrar dica: "Nenhum contato tem conversa nesta instância ainda — os dois escopos produzem o mesmo conjunto."

## Arquivos

- `supabase/functions/uazapi-history-sync-contacts/index.ts` — reescrita: substitui `VARIANTS` + `probeLoop` + `fallback_scan` pela listagem de chats via `/chat/find` + lookup por telefone. Mantém a persistência (conversations + messages upsert) como está.
- `src/lib/historySync.ts` — estender `HistorySyncResult` com `chats_listed`, `phones_matched`, `phones_without_chat`; remover `winner_variant` e `fallback_scan` (não fazem mais sentido).
- `src/components/contacts/BulkHistorySyncDialog.tsx` — exibir os novos campos no card de resultado e adicionar os textos auxiliares dos radios + dica quando as estimativas baterem.

## Notas técnicas

- Endpoint de listagem: tentar primeiro `POST /chat/find` com `{ limit: 100, offset, operator: 'AND' }` (formato UAZAPI v2). Se 404, cair para `GET /chat/find?limit=100&offset=…`. Logar o shape da primeira página para confirmar o campo do chatid (`wa_chatid`, `chatid`, `id`).
- Filtro de chat individual: regex `/@(s\.whatsapp\.net|c\.us|lid)$/i`.
- Extração de telefone do chatid: pegar parte antes do `@`, remover `:\d+` (device id), aplicar `normalizeBrazilPhone`. Para `@lid`, o número antes do `@` *não* é E.164 — nesse caso, usar o campo `wa_name`/`name`/`phone` se a API expuser; senão, pular silenciosamente (o `@lid` é um pseudônimo, não dá pra inferir o telefone).
- Manter limite de 30 dias, batch de 100 telefones, MAX_PAGES_PER_CHAT = 10.
- Sem mudanças em schema, RLS, rotas, ou na função antiga `uazapi-history-sync`.

## Validação pós-deploy

1. Rodar "Histórico WA" no mesmo conjunto.
2. Esperar resposta com `chats_listed > 0`, `phones_matched ≥ 0`, e — se `phones_matched > 0` — `messages_inserted > 0`.
3. Se `chats_listed = 0`, é problema de credencial/endpoint (vai aparecer no log com o corpo da resposta).
4. Se `phones_matched = 0` e `chats_listed > 0`, confirma que a UAZAPI realmente não tem histórico desses leads — comunicação esperada para o usuário.
