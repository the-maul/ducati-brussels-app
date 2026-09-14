/**
 * M1 — Accès données Contacts (RLS : filtré par société côté serveur).
 */
import { supabase } from '@/integrations/supabase/client';
import { errorMessage } from '@/lib/mutation-feedback';
import type { Database } from '@/integrations/supabase/types';

export type Contact = Database['public']['Tables']['contacts']['Row'];
export type ContactInsert = Database['public']['Tables']['contacts']['Insert'];
export type ContactUpdate = Database['public']['Tables']['contacts']['Update'];
export type ContactType = Database['public']['Enums']['contact_type'];
export type CustomerSegment = Database['public']['Enums']['customer_segment'];
export type LicenseCategory = Database['public']['Enums']['license_category'];
export type ContactStatus = Database['public']['Enums']['contact_status'];
export type SaleVatType = Database['public']['Enums']['sale_vat_type'];

/** Nom d'affichage d'un contact (raison sociale ou nom complet). */
export function contactDisplayName(c: Pick<Contact, 'company_name' | 'first_name' | 'last_name'>): string {
  if (c.company_name) return c.company_name;
  return [c.first_name, c.last_name].filter(Boolean).join(' ') || '—';
}

/**
 * Accès sûr aux modèles d'intérêt Ducati d'un contact.
 * La colonne `model_interests` (text[]) est ajoutée par migration mais pas encore
 * présente dans les types Supabase auto-générés — d'où le cast localisé.
 */
export function getModelInterests(c: Contact): string[] {
  const v = (c as { model_interests?: string[] | null }).model_interests;
  return Array.isArray(v) ? v : [];
}

/** Motif de surveillance (colonne ajoutée par migration, pas encore dans les types Supabase générés). */
export function getWatchNote(c: Contact): string | null {
  const v = (c as { watch_note?: string | null }).watch_note;
  return v || null;
}

/** Recherche contacts (accent-insensible, par mots) — pour pickers / recherche globale. */
export async function listContacts(companyId: string, search?: string, type?: string): Promise<Contact[]> {
  const { data, error } = await supabase.rpc('contacts_search', {
    // `_type` vide plutôt que null : la fonction SQL traite les deux pareil
    // (`_type is null or _type = '' or ...`) et la signature générée attend une chaîne.
    _company: companyId, _q: search ?? '', _type: type ?? '', _limit: 500, _offset: 0,
  });
  if (error) throw error;
  return (data as Contact[]) ?? [];
}

export type ContactPage = { rows: Contact[]; total: number };
/** Liste paginée des contacts (range + count exact) — pour l'écran liste. */
/** Tri de la liste : par nom (défaut) ou par date d'arrivée, les plus récents d'abord. */
export type ContactSort = 'name' | 'recent';

export async function listContactsPaged(
  companyId: string,
  opts: { search?: string; type?: string; page?: number; pageSize?: number; sort?: ContactSort } = {},
): Promise<ContactPage> {
  const page = opts.page ?? 0;
  const pageSize = opts.pageSize ?? 50;
  const args = { _company: companyId, _q: opts.search ?? '', _type: opts.type ?? '' };
  const [{ data, error }, { data: total, error: ce }] = await Promise.all([
    // `_sort` n'existe que sur la recherche : le comptage ne dépend pas de l'ordre.
    supabase.rpc('contacts_search', { ...args, _limit: pageSize, _offset: page * pageSize, _sort: opts.sort ?? 'name' }),
    supabase.rpc('contacts_search_count', args),
  ]);
  if (error) throw error;
  if (ce) throw ce;
  return { rows: (data as Contact[]) ?? [], total: Number(total ?? 0) };
}

/** Contacts par lot d'ids — pour croiser une liste de documents/véhicules avec leur client. */
export async function listContactsByIds(ids: string[]): Promise<Contact[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase.from('contacts').select('*').in('id', ids);
  if (error) throw error;
  return data ?? [];
}

export async function getContact(id: string): Promise<Contact | null> {
  const { data, error } = await supabase.from('contacts').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function createContact(input: ContactInsert): Promise<Contact> {
  const { data, error } = await supabase.from('contacts').insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function updateContact(id: string, input: ContactUpdate): Promise<Contact> {
  const { data, error } = await supabase.from('contacts').update(input).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

/** Archive une fiche (is_active=false) : jamais de suppression physique, pour préserver l'audit. */
export async function archiveContact(id: string): Promise<void> {
  const { error } = await supabase.from('contacts').update({ is_active: false }).eq('id', id);
  if (error) throw error;
}

export async function unarchiveContact(id: string): Promise<void> {
  const { error } = await supabase.from('contacts').update({ is_active: true }).eq('id', id);
  if (error) throw error;
}

/**
 * Tables métier portant contact_id, réassignées lors d'une fusion. Liste tenue à jour
 * manuellement (pas d'introspection de schéma côté client) : client_price_rules,
 * communications, contact_subcontacts, customer_price_rules, delivery_addresses,
 * documents, leads, repair_orders, sepa_mandates, vehicle_owners, workshop_appointments.
 */
const MERGE_TABLES = [
  'client_price_rules', 'communications', 'contact_subcontacts', 'customer_price_rules',
  'delivery_addresses', 'documents', 'leads', 'repair_orders', 'sepa_mandates',
  'vehicle_owners', 'workshop_appointments',
] as const;

export type MergeContactsResult = { reassigned: string[]; failed: { table: string; error: string }[] };

/**
 * Fusionne mergeId dans keepId : réassigne contact_id vers keepId sur chaque table de
 * MERGE_TABLES (défensif, une table par une table — un schéma pas encore migré ou une
 * colonne absente ne doit pas bloquer la fusion des autres), puis archive mergeId
 * (is_active=false) plutôt que de le supprimer, pour préserver l'audit (règle 4).
 */
export async function mergeContacts(keepId: string, mergeId: string): Promise<MergeContactsResult> {
  const reassigned: string[] = [];
  const failed: { table: string; error: string }[] = [];
  for (const table of MERGE_TABLES) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from(table) as any).update({ contact_id: keepId }).eq('contact_id', mergeId);
      if (error) throw error;
      reassigned.push(table);
    } catch (e) {
      failed.push({ table, error: e instanceof Error ? e.message : String(e) });
    }
  }
  await archiveContact(mergeId);
  return { reassigned, failed };
}

// ── Doublons, dependances, suppression ────────────────────────────────

export type DuplicateProbe = {
  name: string;
  city?: string | null;
  phone?: string | null;
  email?: string | null;
  excludeId?: string | null;
};

/**
 * Fiches strictement identiques (nom + ville + telephone + e-mail, normalises
 * cote base : casse/accents ignores, telephone reduit a ses chiffres).
 * Sert d'alerte non bloquante avant creation : on previent, on ne refuse pas.
 */
export async function findDuplicateContacts(companyId: string, probe: DuplicateProbe): Promise<Contact[]> {
  const { data, error } = await supabase.rpc('contacts_find_duplicates', {
    _company: companyId,
    _name: probe.name ?? '',
    _city: probe.city ?? '',
    _phone: probe.phone ?? '',
    _email: probe.email ?? '',
    // undefined : `_exclude` est DEFAULT NULL cote SQL, l'omettre equivaut a NULL.
    _exclude: probe.excludeId ?? undefined,
  });
  if (error) throw error;
  return (data as Contact[]) ?? [];
}

export type ContactDependency = { table_name: string; n: number };

/** Lignes metier rattachees a une fiche. Vide => suppression physique possible. */
export async function contactDependencies(id: string): Promise<ContactDependency[]> {
  const { data, error } = await supabase.rpc('contact_dependencies', { _id: id });
  if (error) throw error;
  return (data as ContactDependency[]) ?? [];
}

/**
 * Suppression physique, reservee aux fiches vierges (doublons, comptes crees par
 * erreur). La base refuse et leve CONTACT_HAS_DEPENDENCIES si la fiche porte le
 * moindre document/vehicule/mouvement : l'appelant bascule alors sur l'archivage.
 */
export async function deleteContact(id: string): Promise<void> {
  const { error } = await supabase.rpc('contact_delete_safe', { _id: id });
  if (error) throw error;
}

/**
 * Vrai si l'erreur remontee est le refus de suppression pour cause de dependances.
 *
 * Passe par errorMessage() : supabase-js ne leve PAS des instances d'Error mais des
 * objets { message, details, hint, code }. Le test `e instanceof Error` employe ici
 * auparavant etait donc toujours faux, et l'UI ne basculait jamais sur l'archivage.
 */
export function isDependencyError(e: unknown): boolean {
  return errorMessage(e).includes('CONTACT_HAS_DEPENDENCIES');
}
