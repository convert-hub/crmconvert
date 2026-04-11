

## Plano: Fallback para `global_api_keys` no Worker (ingest de documentos)

### Diagnóstico

- Tenant "Na Melhor" tem **zero registros** em `ai_configs`
- Worker (linha 862-869) busca key em `ai_configs` → fallback para `process.env.OPENAI_API_KEY`
- Nenhum dos dois existe, mas há uma chave global ativa em `global_api_keys` (label "OpenAI Produção") que não é consultada

### Solução

Adicionar um fallback intermediário: quando `ai_configs` não retorna key, buscar em `global_api_keys` uma chave OpenAI ativa antes de tentar a env var.

### Alteração em `worker/index.js` (linhas 860-869)

```text
Lógica atual:
  ai_configs (tenant) → process.env.OPENAI_API_KEY

Lógica nova:
  ai_configs (tenant) → global_api_keys (OpenAI, ativa) → process.env.OPENAI_API_KEY
```

Inserir entre as linhas 868 e 869:

```javascript
if (!apiKey) {
  const { data: globalKey } = await supabase
    .from('global_api_keys')
    .select('api_key_encrypted')
    .eq('provider', 'openai')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  if (globalKey) apiKey = globalKey.api_key_encrypted;
}
```

### Arquivo

| Arquivo | Alteração |
|---|---|
| `worker/index.js` | Linhas 868-869: adicionar fallback para `global_api_keys` |

### Após o deploy

O documento `estrias-na-melhor.pdf` (status `error`) poderá ser reprocessado pelo botão de refresh na UI do Knowledge Base. O worker precisará de rebuild/restart do container Docker.

