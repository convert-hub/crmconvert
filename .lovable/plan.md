# Melhorar mensagens de erro Meta Cloud (wa-meta-send e wa-meta-templates-sync)

## Problema
Hoje, quando o usuário clica em "Testar conexão" ou "Sincronizar templates" em uma instância Meta Cloud mal configurada, as edge functions retornam mensagens genéricas como `"Instance not configured for Meta"`, `"Meta credentials incomplete"` ou `"Instance is not Meta Cloud"`. A UI mostra "erro na add function 2xx" sem indicar o que falta preencher, dificultando o diagnóstico.

## Escopo
Apenas as duas edge functions abaixo. Sem mudanças de UI, schema ou outras funções.

- `supabase/functions/wa-meta-send/index.ts`
- `supabase/functions/wa-meta-templates-sync/index.ts`

## Mudanças

### 1. Padronizar formato de erro acionável
Todos os retornos de erro de pré-condição (instância faltante, provider errado, credenciais incompletas) passam a usar o mesmo envelope JSON, sempre com HTTP 200 + `ok:false` (mantém compatibilidade com clientes que não tratam 4xx):

```json
{
  "ok": false,
  "code": "meta_missing_phone_number_id",
  "error": "Configure o Phone Number ID da Meta nas configurações da instância.",
  "missing": ["meta_phone_number_id"],
  "instance_id": "...",
  "provider": "meta_cloud"
}
```

Campos:
- `code`: identificador estável e granular (ver tabela abaixo)
- `error`: mensagem em pt-BR pronta para `toast()`
- `missing`: array dos campos exatos que faltam, quando aplicável
- `instance_id` e `provider`: contexto para o usuário identificar qual instância

### 2. Novos códigos de erro

| code | Quando | missing |
|---|---|---|
| `instance_not_found` | `whatsapp_instances` não encontrada | — |
| `instance_wrong_provider` | provider ≠ `meta_cloud` (atual provider devolvido em campo `actual_provider`) | — |
| `meta_missing_phone_number_id` | falta `meta_phone_number_id` | `["meta_phone_number_id"]` |
| `meta_missing_access_token` | falta `meta_access_token_encrypted` | `["meta_access_token_encrypted"]` |
| `meta_missing_waba_id` (sync apenas) | falta `meta_waba_id` | `["meta_waba_id"]` |
| `meta_credentials_incomplete` | múltiplos faltando | lista de todos |
| `meta_token_expired` | já existe — mantido como está |

### 3. wa-meta-send — pontos exatos
Substituir os 3 retornos atuais:
- `"Instance not found"` → `code: instance_not_found`
- `"Instance is not Meta Cloud"` → `code: instance_wrong_provider` + `actual_provider`
- `"Meta credentials incomplete"` → detectar quais campos faltam (`meta_phone_number_id` e/ou `meta_access_token_encrypted`) e devolver `missing[]` + `code` granular

### 4. wa-meta-templates-sync — pontos exatos
Substituir o retorno único `"Instance not configured for Meta"` por verificações separadas:
- Provider errado → `instance_wrong_provider`
- Falta `meta_waba_id` → `meta_missing_waba_id`
- Falta `meta_access_token_encrypted` → `meta_missing_access_token`
- Múltiplos faltando → `meta_credentials_incomplete` com `missing[]`

### 5. Logging
Adicionar `console.warn("[wa-meta-send] precondition_failed", { code, instance_id, missing })` antes de cada retorno de erro de pré-condição, para facilitar leitura nos Edge Function logs.

## Fora de escopo
- Não alterar UI (toasts continuam recebendo `error` em pt-BR, agora mais específico)
- Não alterar autenticação, RLS, schema ou outras funções
- Não tocar o fluxo `test_connection` que chama o Graph API (já trata `meta_token_expired`)
- Não fazer deploy automático — apenas escrever o código

## Critério de pronto
- Instância sem `meta_phone_number_id` → `{ok:false, code:"meta_missing_phone_number_id", missing:["meta_phone_number_id"], error:"Configure o Phone Number ID..."}`
- Instância sem `meta_waba_id` ao sincronizar templates → `{ok:false, code:"meta_missing_waba_id", missing:["meta_waba_id"], ...}`
- Instância UAZAPI tentando rodar Meta send → `{ok:false, code:"instance_wrong_provider", actual_provider:"uazapi"}`
- Comportamento de sucesso e de `meta_token_expired` inalterado
