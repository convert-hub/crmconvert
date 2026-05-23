
-- 1) ai_configs: restrict SELECT to admin/manager (api_key_encrypted is sensitive)
DROP POLICY IF EXISTS "Members view ai configs" ON public.ai_configs;
CREATE POLICY "Admin/Manager view ai configs"
ON public.ai_configs
FOR SELECT
TO authenticated
USING (is_admin_or_manager(tenant_id));

-- 2) global_api_keys: restrict SELECT to SaaS admins only
DROP POLICY IF EXISTS "Authenticated users view global keys" ON public.global_api_keys;
-- (existing "SaaS admin manages global keys" ALL policy already covers SELECT for SaaS admins)

-- 3) webhook_endpoints: restrict SELECT to admin/manager (secret column is sensitive)
DROP POLICY IF EXISTS "Members view webhook endpoints" ON public.webhook_endpoints;
CREATE POLICY "Admin/Manager view webhook endpoints"
ON public.webhook_endpoints
FOR SELECT
TO authenticated
USING (is_admin_or_manager(tenant_id));

-- 4) tenant_memberships: prevent managers from escalating their own role.
--    Managers can still update other members; admins can update themselves
--    (only role changes for self require admin).
DROP POLICY IF EXISTS "Admin/Manager updates membership" ON public.tenant_memberships;
CREATE POLICY "Admin/Manager updates membership"
ON public.tenant_memberships
FOR UPDATE
TO authenticated
USING (
  is_admin_or_manager(tenant_id)
  AND (
    user_id <> auth.uid()
    OR has_tenant_role(tenant_id, 'admin')
  )
)
WITH CHECK (
  is_admin_or_manager(tenant_id)
  AND (
    user_id <> auth.uid()
    OR has_tenant_role(tenant_id, 'admin')
  )
);

-- 5) crm-files bucket: add explicit UPDATE policy (insert/select/delete exist already)
CREATE POLICY "Members update crm-files in their tenant"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'crm-files'
  AND is_member_of_tenant(((storage.foldername(name))[1])::uuid)
)
WITH CHECK (
  bucket_id = 'crm-files'
  AND is_member_of_tenant(((storage.foldername(name))[1])::uuid)
);
