/**
 * M6 — Financement d'un document et règlements d'un client (mission 05, carte 9) : accès base.
 * Organismes : table de référence existante (reference_values, table_key 'financing_org',
 * Paramètres → Tables). Écriture du financement : fonction SQL document_set_financing (contrôles
 * serveur, trace events par l'audit des documents).
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import type { FinancingStatus } from './balance';

export type FinancingOrg = { id: string; code: string; label: string; isActive: boolean };

export async function listFinancingOrgs(companyId: string): Promise<FinancingOrg[]> {
  const { data, error } = await supabase
    .from('reference_values').select('id, code, label, is_active, sort_order')
    .eq('company_id', companyId).eq('table_key', 'financing_org')
    .order('sort_order').order('label');
  if (error) throw error;
  return (data ?? []).map((r) => ({ id: r.id, code: r.code, label: r.label, isActive: r.is_active }));
}

export async function setDocumentFinancing(
  documentId: string, f: { orgId: string | null; amount: number; status: FinancingStatus | null },
): Promise<void> {
  // Arguments SQL facultatifs : null = retrait du financement (types générés : string).
  const { error } = await supabase.rpc('document_set_financing', {
    _document: documentId, _org: f.orgId as string, _amount: f.amount, _status: f.status as string,
  });
  if (error) throw error;
}

export type PaymentRow = Database['public']['Tables']['document_payments']['Row'];

/** Règlements d'un lot de documents (onglet Documents de la fiche client), en un aller-retour. */
export async function listPaymentsFor(documentIds: string[]): Promise<Map<string, PaymentRow[]>> {
  const map = new Map<string, PaymentRow[]>();
  if (documentIds.length === 0) return map;
  for (let i = 0; i < documentIds.length; i += 200) {
    const { data, error } = await supabase
      .from('document_payments').select('*').in('document_id', documentIds.slice(i, i + 200)).order('paid_at');
    if (error) throw error;
    for (const p of data ?? []) {
      const list = map.get(p.document_id) ?? [];
      list.push(p);
      map.set(p.document_id, list);
    }
  }
  return map;
}
