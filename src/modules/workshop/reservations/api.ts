/**
 * M8 / M5 — Acces base des reservations de l'atelier (mission 10, carte 6, migration 20261103270000).
 * Avant la migration : `reservationSchemaReady()` = false, les ecrans gardent l'ancien chemin
 * (popup « pieces manquantes ») et affichent un message ; rien ne casse.
 */
import { supabase } from '@/integrations/supabase/client';
import type { DisplayStatus, ArticleReservation } from './rules';

const sb = supabase as unknown as {
  from: (t: string) => { select: (cols: string) => { limit: (n: number) => PromiseLike<{ error: unknown }> } };
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
};

/** Fonction / table absente (migration non appliquee). */
export function isMissingSchema(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code ?? '';
  const msg = String((e as { message?: string } | null)?.message ?? '');
  return ['PGRST202', 'PGRST204', 'PGRST205', '42883', '42P01', '42703'].includes(code) || /Could not find|does not exist|schema cache/i.test(msg);
}

let probe: Promise<boolean> | null = null;
/** true quand la table stock_reservations est en base (sonde une fois par session). */
export function reservationSchemaReady(): Promise<boolean> {
  probe ??= (async () => {
    try {
      const { error } = await sb.from('stock_reservations').select('id').limit(1);
      return !error;
    } catch {
      return false;
    }
  })();
  return probe;
}

export type ReservedPart = {
  id: string; articleId: string; reference: string; designation: string; serviceCode: string | null;
  qtyNeeded: number; qtyReserved: number; qtyMissing: number; qtyToOrder: number; qtyConsumed: number;
  displayStatus: DisplayStatus; status: 'active' | 'liberee' | 'consommee'; releaseReason: string | null;
  basketId: string | null; basketLabel: string | null; basketKind: string | null; basketStatus: string | null;
  bin: string | null; dueAt: string | null; appointmentId: string | null; repairOrderId: string | null;
  onOrLines: boolean; realQty: number; availableQty: number;
};

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0) || 0;
const s = (v: unknown) => (v == null ? null : String(v));

/** Lignes du bloc « Pieces reservees » d'un RDV ou d'un OR. */
export async function listReservedParts(p: { appointmentId?: string | null; orId?: string | null }): Promise<ReservedPart[]> {
  const { data, error } = await sb.rpc('workshop_reservations_list', { _appointment: p.appointmentId ?? null, _or: p.orId ?? null });
  if (error) {
    if (isMissingSchema(error)) return [];
    throw new Error(error.message);
  }
  return ((data ?? []) as Row[]).map((r) => ({
    id: String(r.id), articleId: String(r.article_id), reference: String(r.reference ?? ''), designation: String(r.designation ?? ''),
    serviceCode: s(r.service_code), qtyNeeded: n(r.qty_needed), qtyReserved: n(r.qty_reserved), qtyMissing: n(r.qty_missing),
    qtyToOrder: n(r.qty_to_order), qtyConsumed: n(r.qty_consumed), displayStatus: String(r.display_status) as DisplayStatus,
    status: String(r.status) as ReservedPart['status'], releaseReason: s(r.release_reason),
    basketId: s(r.basket_id), basketLabel: s(r.basket_label), basketKind: s(r.basket_kind), basketStatus: s(r.basket_status),
    bin: s(r.bin_location), dueAt: s(r.due_at), appointmentId: s(r.appointment_id), repairOrderId: s(r.repair_order_id),
    onOrLines: !!r.on_or_lines, realQty: n(r.real_qty), availableQty: n(r.available_qty),
  }));
}

export type SyncResult = { moves: number; basketLines: number; minimax: number; released: number; serviceCode: string | null; basketKind: string | null };

/** « Reserver / mettre a jour » : aligne les reservations sur le kit de l'entretien (le manque part au panier). */
export async function syncReservations(p: { appointmentId?: string | null; orId?: string | null }): Promise<SyncResult> {
  const { data, error } = await sb.rpc('workshop_reservations_sync', { _appointment: p.appointmentId ?? null, _or: p.orId ?? null });
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as Row;
  return {
    moves: n(d.moves), basketLines: n(d.basket_lines), minimax: n(d.minimax), released: n(d.released),
    serviceCode: s(d.service_code), basketKind: s(d.basket_kind),
  };
}

export type ArticleReservationRow = ArticleReservation & {
  id: string; appointmentId: string | null; repairOrderId: string | null; qtyMissing: number; serviceCode: string | null;
};

/** Reservations atelier en cours d'une piece (fiche article, comptoir). Migration absente : liste vide. */
export async function listArticleReservations(articleId: string): Promise<ArticleReservationRow[]> {
  const { data, error } = await sb.rpc('article_reservations', { _article: articleId });
  if (error) {
    if (isMissingSchema(error)) return [];
    throw new Error(error.message);
  }
  return ((data ?? []) as Row[]).map((r) => ({
    id: String(r.id), appointmentId: s(r.appointment_id), repairOrderId: s(r.repair_order_id), holder: String(r.holder ?? ''),
    contactName: s(r.contact_name), dueAt: s(r.due_at), qtyReserved: n(r.qty_reserved), qtyMissing: n(r.qty_missing),
    serviceCode: s(r.service_code),
  }));
}

export type ServiceKitItem = {
  kitItemId: string; articleId: string | null; reference: string; designation: string; quantity: number; unit: string | null;
  kind: string; confidence: string; realQty: number; reservedQty: number; onOrderQty: number;
  salePriceHt: number | null; salePriceTtc: number | null; vatRate: number | null;
};

/** Pieces de l'entretien de LA moto (kits reunis, M-109). `null` = fonction absente (ancien chemin). */
export async function getServiceKit(vehicleId: string, serviceCode: string): Promise<ServiceKitItem[] | null> {
  const { data, error } = await sb.rpc('workshop_service_kit', { _vehicle: vehicleId, _service: serviceCode });
  if (error) {
    if (isMissingSchema(error)) return null;
    throw new Error(error.message);
  }
  return ((data ?? []) as Row[]).map((r) => ({
    kitItemId: String(r.kit_item_id), articleId: s(r.article_id), reference: String(r.reference ?? ''), designation: String(r.designation ?? ''),
    quantity: n(r.quantity), unit: s(r.unit), kind: String(r.kind ?? 'piece'), confidence: String(r.confidence ?? 'sur'),
    realQty: n(r.real_qty), reservedQty: n(r.reserved_qty), onOrderQty: n(r.on_order_qty),
    salePriceHt: r.sale_price_ht == null ? null : n(r.sale_price_ht), salePriceTtc: r.sale_price_ttc == null ? null : n(r.sale_price_ttc),
    vatRate: r.vat_rate == null ? null : n(r.vat_rate),
  }));
}
