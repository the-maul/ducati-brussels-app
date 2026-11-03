/**
 * M6 (POS) — Journal Z = journal des recettes (PDV010, 03/11/2026). Logique pure, sans Supabase.
 *
 * Le Z est calcule en base par `cash_z_report_session` (rapport X tant que la session est ouverte,
 * puis FIGE dans `cash_sessions.z_report` a la cloture : `parseZReport` ne recalcule rien, il lit).
 * Sources : AR n. 1 art. 14 par. 2 et art. 15 par. 4 (journal des recettes, lignes > 500 EUR TTC),
 * AR du 13/12/2022 (caisse enregistreuse assimilee au journal numerique : numero d ordre continu,
 * identification de la caisse, periode, totaux, reductions, remboursements, CA net TVAC).
 * Testee dans tests/caisse-legale.test.ts.
 */

export type ZVatLine = { vat_rate: number; base_ht: number; vat: number; ttc: number };
export type ZDocLine = { doc_type: string; count: number; total_ttc: number };
export type ZLargeItem = { number: string | null; doc_type: string; issue_date: string; designation: string; quantity: number; line_ttc: number };
export type ZPaymentLine = { method: string; label: string; sales: number; deposits: number; refunds: number; total: number };
export type ZMovement = { occurred_at: string; kind: string; method: string; amount: number; reason: string | null };

export type ZReport = {
  version: number;
  /** Numero d ordre (Z-2026-00001) ; null pour un rapport X. */
  number: string | null;
  register_code: string;
  company: { name: string; legal_name: string | null; vat_number: string | null; address: string | null; zip: string | null; city: string | null };
  session_id: string;
  opened_at: string;
  closed_at: string;
  opening_float: number;
  expected_cash: number;
  counted_cash: number | null;
  variance: number | null;
  variance_reason: string | null;
  documents: ZDocLine[];
  ticket_count: number;
  vat_breakdown: ZVatLine[];
  discounts_ht: number;
  refunds_ttc: number;
  net_sales_ttc: number;
  large_items: ZLargeItem[];
  payments_by_method: ZPaymentLine[];
  cash_in_esp: number;
  cash_out_esp: number;
  cash_in: number;
  cash_out: number;
  movements: ZMovement[];
};

const n = (v: unknown): number => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const nOrNull = (v: unknown): number | null => (v == null ? null : n(v));
const s = (v: unknown): string => (v == null ? '' : String(v));
const sOrNull = (v: unknown): string | null => (v == null ? null : String(v));
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);

/** Lit un journal Z (JSON de la base) sans rien recalculer : ce qui a ete fige est ce qui est affiche. */
export function parseZReport(raw: unknown): ZReport {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const co = (r.company && typeof r.company === 'object' ? r.company : {}) as Record<string, unknown>;
  return {
    version: n(r.version),
    number: sOrNull(r.number),
    register_code: s(r.register_code) || 'CAISSE-1',
    company: { name: s(co.name), legal_name: sOrNull(co.legal_name), vat_number: sOrNull(co.vat_number), address: sOrNull(co.address), zip: sOrNull(co.zip), city: sOrNull(co.city) },
    session_id: s(r.session_id),
    opened_at: s(r.opened_at),
    closed_at: s(r.closed_at),
    opening_float: n(r.opening_float),
    expected_cash: n(r.expected_cash),
    counted_cash: nOrNull(r.counted_cash),
    variance: nOrNull(r.variance),
    variance_reason: sOrNull(r.variance_reason),
    documents: arr(r.documents).map((d) => ({ doc_type: s(d.doc_type), count: n(d.count), total_ttc: n(d.total_ttc) })),
    ticket_count: n(r.ticket_count),
    vat_breakdown: arr(r.vat_breakdown).map((v) => ({ vat_rate: n(v.vat_rate), base_ht: n(v.base_ht), vat: n(v.vat), ttc: n(v.ttc) })),
    discounts_ht: n(r.discounts_ht),
    refunds_ttc: n(r.refunds_ttc),
    net_sales_ttc: n(r.net_sales_ttc),
    large_items: arr(r.large_items).map((l) => ({ number: sOrNull(l.number), doc_type: s(l.doc_type), issue_date: s(l.issue_date), designation: s(l.designation), quantity: n(l.quantity), line_ttc: n(l.line_ttc) })),
    payments_by_method: arr(r.payments_by_method).map((p) => ({ method: s(p.method), label: s(p.label) || s(p.method), sales: n(p.sales), deposits: n(p.deposits), refunds: n(p.refunds), total: n(p.total) })),
    cash_in_esp: n(r.cash_in_esp),
    cash_out_esp: n(r.cash_out_esp),
    cash_in: n(r.cash_in),
    cash_out: n(r.cash_out),
    movements: arr(r.movements).map((m) => ({ occurred_at: s(m.occurred_at), kind: s(m.kind), method: s(m.method), amount: n(m.amount), reason: sOrNull(m.reason) })),
  };
}

/** Un Z numerote est fige (cloture) ; un rapport X ne l est pas. */
export const isFrozenZ = (z: Pick<ZReport, 'number'>): boolean => !!z.number;

/** Tri par numero d ordre (Z-2026-00002 apres Z-2026-00001), les non numerotes a la fin. */
export function compareZNumber(a: string | null, b: string | null): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const pa = a.split('-'), pb = b.split('-');
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? '', y = pb[i] ?? '';
    const nx = Number(x), ny = Number(y);
    const c = Number.isFinite(nx) && Number.isFinite(ny) && x !== '' && y !== '' ? nx - ny : x.localeCompare(y);
    if (c !== 0) return c;
  }
  return 0;
}

/** Jour local (AAAA-MM-JJ) et mois (AAAA-MM) de cloture d un Z. */
export function zDay(z: Pick<ZReport, 'closed_at'>): string {
  const d = new Date(z.closed_at);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export const zMonth = (z: Pick<ZReport, 'closed_at'>): string => zDay(z).slice(0, 7);

/** Taux de TVA presents dans un lot de Z (colonnes du journal), tries. */
export function zVatRates(zs: ZReport[]): number[] {
  return [...new Set(zs.flatMap((z) => z.vat_breakdown.map((v) => v.vat_rate)))].sort((a, b) => a - b);
}

export type JournalRow = {
  number: string;
  day: string;
  register_code: string;
  ticket_count: number;
  /** Par taux : base HT, TVA, TTC. */
  byRate: Record<number, { base_ht: number; vat: number; ttc: number }>;
  discounts_ht: number;
  refunds_ttc: number;
  net_sales_ttc: number;
  byMethod: Record<string, number>;
  opening_float: number;
  expected_cash: number;
  counted_cash: number | null;
  variance: number | null;
  variance_reason: string | null;
};

/**
 * Journal des recettes : une ligne par Z (= par jour de caisse), triee par numero. Les rapports X
 * (non numerotes) sont ignores : seul un Z fige entre au journal.
 */
export function journalRows(zs: ZReport[]): JournalRow[] {
  return zs.filter(isFrozenZ)
    .sort((a, b) => compareZNumber(a.number, b.number))
    .map((z) => ({
      number: z.number as string,
      day: zDay(z),
      register_code: z.register_code,
      ticket_count: z.ticket_count,
      byRate: Object.fromEntries(z.vat_breakdown.map((v) => [v.vat_rate, { base_ht: v.base_ht, vat: v.vat, ttc: v.ttc }])),
      discounts_ht: z.discounts_ht,
      refunds_ttc: z.refunds_ttc,
      net_sales_ttc: z.net_sales_ttc,
      byMethod: Object.fromEntries(z.payments_by_method.map((p) => [p.method, p.total])),
      opening_float: z.opening_float,
      expected_cash: z.expected_cash,
      counted_cash: z.counted_cash,
      variance: z.variance,
      variance_reason: z.variance_reason,
    }));
}

/** Totaux d un lot de lignes de journal (pied du mois). */
export function journalTotals(rows: JournalRow[]): { ticket_count: number; byRate: Record<number, { base_ht: number; vat: number; ttc: number }>; discounts_ht: number; refunds_ttc: number; net_sales_ttc: number; byMethod: Record<string, number> } {
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const byRate: Record<number, { base_ht: number; vat: number; ttc: number }> = {};
  const byMethod: Record<string, number> = {};
  let tickets = 0, disc = 0, ref = 0, net = 0;
  for (const row of rows) {
    tickets += row.ticket_count; disc += row.discounts_ht; ref += row.refunds_ttc; net += row.net_sales_ttc;
    for (const [rate, v] of Object.entries(row.byRate)) {
      const k = Number(rate);
      const cur = byRate[k] ?? { base_ht: 0, vat: 0, ttc: 0 };
      byRate[k] = { base_ht: r2(cur.base_ht + v.base_ht), vat: r2(cur.vat + v.vat), ttc: r2(cur.ttc + v.ttc) };
    }
    for (const [m, v] of Object.entries(row.byMethod)) byMethod[m] = r2((byMethod[m] ?? 0) + v);
  }
  return { ticket_count: tickets, byRate, discounts_ht: r2(disc), refunds_ttc: r2(ref), net_sales_ttc: r2(net), byMethod };
}

const csvCell = (v: unknown): string => {
  const t = v == null ? '' : typeof v === 'number' ? String(Math.round(v * 100) / 100).replace('.', ',') : String(v);
  return /[";\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

/**
 * Export CSV du journal des recettes (separateur « ; », decimales a la virgule, Excel belge) :
 * une ligne par Z, colonnes par taux de TVA et par mode de reglement, pied de totaux.
 */
export function journalCsv(zs: ZReport[], labels: { number: string; day: string; register: string; tickets: string; base: string; vat: string; ttc: string; discounts: string; refunds: string; net: string; opening: string; expected: string; counted: string; variance: string; reason: string; total: string }): string {
  const rows = journalRows(zs);
  const rates = zVatRates(zs.filter(isFrozenZ));
  const methods = [...new Set(rows.flatMap((r) => Object.keys(r.byMethod)))].sort();
  const methodLabel = new Map<string, string>();
  for (const z of zs) for (const p of z.payments_by_method) methodLabel.set(p.method, p.label);
  const header = [labels.number, labels.day, labels.register, labels.tickets,
    ...rates.flatMap((r) => [`${labels.base} ${r}%`, `${labels.vat} ${r}%`, `${labels.ttc} ${r}%`]),
    labels.discounts, labels.refunds, labels.net,
    ...methods.map((m) => methodLabel.get(m) ?? m),
    labels.opening, labels.expected, labels.counted, labels.variance, labels.reason];
  const lines = rows.map((r) => [r.number, r.day, r.register_code, r.ticket_count,
    ...rates.flatMap((rate) => { const v = r.byRate[rate]; return [v?.base_ht ?? 0, v?.vat ?? 0, v?.ttc ?? 0]; }),
    r.discounts_ht, r.refunds_ttc, r.net_sales_ttc,
    ...methods.map((m) => r.byMethod[m] ?? 0),
    r.opening_float, r.expected_cash, r.counted_cash, r.variance, r.variance_reason]);
  const tot = journalTotals(rows);
  const footer = [labels.total, '', '', tot.ticket_count,
    ...rates.flatMap((rate) => { const v = tot.byRate[rate]; return [v?.base_ht ?? 0, v?.vat ?? 0, v?.ttc ?? 0]; }),
    tot.discounts_ht, tot.refunds_ttc, tot.net_sales_ttc,
    ...methods.map((m) => tot.byMethod[m] ?? 0),
    '', '', '', '', ''];
  return [header, ...lines, footer].map((row) => row.map(csvCell).join(';')).join('\r\n');
}

/** Nom du fichier CSV du journal des recettes (par jour ou par mois). */
export const journalCsvFileName = (registerCode: string, period: string): string => `journal-recettes_${registerCode}_${period}.csv`;

/** Nom du fichier PDF d un Z (archive GED, reimpression). */
export const zPdfFileName = (z: Pick<ZReport, 'number' | 'register_code'>): string => `${z.number ?? 'X'}_${z.register_code}.pdf`;

/** Seuil des lignes distinctes du journal des recettes (AR n. 1 art. 14 par. 2, 3. ; 500 EUR depuis le 10/01/2026). */
export const LARGE_ITEM_TTC = 500;

/**
 * Une ligne de vente s inscrit-elle a part au journal (prix UNITAIRE TTC > 500 EUR) ? Meme regle
 * que `_cash_z_build` en base (`abs(line_ttc / quantity) > 500`), avoirs compris.
 */
export function isLargeItem(line: { quantity: number; line_ttc: number }): boolean {
  const q = Number(line.quantity);
  if (!q) return false;
  return Math.abs(Number(line.line_ttc) / q) > LARGE_ITEM_TTC;
}
