

## Exibir Data de Nascimento no Card do Pipeline

### Objetivo
Mostrar a data de nascimento do contato diretamente nos cards de oportunidade do Kanban, quando preenchida.

### O que sera feito

No componente `SortableOppCard` em `src/pages/PipelinePage.tsx`, adicionar uma linha abaixo do nome do contato exibindo a data de nascimento formatada (dd/MM/yyyy) com um icone de bolo (Cake).

O campo so aparece quando o contato tem `birth_date` preenchido, mantendo o card limpo nos demais casos.

### Detalhes Tecnicos

**Arquivo**: `src/pages/PipelinePage.tsx`

- Importar o icone `Cake` do `lucide-react`
- Importar `format` do `date-fns` (ja usado no arquivo)
- Dentro do `SortableOppCard`, logo apos o bloco que exibe o nome do contato (icone User + nome), adicionar:

```text
{opp.contact?.birth_date && (
  <div className="flex items-center gap-1.5 text-xs text-muted-foreground pl-5">
    <Cake className="h-3 w-3" />
    <span>{format(new Date(opp.contact.birth_date + 'T00:00:00'), 'dd/MM/yyyy')}</span>
  </div>
)}
```

- Nenhuma outra alteracao necessaria pois os dados do contato ja sao carregados com `select('*, contact:contacts(*)')`.

### Arquivos afetados
- `src/pages/PipelinePage.tsx` -- adicionar exibicao do birth_date no card

