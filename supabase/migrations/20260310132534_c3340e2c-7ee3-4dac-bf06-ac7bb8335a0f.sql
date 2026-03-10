
-- SaaS admin needs full access to opportunities and related tables when impersonating
-- Add SaaS admin ALL policies for tables that lack them

-- opportunities: add SaaS admin ALL
CREATE POLICY "SaaS admin manages opportunities"
  ON public.opportunities FOR ALL
  TO public
  USING (is_saas_admin())
  WITH CHECK (is_saas_admin());

-- conversations: add SaaS admin ALL
CREATE POLICY "SaaS admin manages conversations"
  ON public.conversations FOR ALL
  TO public
  USING (is_saas_admin())
  WITH CHECK (is_saas_admin());

-- activities: add SaaS admin ALL
CREATE POLICY "SaaS admin manages activities"
  ON public.activities FOR ALL
  TO public
  USING (is_saas_admin())
  WITH CHECK (is_saas_admin());

-- stage_moves: add SaaS admin ALL
CREATE POLICY "SaaS admin manages stage moves"
  ON public.stage_moves FOR ALL
  TO public
  USING (is_saas_admin())
  WITH CHECK (is_saas_admin());

-- contacts: add SaaS admin ALL
CREATE POLICY "SaaS admin manages contacts"
  ON public.contacts FOR ALL
  TO public
  USING (is_saas_admin())
  WITH CHECK (is_saas_admin());

-- messages: add SaaS admin ALL
CREATE POLICY "SaaS admin manages messages"
  ON public.messages FOR ALL
  TO public
  USING (is_saas_admin())
  WITH CHECK (is_saas_admin());
