/**
 * M4 — Règles pures du rattrapage G8 achats (18/11/2026), testées dans tests/purchases-g8.test.ts.
 * Le serveur (purchase_doc_save, migration 20261118200000) fait foi ; ces fonctions servent à
 * l'aperçu à l'écran et reprennent EXACTEMENT les mêmes formules.
 */

export type PurchaseDocType = 'CMD' | 'REC' | 'PCF' | 'RTF';
export type PurchaseOrderType = 'stock' | 'depannage' | 'garantie';
export type VatRegimeCode = 'with_vat' | 'cee' | 'outside_cee';

export const PURCHASE_DOC_TYPES: PurchaseDocType[] = ['REC', 'CMD', 'PCF', 'RTF'];
export const PURCHASE_ORDER_TYPES: PurchaseOrderType[] = ['stock', 'depannage', 'garantie'];
export const SEND_CHANNELS = ['mail', 'dcs', 'b2b', 'telephone', 'papier', 'autre'] as const;
export type SendChannel = (typeof SEND_CHANNELS)[number];
export const INFORM_CHANNELS = ['telephone', 'sms', 'email', 'comptoir', 'autre'] as const;
export type InformChannel = (typeof INFORM_CHANNELS)[number];

/** Types de gestion sans mouvement de stock à la réception (B1) : non stocké, texte, main d'œuvre. */
export const NON_STOCKED_MGMT = ['M', 'F', 'T'];

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const r2 = (n: number) => Math.round(n * 100) / 100;

export type LandedLine = { quantity: number; unit_price_ht: number; discount_pct: number; stocked: boolean };

/**
 * Coût unitaire d'entrée en stock (base du PAMP) de chaque ligne d'une réception.
 * PA net de la ligne ; si `spread` : remise globale appliquée et port réparti au prorata du HT net
 * des lignes STOCKÉES (une ligne texte / non stockée ne prend pas de port). null = pas d'entrée.
 */
export function landedUnitCosts(
  lines: LandedLine[],
  opts: { globalDiscountPct?: number; shippingHt?: number; spread?: boolean },
): (number | null)[] {
  const spread = opts.spread !== false;
  const gd = spread ? opts.globalDiscountPct || 0 : 0;
  const ship = spread ? opts.shippingHt || 0 : 0;
  const net = (l: LandedLine) => l.quantity * l.unit_price_ht * (1 - (l.discount_pct || 0) / 100);
  const basis = lines.filter((l) => l.stocked && l.quantity > 0).reduce((s, l) => s + net(l), 0);
  return lines.map((l) => {
    if (!l.stocked || l.quantity <= 0) return null;
    const unitNet = r3(l.unit_price_ht * (1 - (l.discount_pct || 0) / 100));
    const share = basis > 0 ? (ship * net(l)) / basis : 0;
    return r3((l.quantity * unitNet * (1 - gd / 100) + share) / l.quantity);
  });
}

/** Nouveau PAMP après une entrée (même formule que record_stock_move). */
export function nextPamp(oldReal: number, oldPamp: number, qty: number, unitCost: number): number {
  if (oldReal <= 0) return r3(unitCost);
  return r3((oldPamp * oldReal + unitCost * qty) / (oldReal + qty));
}

/** Reste à recevoir d'une ligne de commande (jamais négatif). */
export function remainingQty(ordered: number, received: number): number {
  return Math.max(r3(ordered - received), 0);
}

/** Statut d'une commande d'après ses lignes (validee / partielle / recue), comme _purchase_order_refresh_status. */
export function orderReceptionStatus(lines: { quantity: number; received: number }[]): 'validee' | 'partielle' | 'recue' {
  const anyRec = lines.some((l) => l.received > 0);
  const allDone = lines.every((l) => l.quantity <= 0 || l.received >= l.quantity);
  if (anyRec && allDone) return 'recue';
  return anyRec ? 'partielle' : 'validee';
}

/** Quantité arrondie au conditionnement d'achat supérieur (INV009, G8 « qté proposée = conditionnement »). */
export function roundToPack(qty: number, pack: number | null | undefined): number {
  const p = Number(pack) || 0;
  if (qty <= 0) return 0;
  if (p <= 1) return qty;
  return Math.ceil(r3(qty / p)) * p;
}

/** Remise de ligne par défaut : remise dépannage du fournisseur sur une commande de type dépannage. */
export function defaultLineDiscount(orderType: PurchaseOrderType | null | undefined, rushDiscountPct: number | null | undefined): number {
  return orderType === 'depannage' ? Number(rushDiscountPct) || 0 : 0;
}

/** Conditions de commande d'un fournisseur sur une sélection (regroupement G8 : franco, minimum, totaux). */
export type SupplierThresholds = { franco: number | null; minAmount: number | null; minQty: number | null };
export function thresholdStatus(total: number, qty: number, t: SupplierThresholds) {
  const francoRest = t.franco && t.franco > 0 ? Math.max(r2(t.franco - total), 0) : null;
  const minRest = t.minAmount && t.minAmount > 0 ? Math.max(r2(t.minAmount - total), 0) : null;
  const minQtyRest = t.minQty && t.minQty > 0 ? Math.max(r3(t.minQty - qty), 0) : null;
  return {
    francoRest, minRest, minQtyRest,
    francoMet: francoRest === null ? null : francoRest === 0,
    minMet: minRest === null ? null : minRest === 0,
    minQtyMet: minQtyRest === null ? null : minQtyRest === 0,
  };
}

/** Contrôle d'un regroupement avant l'appel serveur (mêmes règles que purchase_orders_merge). */
export function mergeProblem(orders: { supplier_id: string | null; doc_type: string; status: string; dcs_kind: string | null }[]):
  null | 'count' | 'supplier' | 'mixed' | 'status' {
  if (orders.length < 2) return 'count';
  if (orders.some((o) => !o.supplier_id) || new Set(orders.map((o) => o.supplier_id)).size !== 1) return 'supplier';
  if (new Set(orders.map((o) => o.doc_type)).size !== 1 || new Set(orders.map((o) => o.status)).size !== 1
      || new Set(orders.map((o) => o.dcs_kind ?? '-')).size !== 1) return 'mixed';
  if (orders.some((o) => !['CMD', 'PCF'].includes(o.doc_type) || !['brouillon', 'validee'].includes(o.status))) return 'status';
  return null;
}

/** Statut affiché : ton du badge (couleur + icône + libellé, charte). */
export function purchaseStatusTone(s: string): 'success' | 'warning' | 'info' | 'neutral' | 'danger' {
  switch (s) {
    case 'recue': case 'transformee': return 'success';
    case 'partielle': case 'validee': return 'warning';
    case 'brouillon': return 'info';
    default: return 'neutral';
  }
}

/** Libellé de période → bornes ISO (liste des documents). */
export function periodBounds(kind: 'month' | 'quarter' | 'year' | 'all', today = new Date()): { from: string | null; to: string | null } {
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (kind === 'all') return { from: null, to: null };
  const y = today.getFullYear();
  const m = today.getMonth();
  if (kind === 'year') return { from: `${y}-01-01`, to: `${y}-12-31` };
  if (kind === 'quarter') {
    const q0 = Math.floor(m / 3) * 3;
    return { from: iso(new Date(y, q0, 1)), to: iso(new Date(y, q0 + 3, 0)) };
  }
  return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
}
