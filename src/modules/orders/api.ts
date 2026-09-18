/**
 * Commandes de pièces (module orders) — process Miro 2026-07-30.
 * Réservation de pièces validée selon 4 types : urgente | standard | excel | accident.
 * Accès Supabase typé localement (la régénération de types.ts suivra la migration
 * 20260730160000_orders_parts.sql ; on ne bloque pas le build dessus).
 */
import { supabase } from '@/integrations/supabase/client';
import type { OrderRule, RuleIssueCode } from './thresholds';
import type { OrderKindStatus } from './status-flow';

// Client non typé pour les tables introduites par la migration orders (pas encore dans types.ts).
const sb = supabase as unknown as {
  from: (t: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => any;
};

/**
 * Type de commande. Liste extensible : les types viennent de l'énum `order_kind`
 * et de Paramètres → Tables → « Règles des types de commande » (voir getOrderRules).
 */
export type OrderKind = 'urgente' | 'standard' | 'excel' | 'accident' | (string & {});
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
  validated_at: string | null;
  validated_by: string | null;
  sent_at: string | null;
  status_changed_at: string | null;
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

/** Liste des commandes de pièces (filtres facultatifs : type et état). */
export async function listPartOrders(
  companyId: string,
  filters: { kind?: OrderKind; status?: OrderDispatchStatus } = {},
): Promise<PartOrder[]> {
  let q = sb.from('part_orders').select('*').eq('company_id', companyId)
    .order('created_at', { ascending: false }).limit(200);
  if (filters.kind) q = q.eq('order_kind', filters.kind);
  if (filters.status) q = q.eq('dispatch_status', filters.status);
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

/** Couples (type, état) de toutes les commandes de la société — base des compteurs de la liste. */
export async function listKindStatus(companyId: string): Promise<OrderKindStatus[]> {
  const { data, error } = await sb.from('part_orders').select('order_kind, dispatch_status').eq('company_id', companyId);
  if (error) throw error;
  return (data ?? []) as OrderKindStatus[];
}

// ---- Cycle de vie (carte « Suivre l'état d'une commande ») : règles pures dans status-flow.ts ----

/** Change l'état d'une commande par la fonction SQL part_order_transition (contrôles + historique + events). */
export async function transitionPartOrder(
  orderId: string,
  to: OrderDispatchStatus,
  opts: { paymentMethod?: string | null; note?: string | null } = {},
): Promise<ServerRuleCheck> {
  const { data, error } = await sb.rpc('part_order_transition', {
    _order_id: orderId,
    _to: to,
    _payment_method: opts.paymentMethod ?? null,
    _note: opts.note ?? null,
  });
  if (error) throw new Error(error.message);
  return data as ServerRuleCheck;
}

export type PartOrderHistoryRow = {
  changed_at: string;
  from_status: OrderDispatchStatus | null;
  to_status: OrderDispatchStatus;
  changed_by: string | null;
  changed_by_name: string | null;
  note: string | null;
};

/** Historique des états (qui, quand, ancien → nouveau, note). */
export async function getPartOrderHistory(orderId: string): Promise<PartOrderHistoryRow[]> {
  const { data, error } = await sb.rpc('part_order_history', { _order_id: orderId });
  if (error) throw error;
  return (data ?? []) as PartOrderHistoryRow[];
}

// ---- Règles des types (Paramètres → Tables → Règles des types de commande) ----

type RuleRow = {
  code: string; label: string; sort_order: number; is_active: boolean; configured: boolean;
  min_ht: number | null; surcharge_pct: number | null; max_per_day: number | null;
  fallback: string | null; min_ht_per_tab: number | null;
};

const num = (v: unknown): number | null => (v == null || v === '' ? null : Number(v));

/** Règles de chaque type de commande, lues côté serveur (fonction SQL `part_order_rules`). */
export async function getOrderRules(companyId: string): Promise<OrderRule[]> {
  const { data, error } = await sb.rpc('part_order_rules', { _company: companyId });
  if (error) throw error;
  return ((data ?? []) as RuleRow[]).map((r) => ({
    code: r.code,
    label: r.label,
    sortOrder: r.sort_order,
    isActive: r.is_active,
    configured: r.configured,
    minHt: num(r.min_ht),
    surchargePct: num(r.surcharge_pct) ?? 0,
    maxPerDay: num(r.max_per_day),
    fallback: r.fallback,
    minHtPerTab: num(r.min_ht_per_tab),
  }));
}

export type ServerRuleIssue = { code: RuleIssueCode; message: string; [k: string]: unknown };
export type ServerRuleCheck = {
  ok: boolean;
  kind: OrderKind;
  effective_kind: OrderKind;
  total_ht: number;
  surcharge_pct: number;
  errors: ServerRuleIssue[];
  notices: ServerRuleIssue[];
};

/** Diagnostic des règles d'une commande, sans rien écrire (fonction SQL `part_order_check_rules`). */
export async function checkPartOrderRules(orderId: string): Promise<ServerRuleCheck> {
  const { data, error } = await sb.rpc('part_order_check_rules', { _order_id: orderId });
  if (error) throw error;
  return data as ServerRuleCheck;
}

/** Valide la commande : brouillon → en attente de paiement. Refusé par le serveur si une règle bloque. */
export async function validatePartOrder(orderId: string): Promise<ServerRuleCheck> {
  const { data, error } = await sb.rpc('part_order_validate', { _order_id: orderId });
  if (error) throw new Error(error.message);
  return data as ServerRuleCheck;
}

// ---- Lignes (carte « Ajouter et modifier les pièces d'une commande ») ----
// Écritures uniquement par fonctions SQL : brouillon seulement, contrôles serveur, trace dans events.

/** Article trouvé pour une commande : casier, fournisseur principal, triple stock (B4). */
export type OrderArticleHit = {
  articleId: string;
  reference: string;
  designation: string;
  supplierRef: string | null;
  supplierId: string | null;
  supplierName: string | null;
  bin: string | null;
  bin2: string | null;
  salePriceHt: number;
  vatRate: number;
  mgmtType: string;
  isLibrary: boolean;
  matchedBarcode: string | null;
  realQty: number;
  reservedQty: number;
  onOrderQty: number;
  availableQty: number;
};

/** Recherche par référence, désignation, réf. fournisseur ou code-barres (fonction SQL part_order_article_search). */
export async function searchOrderArticles(companyId: string, term: string, limit = 12): Promise<OrderArticleHit[]> {
  const { data, error } = await supabase.rpc('part_order_article_search', { _company: companyId, _term: term, _limit: limit });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    articleId: r.article_id,
    reference: r.reference,
    designation: r.designation,
    supplierRef: r.supplier_ref ?? null,
    supplierId: r.supplier_id ?? null,
    supplierName: r.supplier_name ?? null,
    bin: r.bin_location ?? null,
    bin2: r.bin_location2 ?? null,
    salePriceHt: Number(r.sale_price_ht ?? 0),
    vatRate: Number(r.vat_rate ?? 21),
    mgmtType: r.mgmt_type,
    isLibrary: !!r.is_library,
    matchedBarcode: r.matched_barcode ?? null,
    realQty: Number(r.real_qty ?? 0),
    reservedQty: Number(r.reserved_qty ?? 0),
    onOrderQty: Number(r.on_order_qty ?? 0),
    availableQty: Number(r.available_qty ?? 0),
  }));
}

/** Ligne de commande avec fournisseur, casier et stock (fonction SQL part_order_lines_detail). */
export type PartOrderLineDetail = {
  id: string;
  articleId: string | null;
  reference: string | null;
  designation: string;
  supplierId: string | null;
  supplierName: string | null;
  qtyClient: number;
  qtyShop: number;
  unitPriceHt: number;
  vatRate: number;
  lineHt: number;
  bin: string | null;
  bin2: string | null;
  /** null = ligne sans article */
  availableQty: number | null;
  realQty: number | null;
  reservedQty: number | null;
  onOrderQty: number | null;
};

export async function getPartOrderLinesDetail(orderId: string): Promise<PartOrderLineDetail[]> {
  const { data, error } = await supabase.rpc('part_order_lines_detail', { _order_id: orderId });
  if (error) throw error;
  const n = (v: unknown) => (v == null ? null : Number(v));
  return (data ?? []).map((r) => ({
    id: r.id,
    articleId: r.article_id ?? null,
    reference: r.reference ?? null,
    designation: r.designation,
    supplierId: r.supplier_id ?? null,
    supplierName: r.supplier_name ?? null,
    qtyClient: Number(r.qty_client),
    qtyShop: Number(r.qty_shop),
    unitPriceHt: Number(r.unit_price_ht),
    vatRate: Number(r.vat_rate),
    lineHt: Number(r.line_ht),
    bin: r.bin_location ?? null,
    bin2: r.bin_location2 ?? null,
    availableQty: r.article_id ? n(r.available_qty) : null,
    realQty: r.article_id ? n(r.real_qty) : null,
    reservedQty: r.article_id ? n(r.reserved_qty) : null,
    onOrderQty: r.article_id ? n(r.on_order_qty) : null,
  }));
}

export type SaveOrderLineInput = {
  orderId: string;
  /** absent = nouvelle ligne */
  lineId?: string | null;
  articleId?: string | null;
  designation?: string | null;
  supplierId: string | null;
  qtyClient: number;
  qtyShop: number;
  unitPriceHt: number;
  vatRate: number;
};

/** Ajoute ou modifie une ligne (brouillon seulement ; refusé par le serveur sinon). */
export async function saveOrderLine(p: SaveOrderLineInput): Promise<void> {
  const { error } = await supabase.rpc('part_order_line_save', {
    _order_id: p.orderId,
    _line_id: p.lineId ?? undefined,
    _article_id: p.articleId ?? undefined,
    _designation: p.designation ?? undefined,
    // omis = null côté SQL = « aucun fournisseur »
    _supplier_id: p.supplierId ?? undefined,
    _qty_client: p.qtyClient,
    _qty_shop: p.qtyShop,
    _unit_price_ht: p.unitPriceHt,
    _vat_rate: p.vatRate,
  });
  if (error) throw new Error(error.message);
}

/** Supprime une ligne (brouillon seulement). */
export async function deleteOrderLine(lineId: string): Promise<void> {
  const { error } = await supabase.rpc('part_order_line_delete', { _line_id: lineId });
  if (error) throw new Error(error.message);
}
