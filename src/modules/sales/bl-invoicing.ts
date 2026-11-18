/**
 * M6 — Facturation groupée des bons de livraison (G8 « Utilitaires factures › Génération des
 * factures par B.L. client », parcours 17). Règles pures : regroupement par client, lignes de la
 * facture (une ligne d'en-tête « Livraison N° … du … » par BL, comme G8), pied de chaque BL replié
 * sur ses lignes, majoration fixe ou en %, échéance d'après la condition de règlement.
 * Lot rattrapage G8 du 18/11/2026 (bloquant #10 de la comparaison).
 */
import type { LineInput } from './write-api';

export type BlCandidate = {
  id: string;
  number: string | null;
  issue_date: string;
  contact_id: string | null;
  contact_name: string | null;
  condition_reglement: string | null;
  total_ht: number;
  total_ttc: number;
  paid_amount: number;
  operator: string | null;
  tax_exempt: boolean;
  /** Régime de TVA du BL (marge pour une moto O, B2) : jamais mélangé avec un régime normal. */
  vat_scheme: 'normal' | 'marge';
  notes: string | null;
};

/** Pied d'un BL (remise globale, port) tel qu'enregistré. */
export type BlPied = {
  global_discount_pct: number;
  global_discount_amount: number;
  shipping_ht: number;
  shipping_taxed: boolean;
  shipping_vat_rate: number;
};

export type BlInvoicingParams = {
  invoiceDate: string;                 // AAAA-MM-JJ
  priceMode: 'ht' | 'ttc';
  /** Condition de règlement appliquée à toutes les factures générées (libellé), null = celle du BL. */
  paymentCondition: string | null;
  /** Échéance : jours et fin de mois de la condition choisie (Paramètres → Tables). */
  paymentDays: number | null;
  paymentEndOfMonth: boolean;
  surchargeFixedHt: number;
  surchargePct: number;
  /** Une facture par BL (pas de regroupement). */
  onePerBl: boolean;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Clé de regroupement : même client, même détaxe, même régime de TVA (sinon la facture serait fausse). */
export const groupKey = (b: Pick<BlCandidate, 'contact_id' | 'tax_exempt' | 'vat_scheme'>): string =>
  `${b.contact_id ?? '-'}|${b.tax_exempt ? 'detaxe' : 'normal'}|${b.vat_scheme}`;

/**
 * Factures à générer : une par BL, ou une par client (et par détaxe / régime de TVA), BL triés
 * par date puis par numéro dans chaque facture.
 */
export function groupDeliveryNotes<T extends BlCandidate>(bls: T[], onePerBl: boolean): T[][] {
  const sorted = [...bls].sort((a, b) => a.issue_date.localeCompare(b.issue_date) || String(a.number ?? '').localeCompare(String(b.number ?? '')));
  if (onePerBl) return sorted.map((b) => [b]);
  const groups = new Map<string, T[]>();
  for (const b of sorted) {
    const k = groupKey(b);
    const g = groups.get(k) ?? [];
    g.push(b);
    groups.set(k, g);
  }
  return [...groups.values()];
}

const dmy = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${y}`; };

/** Ligne d'en-tête d'un BL dans la facture (G8 : « LIVRAISON N°4000000 DU 18/11/2026 »). */
export function blHeaderLine(bl: Pick<BlCandidate, 'number' | 'issue_date'>, template: string): LineInput {
  return {
    article_id: null, line_type: 'texte', quantity: 0, unit_price_ht: 0, vat_rate: 0, discount_pct: 0,
    designation: template.replace('{number}', bl.number ?? '').replace('{date}', dmy(bl.issue_date)),
  };
}

/** Remise de ligne combinée (remise de ligne puis remise globale du BL) : 1 − (1 − a)(1 − b). */
export const combineDiscount = (linePct: number, globalPct: number): number =>
  r2((1 - (1 - (linePct || 0) / 100) * (1 - (globalPct || 0) / 100)) * 100);

/**
 * Lignes d'un BL recopiées dans la facture groupée, son pied replié dessus (le pied de la facture
 * groupée est neutre) : remise globale en % reportée sur chaque ligne ; remise en montant convertie
 * en % du HT des lignes ; frais de port en ligne à part (taux du port, 0 % si non taxé).
 */
export function blLinesForInvoice(lines: LineInput[], pied: BlPied, shippingLabel: string): LineInput[] {
  const amountLines = lines.filter((l) => l.line_type !== 'texte' && l.line_type !== 'vide');
  const linesHt = amountLines.reduce((s, l) => s + l.quantity * l.unit_price_ht * (1 - (l.discount_pct || 0) / 100), 0);
  const globalPct = pied.global_discount_pct > 0
    ? pied.global_discount_pct
    : (pied.global_discount_amount > 0 && Math.abs(linesHt) > 0.005 ? (pied.global_discount_amount / linesHt) * 100 : 0);
  const out = lines.map((l) => (l.line_type === 'texte' || l.line_type === 'vide' || !globalPct
    ? { ...l }
    : { ...l, discount_pct: combineDiscount(l.discount_pct, globalPct) }));
  if (pied.shipping_ht > 0) {
    out.push({
      article_id: null, line_type: 'article', designation: shippingLabel, quantity: 1,
      unit_price_ht: r2(pied.shipping_ht), vat_rate: pied.shipping_taxed ? pied.shipping_vat_rate : 0, discount_pct: 0,
    });
  }
  return out;
}

/** HT des lignes avec montant (base de la majoration en %). */
export function linesHtOf(lines: LineInput[]): number {
  return r2(lines.filter((l) => l.line_type !== 'texte' && l.line_type !== 'vide')
    .reduce((s, l) => s + l.quantity * l.unit_price_ht * (1 - (l.discount_pct || 0) / 100), 0));
}

/** Taux de TVA le plus représenté (en HT) : celui de la ligne de majoration. */
export function dominantVatRate(lines: LineInput[], fallback = 21): number {
  const byRate = new Map<number, number>();
  for (const l of lines) {
    if (l.line_type === 'texte' || l.line_type === 'vide') continue;
    byRate.set(l.vat_rate, (byRate.get(l.vat_rate) ?? 0) + Math.abs(l.quantity * l.unit_price_ht));
  }
  let best = fallback, max = -1;
  for (const [rate, ht] of byRate) if (ht > max) { best = rate; max = ht; }
  return best;
}

/** Ligne de majoration (fixe HT + % du HT des lignes), null si aucune. */
export function surchargeLine(lines: LineInput[], p: Pick<BlInvoicingParams, 'surchargeFixedHt' | 'surchargePct'>, label: string): LineInput | null {
  const amount = r2((p.surchargeFixedHt || 0) + linesHtOf(lines) * (p.surchargePct || 0) / 100);
  if (Math.abs(amount) < 0.005) return null;
  return { article_id: null, line_type: 'article', designation: label, quantity: 1, unit_price_ht: amount, vat_rate: dominantVatRate(lines), discount_pct: 0 };
}

/** Échéance d'après la condition : date + jours, puis fin de mois si demandé. */
export function dueDateFor(invoiceDate: string, days: number | null, endOfMonth: boolean): string | null {
  if (days == null && !endOfMonth) return null;
  const d = new Date(`${invoiceDate}T12:00:00`);
  d.setDate(d.getDate() + (days ?? 0));
  if (endOfMonth) { d.setMonth(d.getMonth() + 1, 0); }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Totaux de la sélection (bandeau de l'écran G8 : lignes sélectionnées, HT, TTC, acomptes). */
export function selectionTotals(bls: Pick<BlCandidate, 'total_ht' | 'total_ttc' | 'paid_amount'>[]): { count: number; ht: number; ttc: number; deposit: number } {
  return {
    count: bls.length,
    ht: r2(bls.reduce((s, b) => s + Number(b.total_ht), 0)),
    ttc: r2(bls.reduce((s, b) => s + Number(b.total_ttc), 0)),
    deposit: r2(bls.reduce((s, b) => s + Number(b.paid_amount), 0)),
  };
}
