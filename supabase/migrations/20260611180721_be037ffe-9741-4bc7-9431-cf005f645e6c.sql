
-- 1) Tighten job_queue policies (remove tenant_id IS NULL branch for authenticated)
DROP POLICY IF EXISTS "Admin views jobs" ON public.job_queue;
DROP POLICY IF EXISTS "System inserts jobs" ON public.job_queue;
DROP POLICY IF EXISTS "Admin updates jobs" ON public.job_queue;

CREATE POLICY "Members view tenant jobs" ON public.job_queue
  FOR SELECT TO authenticated
  USING (tenant_id IS NOT NULL AND public.is_member_of_tenant(tenant_id));

CREATE POLICY "Members insert tenant jobs" ON public.job_queue
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id IS NOT NULL AND public.is_member_of_tenant(tenant_id));

CREATE POLICY "Admin updates tenant jobs" ON public.job_queue
  FOR UPDATE TO authenticated
  USING (tenant_id IS NOT NULL AND public.is_admin_or_manager(tenant_id));

-- 2) Fix function search_path
ALTER FUNCTION public.tg_campaign_recipients_no_funnel_regress() SET search_path = public;
