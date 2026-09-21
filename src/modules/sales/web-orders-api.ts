/**
 * Mission 03 — « Une vente sur le site crée la vente et la sortie de stock dans le DMS ».
 * Écran Ventes → « Commandes du site » : commandes Shopify reçues, statut d'import, lien vers la
 * facture du DMS, bouton « Réessayer » ; réglage société « Import des commandes du site ».
 * Les écritures sont faites par la fonction serveur shopify-orders (clé de service) et la fonction
 * SQL _shopify_order_apply (migration 20260921120000). Rien n'est écrit dans Shopify.
 * Carte « Réserver le stock dès qu'une commande du site est passée, même non payée » (migration
 * 20260921150000) : une commande pas encore payée réserve le stock de ses lignes reliées
 * (shopify_order_reservations) ; affichée « Réservée (en attente de paiement) ».
 */
import { supabase } from '@/integrations/supabase/client';
import type { StatusTone } from '@/components/status-badge';

export type WebOrderImportStatus = 'importee' | 'a_relier' | 'erreur' | 'en_attente' | 'annulee' | 'ignoree';
export const WEB_ORDER_STATUSES: readonly WebOrderImportStatus[] = ['importee', 'a_relier', 'erreur', 'en_attente', 'annulee', 'ignoree'];

/** Statut affiché : « Pas encore payée » devient « Réservée (en attente de paiement) » tant que du stock est réservé. */
export type WebOrderDisplayStatus = WebOrderImportStatus | 'reservee';
export const WEB_ORDER_DISPLAY_STATUSES: readonly WebOrderDisplayStatus[] = ['importee', 'a_relier', 'erreur', 'reservee', 'en_attente', 'annulee', 'ignoree'];

export type WebOrderReservationStatus = 'active' | 'vendue' | 'annulee' | 'expiree';
/** Synthèse des réservations de stock d'une commande (une ligne par ligne de commande reliée). */
export type WebOrderReservation = {
  /** Quantité encore réservée (toutes lignes). */
  activeQty: number;
  /** État de la dernière libération si plus rien n'est réservé (vendue, annulée, expirée), sinon null. */
  released: WebOrderReservationStatus | null;
  releasedAt: string | null;
  releaseReason: string | null;
};

/** Durée par défaut d'une réservation (jours), réglable par société. */
export const DEFAULT_RESERVATION_DAYS = 7;

/** Rôles qui voient l'écran et la cloche « Nouvelle commande web » (filtré aussi en base). */
export const WEB_ORDER_ROLES = ['admin', 'vendeur'] as const;

export type WebOrderLine = { shopifyLineId: string; title: string | null; sku: string | null; quantity: number; articleId: string | null };

export type WebOrder = {
  id: string;
  shopifyOrderId: string;
  name: string | null;
  createdAt: string | null;
  email: string | null;
  totalTtc: number | null;
  financialStatus: string | null;
  cancelledAt: string | null;
  status: WebOrderImportStatus;
  needsCheck: boolean;
  checkReason: string | null;
  errorMessage: string | null;
  attempts: number;
  documentId: string | null;
  documentNumber: string | null;
  contactId: string | null;
  contactName: string | null;
  contactCreated: boolean;
  lines: WebOrderLine[];
  reservation: WebOrderReservation | null;
  credits: { id: string; number: string | null; amount: number }[];
  lastAttemptAt: string | null;
};

export type WebOrderSettings = { importEnabled: boolean; enabledAt: string | null; lastCatchupAt: string | null; reservationDays: number };

const n = (v: unknown): number | null => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** Couleur + icône (choisie par l'écran) + libellé : jamais le rouge Ducati pour un statut. */
export function webOrderTone(s: WebOrderDisplayStatus): StatusTone {
  switch (s) {
    case 'importee': return 'success';
    case 'a_relier': return 'warning';
    case 'erreur': return 'danger';
    case 'reservee': return 'info';
    case 'en_attente': return 'info';
    default: return 'neutral';
  }
}

/** Le bouton « Réessayer » a-t-il un sens ? (une commande importée sans rien à relier : non) */
export function canRetry(o: Pick<WebOrder, 'status'>): boolean {
  return o.status === 'erreur' || o.status === 'a_relier' || o.status === 'en_attente';
}

/** « Réservée (en attente de paiement) » : pas encore payée et du stock encore réservé. */
export function displayStatus(o: Pick<WebOrder, 'status' | 'reservation'>): WebOrderDisplayStatus {
  return o.status === 'en_attente' && (o.reservation?.activeQty ?? 0) > 0 ? 'reservee' : o.status;
}

/** Réservations d'une commande → synthèse (quantité encore réservée, dernière libération). */
export function summarizeReservations(
  rows: { status: string; reserved_qty: number | string | null; released_at: string | null; release_reason: string | null }[],
): WebOrderReservation | null {
  if (!rows.length) return null;
  const activeQty = rows.filter((r) => r.status === 'active').reduce((s, r) => s + Number(r.reserved_qty ?? 0), 0);
  const last = rows.filter((r) => r.status !== 'active' && r.released_at)
    .sort((a, b) => (a.released_at! < b.released_at! ? 1 : -1))[0];
  return {
    activeQty,
    released: activeQty > 0 || !last ? null : (last.status as WebOrderReservationStatus),
    releasedAt: activeQty > 0 || !last ? null : last.released_at,
    releaseReason: activeQty > 0 || !last ? null : last.release_reason,
  };
}

/** Fin de la réservation : date de la commande + durée réglée. */
export function reservationEndsAt(createdAt: string | null, days: number): Date | null {
  if (!createdAt) return null;
  const t = Date.parse(createdAt);
  return Number.isFinite(t) ? new Date(t + days * 24 * 3600 * 1000) : null;
}

export function countByStatus(rows: Pick<WebOrder, 'status' | 'needsCheck' | 'reservation'>[]): Record<WebOrderDisplayStatus | 'a_verifier', number> {
  const out = { importee: 0, a_relier: 0, erreur: 0, reservee: 0, en_attente: 0, annulee: 0, ignoree: 0, a_verifier: 0 };
  for (const r of rows) {
    out[displayStatus(r)] += 1;
    if (r.needsCheck) out.a_verifier += 1;
  }
  return out;
}

const contactLabel = (c: { company_name?: string | null; first_name?: string | null; last_name?: string | null } | null): string | null => {
  if (!c) return null;
  const s = (c.company_name ?? '').trim() || [c.first_name, c.last_name].filter(Boolean).join(' ').trim();
  return s || null;
};

export async function listWebOrders(companyId: string, limit = 200): Promise<WebOrder[]> {
  const { data, error } = await supabase
    .from('shopify_orders')
    .select(`id, shopify_order_id, order_name, shopify_created_at, email, total_ttc, financial_status, cancelled_at,
      import_status, needs_check, check_reason, error_message, attempts, document_id, contact_id, contact_created, last_attempt_at,
      document:documents!shopify_orders_document_id_fkey(number),
      contact:contacts!shopify_orders_contact_id_fkey(company_name, first_name, last_name),
      shopify_order_lines(shopify_line_id, title, sku, quantity, article_id),
      shopify_order_reservations(status, reserved_qty, released_at, release_reason),
      shopify_order_refunds(credit_note_id, amount, credit:documents!shopify_order_refunds_credit_note_id_fkey(number))`)
    .eq('company_id', companyId)
    .order('shopify_created_at', { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    shopifyOrderId: r.shopify_order_id,
    name: r.order_name,
    createdAt: r.shopify_created_at,
    email: r.email,
    totalTtc: n(r.total_ttc),
    financialStatus: r.financial_status,
    cancelledAt: r.cancelled_at,
    status: (WEB_ORDER_STATUSES as readonly string[]).includes(r.import_status) ? (r.import_status as WebOrderImportStatus) : 'erreur',
    needsCheck: !!r.needs_check,
    checkReason: r.check_reason,
    errorMessage: r.error_message,
    attempts: r.attempts ?? 0,
    documentId: r.document_id,
    documentNumber: r.document?.number ?? null,
    contactId: r.contact_id,
    contactName: contactLabel(r.contact),
    contactCreated: !!r.contact_created,
    lines: (r.shopify_order_lines ?? []).map((l) => ({
      shopifyLineId: l.shopify_line_id, title: l.title, sku: l.sku, quantity: Number(l.quantity), articleId: l.article_id,
    })),
    reservation: summarizeReservations(r.shopify_order_reservations ?? []),
    credits: (r.shopify_order_refunds ?? []).filter((c) => c.credit_note_id).map((c) => ({
      id: c.credit_note_id as string, number: c.credit?.number ?? null, amount: Number(c.amount),
    })),
    lastAttemptAt: r.last_attempt_at,
  }));
}

export async function getWebOrderSettings(companyId: string): Promise<WebOrderSettings> {
  const { data, error } = await supabase
    .from('shopify_order_settings')
    .select('import_enabled, enabled_at, last_catchup_at, reservation_days')
    .eq('company_id', companyId)
    .maybeSingle();
  if (error) throw error;
  return {
    importEnabled: !!data?.import_enabled, enabledAt: data?.enabled_at ?? null, lastCatchupAt: data?.last_catchup_at ?? null,
    reservationDays: data?.reservation_days ?? DEFAULT_RESERVATION_DAYS,
  };
}

/** Durée de réservation d'une commande non payée, 1 à 60 jours (administrateurs, tracé dans events). */
export async function setWebOrderReservationDays(companyId: string, days: number): Promise<void> {
  const { error } = await supabase.rpc('shopify_orders_set_reservation_days', { _company: companyId, _days: days });
  if (error) throw error;
}

/** Arrêté / Actif (administrateurs, tracé dans events). */
export async function setWebOrderImport(companyId: string, enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc('shopify_orders_set_import', { _company: companyId, _enabled: enabled });
  if (error) throw error;
}

type FnResult = { ok?: boolean; error?: string; detail?: string; result?: { status?: string; detail?: string }; read?: number };

async function invokeOrders(body: Record<string, unknown>): Promise<FnResult> {
  const { data, error } = await supabase.functions.invoke('shopify-orders', { body });
  if (error) {
    // Réponse d'erreur de la fonction : on remonte son code lisible (import_stopped, forbidden…).
    const ctx = (error as { context?: Response }).context;
    const parsed = ctx && typeof ctx.json === 'function' ? await ctx.json().catch(() => null) : null;
    throw new Error((parsed as FnResult | null)?.error ?? error.message);
  }
  const r = data as FnResult;
  if (!r?.ok) throw new Error(r?.detail ?? r?.error ?? 'failed');
  return r;
}

/** « Réessayer » : relit la commande dans Shopify et refait l'import (sans doublon). */
export async function retryWebOrder(companyId: string, shopifyOrderId: string): Promise<string> {
  const r = await invokeOrders({ action: 'retry', company_id: companyId, order_id: shopifyOrderId });
  if (r.result?.status === 'erreur') throw new Error(r.result.detail ?? 'erreur');
  return r.result?.status ?? 'importee';
}

/** « Relire maintenant » : même lecture que le rattrapage planifié (administrateurs). */
export async function syncWebOrdersNow(companyId: string): Promise<number> {
  const r = await invokeOrders({ action: 'sync', company_id: companyId });
  return r.read ?? 0;
}

// ---- Cloche « Nouvelle commande web »

export type WebOrderAlert = {
  id: string;
  documentId: string | null;
  title: string;
  totalTtc: number;
  unlinked: number;
  createdAt: string;
  read: boolean;
};

/** Jours d'affichage dans la cloche. */
export const WEB_ORDER_ALERT_DAYS = 7;

export async function listWebOrderAlerts(companyId: string, userId: string): Promise<WebOrderAlert[]> {
  const since = new Date(Date.now() - WEB_ORDER_ALERT_DAYS * 24 * 3600 * 1000).toISOString();
  const { data, error } = await supabase
    .from('team_notifications')
    .select('id, document_id, title, payload, created_at, team_notification_reads(user_id)')
    .eq('company_id', companyId)
    .eq('kind', 'web_order')
    .gte('created_at', since)
    .eq('team_notification_reads.user_id', userId)
    .order('created_at', { ascending: false })
    .limit(30);
  if (error) throw error;
  return (data ?? []).map((r) => {
    const p = (r.payload ?? {}) as { total_ttc?: number; unlinked?: number };
    return {
      id: r.id, documentId: r.document_id, title: r.title, totalTtc: Number(p.total_ttc ?? 0),
      unlinked: Number(p.unlinked ?? 0), createdAt: r.created_at, read: (r.team_notification_reads ?? []).length > 0,
    };
  });
}
