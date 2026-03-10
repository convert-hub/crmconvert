
-- Drop the restrictive SaaS admin delete policy and recreate as permissive
DROP POLICY IF EXISTS "SaaS admin deletes any membership" ON public.tenant_memberships;

CREATE POLICY "SaaS admin deletes any membership"
ON public.tenant_memberships
FOR DELETE
TO public
USING (is_saas_admin());
