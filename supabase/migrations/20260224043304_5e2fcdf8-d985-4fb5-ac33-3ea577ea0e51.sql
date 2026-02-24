-- Create public bucket for tenant logos
INSERT INTO storage.buckets (id, name, public)
VALUES ('tenant-logos', 'tenant-logos', true)
ON CONFLICT (id) DO NOTHING;

-- Anyone can view tenant logos (public bucket)
CREATE POLICY "Public read tenant logos"
ON storage.objects FOR SELECT
USING (bucket_id = 'tenant-logos');

-- Tenant admins can upload logos (folder = tenant_id)
CREATE POLICY "Tenant admins upload logos"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'tenant-logos'
  AND public.is_member_of_tenant((storage.foldername(name))[1]::uuid)
  AND public.has_tenant_role((storage.foldername(name))[1]::uuid, 'admin')
);

-- Tenant admins can update logos
CREATE POLICY "Tenant admins update logos"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'tenant-logos'
  AND public.is_member_of_tenant((storage.foldername(name))[1]::uuid)
  AND public.has_tenant_role((storage.foldername(name))[1]::uuid, 'admin')
);

-- Tenant admins can delete logos
CREATE POLICY "Tenant admins delete logos"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'tenant-logos'
  AND public.is_member_of_tenant((storage.foldername(name))[1]::uuid)
  AND public.has_tenant_role((storage.foldername(name))[1]::uuid, 'admin')
);