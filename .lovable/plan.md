

## Plano: Agent Takeover Keyword

Feature que permite desativar a IA automaticamente quando o atendente humano envia uma frase-chave específica pelo WhatsApp conectado.

### 1. `src/pages/SettingsPage.tsx` — UI de Takeover Keywords

- Adicionar states `takeoverKeywords` e `newTakeoverKeyword`
- Carregar `agent_takeover_keywords` do `tenants.settings` no `loadAll`
- Criar funções `addTakeoverKeyword` e `removeTakeoverKeyword` (mesmo padrão de `addKeyword`/`removeKeyword`)
- Atualizar `KeywordTester` para usar normalização reforçada (remover pontuação + colapsar espaços)
- Adicionar nova seção na tab de automação/IA, logo após os lead keywords, com título "Palavras-chave de Takeover (Atendente)" e reutilização do `KeywordTester`

### 2. `supabase/functions/webhook-uazapi/index.ts` — Detecção no webhook

- Criar helper `normalizeForPhraseMatch` (remove acentos, pontuação, colapsa espaços, lowercase)
- Após salvar mensagem `fromMe` e antes do bloco de AI enqueue, buscar `tenants.settings.agent_takeover_keywords`
- Se match: setar `metadata.ai_activated = false`, `ai_deactivated_by = 'takeover_keyword'`, `status = 'waiting_agent'`, `assigned_to = null`
- Deploy automático da edge function

### 3. `worker/index.js` — Normalização reforçada

- Criar `normalizeForPhraseMatch` (reutiliza `removeAccents` + remove pontuação + colapsa espaços)
- Atualizar `checkKeywordAndActivateAi` (linhas 1050-1051) para usar a nova normalização — melhora também o matching dos lead_keywords existentes

### Arquivos

| Arquivo | Alteração |
|---|---|
| `src/pages/SettingsPage.tsx` | UI takeover keywords + normalização reforçada no KeywordTester |
| `supabase/functions/webhook-uazapi/index.ts` | Helper + detecção fromMe takeover |
| `worker/index.js` | `normalizeForPhraseMatch` + atualizar `checkKeywordAndActivateAi` |

### Sem migration

O campo `agent_takeover_keywords` é armazenado no JSONB `tenants.settings` — sem alteração de schema.

