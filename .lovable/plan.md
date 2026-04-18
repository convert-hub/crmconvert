

## Plano: Adicionar coluna `timezone` em `public.tenants`

### 1. Migration SQL (via tool de migration)

```sql
ALTER TABLE public.tenants
ADD COLUMN timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo';
```

Aplica default para linhas existentes (NOT NULL satisfeito automaticamente).

### 2. `src/types/crm.ts` — interface `Tenant`

Adicionar `timezone: string;` na interface (após `business_hours`):

```ts
export interface Tenant {
  // ... campos existentes
  business_hours: Record<string, { start: string; end: string }>;
  timezone: string;
  created_at: string;
  updated_at: string;
}
```

### 3. `src/integrations/supabase/types.ts`

**NÃO editar manualmente** — esse arquivo é regenerado automaticamente pelo Supabase após a migration. O tipo `timezone: string` aparecerá nos blocos `Row`/`Insert`/`Update` da tabela `tenants` sem intervenção.

> Observação: as instruções do projeto explicitamente proíbem editar `src/integrations/supabase/types.ts` (vem da API do Supabase). A regeneração é automática após aplicar a migration.

### 4. Sem mudanças de lógica

Nenhum outro arquivo é tocado. Uso prático do timezone fica para próximo prompt.

### Resultado

- Coluna `timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo'` em `tenants`
- Tipo `Tenant` em `src/types/crm.ts` com novo campo
- `types.ts` regenerado automaticamente pelo Supabase

