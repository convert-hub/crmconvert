CREATE POLICY "Members view co-member profiles"
ON public.profiles
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.tenant_memberships tm1
    JOIN public.tenant_memberships tm2 ON tm1.tenant_id = tm2.tenant_id
    WHERE tm1.user_id = auth.uid()
      AND tm1.is_active = true
      AND tm2.user_id = profiles.user_id
      AND tm2.is_active = true
  )
);