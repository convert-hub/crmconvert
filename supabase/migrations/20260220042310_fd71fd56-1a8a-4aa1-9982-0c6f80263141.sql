
-- Fix: All policies need to be PERMISSIVE (default) not RESTRICTIVE
-- Drop and recreate the tenant INSERT policy as PERMISSIVE
DROP POLICY IF EXISTS "Authenticated creates tenant" ON public.tenants;
CREATE POLICY "Authenticated creates tenant" ON public.tenants
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

-- Fix the Members view tenant policy
DROP POLICY IF EXISTS "Members view tenant" ON public.tenants;
CREATE POLICY "Members view tenant" ON public.tenants
  FOR SELECT TO authenticated
  USING (is_member_of_tenant(id));

-- Fix Admin updates tenant
DROP POLICY IF EXISTS "Admin updates tenant" ON public.tenants;
CREATE POLICY "Admin updates tenant" ON public.tenants
  FOR UPDATE TO authenticated
  USING (has_tenant_role(id, 'admin'::tenant_role));

-- Fix tenant_memberships policies - make PERMISSIVE and fix the self-join bug
DROP POLICY IF EXISTS "Creator first membership" ON public.tenant_memberships;
CREATE POLICY "Creator first membership" ON public.tenant_memberships
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND role = 'admin'::tenant_role
    AND NOT EXISTS (
      SELECT 1 FROM public.tenant_memberships tm
      WHERE tm.tenant_id = tenant_memberships.tenant_id
    )
  );

DROP POLICY IF EXISTS "Admin/Manager creates membership" ON public.tenant_memberships;
CREATE POLICY "Admin/Manager creates membership" ON public.tenant_memberships
  FOR INSERT TO authenticated
  WITH CHECK (is_admin_or_manager(tenant_id));

DROP POLICY IF EXISTS "Members view memberships" ON public.tenant_memberships;
CREATE POLICY "Members view memberships" ON public.tenant_memberships
  FOR SELECT TO authenticated
  USING (is_member_of_tenant(tenant_id));

DROP POLICY IF EXISTS "Admin/Manager updates membership" ON public.tenant_memberships;
CREATE POLICY "Admin/Manager updates membership" ON public.tenant_memberships
  FOR UPDATE TO authenticated
  USING (is_admin_or_manager(tenant_id));

DROP POLICY IF EXISTS "Admin deletes membership" ON public.tenant_memberships;
CREATE POLICY "Admin deletes membership" ON public.tenant_memberships
  FOR DELETE TO authenticated
  USING (has_tenant_role(tenant_id, 'admin'::tenant_role) AND user_id <> auth.uid());

-- Fix pipelines policies
DROP POLICY IF EXISTS "Admin/Manager creates pipelines" ON public.pipelines;
CREATE POLICY "Admin/Manager creates pipelines" ON public.pipelines
  FOR INSERT TO authenticated
  WITH CHECK (is_admin_or_manager(tenant_id));

DROP POLICY IF EXISTS "Members view pipelines" ON public.pipelines;
CREATE POLICY "Members view pipelines" ON public.pipelines
  FOR SELECT TO authenticated
  USING (is_member_of_tenant(tenant_id));

DROP POLICY IF EXISTS "Admin/Manager updates pipelines" ON public.pipelines;
CREATE POLICY "Admin/Manager updates pipelines" ON public.pipelines
  FOR UPDATE TO authenticated
  USING (is_admin_or_manager(tenant_id));

DROP POLICY IF EXISTS "Admin deletes pipelines" ON public.pipelines;
CREATE POLICY "Admin deletes pipelines" ON public.pipelines
  FOR DELETE TO authenticated
  USING (has_tenant_role(tenant_id, 'admin'::tenant_role));

-- Fix stages policies
DROP POLICY IF EXISTS "Admin/Manager creates stages" ON public.stages;
CREATE POLICY "Admin/Manager creates stages" ON public.stages
  FOR INSERT TO authenticated
  WITH CHECK (is_admin_or_manager(tenant_id));

DROP POLICY IF EXISTS "Members view stages" ON public.stages;
CREATE POLICY "Members view stages" ON public.stages
  FOR SELECT TO authenticated
  USING (is_member_of_tenant(tenant_id));

DROP POLICY IF EXISTS "Admin/Manager updates stages" ON public.stages;
CREATE POLICY "Admin/Manager updates stages" ON public.stages
  FOR UPDATE TO authenticated
  USING (is_admin_or_manager(tenant_id));

DROP POLICY IF EXISTS "Admin deletes stages" ON public.stages;
CREATE POLICY "Admin deletes stages" ON public.stages
  FOR DELETE TO authenticated
  USING (has_tenant_role(tenant_id, 'admin'::tenant_role));

-- Fix profiles policies
DROP POLICY IF EXISTS "Users view own profile" ON public.profiles;
CREATE POLICY "Users view own profile" ON public.profiles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
CREATE POLICY "Users update own profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "System inserts profile" ON public.profiles;
CREATE POLICY "System inserts profile" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Fix remaining tables with same pattern (contacts, opportunities, etc.)
DROP POLICY IF EXISTS "Members view contacts" ON public.contacts;
CREATE POLICY "Members view contacts" ON public.contacts
  FOR SELECT TO authenticated USING (is_member_of_tenant(tenant_id));

DROP POLICY IF EXISTS "Members create contacts" ON public.contacts;
CREATE POLICY "Members create contacts" ON public.contacts
  FOR INSERT TO authenticated WITH CHECK (is_member_of_tenant(tenant_id) AND get_user_role_in_tenant(tenant_id) <> 'readonly');

DROP POLICY IF EXISTS "Members update contacts" ON public.contacts;
CREATE POLICY "Members update contacts" ON public.contacts
  FOR UPDATE TO authenticated USING (is_member_of_tenant(tenant_id) AND get_user_role_in_tenant(tenant_id) <> 'readonly');

DROP POLICY IF EXISTS "Admin/Manager deletes contacts" ON public.contacts;
CREATE POLICY "Admin/Manager deletes contacts" ON public.contacts
  FOR DELETE TO authenticated USING (is_admin_or_manager(tenant_id));

DROP POLICY IF EXISTS "Members view opportunities" ON public.opportunities;
CREATE POLICY "Members view opportunities" ON public.opportunities
  FOR SELECT TO authenticated USING (is_member_of_tenant(tenant_id));

DROP POLICY IF EXISTS "Members create opportunities" ON public.opportunities;
CREATE POLICY "Members create opportunities" ON public.opportunities
  FOR INSERT TO authenticated WITH CHECK (is_member_of_tenant(tenant_id) AND get_user_role_in_tenant(tenant_id) <> 'readonly');

DROP POLICY IF EXISTS "Members update opportunities" ON public.opportunities;
CREATE POLICY "Members update opportunities" ON public.opportunities
  FOR UPDATE TO authenticated USING (is_member_of_tenant(tenant_id) AND get_user_role_in_tenant(tenant_id) <> 'readonly');

DROP POLICY IF EXISTS "Admin/Manager deletes opportunities" ON public.opportunities;
CREATE POLICY "Admin/Manager deletes opportunities" ON public.opportunities
  FOR DELETE TO authenticated USING (is_admin_or_manager(tenant_id));

-- Fix conversations
DROP POLICY IF EXISTS "Members view conversations" ON public.conversations;
CREATE POLICY "Members view conversations" ON public.conversations
  FOR SELECT TO authenticated USING (is_member_of_tenant(tenant_id));

DROP POLICY IF EXISTS "Members create conversations" ON public.conversations;
CREATE POLICY "Members create conversations" ON public.conversations
  FOR INSERT TO authenticated WITH CHECK (is_member_of_tenant(tenant_id) AND get_user_role_in_tenant(tenant_id) <> 'readonly');

DROP POLICY IF EXISTS "Members update conversations" ON public.conversations;
CREATE POLICY "Members update conversations" ON public.conversations
  FOR UPDATE TO authenticated USING (is_member_of_tenant(tenant_id) AND get_user_role_in_tenant(tenant_id) <> 'readonly');

DROP POLICY IF EXISTS "Admin closes conversations" ON public.conversations;
CREATE POLICY "Admin closes conversations" ON public.conversations
  FOR DELETE TO authenticated USING (is_admin_or_manager(tenant_id));

-- Fix messages
DROP POLICY IF EXISTS "Members view messages" ON public.messages;
CREATE POLICY "Members view messages" ON public.messages
  FOR SELECT TO authenticated USING (is_member_of_tenant(tenant_id));

DROP POLICY IF EXISTS "Members create messages" ON public.messages;
CREATE POLICY "Members create messages" ON public.messages
  FOR INSERT TO authenticated WITH CHECK (is_member_of_tenant(tenant_id) AND get_user_role_in_tenant(tenant_id) <> 'readonly');

-- Fix activities
DROP POLICY IF EXISTS "Members view activities" ON public.activities;
CREATE POLICY "Members view activities" ON public.activities
  FOR SELECT TO authenticated USING (is_member_of_tenant(tenant_id));

DROP POLICY IF EXISTS "Members create activities" ON public.activities;
CREATE POLICY "Members create activities" ON public.activities
  FOR INSERT TO authenticated WITH CHECK (is_member_of_tenant(tenant_id) AND get_user_role_in_tenant(tenant_id) <> 'readonly');

DROP POLICY IF EXISTS "Members update activities" ON public.activities;
CREATE POLICY "Members update activities" ON public.activities
  FOR UPDATE TO authenticated USING (is_member_of_tenant(tenant_id) AND get_user_role_in_tenant(tenant_id) <> 'readonly');

DROP POLICY IF EXISTS "Admin/Manager deletes activities" ON public.activities;
CREATE POLICY "Admin/Manager deletes activities" ON public.activities
  FOR DELETE TO authenticated USING (is_admin_or_manager(tenant_id));

-- Fix remaining tables
DROP POLICY IF EXISTS "Members view automations" ON public.automations;
CREATE POLICY "Members view automations" ON public.automations FOR SELECT TO authenticated USING (is_member_of_tenant(tenant_id));
DROP POLICY IF EXISTS "Admin/Manager creates automations" ON public.automations;
CREATE POLICY "Admin/Manager creates automations" ON public.automations FOR INSERT TO authenticated WITH CHECK (is_admin_or_manager(tenant_id));
DROP POLICY IF EXISTS "Admin/Manager updates automations" ON public.automations;
CREATE POLICY "Admin/Manager updates automations" ON public.automations FOR UPDATE TO authenticated USING (is_admin_or_manager(tenant_id));
DROP POLICY IF EXISTS "Admin deletes automations" ON public.automations;
CREATE POLICY "Admin deletes automations" ON public.automations FOR DELETE TO authenticated USING (has_tenant_role(tenant_id, 'admin'));

DROP POLICY IF EXISTS "Members view ai configs" ON public.ai_configs;
CREATE POLICY "Members view ai configs" ON public.ai_configs FOR SELECT TO authenticated USING (is_member_of_tenant(tenant_id));
DROP POLICY IF EXISTS "Admin creates ai configs" ON public.ai_configs;
CREATE POLICY "Admin creates ai configs" ON public.ai_configs FOR INSERT TO authenticated WITH CHECK (has_tenant_role(tenant_id, 'admin'));
DROP POLICY IF EXISTS "Admin updates ai configs" ON public.ai_configs;
CREATE POLICY "Admin updates ai configs" ON public.ai_configs FOR UPDATE TO authenticated USING (has_tenant_role(tenant_id, 'admin'));
DROP POLICY IF EXISTS "Admin deletes ai configs" ON public.ai_configs;
CREATE POLICY "Admin deletes ai configs" ON public.ai_configs FOR DELETE TO authenticated USING (has_tenant_role(tenant_id, 'admin'));

DROP POLICY IF EXISTS "Members view ai logs" ON public.ai_logs;
CREATE POLICY "Members view ai logs" ON public.ai_logs FOR SELECT TO authenticated USING (is_member_of_tenant(tenant_id));
DROP POLICY IF EXISTS "System inserts ai logs" ON public.ai_logs;
CREATE POLICY "System inserts ai logs" ON public.ai_logs FOR INSERT TO authenticated WITH CHECK (is_member_of_tenant(tenant_id));

DROP POLICY IF EXISTS "Members view prompts" ON public.prompt_templates;
CREATE POLICY "Members view prompts" ON public.prompt_templates FOR SELECT TO authenticated USING (is_member_of_tenant(tenant_id));
DROP POLICY IF EXISTS "Admin/Manager creates prompts" ON public.prompt_templates;
CREATE POLICY "Admin/Manager creates prompts" ON public.prompt_templates FOR INSERT TO authenticated WITH CHECK (is_admin_or_manager(tenant_id));
DROP POLICY IF EXISTS "Admin/Manager updates prompts" ON public.prompt_templates;
CREATE POLICY "Admin/Manager updates prompts" ON public.prompt_templates FOR UPDATE TO authenticated USING (is_admin_or_manager(tenant_id));
DROP POLICY IF EXISTS "Admin deletes prompts" ON public.prompt_templates;
CREATE POLICY "Admin deletes prompts" ON public.prompt_templates FOR DELETE TO authenticated USING (has_tenant_role(tenant_id, 'admin'));

DROP POLICY IF EXISTS "Members view stage moves" ON public.stage_moves;
CREATE POLICY "Members view stage moves" ON public.stage_moves FOR SELECT TO authenticated USING (is_member_of_tenant(tenant_id));
DROP POLICY IF EXISTS "Members create stage moves" ON public.stage_moves;
CREATE POLICY "Members create stage moves" ON public.stage_moves FOR INSERT TO authenticated WITH CHECK (is_member_of_tenant(tenant_id) AND get_user_role_in_tenant(tenant_id) <> 'readonly');

DROP POLICY IF EXISTS "Members view reviews" ON public.conversation_reviews;
CREATE POLICY "Members view reviews" ON public.conversation_reviews FOR SELECT TO authenticated USING (is_member_of_tenant(tenant_id));
DROP POLICY IF EXISTS "Members create reviews" ON public.conversation_reviews;
CREATE POLICY "Members create reviews" ON public.conversation_reviews FOR INSERT TO authenticated WITH CHECK (is_member_of_tenant(tenant_id) AND get_user_role_in_tenant(tenant_id) <> 'readonly');

DROP POLICY IF EXISTS "Members view companies" ON public.companies;
CREATE POLICY "Members view companies" ON public.companies FOR SELECT TO authenticated USING (is_member_of_tenant(tenant_id));
DROP POLICY IF EXISTS "Members create companies" ON public.companies;
CREATE POLICY "Members create companies" ON public.companies FOR INSERT TO authenticated WITH CHECK (is_member_of_tenant(tenant_id) AND get_user_role_in_tenant(tenant_id) <> 'readonly');
DROP POLICY IF EXISTS "Members update companies" ON public.companies;
CREATE POLICY "Members update companies" ON public.companies FOR UPDATE TO authenticated USING (is_member_of_tenant(tenant_id) AND get_user_role_in_tenant(tenant_id) <> 'readonly');
DROP POLICY IF EXISTS "Admin/Manager deletes companies" ON public.companies;
CREATE POLICY "Admin/Manager deletes companies" ON public.companies FOR DELETE TO authenticated USING (is_admin_or_manager(tenant_id));

DROP POLICY IF EXISTS "Admin views jobs" ON public.job_queue;
CREATE POLICY "Admin views jobs" ON public.job_queue FOR SELECT TO authenticated USING (tenant_id IS NULL OR is_member_of_tenant(tenant_id));
DROP POLICY IF EXISTS "System inserts jobs" ON public.job_queue;
CREATE POLICY "System inserts jobs" ON public.job_queue FOR INSERT TO authenticated WITH CHECK (tenant_id IS NULL OR is_member_of_tenant(tenant_id));
DROP POLICY IF EXISTS "Admin updates jobs" ON public.job_queue;
CREATE POLICY "Admin updates jobs" ON public.job_queue FOR UPDATE TO authenticated USING (tenant_id IS NULL OR is_admin_or_manager(tenant_id));

DROP POLICY IF EXISTS "Members view audit log" ON public.audit_log;
CREATE POLICY "Members view audit log" ON public.audit_log FOR SELECT TO authenticated USING (is_member_of_tenant(tenant_id));
DROP POLICY IF EXISTS "System inserts audit" ON public.audit_log;
CREATE POLICY "System inserts audit" ON public.audit_log FOR INSERT TO authenticated WITH CHECK (is_member_of_tenant(tenant_id));

DROP POLICY IF EXISTS "Admin views webhooks" ON public.webhook_events;
CREATE POLICY "Admin views webhooks" ON public.webhook_events FOR SELECT TO authenticated USING (is_member_of_tenant(tenant_id));
DROP POLICY IF EXISTS "Members insert webhooks" ON public.webhook_events;
CREATE POLICY "Members insert webhooks" ON public.webhook_events FOR INSERT TO authenticated WITH CHECK (tenant_id IS NOT NULL AND is_member_of_tenant(tenant_id));

DROP POLICY IF EXISTS "Members view whatsapp instances" ON public.whatsapp_instances;
CREATE POLICY "Members view whatsapp instances" ON public.whatsapp_instances FOR SELECT TO authenticated USING (is_member_of_tenant(tenant_id));
DROP POLICY IF EXISTS "Admin creates whatsapp instances" ON public.whatsapp_instances;
CREATE POLICY "Admin creates whatsapp instances" ON public.whatsapp_instances FOR INSERT TO authenticated WITH CHECK (has_tenant_role(tenant_id, 'admin'));
DROP POLICY IF EXISTS "Admin updates whatsapp instances" ON public.whatsapp_instances;
CREATE POLICY "Admin updates whatsapp instances" ON public.whatsapp_instances FOR UPDATE TO authenticated USING (has_tenant_role(tenant_id, 'admin'));
DROP POLICY IF EXISTS "Admin deletes whatsapp instances" ON public.whatsapp_instances;
CREATE POLICY "Admin deletes whatsapp instances" ON public.whatsapp_instances FOR DELETE TO authenticated USING (has_tenant_role(tenant_id, 'admin'));
