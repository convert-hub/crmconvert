
-- Allow SaaS admins to manage files in tenant-logos bucket
CREATE POLICY "SaaS admin uploads tenant logos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'tenant-logos' AND (SELECT is_saas_admin()));

CREATE POLICY "SaaS admin updates tenant logos"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'tenant-logos' AND (SELECT is_saas_admin()));

CREATE POLICY "SaaS admin deletes tenant logos"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'tenant-logos' AND (SELECT is_saas_admin()));

-- Allow tenant admins to manage their own logos
CREATE POLICY "Tenant admin uploads own logo"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'tenant-logos' AND (SELECT is_member_of_tenant((storage.foldername(name))[1]::uuid)));

CREATE POLICY "Tenant admin updates own logo"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'tenant-logos' AND (SELECT is_member_of_tenant((storage.foldername(name))[1]::uuid)));

CREATE POLICY "Tenant admin deletes own logo"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'tenant-logos' AND (SELECT is_member_of_tenant((storage.foldername(name))[1]::uuid)));
