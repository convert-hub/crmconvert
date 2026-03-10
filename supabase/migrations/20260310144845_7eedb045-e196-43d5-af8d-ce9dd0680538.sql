
-- Atendentes só veem oportunidades atribuídas a si ou sem atribuição
-- Admin/Manager/SaaS admin continuam vendo tudo

DROP POLICY IF EXISTS "Members view opportunities" ON public.opportunities;

CREATE POLICY "Members view opportunities"
ON public.opportunities
FOR SELECT
TO authenticated
USING (
  is_member_of_tenant(tenant_id)
  AND (
    -- Admin e Manager veem tudo do tenant
    get_user_role_in_tenant(tenant_id) IN ('admin', 'manager')
    -- Atendente só vê sem atribuição ou atribuídas a si
    OR (
      get_user_role_in_tenant(tenant_id) = 'attendant'
      AND (assigned_to IS NULL OR assigned_to = get_user_membership_id(tenant_id))
    )
  )
);
