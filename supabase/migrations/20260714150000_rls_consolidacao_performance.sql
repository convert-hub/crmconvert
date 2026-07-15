-- ============================================================================
-- RLS: consolidação de políticas permissivas múltiplas + initplan
-- (aplicada em produção via MCP em 2026-07-14; arquivo para versionamento)
--
-- Motivo: cada query avaliava 2+ políticas POR LINHA (is_saas_admin() por linha
-- + is_member_of_tenant() por linha). Consolidamos em 1 política por ação:
--   - (SELECT is_saas_admin()) vira InitPlan (avaliado 1x por query)
--   - membership nas leituras quentes vira semi-join hasheado (1x por query)
-- Semântica preservada: mesmas permissões de antes.
-- Medido: query de messages por tenant caiu de ~80ms para ~5ms.
-- ============================================================================

-- ── MESSAGES ──
DROP POLICY IF EXISTS "SaaS admin manages messages" ON public.messages;
DROP POLICY IF EXISTS "Members view messages" ON public.messages;
DROP POLICY IF EXISTS "Members create messages" ON public.messages;
DROP POLICY IF EXISTS "Service updates message metadata" ON public.messages;

CREATE POLICY "messages_select" ON public.messages FOR SELECT TO authenticated
USING (
  (SELECT public.is_saas_admin())
  OR tenant_id IN (SELECT tm.tenant_id FROM public.tenant_memberships tm WHERE tm.user_id = (SELECT auth.uid()) AND tm.is_active = true)
);
CREATE POLICY "messages_insert" ON public.messages FOR INSERT TO authenticated
WITH CHECK (
  (SELECT public.is_saas_admin())
  OR (public.is_member_of_tenant(tenant_id) AND public.get_user_role_in_tenant(tenant_id) <> 'readonly'::tenant_role)
);
CREATE POLICY "messages_update" ON public.messages FOR UPDATE TO authenticated
USING ((SELECT public.is_saas_admin()) OR public.is_member_of_tenant(tenant_id))
WITH CHECK ((SELECT public.is_saas_admin()) OR public.is_member_of_tenant(tenant_id));
CREATE POLICY "messages_delete" ON public.messages FOR DELETE TO authenticated
USING ((SELECT public.is_saas_admin()));

-- ── CONVERSATIONS ──
DROP POLICY IF EXISTS "SaaS admin manages conversations" ON public.conversations;
DROP POLICY IF EXISTS "Members view conversations" ON public.conversations;
DROP POLICY IF EXISTS "Members create conversations" ON public.conversations;
DROP POLICY IF EXISTS "Members update conversations" ON public.conversations;
DROP POLICY IF EXISTS "Admin closes conversations" ON public.conversations;

CREATE POLICY "conversations_select" ON public.conversations FOR SELECT TO authenticated
USING (
  (SELECT public.is_saas_admin())
  OR tenant_id IN (SELECT tm.tenant_id FROM public.tenant_memberships tm WHERE tm.user_id = (SELECT auth.uid()) AND tm.is_active = true)
);
CREATE POLICY "conversations_insert" ON public.conversations FOR INSERT TO authenticated
WITH CHECK (
  (SELECT public.is_saas_admin())
  OR (public.is_member_of_tenant(tenant_id) AND public.get_user_role_in_tenant(tenant_id) <> 'readonly'::tenant_role)
);
CREATE POLICY "conversations_update" ON public.conversations FOR UPDATE TO authenticated
USING (
  (SELECT public.is_saas_admin())
  OR (public.is_member_of_tenant(tenant_id) AND public.get_user_role_in_tenant(tenant_id) <> 'readonly'::tenant_role)
);
CREATE POLICY "conversations_delete" ON public.conversations FOR DELETE TO authenticated
USING ((SELECT public.is_saas_admin()) OR public.is_admin_or_manager(tenant_id));

-- ── CONTACTS ──
DROP POLICY IF EXISTS "SaaS admin manages contacts" ON public.contacts;
DROP POLICY IF EXISTS "Members view contacts" ON public.contacts;
DROP POLICY IF EXISTS "Members create contacts" ON public.contacts;
DROP POLICY IF EXISTS "Members update contacts" ON public.contacts;
DROP POLICY IF EXISTS "Admin/Manager deletes contacts" ON public.contacts;

CREATE POLICY "contacts_select" ON public.contacts FOR SELECT TO authenticated
USING (
  (SELECT public.is_saas_admin())
  OR tenant_id IN (SELECT tm.tenant_id FROM public.tenant_memberships tm WHERE tm.user_id = (SELECT auth.uid()) AND tm.is_active = true)
);
CREATE POLICY "contacts_insert" ON public.contacts FOR INSERT TO authenticated
WITH CHECK (
  (SELECT public.is_saas_admin())
  OR (public.is_member_of_tenant(tenant_id) AND public.get_user_role_in_tenant(tenant_id) <> 'readonly'::tenant_role)
);
CREATE POLICY "contacts_update" ON public.contacts FOR UPDATE TO authenticated
USING (
  (SELECT public.is_saas_admin())
  OR (public.is_member_of_tenant(tenant_id) AND public.get_user_role_in_tenant(tenant_id) <> 'readonly'::tenant_role)
);
CREATE POLICY "contacts_delete" ON public.contacts FOR DELETE TO authenticated
USING ((SELECT public.is_saas_admin()) OR public.is_admin_or_manager(tenant_id));

-- ── OPPORTUNITIES ──
DROP POLICY IF EXISTS "SaaS admin manages opportunities" ON public.opportunities;
DROP POLICY IF EXISTS "Members view opportunities" ON public.opportunities;
DROP POLICY IF EXISTS "Members create opportunities" ON public.opportunities;
DROP POLICY IF EXISTS "Members update opportunities" ON public.opportunities;
DROP POLICY IF EXISTS "Members delete opportunities" ON public.opportunities;

CREATE POLICY "opportunities_select" ON public.opportunities FOR SELECT TO authenticated
USING (
  (SELECT public.is_saas_admin())
  OR (
    tenant_id IN (SELECT tm.tenant_id FROM public.tenant_memberships tm WHERE tm.user_id = (SELECT auth.uid()) AND tm.is_active = true)
    AND (public.can_view_all_in_tenant(tenant_id) OR assigned_to IS NULL OR assigned_to = public.get_user_membership_id(tenant_id))
  )
);
CREATE POLICY "opportunities_insert" ON public.opportunities FOR INSERT TO authenticated
WITH CHECK (
  (SELECT public.is_saas_admin())
  OR (public.is_member_of_tenant(tenant_id) AND public.get_user_role_in_tenant(tenant_id) <> 'readonly'::tenant_role)
);
CREATE POLICY "opportunities_update" ON public.opportunities FOR UPDATE TO authenticated
USING (
  (SELECT public.is_saas_admin())
  OR (public.is_member_of_tenant(tenant_id) AND public.get_user_role_in_tenant(tenant_id) <> 'readonly'::tenant_role)
);
CREATE POLICY "opportunities_delete" ON public.opportunities FOR DELETE TO authenticated
USING (
  (SELECT public.is_saas_admin())
  OR (public.is_member_of_tenant(tenant_id) AND public.get_user_role_in_tenant(tenant_id) <> 'readonly'::tenant_role)
);

-- ── ACTIVITIES ──
DROP POLICY IF EXISTS "SaaS admin manages activities" ON public.activities;
DROP POLICY IF EXISTS "Members view activities" ON public.activities;
DROP POLICY IF EXISTS "Members create activities" ON public.activities;
DROP POLICY IF EXISTS "Members update activities" ON public.activities;
DROP POLICY IF EXISTS "Admin/Manager deletes activities" ON public.activities;

CREATE POLICY "activities_select" ON public.activities FOR SELECT TO authenticated
USING (
  (SELECT public.is_saas_admin())
  OR tenant_id IN (SELECT tm.tenant_id FROM public.tenant_memberships tm WHERE tm.user_id = (SELECT auth.uid()) AND tm.is_active = true)
);
CREATE POLICY "activities_insert" ON public.activities FOR INSERT TO authenticated
WITH CHECK (
  (SELECT public.is_saas_admin())
  OR (public.is_member_of_tenant(tenant_id) AND public.get_user_role_in_tenant(tenant_id) <> 'readonly'::tenant_role)
);
CREATE POLICY "activities_update" ON public.activities FOR UPDATE TO authenticated
USING (
  (SELECT public.is_saas_admin())
  OR (public.is_member_of_tenant(tenant_id) AND public.get_user_role_in_tenant(tenant_id) <> 'readonly'::tenant_role)
);
CREATE POLICY "activities_delete" ON public.activities FOR DELETE TO authenticated
USING ((SELECT public.is_saas_admin()) OR public.is_admin_or_manager(tenant_id));

-- ── CAMPAIGNS ──
DROP POLICY IF EXISTS "SaaS admin manages campaigns" ON public.campaigns;
DROP POLICY IF EXISTS "Members view campaigns" ON public.campaigns;
DROP POLICY IF EXISTS "Admin/Manager creates campaigns" ON public.campaigns;
DROP POLICY IF EXISTS "Admin/Manager updates campaigns" ON public.campaigns;
DROP POLICY IF EXISTS "Admin/Manager deletes campaigns" ON public.campaigns;

CREATE POLICY "campaigns_select" ON public.campaigns FOR SELECT TO authenticated
USING (
  (SELECT public.is_saas_admin())
  OR tenant_id IN (SELECT tm.tenant_id FROM public.tenant_memberships tm WHERE tm.user_id = (SELECT auth.uid()) AND tm.is_active = true)
);
CREATE POLICY "campaigns_insert" ON public.campaigns FOR INSERT TO authenticated
WITH CHECK ((SELECT public.is_saas_admin()) OR public.is_admin_or_manager(tenant_id));
CREATE POLICY "campaigns_update" ON public.campaigns FOR UPDATE TO authenticated
USING ((SELECT public.is_saas_admin()) OR public.is_admin_or_manager(tenant_id));
CREATE POLICY "campaigns_delete" ON public.campaigns FOR DELETE TO authenticated
USING ((SELECT public.is_saas_admin()) OR public.is_admin_or_manager(tenant_id));

-- ── CAMPAIGN_RECIPIENTS ──
DROP POLICY IF EXISTS "SaaS admin manages recipients" ON public.campaign_recipients;
DROP POLICY IF EXISTS "Members view recipients" ON public.campaign_recipients;
DROP POLICY IF EXISTS "Admin/Manager creates recipients" ON public.campaign_recipients;
DROP POLICY IF EXISTS "Admin/Manager updates recipients" ON public.campaign_recipients;
DROP POLICY IF EXISTS "Admin/Manager deletes recipients" ON public.campaign_recipients;

CREATE POLICY "campaign_recipients_select" ON public.campaign_recipients FOR SELECT TO authenticated
USING (
  (SELECT public.is_saas_admin())
  OR tenant_id IN (SELECT tm.tenant_id FROM public.tenant_memberships tm WHERE tm.user_id = (SELECT auth.uid()) AND tm.is_active = true)
);
CREATE POLICY "campaign_recipients_insert" ON public.campaign_recipients FOR INSERT TO authenticated
WITH CHECK ((SELECT public.is_saas_admin()) OR public.is_admin_or_manager(tenant_id));
CREATE POLICY "campaign_recipients_update" ON public.campaign_recipients FOR UPDATE TO authenticated
USING ((SELECT public.is_saas_admin()) OR public.is_admin_or_manager(tenant_id));
CREATE POLICY "campaign_recipients_delete" ON public.campaign_recipients FOR DELETE TO authenticated
USING ((SELECT public.is_saas_admin()) OR public.is_admin_or_manager(tenant_id));

-- ── PROFILES (initplan + consolidação de 3 SELECTs) ──
DROP POLICY IF EXISTS "Users view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Members view co-member profiles" ON public.profiles;
DROP POLICY IF EXISTS "SaaS admin views all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
DROP POLICY IF EXISTS "System inserts profile" ON public.profiles;

CREATE POLICY "profiles_select" ON public.profiles FOR SELECT TO authenticated
USING (
  (SELECT public.is_saas_admin())
  OR user_id = (SELECT auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.tenant_memberships tm1
    JOIN public.tenant_memberships tm2 ON tm1.tenant_id = tm2.tenant_id
    WHERE tm1.user_id = (SELECT auth.uid()) AND tm1.is_active = true
      AND tm2.user_id = profiles.user_id AND tm2.is_active = true
  )
);
CREATE POLICY "profiles_insert" ON public.profiles FOR INSERT TO authenticated
WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "profiles_update" ON public.profiles FOR UPDATE TO authenticated
USING (user_id = (SELECT auth.uid()));

-- ── TENANTS (initplan + consolidação) ──
DROP POLICY IF EXISTS "Members view tenant" ON public.tenants;
DROP POLICY IF EXISTS "SaaS admin views all tenants" ON public.tenants;
DROP POLICY IF EXISTS "Authenticated creates tenant" ON public.tenants;
DROP POLICY IF EXISTS "SaaS admin creates tenants" ON public.tenants;
DROP POLICY IF EXISTS "Admin updates tenant" ON public.tenants;
DROP POLICY IF EXISTS "SaaS admin updates any tenant" ON public.tenants;
DROP POLICY IF EXISTS "SaaS admin deletes tenants" ON public.tenants;

CREATE POLICY "tenants_select" ON public.tenants FOR SELECT TO authenticated
USING (
  (SELECT public.is_saas_admin())
  OR id IN (SELECT tm.tenant_id FROM public.tenant_memberships tm WHERE tm.user_id = (SELECT auth.uid()) AND tm.is_active = true)
);
CREATE POLICY "tenants_insert" ON public.tenants FOR INSERT TO authenticated
WITH CHECK ((SELECT public.is_saas_admin()) OR (SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "tenants_update" ON public.tenants FOR UPDATE TO authenticated
USING ((SELECT public.is_saas_admin()) OR public.has_tenant_role(id, 'admin'::tenant_role));
CREATE POLICY "tenants_delete" ON public.tenants FOR DELETE TO authenticated
USING ((SELECT public.is_saas_admin()));

-- ── TENANT_MEMBERSHIPS (initplan; mantém funções SECURITY DEFINER para evitar
--     recursão de subquery na própria tabela) ──
DROP POLICY IF EXISTS "Members view memberships" ON public.tenant_memberships;
DROP POLICY IF EXISTS "SaaS admin views all memberships" ON public.tenant_memberships;
DROP POLICY IF EXISTS "Admin/Manager creates membership" ON public.tenant_memberships;
DROP POLICY IF EXISTS "Creator first membership" ON public.tenant_memberships;
DROP POLICY IF EXISTS "SaaS admin creates any membership" ON public.tenant_memberships;
DROP POLICY IF EXISTS "Admin/Manager updates membership" ON public.tenant_memberships;
DROP POLICY IF EXISTS "SaaS admin updates any membership" ON public.tenant_memberships;
DROP POLICY IF EXISTS "Admin deletes membership" ON public.tenant_memberships;
DROP POLICY IF EXISTS "SaaS admin deletes any membership" ON public.tenant_memberships;

CREATE POLICY "tenant_memberships_select" ON public.tenant_memberships FOR SELECT TO authenticated
USING ((SELECT public.is_saas_admin()) OR public.is_member_of_tenant(tenant_id));
CREATE POLICY "tenant_memberships_insert" ON public.tenant_memberships FOR INSERT TO authenticated
WITH CHECK (
  (SELECT public.is_saas_admin())
  OR public.is_admin_or_manager(tenant_id)
  OR (
    user_id = (SELECT auth.uid()) AND role = 'admin'::tenant_role
    AND NOT EXISTS (SELECT 1 FROM public.tenant_memberships tm WHERE tm.tenant_id = tenant_memberships.tenant_id)
  )
);
CREATE POLICY "tenant_memberships_update" ON public.tenant_memberships FOR UPDATE TO authenticated
USING (
  (SELECT public.is_saas_admin())
  OR (public.is_admin_or_manager(tenant_id) AND (user_id <> (SELECT auth.uid()) OR public.has_tenant_role(tenant_id, 'admin'::tenant_role)))
)
WITH CHECK (
  (SELECT public.is_saas_admin())
  OR (public.is_admin_or_manager(tenant_id) AND (user_id <> (SELECT auth.uid()) OR public.has_tenant_role(tenant_id, 'admin'::tenant_role)))
);
CREATE POLICY "tenant_memberships_delete" ON public.tenant_memberships FOR DELETE TO authenticated
USING (
  (SELECT public.is_saas_admin())
  OR (public.has_tenant_role(tenant_id, 'admin'::tenant_role) AND user_id <> (SELECT auth.uid()))
);
