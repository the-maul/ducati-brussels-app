/**
 * AuthProvider — session Supabase + contexte métier (M0).
 * Expose : session/user, profil, rôles par société, sociétés accessibles,
 * société active (multi-société COM005), helpers de rôle, signOut.
 * Les requêtes sont filtrées par RLS : un utilisateur ne voit que ses sociétés/rôles.
 */
import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

export type AppRole =
  | 'admin' | 'vendeur' | 'magasinier' | 'mecanicien'
  | 'chef_atelier' | 'comptable' | 'marketing';

export interface Company {
  id: string;
  code: string;
  name: string;
}
export interface RoleAssignment {
  company_id: string;
  role: AppRole;
}
export interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
  default_company_id: string | null;
}

interface AuthState {
  loading: boolean;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  companies: Company[];
  roles: RoleAssignment[];
  activeCompanyId: string | null;
  activeCompany: Company | null;
  setActiveCompany: (id: string) => void;
  hasRole: (role: AppRole, companyId?: string) => boolean;
  isAdmin: (companyId?: string) => boolean;
  rolesForActiveCompany: AppRole[];
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthState | undefined>(undefined);
const ACTIVE_KEY = 'ducati.activeCompany';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [roles, setRoles] = useState<RoleAssignment[]>([]);
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(null);

  const loadProfileData = useCallback(async (userId: string) => {
    const [profRes, roleRes, compRes] = await Promise.all([
      supabase.from('profiles').select('id, full_name, email, default_company_id').eq('id', userId).maybeSingle(),
      supabase.from('user_roles').select('company_id, role'),
      supabase.from('companies').select('id, code, name').order('name'),
    ]);
    const prof = (profRes.data ?? null) as Profile | null;
    const comps = (compRes.data ?? []) as Company[];
    setProfile(prof);
    setRoles((roleRes.data ?? []) as RoleAssignment[]);
    setCompanies(comps);

    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(ACTIVE_KEY) : null;
    const storedValid = comps.find((c) => c.id === stored)?.id ?? null;
    setActiveCompanyId(storedValid ?? prof?.default_company_id ?? comps[0]?.id ?? null);
  }, []);

  useEffect(() => {
    let mounted = true;

    supabase.auth
      .getSession()
      .then(async ({ data }) => {
        if (!mounted) return;
        setSession(data.session);
        if (data.session?.user) {
          try {
            await loadProfileData(data.session.user.id);
          } catch (e) {
            console.error('[auth] chargement profil', e);
          }
        }
      })
      .catch((e) => console.error('[auth] getSession', e))
      .finally(() => {
        // loading se résout TOUJOURS, même en cas d'erreur (sinon spinner infini).
        if (mounted) setLoading(false);
      });

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, sess) => {
      setSession(sess);
      if (sess?.user) {
        try {
          await loadProfileData(sess.user.id);
        } catch (e) {
          console.error('[auth] chargement profil', e);
        }
      } else {
        setProfile(null);
        setRoles([]);
        setCompanies([]);
        setActiveCompanyId(null);
      }
      if (mounted) setLoading(false);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfileData]);

  const setActiveCompany = useCallback((id: string) => {
    setActiveCompanyId(id);
    if (typeof localStorage !== 'undefined') localStorage.setItem(ACTIVE_KEY, id);
  }, []);

  const hasRole = useCallback(
    (role: AppRole, companyId?: string) => {
      const cid = companyId ?? activeCompanyId;
      return roles.some((r) => r.role === role && (!cid || r.company_id === cid));
    },
    [roles, activeCompanyId],
  );

  const isAdmin = useCallback((companyId?: string) => hasRole('admin', companyId), [hasRole]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const refresh = useCallback(async () => {
    if (session?.user) await loadProfileData(session.user.id);
  }, [session, loadProfileData]);

  const activeCompany = companies.find((c) => c.id === activeCompanyId) ?? null;
  const rolesForActiveCompany = roles
    .filter((r) => !activeCompanyId || r.company_id === activeCompanyId)
    .map((r) => r.role);

  return (
    <Ctx.Provider
      value={{
        loading,
        session,
        user: session?.user ?? null,
        profile,
        companies,
        roles,
        activeCompanyId,
        activeCompany,
        setActiveCompany,
        hasRole,
        isAdmin,
        rolesForActiveCompany,
        signOut,
        refresh,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth doit être utilisé dans <AuthProvider>');
  return v;
}
