-- Allow service role to update messages (for status updates from webhooks)
-- The service role key bypasses RLS, but let's also add a policy for completeness
CREATE POLICY "Service updates message metadata"
ON public.messages
FOR UPDATE
USING (is_member_of_tenant(tenant_id))
WITH CHECK (is_member_of_tenant(tenant_id));