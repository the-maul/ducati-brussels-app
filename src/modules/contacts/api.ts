/**
 * M1 — Accès données Contacts (RLS : filtré par société côté serveur).
 */
import { supabase } from '@/integrations/supabase/client';
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
    _company: companyId, _q: search ?? '', _type: type ?? null, _limit: 500, _offset: 0,
  });
  if (error) throw error;
  return (data as Contact[]) ?? [];
}

export type ContactPage = { rows: Contact[]; total: number };
/** Liste paginée des contacts (range + count exact) — pour l'écran liste. */
export async function listContactsPaged(
  companyId: string,
  opts: { search?: string; type?: string; page?: number; pageSize?: number } = {},
): Promise<ContactPage> {
  const page = opts.page ?? 0;
  const pageSize = opts.pageSize ?? 50;
  const args = { _company: companyId, _q: opts.search ?? '', _type: opts.type ?? null };
  const [{ data, error }, { data: total, error: ce }] = await Promise.all([
    supabase.rpc('contacts_search', { ...args, _limit: pageSize, _offset: page * pageSize }),
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
