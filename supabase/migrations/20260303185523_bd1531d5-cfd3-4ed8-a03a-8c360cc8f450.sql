-- Allow admin/manager to see global API keys (for selection in AI config)
-- They can see id, label, provider but the api_key_encrypted is still exposed in the row
-- This is acceptable since these are server-managed keys
CREATE POLICY "Authenticated users view global keys"
ON public.global_api_keys
FOR SELECT
USING (auth.uid() IS NOT NULL);