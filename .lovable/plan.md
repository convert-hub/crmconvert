## Diagnóstico

Os 273 "erros" são, na verdade, conflitos entre etapas no CSV que misturam nomes válidos do pipeline (ex.: `PROPOSTA ENVIADA`, `EM CONTATO`) com nomes que não existem no pipeline (`REPETIDOS`, `NÃO VAMOS PERSEGUIR`, `LEAD RECEBIDO`). O importador hoje:

1. Junta todas as etapas distintas que aparecem para o mesmo contato.
2. Se tem mais de uma, joga erro — sem distinguir válidas de inválidas.
3. Se a etapa não bate, conta como "etapa inválida".

Como `REPETIDOS` não existe no pipeline e `PROPOSTA ENVIADA` existe, hoje vira conflito. Você quer que o importador ignore os nomes inexistentes e use o que tem match.

## Plano de correção

No `src/components/contacts/ImportContactsDialog.tsx`, no bloco de oportunidades:

1. Antes de checar conflito, filtrar `rawStages` deixando só as que dão match em `stagesByNormName`.
2. Decisão por contato:
   - **0 matches** → silencioso. Não cria oportunidade, não conta como erro, não conta como "etapa inválida".
   - **1 match** → cria oportunidade normalmente nessa etapa.
   - **>1 matches distintos** → mantém o erro atual de "etapas diferentes" (caso real de ambiguidade entre etapas válidas).
3. Remover o incremento de `stageErrors` para etapas que simplesmente não existem no pipeline (passam a ser silenciosas, conforme sua escolha).
4. Manter contador `stageErrors` apenas para o caso em que TODAS as `rawStages` foram filtradas (zero matches) — não, esse vira silencioso. Então `stageErrors` deixa de ser usado e some do resultado.

## Resultado esperado na próxima importação

- Contatos com `REPETIDOS` + `PROPOSTA ENVIADA` → oportunidade criada em `PROPOSTA ENVIADA`, sem erro.
- Contatos só com nomes inexistentes (`REPETIDOS` sozinho) → contato criado, oportunidade ignorada, sem erro.
- Conflito real (`PROPOSTA ENVIADA` + `EM CONTATO`, ambas existem) → continua listado como erro pra você revisar.

## Arquivo

- `src/components/contacts/ImportContactsDialog.tsx` (apenas o bloco de oportunidades + UI de resultado que mostra `stageErrors`).

Sem mudanças no banco.