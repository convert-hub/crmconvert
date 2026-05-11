# Onda 1 — Tornar honesto o que já existe

Correções pequenas no Flow Builder e no worker para que os nós/ações que aparecem na UI realmente funcionem como prometido. Sem refatorar executor (Delay longo e Pergunta com pausa ficam para a Onda 2).

## Escopo

### 1. Nó Mensagem em modo Template Meta (worker)
Hoje o `MessageNodeEditor` salva `mode: 'template'`, `templateInstanceId`, `templateId`, `templateLanguage`, `templateVariables`, mas o worker (`worker/index.js`, branch `node.type === 'message'`) só lê `node.data.content` e dispara texto via UAZAPI. Vamos:

- Detectar `node.data.mode === 'template'` no executor.
- Resolver provider da conversa via `whatsapp_instance_id`. Se for `meta_cloud` → enfileirar `send_whatsapp_template` (handler já existe no worker), passando `template_id`, `language`, `variables` interpoladas com `{{contact.name}}`, `{{contact.phone}}`, `{{contact.email}}`, e demais `ctx.variables`.
- Se a conversa for UAZAPI ou não tiver instância → cair no `node.data.content` (fallback de texto livre). Se também estiver vazio, log e segue.

### 2. Roteamento por instância no envio de mensagem livre
Tanto o nó Mensagem (modo texto) quanto a Ação `send_whatsapp` hoje sempre vão para UAZAPI. Vamos:

- Antes de enfileirar `send_whatsapp`, ler `conversations.whatsapp_instance_id` da conversa e o `provider` da instância.
- Se `meta_cloud` → invocar `wa-meta-send` com `type: 'text'` (mesma rota que o `whatsappRouter` do front usa).
- Se `uazapi` ou indefinido → caminho atual (`enqueue_job send_whatsapp`).
- Reutilizar helper inline no worker (sem importar do `src`, que não roda no Node).

### 3. Ação `move_stage` (UI + worker)
- **UI** (`FlowBuilderPage.tsx`): quando `actionType === 'move_stage'`, mostrar dois selects encadeados — Pipeline → Etapa de destino — gravando `config.pipeline_id` e `config.stage_id`.
- **Worker**: adicionar `case 'move_stage'` no switch de ações. Procura a oportunidade aberta do contato no pipeline alvo (ou cria se faltar via fallback simples — a definir: por ora só move se já existir; senão log e segue).

### 4. Ação `create_opportunity` com pipeline/etapa configuráveis
Hoje sempre usa o pipeline `is_default = true` e a primeira etapa. Vamos:

- **UI**: campos opcionais Pipeline e Etapa inicial (mantendo o default quando vazios).
- **Worker**: respeitar `config.pipeline_id` / `config.stage_id` se preenchidos.

### 5. Status final em `flow_executions`
Hoje a linha em `flow_executions` é criada com `status: 'running'` e nunca é atualizada ao terminar. Vamos:

- Em sucesso (loop terminou normal ou estourou `MAX_STEPS`): `update status = 'completed'`, `finished_at = now()`.
- Em erro (catch): `update status = 'failed'`, `last_error = ...`, `finished_at = now()`.

## Arquivos tocados

- `worker/index.js` — branch `message` (template + roteamento), branch `action` (`move_stage`, `create_opportunity` com pipeline/etapa, `send_whatsapp` roteado), update final em `flow_executions`.
- `src/pages/FlowBuilderPage.tsx` — editor das ações `move_stage` e `create_opportunity` (selects de pipeline/etapa).

## Sem mudanças de schema

`flow_executions` já tem colunas `status`, `last_error`, `finished_at` (verificável; se faltar `finished_at` ou `last_error`, faço migration mínima junto). Tabelas `pipelines` e `stages` já existem com os campos usados.

## Fora desta onda (vai para Onda 2+)

- Delay > 1 min de verdade (precisa pausar/retomar execução).
- Pergunta funcional com envio de texto e espera pela resposta do usuário.
- Lock anti-duplicação por contato e gatilhos `lead_created` / `tag_added` / `keyword_match` / `manual`.
- Toggle "Ativo" na lista, página de Execuções, modo simulação.

## Como vou validar

1. Criar fluxo `message_received` com nó Mensagem em modo Template e disparar via mensagem em conversa Meta — confirmar que `wa-meta-templates` recebe a chamada.
2. Mesmo fluxo, mas conversa UAZAPI — confirmar que cai no fallback de texto.
3. Fluxo com ação `move_stage` configurada — mover oportunidade e verificar `stage_id` atualizado.
4. Conferir `flow_executions` ganhando `status = 'completed'` ao final.

Posso seguir?
