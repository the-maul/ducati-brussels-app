/**
 * M0 — Gestion des sociétés (Paramètres → Sociétés). CRUD + champs légaux/compta
 * (TVA, adresse, IBAN, Peppol, comptes par défaut) utilisés par M12 (UBL/Winbooks).
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

export type Company = Database['public']['Tables']['companies']['Row'];

export async function listCompanies(): Promise<Company[]> {
  const { data, error } = await supabase.from('companies').select('*').order('name');
  if (error) throw error;
  return data ?? [];
}

export type CompanyPatch = Partial<Pick<Company,
  'name' | 'legal_name' | 'vat_number' | 'address' | 'zip' | 'city' | 'country' | 'iban' | 'peppol_id' |
  'sales_account_default' | 'customer_account_default' | 'vat_account_default' | 'is_active' | 'inbound_mailbox' |
  'round_sale_prices_up'>>
  // Plancher de prix (migration 20260714 — colonnes hors types générés)
  & { price_floor_threshold?: number; price_floor_min?: number }
  // Facture legale (migration 20261103180000 — colonnes hors types generes) : n° BCE, RPM, copie comptable
  & { company_number?: string | null; rpm?: string | null; accountant_email?: string | null };

/** Colonnes de la fiche societe posees par la migration 20261103180000 (absentes tant qu elle n est pas appliquee). */
export const LEGAL_COMPANY_FIELDS = ['company_number', 'rpm', 'accountant_email'] as const;

/** N° BCE saisi → 10 chiffres (« BE 0472.540.151 » → « 0472540151 »), vide si illisible. */
export function normalizeCompanyNumber(v: string | null | undefined): string {
  const d = String(v ?? '').replace(/\D/g, '');
  return d.length === 9 ? `0${d}` : d.length === 10 ? d : '';
}

/** Identifiant Peppol propose d apres le n° BCE (regle belge : 0208). */
export function suggestedPeppolId(companyNumber: string | null | undefined): string {
  const n = normalizeCompanyNumber(companyNumber);
  return n ? `0208:${n}` : '';
}

export async function updateCompany(id: string, patch: CompanyPatch): Promise<void> {
  // `as never` : company_number, rpm, accountant_email (migration 20261103180000) sont hors types generes.
  const { error } = await supabase.from('companies').update(patch as never).eq('id', id);
  if (error) throw error;
}

export async function createCompany(p: { code: string; name: string; legal_name?: string; vat?: string; address?: string; zip?: string; city?: string }): Promise<string> {
  const { data, error } = await supabase.rpc('create_company', {
    // undefined et non null : ces parametres sont DEFAULT NULL cote SQL, les omettre
    // revient exactement a passer NULL, et c'est ce que le type genere attend.
    _code: p.code, _name: p.name, _legal_name: p.legal_name ?? undefined, _vat: p.vat ?? undefined,
    _address: p.address ?? undefined, _zip: p.zip ?? undefined, _city: p.city ?? undefined,
  });
  if (error) throw error;
  return data as string;
}
