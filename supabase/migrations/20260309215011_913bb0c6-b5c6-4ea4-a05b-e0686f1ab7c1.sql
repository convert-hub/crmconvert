CREATE POLICY "Admin/Manager deletes stage moves"
ON public.stage_moves
FOR DELETE
TO authenticated
USING (is_admin_or_manager(tenant_id));