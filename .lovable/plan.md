

## Plano: Sistema de ativação de IA por keyword (chave de ignição)

### Resumo

A IA só responde automaticamente quando uma keyword configurada é detectada na conversa. Uma vez ativada (`metadata.ai_activated = true`), a IA continua respondendo até um humano assumir (`assigned_to`). Todas as alterações são no `worker/index.js`.

### Alterações em `worker/index.js`

#### 1. Criar `checkKeywordAndActivateAi` (substitui `checkKeywordLeadCreation`)

Nova função que:
- Busca `lead_keywords` do tenant
- Normaliza e faz match
- Seta `metadata.ai_activated = true` + `ai_activated_at` + `ai_activated_keyword` na conversa
- Converte contato para lead se necessário
- Cria oportunidade no pipeline padrão (se não existir uma aberta)
- Cria activity de notificação
- Retorna `true` se keyword bateu

#### 2. Refatorar `process_uazapi_message` — path `already_saved` (linhas 137-153)

Ordem atual: `handleAiAutoReply` → `checkKeywordLeadCreation`

Nova ordem:
1. `checkKeywordAndActivateAi` (keyword check primeiro)
2. Re-buscar conversa atualizada do banco
3. `handleAiAutoReply` somente se `ai_activated === true` E `!assigned_to`

#### 3. Refatorar `process_uazapi_message` — path legacy (linhas 232-254)

Mesma lógica: keyword check primeiro, re-buscar dados, depois auto-reply condicional.

#### 4. Guard clauses em `handleAiAutoReply` (linha 1003)

Adicionar no início:
- Se `conversation.metadata?.ai_activated !== true` → skip
- Se `contact.status !== 'lead'` → skip

#### 5. Remover `checkKeywordLeadCreation` (linhas 875-933)

Substituída completamente por `checkKeywordAndActivateAi`.

### O que NÃO muda

- AI Copilot (sugestão no chat) — continua para todos
- Flows/automações — mesma posição
- Edge function `ai-generate` — sem alteração
- Settings UI (lead_keywords) — sem alteração
- Webhook functions — sem alteração

### Arquivo alterado

| Arquivo | Alteração |
|---|---|
| `worker/index.js` | Nova função, refatorar 2 paths, guard clauses, remover função antiga |

### Nota

Requer rebuild do container Docker do worker para entrar em vigor em produção.

