

# Criacao automatica de leads no pipeline via palavras-chave do WhatsApp

## Resumo

Quando uma mensagem inbound do WhatsApp contiver palavras-chave configuradas pelo tenant, e o contato tiver status `lead` (nao `customer`), o sistema ira automaticamente:
1. Criar uma oportunidade no primeiro estagio do pipeline padrao
2. Criar uma atividade de notificacao para a equipe

As palavras-chave serao configuraveis por tenant na tela de Configuracoes.

---

## Onde as palavras-chave serao armazenadas

Utilizaremos o campo `settings` (jsonb) que ja existe na tabela `tenants`. Adicionaremos uma chave `lead_keywords` contendo um array de strings. Nenhuma migracao de banco e necessaria.

Exemplo do valor em `tenants.settings`:
```text
{
  "lead_keywords": ["preco", "orcamento", "comprar", "contratar", "quanto custa", "valor"]
}
```

---

## Fluxo de execucao

```text
Mensagem WhatsApp inbound
        |
        v
  webhook-uazapi (salva mensagem, cria contato/conversa)
        |
        v
  Enfileira job "process_uazapi_message" no worker
        |
        v
  Worker: process_uazapi_message
        |
        +-- Verifica se contato.status == 'lead'
        +-- Busca tenant.settings.lead_keywords
        +-- Verifica se a mensagem contem alguma keyword (case-insensitive)
        +-- Se SIM:
              +-- Verifica se ja existe oportunidade aberta para este contato
              +-- Se NAO existe: cria oportunidade no 1o estagio do pipeline padrao
              +-- Cria atividade "Lead acionado por palavra-chave" vinculada ao contato e conversa
```

---

## Detalhes tecnicos

### 1. Tela de Configuracoes (`src/pages/SettingsPage.tsx`)

Adicionar na aba "Geral" um novo card para gerenciar palavras-chave:
- Campo de input para adicionar novas palavras-chave
- Lista de badges com botao de remover para cada keyword
- Salva no campo `tenants.settings` como `{ lead_keywords: [...] }`
- Somente admins podem editar

### 2. Worker (`worker/index.js`)

No handler `process_uazapi_message`, apos o fluxo existente de AI auto-reply, adicionar logica de keyword matching:

- Buscar `tenants.settings` para obter `lead_keywords`
- Buscar `contacts.status` para verificar se e `lead`
- Normalizar texto (lowercase, remover acentos) para comparacao
- Se match encontrado e nao existe oportunidade aberta para o contato:
  - Criar oportunidade no pipeline padrao, primeiro estagio
  - Criar atividade de notificacao tipo `note` com titulo "Lead acionado por palavra-chave" e descricao contendo a keyword encontrada
- Usar chave de idempotencia para evitar oportunidades duplicadas

### 3. Nenhuma migracao de banco necessaria

O campo `settings` (jsonb) na tabela `tenants` ja existe e aceita dados arbitrarios. As tabelas `opportunities` e `activities` ja possuem todas as colunas necessarias.

---

## Arquivos a serem modificados

| Arquivo | Alteracao |
|---------|-----------|
| `worker/index.js` | Adicionar logica de keyword matching no handler `process_uazapi_message` |
| `src/pages/SettingsPage.tsx` | Adicionar card de configuracao de palavras-chave na aba "Geral" |

