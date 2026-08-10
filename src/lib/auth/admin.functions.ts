/**
 * Server functions d'administration des utilisateurs (M0).
 * Réservées aux admins : création de comptes, attribution de rôles par société.
 * Exécutées côté serveur avec la clé service role (injectée par Netlify au runtime).
 * Le token de l'appelant est validé par requireSupabaseAuth ; on vérifie ensuite
 * qu'il est admin de la/les société(s) ciblée(s) avant toute écriture.
 */
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';

const APP_ROLES = [
  'admin', 'vendeur', 'magasinier', 'mecanicien',
  'chef_atelier', 'comptable', 'marketing',
] as const;
const roleEnum = z.enum(APP_ROLES);

/** Vérifie que `userId` est admin de chacune des sociétés `companyIds`. */
async function assertAdminOf(userId: string, companyIds: string[]) {
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  const { data, error } = await supabaseAdmin
    .from('user_roles')
    .select('company_id')
    .eq('user_id', userId)
    .eq('role', 'admin');
  if (error) throw new Error(error.message);
  const adminCompanies = new Set((data ?? []).map((r) => r.company_id));
  for (const c of companyIds) {
    if (!adminCompanies.has(c)) throw new Error("Accès refusé : rôle admin requis sur la société.");
  }
}

/** Liste les utilisateurs avec leurs rôles (admin uniquement). */
export const listOrgUsers = createServerFn({ method: 'GET' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');

    // L'appelant doit être admin d'au moins une société.
    const { data: myAdmin } = await supabaseAdmin
      .from('user_roles')
      .select('company_id')
      .eq('user_id', context.userId)
      .eq('role', 'admin');
    const adminCompanies = (myAdmin ?? []).map((r) => r.company_id);
    if (adminCompanies.length === 0) throw new Error('Accès refusé.');

    const [{ data: profiles }, { data: roles }, { data: companies }] = await Promise.all([
      supabaseAdmin.from('profiles').select('id, full_name, email, is_active').order('full_name'),
      supabaseAdmin.from('user_roles').select('user_id, company_id, role'),
      supabaseAdmin.from('companies').select('id, code, name').order('name'),
    ]);

    return {
      adminCompanies,
      companies: companies ?? [],
      users: (profiles ?? []).map((p) => ({
        ...p,
        roles: (roles ?? []).filter((r) => r.user_id === p.id),
      })),
    };
  });

/** Crée un compte utilisateur + attribue ses rôles (admin uniquement). */
export const createOrgUser = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      email: z.string().email(),
      password: z.string().min(8),
      full_name: z.string().min(1),
      roles: z.array(z.object({ company_id: z.string().uuid(), role: roleEnum })).min(1),
    }),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const targetCompanies = [...new Set(data.roles.map((r) => r.company_id))];
    await assertAdminOf(context.userId, targetCompanies);

    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.full_name },
    });
    if (createErr || !created?.user) throw new Error(createErr?.message ?? 'Création impossible.');

    const newUserId = created.user.id;
    // Le trigger handle_new_user a créé le profil ; on garantit le nom + actif.
    await supabaseAdmin.from('profiles').upsert({
      id: newUserId,
      email: data.email,
      full_name: data.full_name,
      is_active: true,
    });

    const { error: rolesErr } = await supabaseAdmin.from('user_roles').insert(
      data.roles.map((r) => ({ user_id: newUserId, company_id: r.company_id, role: r.role })),
    );
    if (rolesErr) throw new Error(rolesErr.message);

    return { id: newUserId };
  });

/** Remplace les rôles d'un utilisateur pour une société (admin uniquement). */
export const setUserRoles = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      user_id: z.string().uuid(),
      company_id: z.string().uuid(),
      roles: z.array(roleEnum),
    }),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    await assertAdminOf(context.userId, [data.company_id]);

    await supabaseAdmin
      .from('user_roles')
      .delete()
      .eq('user_id', data.user_id)
      .eq('company_id', data.company_id);

    if (data.roles.length > 0) {
      const { error } = await supabaseAdmin.from('user_roles').insert(
        data.roles.map((role) => ({ user_id: data.user_id, company_id: data.company_id, role })),
      );
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

/** Active/désactive un compte (admin uniquement). */
export const setUserActive = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ user_id: z.string().uuid(), is_active: z.boolean() }))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    // Admin d'au moins une société partagée avec la cible.
    const { data: targetRoles } = await supabaseAdmin
      .from('user_roles')
      .select('company_id')
      .eq('user_id', data.user_id);
    const companyIds = [...new Set((targetRoles ?? []).map((r) => r.company_id))];
    if (companyIds.length > 0) {
      // il suffit d'être admin d'une de ces sociétés
      const { data: myAdmin } = await supabaseAdmin
        .from('user_roles')
        .select('company_id')
        .eq('user_id', context.userId)
        .eq('role', 'admin')
        .in('company_id', companyIds);
      if (!myAdmin || myAdmin.length === 0) throw new Error('Accès refusé.');
    }
    const { error } = await supabaseAdmin
      .from('profiles')
      .update({ is_active: data.is_active })
      .eq('id', data.user_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
