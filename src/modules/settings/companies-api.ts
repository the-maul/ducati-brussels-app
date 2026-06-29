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
  'round_sale_prices_up'>>;

export async function updateCompany(id: string, patch: CompanyPatch): Promise<void> {
  const { error } = await supabase.from('companies').update(patch).eq('id', id);
  if (error) throw error;
}

export async function createCompany(p: { code: string; name: string; legal_name?: string; vat?: string; address?: string; zip?: string; city?: string }): Promise<string> {
  const { data, error } = await supabase.rpc('create_company', {
    _code: p.code, _name: p.name, _legal_name: p.legal_name ?? null, _vat: p.vat ?? null,
    _address: p.address ?? null, _zip: p.zip ?? null, _city: p.city ?? null,
  });
  if (error) throw error;
  return data as string;
}
