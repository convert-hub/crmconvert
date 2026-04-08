

## Plano: Consolidar lógica de IA em `ai-generate` centralizada

### Resumo

Criar uma edge function `ai-generate` que centraliza toda a lógica de geração de IA (config, template, histórico, RAG, prompt, chamada OpenAI, log). O `ai-copilot` vira um wrapper fino. O `handleAiAutoReply` do worker passa a chamar a edge function via fetch.

---

### 1. Criar `supabase/functions/ai-generate/index.ts`

Nova edge function que recebe `{ conversation_id, tenant_id, mode, incoming_message }` e executa:

- Busca `ai_configs` com join em `global_api_keys`, filtro `tenant_id` + `task_type = 'message_generation'`
- Verificação de limites: `daily_usage >= daily_limit` e `monthly_usage >= monthly_limit` (incorporando a lógica do worker `getAiConfig` com reset diário)
- Resolução de API key: tenant → global → env `OPENAI_API_KEY`
- Busca `prompt_templates` com `order('version', { ascending: false })`
- Busca últimas 20 mensagens, reverse
- Busca contato via conversations join contacts
- Busca oportunidade aberta, monta `oppContext`
- RAG: usa `incoming_message` (se fornecido) ou última mensagem inbound. Embedding → `search_knowledge` → agrupamento por procedimento
- Monta `systemPrompt`: se template existe, substituição de variáveis + forbidden_terms. Se não existe: modo `suggestion` usa prompt default hardcoded; modo `auto_reply` retorna `{ suggestion: "" }` sem chamar OpenAI
- Monta messages array. Se `mode === "suggestion"`, adiciona prompt final do usuário
- Chama OpenAI com `max_tokens: 500`, `temperature: 0.7`
- Log em `ai_logs`, incrementa contadores em `ai_configs`
- Retorna `{ suggestion, tokens_used }`

### 2. Refatorar `supabase/functions/ai-copilot/index.ts`

Wrapper fino:
- Valida `conversation_id` e `tenant_id`
- Faz fetch interno para `${supabaseUrl}/functions/v1/ai-generate` com `Authorization: Bearer ${supabaseServiceKey}`, body `{ conversation_id, tenant_id, mode: "suggestion" }`
- Retorna o resultado no formato atual `{ suggestion }`

### 3. Refatorar `handleAiAutoReply` no `worker/index.js`

Simplificar para:
- Fetch para `${SUPABASE_URL}/functions/v1/ai-generate` com service role key
- Body: `{ conversation_id, tenant_id, mode: "auto_reply", incoming_message }`
- Se `suggestion` com conteúdo: envia WhatsApp via `enqueue_job`, salva mensagem, chama `checkQualification`
- Remove toda a lógica interna duplicada (busca config, template, RAG, chamada OpenAI, etc.)

### 4. Funções auxiliares do worker

- `getAiConfig` — **manter** (usada por `checkQualification`)
- `getPromptTemplate` — **manter** (usada por `checkQualification`), **corrigir** adicionando `.order('version', { ascending: false })`
- `getConversationHistory` — **manter** (usada por `checkQualification` indiretamente via `handleAiAutoReply` que passa `history`)
- `callOpenAI` — **manter** (usada por `checkQualification`)
- `incrementAiUsage` — **manter** (usada por `checkQualification`)
- `logAiCall` — **manter** (usada por `checkQualification`)

### 5. Registrar em `supabase/config.toml`

```toml
[functions.ai-generate]
verify_jwt = false
```

---

### Arquivos alterados

| Arquivo | Alteração |
|---|---|
| `supabase/functions/ai-generate/index.ts` | **Novo** — lógica centralizada |
| `supabase/functions/ai-copilot/index.ts` | Wrapper fino chamando ai-generate |
| `worker/index.js` | `handleAiAutoReply` simplificada, `getPromptTemplate` corrigida |
| `supabase/config.toml` | Registrar ai-generate |

