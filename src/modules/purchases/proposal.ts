/**
 * M4 — Proposition de commande (mission 02, carte 4 ; parité G8 « Rappel proposition de commande »).
 * Règles pures, testées par tests/purchases-proposal.test.ts :
 *  - regroupement par fournisseur des pièces des commandes de pièces validées, pas encore
 *    commandées chez un fournisseur, filtré par type (urgente / standard / excel / accident…) ;
 *  - montant HTVA au PRIX D'ACHAT (PA de la fiche article, sinon PAMP ; inconnu = signalé) ;
 *  - minimum de commande et franco de port du fournisseur : atteint / manquant (reste) / non réglé ;
 *  - fournisseur DCS (Ducati) : fichier URGENTE pour les commandes urgentes, STANDARD pour les autres ;
 *  - « en commande » d'une ligne fournisseur : seule la part qui n'est pas déjà comptée par une
 *    commande de pièces (non-double comptage, même règle que la fonction SQL article_on_order_for).
 */

export type ProposalRow = {
  line_id: string; order_id: string; order_number: string | null; order_kind: string; dispatch_status: string;
  paid: boolean; validated_at: string | null; contact_id: string | null; contact_name: string | null;
  source_document_id: string | null; source_document_number: string | null; source_document_type: string | null;
  article_id: string | null; reference: string | null; supplier_ref: string | null; designation: string;
  supplier_id: string | null; supplier_name: string | null; supplier_email: string | null;
  supplier_order_min: number | null; supplier_franco_min: number | null; supplier_is_dcs: boolean;
  qty_client: number; qty_shop: number; purchase_price: number | null; sale_price_ht: number; vat_rate: number;
};

export type DcsKind = 'STANDARD' | 'URGENTE';
export type ThresholdState = 'unset' | 'met' | 'missing';
export type Threshold = { state: ThresholdState; min: number | null; rest: number };

export type SupplierGroup = {
  key: string;                    // id du fournisseur ou '__none__'
  supplierId: string | null;
  name: string | null;
  email: string | null;
  orderMin: number | null;
  francoMin: number | null;
  isDcs: boolean;
  lines: ProposalRow[];
  totalHt: number;                // Σ qté × PA (lignes connues)
  missingPa: number;              // nombre de lignes sans prix d'achat connu
  byKind: Record<string, number>; // montant HTVA par type de commande
};

export const NO_SUPPLIER = '__none__';

const r2 = (n: number) => Math.round(n * 100) / 100;

export const lineQty = (l: Pick<ProposalRow, 'qty_client' | 'qty_shop'>) => (Number(l.qty_client) || 0) + (Number(l.qty_shop) || 0);

/** Montant HTVA d'achat d'une ligne ; null si le prix d'achat est inconnu. */
export function lineAmount(l: Pick<ProposalRow, 'qty_client' | 'qty_shop' | 'purchase_price'>): number | null {
  if (l.purchase_price == null || !(Number(l.purchase_price) > 0)) return null;
  return r2(lineQty(l) * Number(l.purchase_price));
}

/** Une commande Excel garde son circuit (classeur Ducati) : jamais convertie ici. */
export const isExcel = (l: Pick<ProposalRow, 'order_kind'>) => l.order_kind === 'excel';

/** Lignes pré-cochées : commande payée (ou à envoyer), hors Excel, avec un fournisseur. */
export function defaultSelected(l: Pick<ProposalRow, 'order_kind' | 'dispatch_status' | 'supplier_id'>): boolean {
  return !isExcel(l) && !!l.supplier_id && (l.dispatch_status === 'payee' || l.dispatch_status === 'a_envoyer');
}

/** Fichier DCS d'une ligne (fournisseur Ducati) : urgente → URGENTE, tout le reste → STANDARD. */
export const dcsKindOf = (orderKind: string): DcsKind => (orderKind === 'urgente' ? 'URGENTE' : 'STANDARD');

export function splitDcs<T extends Pick<ProposalRow, 'order_kind'>>(lines: T[]): Record<DcsKind, T[]> {
  const out: Record<DcsKind, T[]> = { STANDARD: [], URGENTE: [] };
  for (const l of lines) out[dcsKindOf(l.order_kind)].push(l);
  return out;
}

/** Minimum de commande ou franco : non réglé, atteint, ou ce qu'il manque. */
export function thresholdState(total: number, min: number | null | undefined): Threshold {
  const m = min == null ? null : Number(min);
  if (m == null || !(m > 0)) return { state: 'unset', min: null, rest: 0 };
  const rest = r2(m - total);
  return rest > 0 ? { state: 'missing', min: m, rest } : { state: 'met', min: m, rest: 0 };
}

/** Totaux d'un ensemble de lignes (sélection ou groupe entier). */
export function totalsOf(lines: ProposalRow[]) {
  let totalHt = 0; let missingPa = 0;
  const byKind: Record<string, number> = {};
  for (const l of lines) {
    const a = lineAmount(l);
    if (a == null) { missingPa++; continue; }
    totalHt += a;
    byKind[l.order_kind] = r2((byKind[l.order_kind] ?? 0) + a);
  }
  return { totalHt: r2(totalHt), missingPa, byKind };
}

/**
 * Regroupe les lignes par fournisseur. `kind` = filtre par type ('all' ou absent = tout).
 * Tri : fournisseurs par nom, « sans fournisseur » en dernier ; lignes dans l'ordre reçu.
 */
export function groupBySupplier(rows: ProposalRow[], kind?: string | null): SupplierGroup[] {
  const map = new Map<string, SupplierGroup>();
  for (const r of rows) {
    if (kind && kind !== 'all' && r.order_kind !== kind) continue;
    const key = r.supplier_id ?? NO_SUPPLIER;
    let g = map.get(key);
    if (!g) {
      g = {
        key, supplierId: r.supplier_id, name: r.supplier_name, email: r.supplier_email,
        orderMin: r.supplier_order_min == null ? null : Number(r.supplier_order_min),
        francoMin: r.supplier_franco_min == null ? null : Number(r.supplier_franco_min),
        isDcs: !!r.supplier_is_dcs && !!r.supplier_id, lines: [], totalHt: 0, missingPa: 0, byKind: {},
      };
      map.set(key, g);
    }
    g.lines.push(r);
  }
  const groups = [...map.values()].map((g) => ({ ...g, ...totalsOf(g.lines) }));
  return groups.sort((a, b) => {
    if (a.key === NO_SUPPLIER) return 1;
    if (b.key === NO_SUPPLIER) return -1;
    return (a.name ?? '').localeCompare(b.name ?? '', 'fr');
  });
}

/** Compteurs par type (tous fournisseurs) pour les boutons du filtre. */
export function countByKind(rows: ProposalRow[]): Record<string, number> {
  const out: Record<string, number> = { all: rows.length };
  for (const r of rows) out[r.order_kind] = (out[r.order_kind] ?? 0) + 1;
  return out;
}

/**
 * « En commande » d'une ligne de commande fournisseur pour le stock : la quantité commandée
 * MOINS les pièces des commandes de pièces reliées (non annulées), déjà comptées par la
 * commande de pièces (client ou magasin). Jamais négatif. Reçue = plus rien en commande.
 */
export function purchaseLineStockQty(p: { quantity: number; linkedPartQty: number; received: boolean }): number {
  if (p.received) return 0;
  return Math.max((Number(p.quantity) || 0) - (Number(p.linkedPartQty) || 0), 0);
}

// ---------------------------------------------------------------- fichiers joints (CSV)

function csvCell(v: unknown): string {
  const s = String(v ?? '');
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const num2 = (n: number) => n.toFixed(2).replace('.', ',');

export type SupplierFileLine = { reference: string; supplierRef: string; designation: string; qty: number; unitPrice: number | null };

/** Une ligne par article (plusieurs clients cumulés), comme la commande fournisseur créée. */
export function aggregateForSupplier(lines: ProposalRow[]): SupplierFileLine[] {
  const map = new Map<string, SupplierFileLine>();
  for (const l of lines) {
    const key = l.article_id ?? `line:${l.line_id}`;
    const cur = map.get(key);
    if (cur) { cur.qty += lineQty(l); continue; }
    map.set(key, {
      reference: l.reference ?? '', supplierRef: l.supplier_ref || l.reference || '', designation: l.designation,
      qty: lineQty(l), unitPrice: l.purchase_price != null && Number(l.purchase_price) > 0 ? Number(l.purchase_price) : null,
    });
  }
  return [...map.values()].sort((a, b) => a.reference.localeCompare(b.reference, 'fr'));
}

/** CSV (séparateur ';', BOM UTF-8 pour Excel). Demande de prix : sans colonne de prix. */
export function buildSupplierCsv(lines: SupplierFileLine[], withPrices: boolean, headers: string[]): string {
  const rows = lines.map((l) => {
    const cells: unknown[] = [l.supplierRef, l.reference, l.designation, l.qty];
    if (withPrices) cells.push(l.unitPrice == null ? '' : num2(l.unitPrice), l.unitPrice == null ? '' : num2(l.qty * l.unitPrice));
    return cells.map(csvCell).join(';');
  });
  const head = withPrices ? headers : headers.slice(0, 4);
  return '﻿' + [head.map(csvCell).join(';'), ...rows].join('\r\n');
}
