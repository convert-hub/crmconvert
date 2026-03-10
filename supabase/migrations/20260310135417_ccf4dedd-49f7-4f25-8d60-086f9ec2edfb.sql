-- Permitir que membros do tenant, exceto readonly, excluam oportunidades
-- Isso corrige o caso em que atendentes removem o card na UI mas a exclusão não persiste.

DROP POLICY IF EXISTS "Admin/Manager deletes opportunities" ON public.opportunities;

CREATE POLICY "Members delete opportunities"
ON public.opportunities
FOR DELETE
TO authenticated
USING (
  is_member_of_tenant(tenant_id)
  AND get_user_role_in_tenant(tenant_id) <> 'readonly'::tenant_role
);