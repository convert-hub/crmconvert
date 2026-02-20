
-- Fix permissive RLS policies
DROP POLICY "Anyone creates tenant" ON public.tenants;
CREATE POLICY "Authenticated creates tenant" ON public.tenants FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY "System inserts webhooks" ON public.webhook_events;
CREATE POLICY "Members insert webhooks" ON public.webhook_events FOR INSERT WITH CHECK (tenant_id IS NOT NULL AND public.is_member_of_tenant(tenant_id));
