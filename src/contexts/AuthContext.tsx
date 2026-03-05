import React, { createContext, useContext, useEffect, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import type { TenantMembership, Tenant, Profile, TenantRole } from '@/types/crm';

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  membership: TenantMembership | null;
  allMemberships: TenantMembership[];
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
  allMemberships: [],
  tenant: null, role: null, isSaasAdmin: false, loading: true,
  impersonatedTenantId: null,
  signOut: async () => {}, refreshTenant: async () => {}, switchTenant: async () => {},
});

export const useAuth = () => useContext(AuthContext);

const IMPERSONATION_KEY = 'impersonatedTenantId';
const ACTIVE_TENANT_KEY = 'activeTenantId';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [membership, setMembership] = useState<TenantMembership | null>(null);
  const [allMemberships, setAllMemberships] = useState<TenantMembership[]>([]);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [isSaasAdmin, setIsSaasAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [impersonatedTenantId, setImpersonatedTenantId] = useState<string | null>(
    () => sessionStorage.getItem(IMPERSONATION_KEY)
  );

  const loadUserData = async (userId: string) => {
    try {
      console.log('[Auth] loadUserData start for', userId);
      
      // Load profile
      const { data: prof, error: profErr } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', userId)
        .single();
      console.log('[Auth] profile:', prof?.id, 'error:', profErr?.message);
      setProfile(prof as unknown as Profile);

      // Load ALL active memberships
      const { data: memRows, error: memErr } = await supabase
        .from('tenant_memberships')
        .select('*')
        .eq('user_id', userId)
        .eq('is_active', true);
      console.log('[Auth] memberships:', memRows?.length, 'error:', memErr?.message);
      const memberships = (memRows ?? []) as unknown as TenantMembership[];
      setAllMemberships(memberships);

      // Pick active membership: check stored preference first
      const storedActiveTenant = sessionStorage.getItem(ACTIVE_TENANT_KEY);
      console.log('[Auth] storedActiveTenant:', storedActiveTenant);
      let activeMem = storedActiveTenant
        ? memberships.find(m => m.tenant_id === storedActiveTenant)
        : null;
      if (!activeMem && memberships.length > 0) {
        activeMem = memberships[0];
      }
      console.log('[Auth] activeMem:', activeMem?.id, 'tenant:', activeMem?.tenant_id, 'role:', activeMem?.role);
      setMembership(activeMem ?? null);

      // Check SaaS admin
      const { data: saasRow } = await supabase
        .from('saas_admins')
        .select('id')
        .eq('user_id', userId)
        .maybeSingle();
      const isAdmin = !!saasRow;
      console.log('[Auth] isSaasAdmin:', isAdmin);
      setIsSaasAdmin(isAdmin);

      // Restore impersonated tenant from sessionStorage (SaaS admin only)
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
          sessionStorage.removeItem(IMPERSONATION_KEY);
          setImpersonatedTenantId(null);
          if (activeMem) {
            const { data: ownT } = await supabase
              .from('tenants').select('*').eq('id', activeMem.tenant_id).single();
            setTenant(ownT as unknown as Tenant);
          }
        }
      } else if (activeMem) {
        const { data: t } = await supabase
          .from('tenants').select('*').eq('id', activeMem.tenant_id).single();
        console.log('[Auth] tenant loaded:', t?.id, t?.name);
        setTenant(t as unknown as Tenant);
      }
      console.log('[Auth] loadUserData complete');
    } catch (e) {
      console.error('[Auth] Error loading user data:', e);
    }
  };

  useEffect(() => {
    let mounted = true;
    let dataLoaded = false;
    let isLoadingData = false;

    const handleSession = async (event: string, sess: Session | null) => {
      if (!mounted) return;
      setSession(sess);
      setUser(sess?.user ?? null);

      if (sess?.user) {
        if ((!dataLoaded || event === 'SIGNED_IN') && !isLoadingData) {
          dataLoaded = true;
          isLoadingData = true;
          setLoading(true);
          try {
            await loadUserData(sess.user.id);
          } catch (e) {
            console.error('Failed to load user data:', e);
          } finally {
            isLoadingData = false;
            if (mounted) setLoading(false);
          }
        }
        // Don't set loading=false here if data is still loading
      } else {
        dataLoaded = false;
        isLoadingData = false;
        setProfile(null);
        setMembership(null);
        setAllMemberships([]);
        setTenant(null);
        setIsSaasAdmin(false);
        if (event === 'SIGNED_OUT') {
          setImpersonatedTenantId(null);
          sessionStorage.removeItem(IMPERSONATION_KEY);
          sessionStorage.removeItem(ACTIVE_TENANT_KEY);
        }
        if (mounted) setLoading(false);
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, sess) => { handleSession(event, sess); }
    );

    supabase.auth.getSession().then(({ data: { session: initialSession } }) => {
      if (!mounted) return;
      if (!dataLoaded) {
        handleSession('INITIAL_SESSION', initialSession);
      }
    });

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
    setAllMemberships([]);
    setTenant(null);
    setIsSaasAdmin(false);
    setImpersonatedTenantId(null);
    sessionStorage.removeItem(IMPERSONATION_KEY);
    sessionStorage.removeItem(ACTIVE_TENANT_KEY);
  };

  const refreshTenant = async () => {
    const tid = impersonatedTenantId || membership?.tenant_id;
    if (!tid) return;
    const { data: t } = await supabase.from('tenants').select('*').eq('id', tid).single();
    if (t) setTenant(t as unknown as Tenant);
  };

  const switchTenant = async (tenantId: string | null) => {
    if (!tenantId) {
      // SaaS admin: go back to own tenant
      setImpersonatedTenantId(null);
      sessionStorage.removeItem(IMPERSONATION_KEY);
      if (membership) {
        const { data: t } = await supabase.from('tenants').select('*').eq('id', membership.tenant_id).single();
        setTenant(t as unknown as Tenant);
      } else {
        setTenant(null);
      }
      return;
    }

    // Check if this is one of the user's own memberships
    const ownMem = allMemberships.find(m => m.tenant_id === tenantId);
    if (ownMem) {
      // Regular tenant switch (user's own membership)
      setMembership(ownMem);
      sessionStorage.setItem(ACTIVE_TENANT_KEY, tenantId);
      setImpersonatedTenantId(null);
      sessionStorage.removeItem(IMPERSONATION_KEY);
      const { data: t } = await supabase.from('tenants').select('*').eq('id', tenantId).single();
      if (t) setTenant(t as unknown as Tenant);
    } else {
      // SaaS admin impersonation
      setImpersonatedTenantId(tenantId);
      sessionStorage.setItem(IMPERSONATION_KEY, tenantId);
      const { data: t } = await supabase.from('tenants').select('*').eq('id', tenantId).single();
      if (t) setTenant(t as unknown as Tenant);
    }
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
      allMemberships,
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
