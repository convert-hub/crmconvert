ALTER TABLE public.tenant_memberships
  ADD COLUMN IF NOT EXISTS can_view_all boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.can_view_all_in_tenant(_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_memberships
    WHERE tenant_id = _tenant_id
      AND user_id = auth.uid()
      AND is_active = true
      AND (role IN ('admin','manager') OR can_view_all = true)
  )
$$;

DROP POLICY IF EXISTS "Members view opportunities" ON public.opportunities;
CREATE POLICY "Members view opportunities"
ON public.opportunities
FOR SELECT
TO authenticated
USING (
  is_member_of_tenant(tenant_id) AND (
    public.can_view_all_in_tenant(tenant_id)
    OR assigned_to IS NULL
    OR assigned_to = get_user_membership_id(tenant_id)
  )
);