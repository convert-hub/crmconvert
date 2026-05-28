## Objetivo
Inserir um campo de busca no cabeçalho da página de Pipelines que filtre os cards por nome do contato, título da oportunidade e telefone do contato.

## Mudanças

Arquivo único: `src/pages/PipelinePage.tsx`

1. **Estado novo**: `const [search, setSearch] = useState('')` ao lado dos outros estados (~linha 336).

2. **Filtro client-side**: estender o `useMemo` `filteredOpportunities` (linha 361) para também aplicar o termo de busca normalizado (lowercase, sem acentos, trim) contra:
   - `o.title`
   - `o.contact?.name`
   - `o.contact?.phone` (comparar apenas dígitos, para casar com qualquer formatação digitada)

3. **UI no header** (linha 844): adicionar um `Input` com ícone `Search` (lucide) antes do `FilterBar`, estilo consistente com o usado em `ContactsPage` (`pl-9 w-56 h-9 text-[13px]`, placeholder "Buscar por nome ou telefone..."). Sem labels extras — densidade alta conforme padrão do projeto.

## Detalhes técnicos
- Busca puramente client-side sobre `opportunities` já carregadas; sem alterar queries Supabase nem realtime.
- Normalização reaproveita o padrão já em uso no projeto (lowercase + remove acentos via `normalize('NFD').replace(/\p{Diacritic}/gu,'')`).
- Para telefone, comparar `phone.replace(/\D/g,'').includes(term.replace(/\D/g,''))` quando o termo contiver dígitos.
- Nenhuma alteração em backend, RLS, tipos ou outros componentes.

## Impacto
- Risco zero para fluxos existentes (drag-and-drop, criação, exclusão, chat) — filtro apenas reduz array exibido.
- Não afeta contadores de stage? Atualmente `count` e `total` por coluna usam `filteredOpportunities`; com a busca aplicada, contadores refletirão o resultado filtrado, que é o comportamento esperado.
