/**
 * M4 — Achats & réceptions : accès Supabase (fournisseurs, commandes, réceptions).
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

export type PurchaseOrder = Database['public']['Tables']['purchase_orders']['Row'];
export type PurchaseLine = Database['public']['Tables']['purchase_lines']['Row'];
export type PurchaseSchedule = Database['public']['Tables']['purchase_schedules']['Row'];
export type Supplier = Database['public']['Tables']['contacts']['Row'];

/** Fournisseurs de la société (contacts type fournisseur). */
export async function listSuppliers(companyId: string, term = ''): Promise<Supplier[]> {
  let q = supabase.from('contacts').select('*').eq('company_id', companyId).eq('type', 'fournisseur').order('company_name');
  const s = term.replace(/[,()%*]/g, ' ').trim();
  if (s) q = q.or(`company_name.ilike.%${s}%,last_name.ilike.%${s}%`);
  const { data, error } = await q.limit(50);
  if (error) throw error;
  return data ?? [];
}

export function supplierName(s: Pick<Supplier, 'company_name' | 'first_name' | 'last_name'>): string {
  return s.company_name?.trim() || [s.first_name, s.last_name].filter(Boolean).join(' ').trim() || '—';
}

export async function listPurchaseOrders(companyId: string, docType?: string): Promise<PurchaseOrder[]> {
  let q = supabase.from('purchase_orders').select('*').eq('company_id', companyId)
    .order('created_at', { ascending: false }).limit(100);
  if (docType) q = q.eq('doc_type', docType);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export type PurchaseFull = { order: PurchaseOrder; lines: PurchaseLine[]; schedules: PurchaseSchedule[] };
export async function getPurchaseFull(id: string): Promise<PurchaseFull> {
  const [{ data: order, error: oe }, { data: lines, error: le }, { data: schedules, error: se }] = await Promise.all([
    supabase.from('purchase_orders').select('*').eq('id', id).single(),
    supabase.from('purchase_lines').select('*').eq('order_id', id).order('sort_order'),
    supabase.from('purchase_schedules').select('*').eq('order_id', id).order('seq_no'),
  ]);
  if (oe) throw oe; if (le) throw le; if (se) throw se;
  return { order: order as PurchaseOrder, lines: lines ?? [], schedules: schedules ?? [] };
}

/** Articles cherchables pour la saisie de réception (réf fournisseur, PAMP, casier). */
export type PurchaseArticle = { id: string; reference: string; designation: string; supplier_ref: string | null; purchase_price: number; vat_rate: number; sale_price_ttc: number; bin_location: string | null };
export async function searchPurchaseArticles(companyId: string, term: string): Promise<PurchaseArticle[]> {
  const s = term.replace(/[,()%*]/g, ' ').trim();
  let q = supabase.from('articles')
    .select('id, reference, designation, supplier_ref, purchase_price, vat_rate, sale_price_ttc, bin_location')
    .eq('company_id', companyId).limit(8);
  if (s) q = q.or(`reference.ilike.%${s}%,designation.ilike.%${s}%,supplier_ref.ilike.%${s}%`);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((a) => ({
    id: a.id, reference: a.reference, designation: a.designation, supplier_ref: a.supplier_ref,
    purchase_price: Number(a.purchase_price ?? 0), vat_rate: Number(a.vat_rate ?? 21),
    sale_price_ttc: Number(a.sale_price_ttc ?? 0), bin_location: a.bin_location,
  }));
}
