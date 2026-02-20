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
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  session: null, user: null, profile: null, membership: null,
  tenant: null, role: null, loading: true, signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [membership, setMembership] = useState<TenantMembership | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);

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

        // Load tenant
        const { data: t } = await supabase
          .from('tenants')
          .select('*')
          .eq('id', m.tenant_id)
          .single();
        setTenant(t as unknown as Tenant);
      }
    } catch (e) {
      console.error('Error loading user data:', e);
    }
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, sess) => {
        setSession(sess);
        setUser(sess?.user ?? null);
        if (sess?.user) {
          await loadUserData(sess.user.id);
        } else {
          setProfile(null);
          setMembership(null);
          setTenant(null);
        }
        setLoading(false);
      }
    );

    supabase.auth.getSession().then(async ({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) await loadUserData(s.user.id);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setUser(null);
    setProfile(null);
    setMembership(null);
    setTenant(null);
  };

  return (
    <AuthContext.Provider value={{
      session, user, profile, membership, tenant,
      role: membership?.role ?? null, loading, signOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
};
