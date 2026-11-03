/**
 * M4 — Panier de commande Ducati (mission 09, cartes 1, 2 et 4). Règles pures, testées par
 * tests/purchases-baskets.test.ts ; le contrôle qui fait foi est côté serveur (basket_check,
 * basket_order, basket_fill_minimax — migration 20261103100000_m4_paniers_de_commande.sql).
 *
 *  - minimax : quantité à commander = greatest(stock max, stock min) − stock réel − déjà en commande ;
 *  - « Enlever ce qui est déjà en stock » : une ligne dont le stock réel couvre la quantité sort du panier ;
 *  - validation : minimum du type (standard 250 € HTVA, Paramètres), urgente UNE par jour et sans minimum ;
 *  - urgente : +12 % (réglé dans Paramètres, M-78) sur le prix de vente des lignes commandées pour un client ;
 *  - fichier ExportDucati.xls : lignes à partir de la ligne 4, colonne G = nom du client (NOM PRENOM) ;
 *  - numéro DCS : vide à la validation, saisi à la main après coup (M-79).
 */
import type { OrderRule } from '@/modules/orders/thresholds';

export type BasketKind = 'standard' | 'urgente' | 'demo';
export const BASKET_KINDS: BasketKind[] = ['standard', 'urgente', 'demo'];

export type BasketStatus = 'ouvert' | 'commande' | 'recu' | 'annule';
export const BASKET_STATUSES: BasketStatus[] = ['ouvert', 'commande', 'recu', 'annule'];

export type BasketOrigin = 'minimax' | 'atelier' | 'comptoir' | 'site' | 'manuel';
export const BASKET_ORIGINS: BasketOrigin[] = ['minimax', 'atelier', 'comptoir', 'site', 'manuel'];

export type SupplierBasket = {
  id: string;
  company_id: string;
  kind: BasketKind;
  label: string;
  status: BasketStatus;
  dcs_order_number: string | null;
  ordered_at: string | null;
  ordered_by: string | null;
  received_at: string | null;
  cancelled_at: string | null;
  file_path: string | null;
  file_attachment_id: string | null;
  total_ht: number;
  surcharge_pct: number;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type BasketLine = {
  id: string;
  articleId: string;
  reference: string;
  designation: string;
  qty: number;
  origin: BasketOrigin;
  originRef: string | null;
  originLineId: string | null;
  contactId: string | null;
  /** NOM PRENOM en majuscules (colonne G du fichier), null = pour le stock */
  contactLabel: string | null;
  purchasePrice: number | null;
  salePriceHt: number | null;
  /** stock réel au moment de l'ajout */
  inStockQty: number;
  /** stock réel au moment de la lecture */
  realQtyNow: number;
  sortOrder: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Ligne ajoutée par basket_add_lines(_company, _kind, _lines) (même forme que le JSON attendu par le serveur). */
export type BasketLineInput = {
  article_id: string;
  qty: number;
  origin: BasketOrigin;
  origin_ref?: string | null;
  origin_line_id?: string | null;
  contact_id?: string | null;
};

// ---------------------------------------------------------------- minimax

/**
 * Quantité du minimax : on remonte au stock maximum (sinon au minimum) en tenant compte du stock
 * réel ET de ce qui est déjà en commande (CMD, commandes de pièces, autres paniers). Jamais négatif.
 */
export function minimaxQty(p: { stockMin: number; stockMax: number; realQty: number; onOrderQty: number }): number {
  const target = Math.max(Number(p.stockMax) || 0, Number(p.stockMin) || 0);
  return r3(Math.max(target - (Number(p.realQty) || 0) - (Number(p.onOrderQty) || 0), 0));
}

/** Une pièce entre dans le minimax si elle est stockée (A), a un minimum > 0 et un stock réel sous ce minimum. */
export function belowMinimum(p: { mgmtType: string; stockMin: number; realQty: number }): boolean {
  return p.mgmtType === 'A' && (Number(p.stockMin) || 0) > 0 && (Number(p.realQty) || 0) < Number(p.stockMin);
}

// ---------------------------------------------------------------- lignes et totaux

/** Prix unitaire qui compte dans le total du panier : PA, sinon PV HTVA (signalé). */
export function lineUnitCost(l: Pick<BasketLine, 'purchasePrice' | 'salePriceHt'>): { unit: number; fromSalePrice: boolean } {
  if (l.purchasePrice != null && l.purchasePrice > 0) return { unit: l.purchasePrice, fromSalePrice: false };
  if (l.salePriceHt != null && l.salePriceHt > 0) return { unit: l.salePriceHt, fromSalePrice: true };
  return { unit: 0, fromSalePrice: false };
}

export function lineAmountHt(l: Pick<BasketLine, 'qty' | 'purchasePrice' | 'salePriceHt'>): number {
  return r2((Number(l.qty) || 0) * lineUnitCost(l).unit);
}

export type BasketTotals = { totalHt: number; lineCount: number; qty: number; noPa: number; forClients: number };

export function basketTotals(lines: Pick<BasketLine, 'qty' | 'purchasePrice' | 'salePriceHt' | 'contactId'>[]): BasketTotals {
  let totalHt = 0; let qty = 0; let noPa = 0; let forClients = 0;
  for (const l of lines) {
    totalHt += lineAmountHt(l);
    qty += Number(l.qty) || 0;
    if (lineUnitCost(l).fromSalePrice || lineUnitCost(l).unit === 0) noPa++;
    if (l.contactId) forClients++;
  }
  return { totalHt: r2(totalHt), lineCount: lines.length, qty: r3(qty), noPa, forClients };
}

/** « Enlever ce qui est déjà en stock » : garde les lignes dont le stock réel ne couvre pas la quantité. */
export function removeInStock<T extends Pick<BasketLine, 'qty' | 'realQtyNow'>>(lines: T[]): { kept: T[]; removed: T[] } {
  const kept: T[] = []; const removed: T[] = [];
  for (const l of lines) ((Number(l.realQtyNow) || 0) >= (Number(l.qty) || 0) ? removed : kept).push(l);
  return { kept, removed };
}

// ---------------------------------------------------------------- règles à la validation

export type BasketIssueCode = 'no_lines' | 'below_min' | 'daily_limit' | 'kind_disabled' | 'no_rule' | 'no_pa';
export type BasketIssue = { code: BasketIssueCode; min?: number; total?: number; max?: number; count?: number };

export type BasketCheckInput = {
  kind: BasketKind;
  totalHt: number;
  lineCount: number;
  /** paniers du même type déjà commandés aujourd'hui (société) */
  orderedToday?: number;
  /** lignes sans prix d'achat connu */
  noPa?: number;
};

export type BasketCheckResult = {
  ok: boolean;
  minHt: number | null;
  surchargePct: number;
  errors: BasketIssue[];
  notices: BasketIssue[];
};

/** Code de règle (Paramètres → Tables → Règles des types de commande) qui sert à un type de panier. */
export function ruleCodeFor(kind: BasketKind): string {
  return kind === 'demo' ? 'excel' : kind;
}

/** Même logique que la fonction SQL basket_check. */
export function checkBasket(input: BasketCheckInput, rules: OrderRule[]): BasketCheckResult {
  const errors: BasketIssue[] = [];
  const notices: BasketIssue[] = [];
  if (input.lineCount === 0) errors.push({ code: 'no_lines' });
  if ((input.noPa ?? 0) > 0) notices.push({ code: 'no_pa', count: input.noPa });
  const code = ruleCodeFor(input.kind);
  const r = rules.find((x) => x.code.toLowerCase() === code);
  if (!r || !r.configured) {
    notices.push({ code: 'no_rule' });
    return { ok: errors.length === 0, minHt: null, surchargePct: 0, errors, notices };
  }
  if (!r.isActive) {
    errors.push({ code: 'kind_disabled' });
    return { ok: false, minHt: null, surchargePct: 0, errors, notices };
  }
  const minHt = input.kind === 'demo' ? null : r.minHt;
  if (minHt != null && minHt > 0 && input.totalHt < minHt) errors.push({ code: 'below_min', min: minHt, total: input.totalHt });
  if (r.maxPerDay != null && r.maxPerDay > 0 && (input.orderedToday ?? 0) >= r.maxPerDay) errors.push({ code: 'daily_limit', max: r.maxPerDay });
  return { ok: errors.length === 0, minHt, surchargePct: r.surchargePct, errors, notices };
}

// ---------------------------------------------------------------- urgente : +12 %

/** Supplément du type (Paramètres ; urgente 12 % par défaut depuis M-78). */
export function basketSurchargePct(kind: BasketKind, rules: OrderRule[]): number {
  const r = rules.find((x) => x.code.toLowerCase() === ruleCodeFor(kind));
  return r && r.isActive && r.configured ? r.surchargePct : 0;
}

/**
 * Prix de vente HTVA facturé au client pour une ligne : supplément du panier appliqué seulement aux
 * lignes commandées POUR UN CLIENT (une ligne pour le stock garde le prix de vente de la fiche).
 * Le prix d'achat n'est jamais touché.
 */
export function clientSalePriceHt(l: Pick<BasketLine, 'salePriceHt' | 'contactId'>, surchargePct: number): number | null {
  if (l.salePriceHt == null) return null;
  if (!l.contactId) return r2(l.salePriceHt);
  return r2(l.salePriceHt * (1 + (Number(surchargePct) || 0) / 100));
}

// ---------------------------------------------------------------- numéro DCS, statuts

/** Le numéro donné par le DCS se saisit après la validation (panier commandé ou reçu). */
export function canSetDcsNumber(status: BasketStatus): boolean {
  return status === 'commande' || status === 'recu';
}

export function canEditLines(status: BasketStatus): boolean {
  return status === 'ouvert';
}

/** Filtre de la liste « Toutes nos commandes » : statut, type, période (date de commande ou de création). */
export type BasketListFilter = { status?: BasketStatus | 'all'; kind?: BasketKind | 'all'; from?: string | null; to?: string | null };

export function filterBaskets<T extends Pick<SupplierBasket, 'status' | 'kind' | 'ordered_at' | 'created_at'>>(rows: T[], f: BasketListFilter): T[] {
  return rows.filter((b) => {
    if (f.status && f.status !== 'all' && b.status !== f.status) return false;
    if (f.kind && f.kind !== 'all' && b.kind !== f.kind) return false;
    const d = (b.ordered_at ?? b.created_at).slice(0, 10);
    if (f.from && d < f.from) return false;
    if (f.to && d > f.to) return false;
    return true;
  });
}

export function countBaskets<T extends Pick<SupplierBasket, 'status' | 'kind' | 'total_ht'>>(rows: T[]): { byStatus: Record<string, number>; byKind: Record<string, number>; totalHt: number } {
  const byStatus: Record<string, number> = {}; const byKind: Record<string, number> = {}; let totalHt = 0;
  for (const b of rows) {
    byStatus[b.status] = (byStatus[b.status] ?? 0) + 1;
    byKind[b.kind] = (byKind[b.kind] ?? 0) + 1;
    if (b.status === 'commande' || b.status === 'recu') totalHt += Number(b.total_ht) || 0;
  }
  return { byStatus, byKind, totalHt: r2(totalHt) };
}

// ---------------------------------------------------------------- fichier ExportDucati (contenu)

export const EXPORT_HEADERS = ['Line Number', 'Product Code', 'Day', 'Month', 'Year', 'Quantity'] as const;
/** Première ligne de données (1 = en-têtes, 2-3 vides, comme la capture G8). */
export const EXPORT_FIRST_ROW = 4;

export type ExportRow = { lineNumber: number; productCode: string; day: number; month: number; year: number; quantity: number; client: string | null };

/** Nom du fichier : ExportDucati.xls (standard) / ExportDucati_URGENTE.xls (urgente). */
export function exportFileName(kind: BasketKind): string {
  return kind === 'urgente' ? 'ExportDucati_URGENTE.xls' : kind === 'demo' ? 'ExportDucati_DEMO.xls' : 'ExportDucati.xls';
}

/** NOM PRENOM en majuscules pour la colonne G (société si personne morale). */
export function exportClientName(c: { lastName?: string | null; firstName?: string | null; companyName?: string | null } | null | undefined): string | null {
  if (!c) return null;
  const person = [c.lastName, c.firstName].map((s) => (s ?? '').trim()).filter(Boolean).join(' ');
  const v = person || (c.companyName ?? '').trim();
  return v ? v.toUpperCase() : null;
}

/**
 * Lignes du fichier : numéro 1..n, référence, jour / mois / année de la commande (nombres),
 * quantité ; colonne G = nom du client pour les lignes commandées pour un client, vide sinon.
 * Une ligne du fichier par ligne du panier (la même référence peut revenir : une par client).
 */
export function exportRows(lines: Pick<BasketLine, 'reference' | 'qty' | 'contactLabel'>[], orderedAt: Date): ExportRow[] {
  const day = orderedAt.getDate(); const month = orderedAt.getMonth() + 1; const year = orderedAt.getFullYear();
  return lines.map((l, i) => ({
    lineNumber: i + 1,
    productCode: (l.reference ?? '').trim(),
    day, month, year,
    quantity: Number(l.qty) || 0,
    client: l.contactLabel ? l.contactLabel.toUpperCase() : null,
  }));
}

/** Grille (array of arrays) telle qu'elle est écrite dans la feuille : ligne 1 en-têtes, 2-3 vides, données dès la 4. */
export function exportGrid(rows: ExportRow[]): (string | number)[][] {
  const grid: (string | number)[][] = [[...EXPORT_HEADERS], [], []];
  for (const r of rows) {
    const cells: (string | number)[] = [r.lineNumber, r.productCode, r.day, r.month, r.year, r.quantity];
    if (r.client) cells.push(r.client);
    grid.push(cells);
  }
  return grid;
}
