## Correção: criação de regra de palavra-chave

### Diagnóstico

Na `KeywordsTab.tsx`, o botão "Criar" valida `newKeywords.length === 0`. O `TagInput` só adiciona a palavra ao array quando o usuário pressiona **Enter**. Se a pessoa digita "agendar" e clica direto em **Criar** sem dar Enter, o texto fica preso no input interno e o array continua vazio → erro "selecione fluxo e palavra-chave", mesmo com fluxo selecionado.

Além disso, hoje só dá pra adicionar uma palavra por vez (Enter a cada uma). O pedido é poder colar várias separadas por `;`.

### Mudanças (somente UI, sem tocar backend nem schema)

**1. `src/components/automations/KeywordsTab.tsx`**
- Trocar o `TagInput` do diálogo de criação por um campo simples (`Input` ou `Textarea`) com placeholder `"agendar; preço; horário"`.
- No `create()`, fazer o parse: `value.split(/[;\n,]/).map(s => s.trim()).filter(Boolean)`. Isso aceita `;`, vírgula e quebra de linha.
- Validar usando o array já parseado (não o state do TagInput), eliminando o bug do "Enter esquecido".
- Mensagem de erro mais específica: separar "selecione um fluxo" de "informe ao menos uma palavra-chave".

**2. Edição inline na tabela**
- Manter o `TagInput` na linha da tabela (lá funciona porque cada chip é editado individualmente), mas adicionar dica visual `Use ; para separar` no diálogo de criação.

### Fora de escopo
Sem mudanças em migration, worker, edge functions ou no matching (que já trata `keywords text[]` corretamente).
