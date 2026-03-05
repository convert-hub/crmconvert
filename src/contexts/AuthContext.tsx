import React, { createContext, useContext, useEffect, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import type { TenantMembership, Tenant, Profile, TenantRole } from '@/types/crm';

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  membership: TenantMembership | null;
  tenant: Tenant | null;
  role: TenantRole | null;
  isSaasAdmin: boolean;
  loading: boolean;
  impersonatedTenantId: string | null;
  signOut: () => Promise<void>;
  refreshTenant: () => Promise<void>;
  switchTenant: (tenantId: string | null) => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  session: null, user: null, profile: null, membership: null,
  tenant: null, role: null, isSaasAdmin: false, loading: true,
  impersonatedTenantId: null,
  signOut: async () => {}, refreshTenant: async () => {}, switchTenant: async () => {},
});

export const useAuth = () => useContext(AuthContext);

const IMPERSONATION_KEY = 'impersonatedTenantId';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [membership, setMembership] = useState<TenantMembership | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [isSaasAdmin, setIsSaasAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [impersonatedTenantId, setImpersonatedTenantId] = useState<string | null>(
    () => sessionStorage.getItem(IMPERSONATION_KEY)
  );

  const loadUserData = async (userId: string) => {
    try {
      // Load profile
      const { data: prof } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', userId)
        .single();
      setProfile(prof as unknown as Profile);

      // Load membership (first active)
      const { data: mem } = await supabase
        .from('tenant_memberships')
        .select('*')
        .eq('user_id', userId)
        .eq('is_active', true)
        .limit(1)
        .single();
      
      if (mem) {
        const m = mem as unknown as TenantMembership;
        setMembership(m);
      }

      // Check SaaS admin
      const { data: saasRow } = await supabase
        .from('saas_admins')
        .select('id')
        .eq('user_id', userId)
        .maybeSingle();
      const isAdmin = !!saasRow;
      setIsSaasAdmin(isAdmin);

      // Restore impersonated tenant from sessionStorage
      const storedImpersonation = sessionStorage.getItem(IMPERSONATION_KEY);
      if (isAdmin && storedImpersonation) {
        setImpersonatedTenantId(storedImpersonation);
        const { data: t } = await supabase
          .from('tenants')
          .select('*')
          .eq('id', storedImpersonation)
          .single();
        if (t) {
          setTenant(t as unknown as Tenant);
        } else {
          // Invalid stored tenant, clear it
          sessionStorage.removeItem(IMPERSONATION_KEY);
          setImpersonatedTenantId(null);
          // Fall back to own tenant
          if (mem) {
            const { data: ownT } = await supabase
              .from('tenants')
              .select('*')
              .eq('id', (mem as unknown as TenantMembership).tenant_id)
              .single();
            setTenant(ownT as unknown as Tenant);
          }
        }
      } else if (mem) {
        // Load own tenant
        const { data: t } = await supabase
          .from('tenants')
          .select('*')
          .eq('id', (mem as unknown as TenantMembership).tenant_id)
          .single();
        setTenant(t as unknown as Tenant);
      }
    } catch (e) {
      console.error('Error loading user data:', e);
    }
  };

  useEffect(() => {
    let mounted = true;
    let dataLoaded = false;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, sess) => {
        if (!mounted) return;
        setSession(sess);
        setUser(sess?.user ?? null);

        if (sess?.user) {
          // Only load data once on init, or on actual sign-in events
          if (!dataLoaded || event === 'SIGNED_IN') {
            dataLoaded = true;
            // Keep loading true while fetching user data to prevent premature routing
            setLoading(true);
            await loadUserData(sess.user.id);
          }
          if (mounted) setLoading(false);
        } else {
          dataLoaded = false;
          setProfile(null);
          setMembership(null);
          setTenant(null);
          setIsSaasAdmin(false);
          // Only clear impersonation on explicit sign-out, not on transient null sessions
          if (event === 'SIGNED_OUT') {
            setImpersonatedTenantId(null);
            sessionStorage.removeItem(IMPERSONATION_KEY);
          }
          if (mounted) setLoading(false);
        }
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setUser(null);
    setProfile(null);
    setMembership(null);
    setTenant(null);
    setIsSaasAdmin(false);
    setImpersonatedTenantId(null);
    sessionStorage.removeItem(IMPERSONATION_KEY);
  };

  const refreshTenant = async () => {
    const tid = impersonatedTenantId || membership?.tenant_id;
    if (!tid) return;
    const { data: t } = await supabase
      .from('tenants')
      .select('*')
      .eq('id', tid)
      .single();
    if (t) setTenant(t as unknown as Tenant);
  };

  const switchTenant = async (tenantId: string | null) => {
    if (!tenantId) {
      // Go back to own tenant
      setImpersonatedTenantId(null);
      sessionStorage.removeItem(IMPERSONATION_KEY);
      if (membership) {
        const { data: t } = await supabase
          .from('tenants')
          .select('*')
          .eq('id', membership.tenant_id)
          .single();
        setTenant(t as unknown as Tenant);
      } else {
        setTenant(null);
      }
      return;
    }

    setImpersonatedTenantId(tenantId);
    sessionStorage.setItem(IMPERSONATION_KEY, tenantId);
    const { data: t } = await supabase
      .from('tenants')
      .select('*')
      .eq('id', tenantId)
      .single();
    if (t) setTenant(t as unknown as Tenant);
  };

  // For SaaS admins impersonating, derive an effective membership/role
  const effectiveMembership = impersonatedTenantId
    ? ({ id: 'saas-admin-impersonation', tenant_id: impersonatedTenantId, user_id: user?.id ?? '', role: 'admin' as TenantRole, is_active: true, created_at: '', updated_at: '' } as TenantMembership)
    : membership;

  const effectiveRole = impersonatedTenantId ? ('admin' as TenantRole) : (membership?.role ?? null);

  return (
    <AuthContext.Provider value={{
      session, user, profile,
      membership: effectiveMembership,
      tenant,
      role: effectiveRole,
      isSaasAdmin, loading,
      impersonatedTenantId,
      signOut, refreshTenant, switchTenant,
    }}>
      {children}
    </AuthContext.Provider>
  );
};
