
## Objetivo

Hoje atendentes só veem conversas atribuídas a eles ou sem dono (Inbox) e oportunidades pelo mesmo critério (Pipeline, via RLS). Admin/Manager veem tudo. A proposta é tornar isso configurável **por atendente**, permitindo que admin marque atendentes específicos como "podem ver tudo".

## Mudanças

### 1. Banco (migração)
- Adicionar coluna `can_view_all` (boolean, default `false`) em `tenant_memberships`.
- Criar função `can_view_all_conversations(_tenant_id uuid)` (SECURITY DEFINER) que retorna `true` se o usuário for admin/manager OU se o membership ativo dele no tenant tiver `can_view_all = true`.
- Atualizar a policy `Members view opportunities` para usar essa função no lugar do check atual de role/assigned_to.
- (Conversations já permite ver tudo via RLS; o filtro hoje é client-side em `InboxPage`. Não precisa mexer na RLS.)

### 2. UI – Configurações de equipe
- Em `SettingsPage` (aba Membros/Equipe — onde a lista de `tenant_memberships` já aparece), adicionar um switch "Ver todas as conversas" para cada membro com role `attendant`. Admin/Manager mostra como "Sempre" desabilitado.
- Somente admin pode alterar.

### 3. Frontend – aplicar permissão
- `InboxPage.tsx`: trocar o filtro `assigned_to.is.null,assigned_to.eq.X` por: se `role` é admin/manager OU `membership.can_view_all`, não filtrar; caso contrário, manter filtro atual.
- `PipelinePage` / listagens de oportunidades: já dependem da RLS, então passam a respeitar o flag automaticamente após a migração.
- `AuthContext`: incluir `can_view_all` no objeto `membership` carregado.

### 4. Fora de escopo
- Não muda fluxo de atribuição automática (round-robin) nem o nó "assign_agent" do flow builder.
- Não cria papel novo; é só um flag por membership.

## Detalhes técnicos

```sql
ALTER TABLE public.tenant_memberships
  ADD COLUMN can_view_all boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.can_view_all_in_tenant(_tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM tenant_memberships
    WHERE tenant_id=_tenant_id AND user_id=auth.uid() AND is_active=true
      AND (role IN ('admin','manager') OR can_view_all=true)
  )
$$;

-- Substituir policy "Members view opportunities":
DROP POLICY "Members view opportunities" ON public.opportunities;
CREATE POLICY "Members view opportunities" ON public.opportunities
FOR SELECT TO authenticated
USING (
  is_member_of_tenant(tenant_id) AND (
    can_view_all_in_tenant(tenant_id)
    OR assigned_to IS NULL
    OR assigned_to = get_user_membership_id(tenant_id)
  )
);
```

Arquivos tocados:
- `supabase/migrations/...` (novo)
- `src/contexts/AuthContext.tsx`
- `src/pages/InboxPage.tsx`
- `src/pages/SettingsPage.tsx` (ou subcomponente da aba de equipe)
- `src/integrations/supabase/types.ts` (regenerado automaticamente)
