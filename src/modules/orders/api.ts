/**
 * Commandes de pièces (module orders) — process Miro 2026-07-30.
 * Réservation de pièces validée selon 4 types : urgente | standard | excel | accident.
 * Accès Supabase typé localement (la régénération de types.ts suivra la migration
 * 20260730160000_orders_parts.sql ; on ne bloque pas le build dessus).
 */
import { supabase } from '@/integrations/supabase/client';

// Client non typé pour les tables introduites par la migration orders (pas encore dans types.ts).
const sb = supabase as unknown as {
  from: (t: string) => any;
};

export type OrderKind = 'urgente' | 'standard' | 'excel' | 'accident';
export type OrderDispatchStatus =
  | 'brouillon' | 'en_attente_paiement' | 'payee' | 'a_envoyer' | 'envoyee' | 'annulee';

export type PartOrder = {
  id: string;
  company_id: string;
  number: string | null;
  order_kind: OrderKind;
  dispatch_status: OrderDispatchStatus;
  contact_id: string | null;
  vehicle_id: string | null;
  source_document_id: string | null;
  channel: 'comptoir' | 'mail';
  total_ht: number;
  total_ttc: number;
  surcharge_pct: number;
  paid: boolean;
  paid_at: string | null;
  payment_method: string | null;
  is_accident: boolean;
  claim_ref: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type PartOrderLine = {
  id: string;
  order_id: string;
  article_id: string | null;
  reference: string | null;
  designation: string;
  supplier_id: string | null;
  qty_client: number;
  qty_shop: number;
  unit_price_ht: number;
  vat_rate: number;
  line_ht: number;
  sort_order: number;
};

/** Liste des commandes de pièces (option : filtrer par type). */
export async function listPartOrders(companyId: string, kind?: OrderKind): Promise<PartOrder[]> {
  let q = sb.from('part_orders').select('*').eq('company_id', companyId)
    .order('created_at', { ascending: false }).limit(200);
  if (kind) q = q.eq('order_kind', kind);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as PartOrder[];
}

export type PartOrderFull = { order: PartOrder; lines: PartOrderLine[] };
export async function getPartOrderFull(id: string): Promise<PartOrderFull> {
  const [{ data: order, error: oe }, { data: lines, error: le }] = await Promise.all([
    sb.from('part_orders').select('*').eq('id', id).single(),
    sb.from('part_order_lines').select('*').eq('order_id', id).order('sort_order'),
  ]);
  if (oe) throw oe;
  if (le) throw le;
  return { order: order as PartOrder, lines: (lines ?? []) as PartOrderLine[] };
}

export type NewPartOrder = {
  companyId: string;
  orderKind: OrderKind;
  contactId?: string | null;
  channel?: 'comptoir' | 'mail';
  isAccident?: boolean;
  notes?: string | null;
};

/** Crée une commande de pièces en brouillon. */
export async function createPartOrder(p: NewPartOrder): Promise<string> {
  const { data, error } = await sb.from('part_orders').insert({
    company_id: p.companyId,
    order_kind: p.orderKind,
    dispatch_status: 'brouillon',
    contact_id: p.contactId ?? null,
    channel: p.channel ?? 'comptoir',
    is_accident: p.isAccident ?? (p.orderKind === 'accident'),
    notes: p.notes ?? null,
  }).select('id').single();
  if (error) throw error;
  return (data as { id: string }).id;
}

/** Compteur de commandes par type (pour les pastilles de l'écran liste). */
export async function countByKind(companyId: string): Promise<Record<OrderKind, number>> {
  const out: Record<OrderKind, number> = { urgente: 0, standard: 0, excel: 0, accident: 0 };
  const { data, error } = await sb.from('part_orders').select('order_kind').eq('company_id', companyId);
  if (error) throw error;
  for (const r of (data ?? []) as { order_kind: OrderKind }[]) {
    if (r.order_kind in out) out[r.order_kind] += 1;
  }
  return out;
}
