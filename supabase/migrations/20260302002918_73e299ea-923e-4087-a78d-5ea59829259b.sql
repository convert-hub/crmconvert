-- Allow SaaS admins to delete tenants
CREATE POLICY "SaaS admin deletes tenants"
  ON public.tenants FOR DELETE
  USING (is_saas_admin());