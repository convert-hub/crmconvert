

## Campos Personalizados para Oportunidades

### Objetivo
Permitir que cada empresa (tenant) configure seus proprios campos extras para os cards de oportunidade no pipeline. Os campos sao definidos nas Configuracoes e exibidos tanto nos cards do Kanban quanto no detalhe da oportunidade.

### Como vai funcionar

1. **Nas Configuracoes**, uma nova aba "Campos Personalizados" permite que o admin crie campos com nome, tipo (texto, numero, selecao, data, sim/nao) e opcoes (para campos de selecao).

2. **Nos cards do Kanban**, os campos preenchidos aparecem como badges ou linhas de informacao abaixo do contato.

3. **No detalhe da oportunidade**, os campos aparecem em uma secao editavel.

---

### Detalhes Tecnicos

**1. Migracao de banco de dados**
- Adicionar coluna `custom_fields jsonb DEFAULT '{}'` na tabela `opportunities` (similar ao que ja existe em `contacts`).

**2. Armazenamento das definicoes de campo**
- As definicoes ficam em `tenants.settings.custom_opportunity_fields` como um array JSON:
```text
[
  { "key": "produto", "label": "Produto", "type": "text" },
  { "key": "urgencia", "label": "Urgencia", "type": "select", "options": ["Baixa","Media","Alta"] },
  { "key": "tem_orcamento", "label": "Tem Orcamento?", "type": "boolean" },
  { "key": "data_reuniao", "label": "Data Reuniao", "type": "date" },
  { "key": "quantidade", "label": "Quantidade", "type": "number" }
]
```
- Tipos suportados: `text`, `number`, `select`, `date`, `boolean`

**3. SettingsPage.tsx - Nova aba "Campos Personalizados"**
- Formulario para adicionar campos: nome, chave (slug auto-gerado), tipo, opcoes (se select)
- Lista dos campos existentes com botao de remover
- Salva em `tenants.settings.custom_opportunity_fields`

**4. PipelinePage.tsx - Exibicao nos cards**
- Ler as definicoes do tenant (carregadas uma vez)
- Para cada oportunidade, exibir os `custom_fields` preenchidos como badges/texto compacto abaixo das tags do contato
- Limitar a 2-3 campos visiveis no card para nao poluir

**5. OpportunityDetail.tsx - Edicao dos campos**
- Renderizar inputs dinamicos conforme o tipo de cada campo definido
- Salvar no `opportunities.custom_fields`

**6. types/crm.ts**
- Adicionar `custom_fields?: Record<string, unknown>` ao tipo `Opportunity` (se nao existir apos migracao)

### Arquivos afetados
- `supabase/migrations/` — nova migracao para coluna `custom_fields`
- `src/pages/SettingsPage.tsx` — nova aba de campos personalizados
- `src/pages/PipelinePage.tsx` — exibir campos nos cards
- `src/components/crm/OpportunityDetail.tsx` — edicao dos campos
- `src/types/crm.ts` — atualizar tipo Opportunity

