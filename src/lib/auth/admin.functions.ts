/**
 * Server functions d'administration des utilisateurs (M0).
 * Réservées aux admins : création de comptes, attribution de rôles par société.
 * Exécutées côté serveur avec la clé service role (injectée par Netlify au runtime).
 * Le token de l'appelant est validé par requireSupabaseAuth ; on vérifie ensuite
 * qu'il est admin de la/les société(s) ciblée(s) avant toute écriture.
 *
 * DEUX SORTES DE COMPTES (retour client du 18/09) :
 *   - ÉQUIPE : commercial (vendeur), technicien (mécanicien, chef d'atelier),
 *     manager (admin)… Les rôles existants sont repris tels quels, rien n'est créé.
 *   - CLIENT : un compte rattaché à SA fiche client (table contact_accounts), pour
 *     son futur espace client. Un client n'a AUCUN rôle : l'accès aux données de la
 *     concession passe par les rôles, il ne voit donc rien d'autre que ce qui le concerne.
 *     Si la fiche n'existe pas, on la crée en même temps.
 *
 * MOT DE PASSE : soit l'administrateur le fixe (ex. mot de passe commun provisoire),
 * soit il le laisse vide et la personne reçoit une invitation par e-mail pour choisir
 * le sien (fonction Edge send-account-invitation, appelée ensuite par l'écran).
 * Un mot de passe fixé par l'administrateur respecte les mêmes règles que partout
 * ailleurs (src/lib/password-policy.ts, décision U-4), revérifiées ici côté serveur.
 */
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { isStrongPassword } from '@/lib/password-policy';

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

/** Liste les utilisateurs avec leurs rôles et, pour un client, sa fiche (admin uniquement). */
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

    const [{ data: profiles }, { data: roles }, { data: companies }, { data: accounts }] = await Promise.all([
      supabaseAdmin.from('profiles').select('id, full_name, email, is_active').order('full_name'),
      supabaseAdmin.from('user_roles').select('user_id, company_id, role'),
      supabaseAdmin.from('companies').select('id, code, name').order('name'),
      supabaseAdmin.from('contact_accounts').select('user_id, contact_id, company_id, contacts(first_name, last_name)'),
    ]);

    return {
      adminCompanies,
      companies: companies ?? [],
      users: (profiles ?? []).map((p) => {
        const acc = (accounts ?? []).find((a) => a.user_id === p.id);
        const c = acc?.contacts as { first_name: string | null; last_name: string | null } | null | undefined;
        return {
          ...p,
          roles: (roles ?? []).filter((r) => r.user_id === p.id),
          client: acc
            ? { contact_id: acc.contact_id, company_id: acc.company_id, name: [c?.first_name, c?.last_name].filter(Boolean).join(' ') || null }
            : null,
        };
      }),
    };
  });

const newContactSchema = z.object({
  first_name: z.string().trim().min(1),
  last_name: z.string().trim().min(1),
  email: z.string().trim().email(),
  phone: z.string().trim().optional(),
});

/**
 * Crée un compte (admin uniquement).
 *   kind = 'staff'  : e-mail, nom et au moins un rôle.
 *   kind = 'client' : société + fiche existante (contact_id) OU nouvelle fiche (new_contact).
 * Sans mot de passe, un mot de passe aléatoire est posé et l'écran envoie ensuite
 * l'invitation : la personne choisira le sien.
 */
export const createOrgUser = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      kind: z.enum(['staff', 'client']).default('staff'),
      email: z.string().trim().email().optional(),
      password: z.string()
        .refine(isStrongPassword, 'Mot de passe trop faible : au moins 8 caractères, avec une majuscule, une minuscule, un chiffre et un caractère spécial.')
        .optional(),
      full_name: z.string().trim().min(1).optional(),
      roles: z.array(z.object({ company_id: z.string().uuid(), role: roleEnum })).default([]),
      company_id: z.string().uuid().optional(),
      contact_id: z.string().uuid().optional(),
      new_contact: newContactSchema.optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');

    let email: string;
    let fullName: string;
    let clientCompany: string | null = null;
    let contactId: string | null = null;
    let createdContact = false;

    if (data.kind === 'staff') {
      if (!data.email || !data.full_name) throw new Error('Nom et e-mail obligatoires.');
      if (data.roles.length === 0) throw new Error('Choisissez au moins un rôle.');
      await assertAdminOf(context.userId, [...new Set(data.roles.map((r) => r.company_id))]);
      email = data.email.toLowerCase();
      fullName = data.full_name;
    } else {
      if (!data.company_id) throw new Error('Choisissez la société.');
      await assertAdminOf(context.userId, [data.company_id]);
      clientCompany = data.company_id;

      if (data.contact_id) {
        // Fiche existante : on lit son e-mail, c'est l'identifiant de connexion.
        const { data: c, error } = await supabaseAdmin
          .from('contacts').select('id, company_id, first_name, last_name, email')
          .eq('id', data.contact_id).maybeSingle();
        if (error) throw new Error(error.message);
        if (!c || c.company_id !== clientCompany) throw new Error('Fiche client introuvable dans cette société.');
        const mail = (c.email ?? data.email ?? '').toLowerCase();
        if (!mail) throw new Error("Cette fiche n'a pas d'e-mail : ajoutez-en un sur la fiche ou dans le formulaire.");
        if (!c.email) await supabaseAdmin.from('contacts').update({ email: mail }).eq('id', c.id);
        email = mail;
        fullName = [c.first_name, c.last_name].filter(Boolean).join(' ') || mail;
        contactId = c.id;
      } else if (data.new_contact) {
        // Nouvelle fiche. L'e-mail décide si le client existe déjà (décision client D3) :
        // on refuse de créer un doublon, l'administrateur choisit alors la fiche existante.
        const nc = data.new_contact;
        const mail = nc.email.toLowerCase();
        const { data: dup } = await supabaseAdmin
          .from('contacts').select('id').eq('company_id', clientCompany).ilike('email', mail).limit(1);
        if (dup && dup.length) throw new Error('Une fiche existe déjà avec cet e-mail : choisissez-la plutôt que d’en créer une nouvelle.');
        const { data: ins, error } = await supabaseAdmin.from('contacts').insert({
          company_id: clientCompany, first_name: nc.first_name, last_name: nc.last_name,
          email: mail, phone: nc.phone || null, origin: 'manuel',
        }).select('id').single();
        if (error) throw new Error(error.message);
        email = mail;
        fullName = `${nc.first_name} ${nc.last_name}`;
        contactId = ins.id;
        createdContact = true;
      } else {
        throw new Error('Choisissez une fiche client ou créez-en une.');
      }

      const { data: linked } = await supabaseAdmin.from('contact_accounts').select('user_id').eq('contact_id', contactId).limit(1);
      if (linked && linked.length) throw new Error('Ce client a déjà un compte.');
    }

    // Sans mot de passe fourni : un mot de passe aléatoire, jamais communiqué.
    // La personne choisira le sien grâce à l'invitation.
    const invite = !data.password;
    const password = data.password ?? `${crypto.randomUUID()}${crypto.randomUUID()}`;

    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName, account_kind: data.kind },
    });
    if (createErr || !created?.user) {
      if (createdContact && contactId) await supabaseAdmin.from('contacts').delete().eq('id', contactId);
      const msg = createErr?.message ?? 'Création impossible.';
      throw new Error(/already/i.test(msg) ? 'Un compte existe déjà avec cet e-mail.' : msg);
    }
    const newUserId = created.user.id;

    try {
      // Le trigger handle_new_user a créé le profil ; on garantit le nom + actif.
      await supabaseAdmin.from('profiles').upsert({ id: newUserId, email, full_name: fullName, is_active: true });

      if (data.kind === 'staff') {
        const { error } = await supabaseAdmin.from('user_roles').insert(
          data.roles.map((r) => ({ user_id: newUserId, company_id: r.company_id, role: r.role })),
        );
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabaseAdmin.from('contact_accounts').insert({
          user_id: newUserId, contact_id: contactId!, company_id: clientCompany!, created_by: context.userId,
        });
        if (error) throw new Error(error.message);
      }
    } catch (e) {
      // Pas de compte à moitié créé : on défait tout.
      await supabaseAdmin.auth.admin.deleteUser(newUserId);
      if (createdContact && contactId) await supabaseAdmin.from('contacts').delete().eq('id', contactId);
      throw e;
    }

    return { id: newUserId, email, invite, companyId: clientCompany ?? data.roles[0]?.company_id ?? null };
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
    // Un compte CLIENT n'a pas de rôle : sa société vient de sa fiche (contact_accounts).
    // Avant, un compte sans rôle échappait à toute vérification.
    const { data: targetAccount } = await supabaseAdmin
      .from('contact_accounts')
      .select('company_id')
      .eq('user_id', data.user_id);
    const companyIds = [...new Set([
      ...(targetRoles ?? []).map((r) => r.company_id),
      ...(targetAccount ?? []).map((a) => a.company_id),
    ])];
    // Il suffit d'être admin d'une de ces sociétés ; sans société connue, d'une société quelconque.
    let q = supabaseAdmin.from('user_roles').select('company_id').eq('user_id', context.userId).eq('role', 'admin');
    if (companyIds.length > 0) q = q.in('company_id', companyIds);
    const { data: myAdmin } = await q;
    if (!myAdmin || myAdmin.length === 0) throw new Error('Accès refusé.');
    const { error } = await supabaseAdmin
      .from('profiles')
      .update({ is_active: data.is_active })
      .eq('id', data.user_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
