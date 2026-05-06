
-- 1) Restrict whatsapp_instances SELECT to admin/manager (hide encrypted tokens from regular members)
DROP POLICY IF EXISTS "Members view whatsapp instances" ON public.whatsapp_instances;

CREATE POLICY "Admin/Manager view whatsapp instances"
  ON public.whatsapp_instances
  FOR SELECT
  TO authenticated
  USING (is_admin_or_manager(tenant_id));

-- 2) Provide a safe public view exposing only non-sensitive columns to all tenant members
CREATE OR REPLACE VIEW public.whatsapp_instances_public
WITH (security_invoker = on) AS
SELECT
  id,
  tenant_id,
  provider,
  display_name,
  instance_name,
  api_url,
  phone_number,
  is_active,
  meta_phone_number_id,
  meta_waba_id,
  created_at,
  updated_at
FROM public.whatsapp_instances;

GRANT SELECT ON public.whatsapp_instances_public TO authenticated;

-- 3) Tighten webhook_events SELECT: explicitly exclude null tenant_id rows from member access
DROP POLICY IF EXISTS "Admin views webhooks" ON public.webhook_events;

CREATE POLICY "Members view webhooks for their tenant"
  ON public.webhook_events
  FOR SELECT
  TO authenticated
  USING (tenant_id IS NOT NULL AND is_member_of_tenant(tenant_id));

CREATE POLICY "SaaS admin views all webhooks"
  ON public.webhook_events
  FOR SELECT
  TO authenticated
  USING (is_saas_admin());
