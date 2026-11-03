/**
 * M4 — Panier de commande Ducati (mission 09) : accès Supabase.
 * Lecture : supplier_baskets (RLS is_member) et basket_lines_detail ; écritures UNIQUEMENT par les
 * fonctions SQL tracées dans events (basket_open, basket_add_lines, basket_fill_minimax,
 * basket_remove_in_stock, basket_line_set_qty, basket_order, basket_set_file,
 * basket_set_dcs_number, basket_receive, basket_cancel, basket_fill_from_part_orders,
 * basket_fill_from_shopify). Tables hors types.ts : client non typé, comme le module orders.
 */
import { supabase } from '@/integrations/supabase/client';
import type { BasketKind, BasketLine, BasketLineInput, BasketStatus, SupplierBasket } from './basket';
import { guardSupplierLines } from '@/modules/articles/supply-guard';

const sb = supabase as unknown as {
  from: (t: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => any;
};

const num = (v: unknown) => Number(v ?? 0) || 0;
const numOrNull = (v: unknown) => (v == null ? null : Number(v));

function mapBasket(r: Record<string, unknown>): SupplierBasket {
  return { ...(r as unknown as SupplierBasket), total_ht: num(r.total_ht), surcharge_pct: num(r.surcharge_pct) };
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

/** Tous les paniers de la société (« Toutes nos commandes »), les plus récents d'abord. */
export async function listBaskets(companyId: string, limit = 300): Promise<SupplierBasket[]> {
  const { data, error } = await sb.from('supplier_baskets').select('*').eq('company_id', companyId)
    .order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map(mapBasket);
}

export async function getBasket(id: string): Promise<SupplierBasket> {
  const { data, error } = await sb.from('supplier_baskets').select('*').eq('id', id).single();
  if (error) throw error;
  return mapBasket(data as Record<string, unknown>);
}

export async function getBasketLines(basketId: string): Promise<BasketLine[]> {
  const rows = await rpc<Record<string, unknown>[]>('basket_lines_detail', { _basket: basketId });
  return (rows ?? []).map((r) => ({
    id: String(r.id),
    articleId: String(r.article_id),
    reference: String(r.reference ?? ''),
    designation: String(r.designation ?? ''),
    qty: num(r.qty),
    origin: r.origin as BasketLine['origin'],
    originRef: (r.origin_ref as string | null) ?? null,
    originLineId: (r.origin_line_id as string | null) ?? null,
    contactId: (r.contact_id as string | null) ?? null,
    contactLabel: (r.contact_label as string | null) ?? null,
    purchasePrice: numOrNull(r.purchase_price),
    salePriceHt: numOrNull(r.sale_price_ht),
    inStockQty: num(r.in_stock_qty),
    realQtyNow: num(r.real_qty_now),
    sortOrder: num(r.sort_order),
  }));
}

/** Nouveau panier (plusieurs paniers ouverts possibles). */
export function openBasket(companyId: string, kind: BasketKind, label?: string | null): Promise<string> {
  return rpc<string>('basket_open', { _company: companyId, _kind: kind, _label: label ?? null });
}

/** Panier ouvert le plus récent d'un type (créé si absent). */
export function currentBasket(companyId: string, kind: BasketKind): Promise<string> {
  return rpc<string>('basket_current', { _company: companyId, _kind: kind });
}

/**
 * `refused` : pièces retirées avant l'envoi (fin de série chez Ducati) ; `substituted` : pièces
 * remplacées commandées sous la dernière référence (TAR008). Messages prêts à afficher.
 */
export type BasketAddResult = {
  basket_id: string; added: number; merged: number; skipped: number;
  refused?: string[]; substituted?: string[];
};

/**
 * Garde-fou TAR008 : une pièce en fin de série n'est jamais commandée, une pièce remplacée
 * l'est sous la nouvelle référence. Rien de commandable : erreur avec la raison.
 */
async function guarded(lines: BasketLineInput[], send: (l: BasketLineInput[]) => Promise<BasketAddResult>): Promise<BasketAddResult> {
  const g = await guardSupplierLines(lines);
  if (g.lines.length === 0 && g.refused.length > 0) throw new Error(g.refused.join(' '));
  const res = await send(g.lines);
  return { ...res, refused: g.refused, substituted: g.substituted };
}

/**
 * Ajoute des lignes au panier ouvert le plus récent du type (créé si absent). Fonction partagée
 * avec les autres lots (popup entretien, démo) : basket_add_lines(_company, _kind, _lines).
 */
export function addBasketLines(companyId: string, kind: BasketKind, lines: BasketLineInput[]): Promise<BasketAddResult> {
  return guarded(lines, (l) => rpc<BasketAddResult>('basket_add_lines', { _company: companyId, _kind: kind, _lines: l }));
}

/** Ajoute des lignes dans UN panier précis (ligne manuelle depuis l'écran du panier). */
export function addBasketLinesTo(basketId: string, lines: BasketLineInput[]): Promise<BasketAddResult> {
  return guarded(lines, (l) => rpc<BasketAddResult>('basket_add_lines_to', { _basket: basketId, _lines: l }));
}

/** Quantité d'une ligne ; 0 = suppression. */
export async function setBasketLineQty(lineId: string, qty: number): Promise<void> {
  await rpc<void>('basket_line_set_qty', { _line: lineId, _qty: qty });
}

export type MinimaxResult = BasketAddResult & { removed: number };

/** « Remplir depuis les minimums ». */
export function fillMinimax(companyId: string, basketId?: string | null): Promise<MinimaxResult> {
  return rpc<MinimaxResult>('basket_fill_minimax', { _company: companyId, _basket: basketId ?? null });
}

/** « Enlever ce qui est déjà en stock ». */
export function removeBasketInStock(basketId: string): Promise<{ removed: number }> {
  return rpc<{ removed: number }>('basket_remove_in_stock', { _basket: basketId });
}

export type BasketServerIssue = { code: string; message: string; [k: string]: unknown };
export type BasketServerCheck = {
  ok: boolean; kind: BasketKind; status: BasketStatus; total_ht: number; line_count: number;
  min_ht: number | null; surcharge_pct: number; urgente_today: number;
  errors: BasketServerIssue[]; notices: BasketServerIssue[];
};

/** Diagnostic des règles (n'écrit rien). */
export async function checkBasketRules(basketId: string): Promise<BasketServerCheck> {
  const r = await rpc<BasketServerCheck>('basket_check', { _basket: basketId });
  return { ...r, total_ht: num(r.total_ht), line_count: num(r.line_count), min_ht: numOrNull(r.min_ht), surcharge_pct: num(r.surcharge_pct), urgente_today: num(r.urgente_today) };
}

/** « Commander » : règles contrôlées par le serveur, date + opérateur, statut « commandé ». */
export async function orderBasket(basketId: string): Promise<SupplierBasket> {
  return mapBasket(await rpc<Record<string, unknown>>('basket_order', { _basket: basketId }));
}

export async function setBasketFile(basketId: string, path: string, attachmentId: string | null): Promise<void> {
  await rpc<void>('basket_set_file', { _basket: basketId, _path: path, _attachment: attachmentId });
}

/** Numéro de commande donné par le DCS, saisi après coup. */
export async function setBasketDcsNumber(basketId: string, number: string): Promise<void> {
  await rpc<void>('basket_set_dcs_number', { _basket: basketId, _number: number });
}

export async function receiveBasket(basketId: string): Promise<void> {
  await rpc<void>('basket_receive', { _basket: basketId });
}

export async function cancelBasket(basketId: string, reason?: string | null): Promise<void> {
  await rpc<void>('basket_cancel', { _basket: basketId, _reason: reason ?? null });
}

export type FillFromPartOrdersResult = {
  standard: BasketAddResult | null;
  urgente: BasketAddResult | null;
  skipped: { line_id: string; reference?: string; reason: string }[];
};

/** Comptoir : pièces cochées de « Commandes de pièces à passer » → panier (urgente ou standard selon le type). */
export function fillBasketFromPartOrders(companyId: string, lineIds: string[]): Promise<FillFromPartOrdersResult> {
  return rpc<FillFromPartOrdersResult>('basket_fill_from_part_orders', { _company: companyId, _line_ids: lineIds, _basket: null });
}

export type FillFromShopifyResult = BasketAddResult & { skipped: { line_id: string; sku?: string | null; reason: string }[] };

/** Site : lignes d'une commande Shopify sans stock → panier standard. */
export function fillBasketFromShopify(companyId: string, shopifyOrderId: string): Promise<FillFromShopifyResult> {
  return rpc<FillFromShopifyResult>('basket_fill_from_shopify', { _company: companyId, _shopify_order_id: shopifyOrderId, _basket: null });
}

/** Recherche d'article pour une ligne manuelle (même fonction que l'écran des commandes de pièces). */
export { searchOrderArticles as searchBasketArticles } from '@/modules/orders/api';
