

## Campo Data de Nascimento (fixo) nos Contatos

### Objetivo
Adicionar o campo "Data de Nascimento" como campo fixo do sistema na entidade Contato. Nao obrigatorio, mas sempre presente na interface.

### Alteracoes

**1. Migracao de banco de dados**
- Adicionar coluna `birth_date date NULL` na tabela `contacts`.

**2. Tipo TypeScript (`src/types/crm.ts`)**
- Adicionar `birth_date: string | null` ao tipo `Contact`.

**3. Pagina de Contatos (`src/pages/ContactsPage.tsx`)**
- Adicionar campo de data de nascimento no formulario de criacao/edicao (usando DatePicker com Popover + Calendar).
- Incluir o campo no estado do formulario e no payload de salvamento.
- Exibir a data de nascimento na tabela de listagem (coluna extra).
- Incluir no export CSV.

**4. Detalhe da Oportunidade (`src/components/crm/OpportunityDetail.tsx`)**
- Se o contato vinculado tiver `birth_date` preenchido, exibir a informacao na area de dados do contato (somente leitura).

### Detalhes Tecnicos

- A coluna sera `birth_date date NULL` (tipo date do Postgres, sem horario).
- No formulario, sera usado o componente Calendar dentro de um Popover (padrao Shadcn DatePicker).
- O campo aparecera abaixo do email no formulario de contato.
- Na tabela, a data sera formatada com `format(date, 'dd/MM/yyyy')`.

### Arquivos afetados
- `supabase/migrations/` -- nova migracao
- `src/types/crm.ts` -- adicionar campo ao tipo Contact
- `src/pages/ContactsPage.tsx` -- formulario e tabela
- `src/components/crm/OpportunityDetail.tsx` -- exibicao no detalhe

