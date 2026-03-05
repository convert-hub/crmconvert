
CREATE POLICY "SaaS admin manages pipelines"
ON public.pipelines FOR ALL
USING (is_saas_admin())
WITH CHECK (is_saas_admin());

CREATE POLICY "SaaS admin manages stages"
ON public.stages FOR ALL
USING (is_saas_admin())
WITH CHECK (is_saas_admin());
