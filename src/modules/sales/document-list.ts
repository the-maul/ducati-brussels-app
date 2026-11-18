/**
 * M6 — Liste des documents de vente (G8 « Liste des factures », « Rappel facture », « Documents
 * clients »), règles pures : filtres, exercice, totaux, panier moyen, marge, résumé des règlements,
 * lignes d'export. Lot rattrapage G8 du 18/11/2026 (bloquant #9 de la comparaison).
 * Aucune lecture en base ici : voir `document-list-api.ts`.
 */

/** Types de la « Liste des factures » : G8 a un seul compteur pour Express, facture et avoir. */
export const INVOICE_LIST_DOC_TYPES = ['FAC', 'TIK', 'AVO', 'FAA'] as const;

export type FiscalChoice = 'current' | 'previous' | 'all';
export type ClientKind = 'all' | 'pro' | 'public';
export type TransferFilter = 'all' | 'done' | 'pending';
export type DocListSort = 'date_desc' | 'date_asc' | 'number_asc' | 'number_desc' | 'amount_desc';

export type DocListFilters = {
  docTypes: string[];
  includeDrafts?: boolean;
  statuses?: string[];
  fiscal: FiscalChoice;
  dateFrom: string;
  dateTo: string;
  numberFrom: string;
  numberTo: string;
  amountMin: string;
  amountMax: string;
  contactId: string | null;
  operatorUserId: string | null;
  clientKind: ClientKind;
  transfer: TransferFilter;
  search: string;
  sort: DocListSort;
};

export const emptyDocListFilters = (docTypes: readonly string[] = INVOICE_LIST_DOC_TYPES): DocListFilters => ({
  docTypes: [...docTypes], fiscal: 'current', dateFrom: '', dateTo: '', numberFrom: '', numberTo: '',
  amountMin: '', amountMax: '', contactId: null, operatorUserId: null, clientKind: 'all', transfer: 'all',
  search: '', sort: 'date_desc',
});

export type DocListPayment = { method: string; amount: number; status: string };

export type DocListRow = {
  id: string; doc_type: string; number: string | null; legacy_number: string | null; status: string;
  issue_date: string; due_date: string | null; created_at: string | null;
  contact_id: string | null; contact_name: string | null; contact_code: string | null; contact_kind: string | null;
  operator: string | null; operator_user_id: string | null;
  total_ht: number; total_vat: number; total_ttc: number; paid_amount: number;
  due: number; discount: number; deposit: number; margin: number | null;
  tax_exempt: boolean; condition_reglement: string | null; compta_transferred: boolean; date_transfert: string | null;
  notes: string | null; source_document_id: string | null; vehicle_id: string | null;
  payments: DocListPayment[];
};

export type DocListTotals = {
  count: number; salesCount: number; ht: number; vat: number; ttc: number; salesHt: number; salesTtc: number;
  due: number; discount: number; deposit: number; margin: number | null;
};

export type DocListPage = { total: number; rows: DocListRow[]; totals: DocListTotals; marginExact: boolean };

const r2 = (n: number) => Math.round(n * 100) / 100;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Exercice en dates (année civile, voir « À trancher » : G8 a ses propres exercices) :
 * courant = du 1er janvier de l'année en cours, antérieurs = jusqu'au 31 décembre précédent.
 * Les dates saisies à la main restreignent encore la période.
 */
export function fiscalBounds(choice: FiscalChoice, today: Date = new Date()): { from: string | null; to: string | null } {
  const y = today.getFullYear();
  if (choice === 'current') return { from: `${y}-01-01`, to: null };
  if (choice === 'previous') return { from: null, to: `${y - 1}-12-31` };
  return { from: null, to: null };
}

const maxIso = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);
const minIso = (a: string | null, b: string | null) => (!a ? b : !b ? a : a < b ? a : b);
const parseAmount = (s: string): number | null => {
  const v = s.trim().replace(/\s/g, '').replace(',', '.');
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Filtres de l'écran → paramètres JSON de `sales_document_list` (exercice traduit en dates). */
export function filtersToRpc(f: DocListFilters, today: Date = new Date()): Record<string, unknown> {
  const fy = fiscalBounds(f.fiscal, today);
  const from = maxIso(fy.from, f.dateFrom || null);
  const to = minIso(fy.to, f.dateTo || null);
  const out: Record<string, unknown> = { doc_types: f.docTypes, sort: f.sort };
  if (f.includeDrafts) out.include_drafts = true;
  if (f.statuses?.length) out.statuses = f.statuses;
  if (from) out.date_from = from;
  if (to) out.date_to = to;
  if (f.numberFrom.trim()) out.number_from = f.numberFrom.trim();
  if (f.numberTo.trim()) out.number_to = f.numberTo.trim();
  const amin = parseAmount(f.amountMin); if (amin != null) out.amount_min = amin;
  const amax = parseAmount(f.amountMax); if (amax != null) out.amount_max = amax;
  if (f.contactId) out.contact_id = f.contactId;
  if (f.operatorUserId) out.operator_user_id = f.operatorUserId;
  if (f.clientKind !== 'all') out.client_kind = f.clientKind;
  if (f.transfer !== 'all') out.transfer = f.transfer;
  if (f.search.trim()) out.search = f.search.trim();
  return out;
}

/** Nombre de filtres actifs (hors types et tri), pour le bouton « Filtres (n) ». */
export function countDocListFilters(f: DocListFilters): number {
  let n = 0;
  if (f.fiscal !== 'current') n++;
  if (f.dateFrom || f.dateTo) n++;
  if (f.numberFrom || f.numberTo) n++;
  if (f.amountMin || f.amountMax) n++;
  if (f.contactId) n++;
  if (f.operatorUserId) n++;
  if (f.clientKind !== 'all') n++;
  if (f.transfer !== 'all') n++;
  return n;
}

/** % de marge sur le HT (G8 « % Marge ») ; null si pas de marge connue ou HT nul. */
export function marginPct(margin: number | null | undefined, ht: number): number | null {
  if (margin == null || !Number.isFinite(margin) || Math.abs(ht) < 0.005) return null;
  return r2((margin / ht) * 100);
}

/** Panier moyen G8 : total des ventes (avoirs exclus) / nombre de ventes. */
export function averageBasket(t: Pick<DocListTotals, 'salesCount' | 'salesHt' | 'salesTtc'>): { ht: number; ttc: number } {
  if (!t.salesCount) return { ht: 0, ttc: 0 };
  return { ht: r2(t.salesHt / t.salesCount), ttc: r2(t.salesTtc / t.salesCount) };
}

/** Reste dû d'un document (un avoir n'est jamais « dû »). */
export function docDue(d: { doc_type: string; total_ttc: number; paid_amount: number }): number {
  if (d.doc_type === 'AVO') return 0;
  return Math.max(0, r2(Number(d.total_ttc) - Number(d.paid_amount)));
}

/**
 * Totaux d'un lot de lignes (repli sans la fonction SQL, ou sélection de l'écran) : mêmes règles
 * que `sales_document_list`. `marginKnown` = false si une ligne n'a pas de marge.
 */
export function totalsOf(rows: Pick<DocListRow, 'doc_type' | 'total_ht' | 'total_vat' | 'total_ttc' | 'due' | 'discount' | 'deposit' | 'margin'>[]): DocListTotals {
  const sales = rows.filter((r) => r.doc_type !== 'AVO');
  const sum = (xs: typeof rows, k: 'total_ht' | 'total_vat' | 'total_ttc' | 'due' | 'discount' | 'deposit') => r2(xs.reduce((s, r) => s + (Number(r[k]) || 0), 0));
  const marginKnown = rows.every((r) => r.margin != null);
  return {
    count: rows.length, salesCount: sales.length,
    ht: sum(rows, 'total_ht'), vat: sum(rows, 'total_vat'), ttc: sum(rows, 'total_ttc'),
    salesHt: sum(sales, 'total_ht'), salesTtc: sum(sales, 'total_ttc'),
    due: sum(rows, 'due'), discount: sum(rows, 'discount'), deposit: sum(rows, 'deposit'),
    margin: marginKnown ? r2(rows.reduce((s, r) => s + Number(r.margin ?? 0), 0)) : null,
  };
}

/** Règlements en une ligne (G8 « Règlements ») : « ESP 10,00 · CB 5,00 (attendu) ». */
export function paymentsSummary(payments: DocListPayment[], label: (code: string) => string = (c) => c, expectedLabel = ''): string {
  const byKey = new Map<string, number>();
  for (const p of payments) {
    if (!Number(p.amount)) continue;
    const key = `${p.method}|${p.status === 'attendu' ? 'a' : 'r'}`;
    byKey.set(key, r2((byKey.get(key) ?? 0) + Number(p.amount)));
  }
  return [...byKey.entries()].map(([k, amount]) => {
    const [method, st] = k.split('|');
    return `${label(method)} ${amount.toFixed(2).replace('.', ',')}${st === 'a' && expectedLabel ? ` (${expectedLabel})` : ''}`;
  }).join(' · ');
}

/** Numéro affiché : numéro du DMS, sinon numéro G8 repris. */
export const displayNumber = (r: Pick<DocListRow, 'number' | 'legacy_number'>): string => r.number ?? r.legacy_number ?? '';

/**
 * Comparaison de numéros pour une plage « du n° … au n° … » côté écran : même règle que la base
 * (texte), en ignorant la casse. Les numéros d'une même série (FAC-2026-00012) se comparent bien ;
 * entre séries, la plage n'a pas de sens.
 */
export function inNumberRange(num: string, from: string, to: string): boolean {
  const n = num.toUpperCase();
  if (from.trim() && n < from.trim().toUpperCase()) return false;
  if (to.trim() && n > to.trim().toUpperCase()) return false;
  return true;
}

/** Ligne d'export Excel (en-têtes déjà traduits par l'appelant, valeurs brutes). */
export type ExportColumn = { key: string; header: string; value: (r: DocListRow) => string | number | null };

/** Feuille « tableau de tableaux » prête pour SheetJS (`aoa_to_sheet`). */
export function exportAoa(rows: DocListRow[], columns: ExportColumn[]): (string | number | null)[][] {
  return [columns.map((c) => c.header), ...rows.map((r) => columns.map((c) => c.value(r)))];
}

/** Date AAAA-MM-JJ du jour (fuseau local). */
export const todayIso = (d: Date = new Date()): string => iso(d);
