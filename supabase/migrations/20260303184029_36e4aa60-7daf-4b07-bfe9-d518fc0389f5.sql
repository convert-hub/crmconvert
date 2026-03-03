CREATE POLICY "SaaS admin manages prompt templates"
ON public.prompt_templates
FOR ALL
USING (is_saas_admin())
WITH CHECK (is_saas_admin());