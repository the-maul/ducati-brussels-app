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

// Neutralise les caractères qui casseraient un filtre PostgREST .or()
function sanitize(term: string): string {
  return term.replace(/[,()%*]/g, ' ').trim();
}

export async function listContacts(companyId: string, search?: string, type?: string): Promise<Contact[]> {
  let q = supabase
    .from('contacts')
    .select('*')
    .eq('company_id', companyId)
    .order('last_name', { ascending: true, nullsFirst: false })
    .limit(500);

  if (type) q = q.eq('type', type);

  const s = search ? sanitize(search) : '';
  if (s) {
    q = q.or(
      [
        `last_name.ilike.%${s}%`,
        `first_name.ilike.%${s}%`,
        `company_name.ilike.%${s}%`,
        `email.ilike.%${s}%`,
        `vat_number.ilike.%${s}%`,
        `city.ilike.%${s}%`,
      ].join(','),
    );
  }
  const { data, error } = await q;
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
