
-- Tabela de administradores SaaS (super admins)
CREATE TABLE public.saas_admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.saas_admins ENABLE ROW LEVEL SECURITY;

-- Função security definer para checar se é SaaS admin
CREATE OR REPLACE FUNCTION public.is_saas_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.saas_admins
    WHERE user_id = auth.uid()
  )
$$;

-- SaaS admins podem ver a tabela
CREATE POLICY "SaaS admins view saas_admins"
  ON public.saas_admins FOR SELECT
  USING (is_saas_admin());

-- Apenas SaaS admins existentes podem inserir novos
CREATE POLICY "SaaS admins insert saas_admins"
  ON public.saas_admins FOR INSERT
  WITH CHECK (is_saas_admin());

-- Apenas SaaS admins podem deletar
CREATE POLICY "SaaS admins delete saas_admins"
  ON public.saas_admins FOR DELETE
  USING (is_saas_admin());

-- Permitir que SaaS admins vejam TODOS os tenants (não só os que são membros)
CREATE POLICY "SaaS admin views all tenants"
  ON public.tenants FOR SELECT
  USING (is_saas_admin());

-- Permitir que SaaS admins criem memberships em qualquer tenant
CREATE POLICY "SaaS admin creates any membership"
  ON public.tenant_memberships FOR INSERT
  WITH CHECK (is_saas_admin());

-- Permitir que SaaS admins vejam todas as memberships
CREATE POLICY "SaaS admin views all memberships"
  ON public.tenant_memberships FOR SELECT
  USING (is_saas_admin());

-- Permitir que SaaS admins atualizem memberships
CREATE POLICY "SaaS admin updates any membership"
  ON public.tenant_memberships FOR UPDATE
  USING (is_saas_admin());

-- Permitir que SaaS admins deletem memberships
CREATE POLICY "SaaS admin deletes any membership"
  ON public.tenant_memberships FOR DELETE
  USING (is_saas_admin());

-- Permitir que SaaS admins criem tenants
CREATE POLICY "SaaS admin creates tenants"
  ON public.tenants FOR INSERT
  WITH CHECK (is_saas_admin());

-- Permitir que SaaS admins atualizem qualquer tenant
CREATE POLICY "SaaS admin updates any tenant"
  ON public.tenants FOR UPDATE
  USING (is_saas_admin());

-- Permitir que SaaS admins vejam todos os profiles
CREATE POLICY "SaaS admin views all profiles"
  ON public.profiles FOR SELECT
  USING (is_saas_admin());

-- SaaS admins gerenciam whatsapp instances de qualquer tenant
CREATE POLICY "SaaS admin manages whatsapp instances"
  ON public.whatsapp_instances FOR ALL
  USING (is_saas_admin());

-- SaaS admins gerenciam ai_configs de qualquer tenant
CREATE POLICY "SaaS admin manages ai configs"
  ON public.ai_configs FOR ALL
  USING (is_saas_admin());
