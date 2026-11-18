/**
 * M6 (POS) — Journaux de caisse façon G8 (« Journal de caisse › Édition », rattrapage G8 du 18/11/2026,
 * PDV008). Logique pure : les données d'une période viennent de `cash_journal_data` (migration
 * 20261118151000 : jamais un brouillon ni un document annulé ; règlements perçus hors lettrage d'avoir et
 * hors acompte reporté) ; chaque journal est un tableau générique (`Journal`) rendu à l'écran, en PDF
 * (`cash-journals-pdf.ts`) et en Excel (`cash-journals-xlsx.ts`). Testé dans tests/caisse-journaux.test.ts.
 *
 * Journaux G8 couverts (comparaison-ventes-caisse-compta.md §3.1) : liste des factures (simplifiée,
 * règlements verticaux, règlements horizontaux), état des encaissements de la journée (détaillé,
 * simplifié, par mode), récapitulatif des encaissements de la journée (+ horizontal), état des
 * encaissements du mois (+ simplifié), journal de caisse par mode (report, solde), journal des ventes,
 * ventilations journalières / mensuelles par opérateur, client, famille, taux de TVA (simplifié, détaillé),
 * mouvements de fonds de caisse, historique des reports, détail des ventes d'une référence, port par facture.
 * Les journaux « par poste » attendent la caisse par poste (carte K17).
 */
import { t, fillVars } from '@/lib/i18n';

/* ---------------------------------------------------------------- données (JSON de cash_journal_data) */
export type JDocument = {
  id: string; number: string | null; doc_type: string; status: string; issue_date: string; created_at: string;
  contact_id: string | null; contact_label: string | null; contact_code?: string | null; operator: string | null;
  total_ht: number; total_vat: number; total_ttc: number; paid_amount: number;
  shipping_ht: number; shipping_vat_rate: number; shipping_taxed: boolean; legacy_margin: number | null;
  cash_session_id?: string | null;
};
export type JLine = {
  document_id: string; article_id: string | null; reference: string | null; designation: string; line_type: string;
  quantity: number; vat_rate: number; line_ht: number; line_ttc: number; unit_cost: number | null; family: string | null;
};
export type JPayment = {
  id: string; document_id: string; document_number: string | null; doc_type: string; contact_label: string | null;
  method: string; amount: number; paid_at: string; note: string | null; cash_session_id?: string | null; reversal_of?: string | null;
};
export type JMovement = {
  id: string; movement_no: number | null; occurred_at: string; kind: 'in' | 'out' | string; method: string; amount: number;
  reason: string | null; type_code: string | null; type_label: string | null; vat_rate: number | null; vat_amount: number | null;
  account_code: string | null; deposit_id: string | null; session_id: string | null;
};
export type JSession = {
  id: string; register_code: string | null; z_number: string | null; status: string; opened_at: string; closed_at: string | null;
  opening_float: number; proposed_float: number | null; expected_cash: number | null; counted_cash: number | null;
};
export type JDeposit = {
  id: string; number: number; method: string; kind: string; status: string; deposit_date: string; created_at: string;
  period_from: string | null; period_to: string | null; lines_total: number; deposited_amount: number; new_float: number | null;
  line_count: number; bank_label: string | null; comment: string | null; cancel_reason: string | null;
};
export type JournalData = {
  from: string; to: string;
  documents: JDocument[]; lines: JLine[]; payments: JPayment[]; movements: JMovement[];
  sessions: JSession[]; deposits: JDeposit[]; methods: { code: string; label: string }[];
};

/** Normalise le JSON reçu (nombres en texte, tableaux absents). */
export function parseJournalData(raw: unknown): JournalData {
  const o = (raw ?? {}) as Record<string, unknown>;
  const arr = <T,>(k: string): T[] => (Array.isArray(o[k]) ? (o[k] as T[]) : []);
  const n = (v: unknown): number => (v == null || v === '' ? 0 : Number(v));
  const nn = (v: unknown): number | null => (v == null || v === '' ? null : Number(v));
  return {
    from: String(o.from ?? ''), to: String(o.to ?? ''),
    documents: arr<JDocument>('documents').map((d) => ({ ...d, total_ht: n(d.total_ht), total_vat: n(d.total_vat), total_ttc: n(d.total_ttc),
      paid_amount: n(d.paid_amount), shipping_ht: n(d.shipping_ht), shipping_vat_rate: n(d.shipping_vat_rate), legacy_margin: nn(d.legacy_margin) })),
    lines: arr<JLine>('lines').map((l) => ({ ...l, quantity: n(l.quantity), vat_rate: n(l.vat_rate), line_ht: n(l.line_ht), line_ttc: n(l.line_ttc), unit_cost: nn(l.unit_cost) })),
    payments: arr<JPayment>('payments').map((p) => ({ ...p, amount: n(p.amount) })),
    movements: arr<JMovement>('movements').map((m) => ({ ...m, amount: n(m.amount), vat_rate: nn(m.vat_rate), vat_amount: nn(m.vat_amount) })),
    sessions: arr<JSession>('sessions').map((s) => ({ ...s, opening_float: n(s.opening_float), proposed_float: nn(s.proposed_float), expected_cash: nn(s.expected_cash), counted_cash: nn(s.counted_cash) })),
    deposits: arr<JDeposit>('deposits').map((d) => ({ ...d, number: n(d.number), lines_total: n(d.lines_total), deposited_amount: n(d.deposited_amount), new_float: nn(d.new_float), line_count: n(d.line_count) })),
    methods: arr<{ code: string; label: string }>('methods'),
  };
}

/* ---------------------------------------------------------------- tableau générique */
export type Cell = string | number | null;
export type ColKind = 'text' | 'money' | 'number' | 'pct' | 'date' | 'time';
export type JournalColumn = { label: string; kind: ColKind };
export type RowTone = 'data' | 'group' | 'detail' | 'subtotal' | 'total';
export type JournalRow = { cells: Cell[]; tone?: RowTone };
export type JournalSection = { title?: string; columns: JournalColumn[]; rows: JournalRow[] };
export type Journal = { id: JournalId | string; title: string; sections: JournalSection[]; notes: string[] };

export const JOURNAL_IDS = [
  'invoices', 'invoicesVertical', 'invoicesHorizontal',
  'dayReceipts', 'dayReceiptsSimple', 'dayReceiptsByMethod',
  'dayRecap', 'dayRecapHorizontal', 'monthReceipts', 'monthReceiptsSimple',
  'cashJournal', 'salesJournal',
  'ventOperatorDay', 'ventClientDay', 'ventFamilyDay', 'ventVatDay', 'ventVatDayDetail',
  'ventClientMonth', 'ventFamilyMonth', 'ventVatMonth',
  'movements', 'reportHistory', 'articleSales', 'shipping',
] as const;
export type JournalId = (typeof JOURNAL_IDS)[number];

export type JournalOptions = {
  /** Détail des ventes pour la référence : référence cherchée (vide = journal vide avec un message). */
  reference?: string;
  /** Ventilation par famille : nombre de niveaux de la famille gardés (1 = rayon). */
  familyLevel?: number;
  /** Ventilation par taux de TVA : un seul taux (null = tous). */
  vatRate?: number | null;
};

/* ---------------------------------------------------------------- utilitaires */
const r2 = (n: number) => Math.round(n * 100) / 100;
const sum = (xs: number[]) => r2(xs.reduce((a, b) => a + b, 0));
const TZ = 'Europe/Brussels';
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('fr-BE', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
/** Jour local (Bruxelles) d'un horodatage, AAAA-MM-JJ. */
export const localDay = (iso: string): string => dayFmt.format(new Date(iso));
/** Heure locale HH:MM. */
export const localTime = (iso: string): string => timeFmt.format(new Date(iso));
const monthOf = (day: string) => day.slice(0, 7);
const pct = (part: number, whole: number): number | null => (whole === 0 ? null : r2((part / whole) * 100));
const docLabel = (d: { doc_type: string; number: string | null }) => `${t(`sales.type_${d.doc_type}`)} ${d.number ?? ''}`.trim();
const noneLabel = () => t('cashJournals.none');

function methodLabel(data: JournalData, code: string): string {
  return data.methods.find((m) => m.code === code)?.label ?? code;
}
/** Modes présents dans les règlements et mouvements de la période, dans l'ordre des paramètres. */
function activeMethods(data: JournalData): string[] {
  const used = new Set<string>([...data.payments.map((p) => p.method), ...data.movements.map((m) => m.method)]);
  const ordered = data.methods.map((m) => m.code).filter((c) => used.has(c));
  for (const c of used) if (!ordered.includes(c)) ordered.push(c);
  return ordered;
}
const signedMovement = (m: JMovement) => (m.kind === 'in' ? m.amount : -m.amount);
const movementLabel = (m: JMovement) => [m.type_label, m.reason && m.reason !== m.type_label ? m.reason : null].filter(Boolean).join(' - ') || t('cash.movements');

/** Lignes d'un document avec sa part du port et de la remise globale (pour que la somme = HT du document). */
export type VLine = JLine & { ht: number; vat: number; ttc: number; margin: number | null };
export function ventilatedLines(data: JournalData): VLine[] {
  const byDoc = new Map<string, JLine[]>();
  for (const l of data.lines) { const a = byDoc.get(l.document_id) ?? []; a.push(l); byDoc.set(l.document_id, a); }
  const out: VLine[] = [];
  for (const d of data.documents) {
    const lines = (byDoc.get(d.id) ?? []).filter((l) => l.line_ht !== 0 || l.line_ttc !== 0);
    const linesHt = sum(lines.map((l) => l.line_ht));
    const goodsHt = r2(d.total_ht - d.shipping_ht);
    // Remise globale du pied : répartie au prorata des lignes (G8 ventile le HT net).
    const factor = linesHt !== 0 && Math.abs(goodsHt - linesHt) > 0.004 ? goodsHt / linesHt : 1;
    for (const l of lines) {
      const ht = r2(l.line_ht * factor);
      const ttc = r2(l.line_ttc * factor);
      const margin = l.unit_cost == null ? null : r2(ht - l.quantity * l.unit_cost);
      out.push({ ...l, ht, ttc, vat: r2(ttc - ht), margin });
    }
    if (d.shipping_ht !== 0) {
      const rate = d.shipping_taxed ? d.shipping_vat_rate : 0;
      const ht = r2(d.shipping_ht);
      const ttc = r2(ht * (1 + rate / 100));
      out.push({ document_id: d.id, article_id: null, reference: null, designation: t('cashJournals.shippingLine'), line_type: 'shipping',
        quantity: 1, vat_rate: rate, line_ht: ht, line_ttc: ttc, unit_cost: null, family: null, ht, ttc, vat: r2(ttc - ht), margin: null });
    }
  }
  return out;
}

/** Marge d'un document : marge reprise de G8 sinon somme des marges de ligne (PAMP, à défaut PA). */
export function documentMargins(data: JournalData): Map<string, number | null> {
  const m = new Map<string, number | null>();
  const vl = ventilatedLines(data);
  for (const d of data.documents) {
    if (d.legacy_margin != null) { m.set(d.id, d.legacy_margin); continue; }
    const ls = vl.filter((l) => l.document_id === d.id && l.line_type !== 'shipping');
    m.set(d.id, ls.some((l) => l.margin != null) ? sum(ls.map((l) => l.margin ?? 0)) : null);
  }
  return m;
}

const col = (key: string, kind: ColKind): JournalColumn => ({ label: t(`cashJournals.col.${key}`), kind });
const due = (d: JDocument) => r2(d.total_ttc - d.paid_amount);
const sortedDocs = (data: JournalData) => [...data.documents].sort((a, b) => a.issue_date.localeCompare(b.issue_date) || (a.number ?? '').localeCompare(b.number ?? ''));

/* ---------------------------------------------------------------- 1. liste des factures */
function invoices(data: JournalData, variant: 'simple' | 'vertical' | 'horizontal'): JournalSection[] {
  const margins = documentMargins(data);
  const methods = variant === 'horizontal' ? activeMethods(data).filter((m) => data.payments.some((p) => p.method === m)) : [];
  const columns: JournalColumn[] = variant === 'horizontal'
    ? [col('document', 'text'), col('client', 'text'), col('date', 'date'), col('ttc', 'money'),
      ...methods.map((m) => ({ label: methodLabel(data, m), kind: 'money' as ColKind })), col('due', 'money')]
    : [col('document', 'text'), col('client', 'text'), col('date', 'date'), col('time', 'time'), col('ht', 'money'), col('vat', 'money'),
      col('ttc', 'money'), col('due', 'money'), col('margin', 'money'), col('marginPct', 'pct'), col('operator', 'text')];
  const rows: JournalRow[] = [];
  const docs = sortedDocs(data);
  const days = [...new Set(docs.map((d) => d.issue_date))];
  const pay = (d: JDocument, m: string) => sum(data.payments.filter((p) => p.document_id === d.id && p.method === m).map((p) => p.amount));
  const totalsRow = (ds: JDocument[], label: string, tone: RowTone): JournalRow => {
    if (variant === 'horizontal') {
      return { tone, cells: [label, `${ds.length}`, null, sum(ds.map((d) => d.total_ttc)), ...methods.map((m) => sum(ds.map((d) => pay(d, m)))), sum(ds.map(due))] };
    }
    const ht = sum(ds.map((d) => d.total_ht));
    const mg = sum(ds.map((d) => margins.get(d.id) ?? 0));
    return { tone, cells: [label, `${ds.length}`, null, null, ht, sum(ds.map((d) => d.total_vat)), sum(ds.map((d) => d.total_ttc)), sum(ds.map(due)), mg, pct(mg, ht), null] };
  };
  for (const day of days) {
    const ds = docs.filter((d) => d.issue_date === day);
    for (const d of ds) {
      if (variant === 'horizontal') {
        rows.push({ cells: [docLabel(d), d.contact_label ?? '', d.issue_date, d.total_ttc, ...methods.map((m) => pay(d, m)), due(d)] });
        continue;
      }
      const mg = margins.get(d.id) ?? null;
      rows.push({ cells: [docLabel(d), d.contact_label ?? '', d.issue_date, localTime(d.created_at), d.total_ht, d.total_vat, d.total_ttc, due(d), mg, mg == null ? null : pct(mg, d.total_ht), d.operator ?? ''] });
      if (variant === 'vertical') {
        for (const p of data.payments.filter((x) => x.document_id === d.id)) {
          rows.push({ tone: 'detail', cells: [`   ${methodLabel(data, p.method)}`, p.note ?? '', localDay(p.paid_at), localTime(p.paid_at), null, null, p.amount, null, null, null, null] });
        }
      }
    }
    rows.push(totalsRow(ds, fillVars(t('cashJournals.subtotalDay'), { day: frDay(day) }), 'subtotal'));
  }
  if (docs.length) rows.push(totalsRow(docs, t('cashJournals.total'), 'total'));
  return [{ columns, rows }];
}

/** JJ/MM/AAAA depuis AAAA-MM-JJ. */
export const frDay = (day: string) => (/^\d{4}-\d{2}-\d{2}/.test(day) ? `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}` : day);
const frMonth = (month: string) => `${month.slice(5, 7)}/${month.slice(0, 4)}`;

/* ---------------------------------------------------------------- 2. encaissements */
type Receipt = { day: string; at: string; label: string; client: string; method: string; amount: number; nature: 'sales' | 'deposits' | 'refunds' | 'in' | 'out' };
function receipts(data: JournalData): Receipt[] {
  const out: Receipt[] = [];
  for (const p of data.payments) {
    const nature = p.doc_type === 'AVO' ? 'refunds' : ['RES', 'BC', 'DEV'].includes(p.doc_type) ? 'deposits' : 'sales';
    out.push({ day: localDay(p.paid_at), at: p.paid_at, label: `${t(`sales.type_${p.doc_type}`)} ${p.document_number ?? ''}`.trim(), client: p.contact_label ?? '', method: p.method, amount: p.amount, nature });
  }
  for (const m of data.movements) {
    out.push({ day: localDay(m.occurred_at), at: m.occurred_at, label: movementLabel(m), client: '', method: m.method, amount: signedMovement(m), nature: m.kind === 'in' ? 'in' : 'out' });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

function dayReceipts(data: JournalData, variant: 'detail' | 'simple' | 'byMethod'): JournalSection[] {
  const all = receipts(data);
  const days = [...new Set(all.map((r) => r.day))].sort();
  const sections: JournalSection[] = [];
  for (const day of days) {
    const rs = all.filter((r) => r.day === day);
    const pays = rs.filter((r) => r.nature !== 'in' && r.nature !== 'out');
    const movs = rs.filter((r) => r.nature === 'in' || r.nature === 'out');
    const rows: JournalRow[] = [];
    if (variant === 'simple') {
      for (const m of [...new Set(rs.map((r) => r.method))]) rows.push({ cells: [methodLabel(data, m), sum(rs.filter((r) => r.method === m).map((r) => r.amount))] });
      rows.push({ tone: 'total', cells: [t('cashJournals.totalReceipts'), sum(rs.map((r) => r.amount))] });
      sections.push({ title: frDay(day), columns: [col('method', 'text'), col('amount', 'money')], rows });
      continue;
    }
    const columns = [col('time', 'time'), col('operation', 'text'), col('client', 'text'), col('method', 'text'), col('amount', 'money')];
    const line = (r: Receipt): JournalRow => ({ cells: [localTime(r.at), r.label, r.client, methodLabel(data, r.method), r.amount] });
    if (variant === 'byMethod') {
      for (const m of [...new Set(rs.map((r) => r.method))]) {
        rows.push({ tone: 'group', cells: [null, methodLabel(data, m), null, null, null] });
        for (const r of rs.filter((x) => x.method === m)) rows.push(line(r));
        rows.push({ tone: 'subtotal', cells: [null, fillVars(t('cashJournals.subtotalMethod'), { method: methodLabel(data, m) }), null, null, sum(rs.filter((x) => x.method === m).map((x) => x.amount))] });
      }
    } else {
      for (const r of pays) rows.push(line(r));
      rows.push({ tone: 'subtotal', cells: [null, t('cashJournals.totalInvoicePayments'), null, null, sum(pays.map((r) => r.amount))] });
      if (movs.length) {
        rows.push({ tone: 'group', cells: [null, t('cashJournals.cashMovementsInOut'), null, null, null] });
        for (const r of movs) rows.push(line(r));
        rows.push({ tone: 'subtotal', cells: [null, t('cashJournals.totalMovements'), null, null, sum(movs.map((r) => r.amount))] });
      }
    }
    rows.push({ tone: 'total', cells: [null, t('cashJournals.totalReceipts'), null, null, sum(rs.map((r) => r.amount))] });
    sections.push({ title: frDay(day), columns, rows });
  }
  return sections;
}

function recapRows(data: JournalData, rs: Receipt[]): JournalRow[] {
  const rows: JournalRow[] = [];
  const by = (m: string, n: Receipt['nature']) => sum(rs.filter((r) => r.method === m && r.nature === n).map((r) => r.amount));
  for (const m of [...new Set(rs.map((r) => r.method))]) {
    rows.push({ cells: [methodLabel(data, m), by(m, 'sales'), by(m, 'deposits'), by(m, 'refunds'), by(m, 'in'), by(m, 'out'), sum(rs.filter((r) => r.method === m).map((r) => r.amount))] });
  }
  const tot = (n: Receipt['nature']) => sum(rs.filter((r) => r.nature === n).map((r) => r.amount));
  rows.push({ tone: 'total', cells: [t('cashJournals.total'), tot('sales'), tot('deposits'), tot('refunds'), tot('in'), tot('out'), sum(rs.map((r) => r.amount))] });
  return rows;
}
const recapColumns = () => [col('method', 'text'), col('sales', 'money'), col('deposits', 'money'), col('refunds', 'money'), col('in', 'money'), col('out', 'money'), col('total', 'money')];

function dayRecap(data: JournalData): JournalSection[] {
  const all = receipts(data);
  return [...new Set(all.map((r) => r.day))].sort().map((day) => ({ title: frDay(day), columns: recapColumns(), rows: recapRows(data, all.filter((r) => r.day === day)) }));
}

function periodGrid(data: JournalData, bucket: (r: Receipt) => string, label: (k: string) => string, keyCol: JournalColumn): JournalSection[] {
  const all = receipts(data);
  const methods = activeMethods(data);
  const keys = [...new Set(all.map(bucket))].sort();
  const rows: JournalRow[] = keys.map((k) => {
    const rs = all.filter((r) => bucket(r) === k);
    return { cells: [label(k), ...methods.map((m) => sum(rs.filter((r) => r.method === m).map((r) => r.amount))), sum(rs.map((r) => r.amount))] };
  });
  if (keys.length) rows.push({ tone: 'total', cells: [t('cashJournals.total'), ...methods.map((m) => sum(all.filter((r) => r.method === m).map((r) => r.amount))), sum(all.map((r) => r.amount))] });
  return [{ columns: [keyCol, ...methods.map((m) => ({ label: methodLabel(data, m), kind: 'money' as ColKind })), col('total', 'money')], rows }];
}

function monthReceipts(data: JournalData, simple: boolean): JournalSection[] {
  const all = receipts(data);
  const months = [...new Set(all.map((r) => monthOf(r.day)))].sort();
  if (simple) return periodGrid(data, (r) => monthOf(r.day), frMonth, col('month', 'text'));
  // Détaillé : chaque mois, jour par jour et mode par mode.
  return months.map((m) => {
    const sub: JournalData = { ...data, payments: data.payments.filter((p) => monthOf(localDay(p.paid_at)) === m), movements: data.movements.filter((x) => monthOf(localDay(x.occurred_at)) === m) };
    return { ...periodGrid(sub, (r) => r.day, frDay, col('day', 'text'))[0], title: frMonth(m) };
  });
}

/* ---------------------------------------------------------------- 3. journal de caisse par mode */
function cashJournal(data: JournalData): { sections: JournalSection[]; notes: string[] } {
  const sections: JournalSection[] = [];
  const columns = [col('date', 'date'), col('time', 'time'), col('operation', 'text'), col('client', 'text'), col('in', 'money'), col('out', 'money'), col('balance', 'money')];
  const t0 = data.from;
  for (const m of [...new Set([...activeMethods(data), ...data.deposits.filter((d) => d.created_at >= t0).map((d) => d.method)])]) {
    type Ev = { at: string; label: string; client: string; amount: number };
    const evs: Ev[] = [];
    // Report de la dernière remise d'espèces avant la période (G8 : « report de la caisse du ... »).
    const before = data.deposits.filter((d) => d.method === m && d.status === 'active' && localDay(d.created_at) < t0)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    const report = m === 'ESP' && before ? before.new_float ?? 0 : 0;
    for (const p of data.payments.filter((x) => x.method === m)) evs.push({ at: p.paid_at, label: `${t(`sales.type_${p.doc_type}`)} ${p.document_number ?? ''}`.trim(), client: p.contact_label ?? '', amount: p.amount });
    // Les sorties posées par une remise sont la remise elle-même (ligne « remise en banque » ci-dessous).
    for (const x of data.movements.filter((y) => y.method === m && !y.deposit_id)) evs.push({ at: x.occurred_at, label: movementLabel(x), client: '', amount: signedMovement(x) });
    if (m === 'ESP') {
      for (const s of data.sessions) {
        if (s.proposed_float != null && r2(s.opening_float - s.proposed_float) !== 0 && localDay(s.opened_at) >= t0) {
          evs.push({ at: s.opened_at, label: t('cashDeposits.src.opening_gap'), client: '', amount: r2(s.opening_float - s.proposed_float) });
        }
        if (s.closed_at && s.counted_cash != null && s.expected_cash != null && r2(s.counted_cash - s.expected_cash) !== 0 && localDay(s.closed_at) <= data.to) {
          evs.push({ at: s.closed_at, label: `${t('cashDeposits.src.closing_gap')} ${s.z_number ?? ''}`.trim(), client: '', amount: r2(s.counted_cash - s.expected_cash) });
        }
      }
    }
    for (const d of data.deposits.filter((x) => x.method === m && x.status === 'active' && x.kind === 'remise' && localDay(x.created_at) >= t0)) {
      evs.push({ at: d.created_at, label: fillVars(t('cashJournals.depositLine'), { number: d.number }), client: d.bank_label ?? '', amount: -d.deposited_amount });
    }
    evs.sort((a, b) => a.at.localeCompare(b.at));
    let bal = report;
    const rows: JournalRow[] = [];
    if (m === 'ESP') rows.push({ tone: 'group', cells: [before ? before.deposit_date : null, null, before ? fillVars(t('cashJournals.reportOf'), { date: frDay(before.deposit_date) }) : t('cashJournals.noReport'), null, null, null, report] });
    for (const e of evs) {
      bal = r2(bal + e.amount);
      rows.push({ cells: [localDay(e.at), localTime(e.at), e.label, e.client, e.amount > 0 ? e.amount : null, e.amount < 0 ? -e.amount : null, m === 'ESP' ? bal : null] });
    }
    rows.push({ tone: 'total', cells: [null, null, m === 'ESP' ? fillVars(t('cashJournals.cashBalanceAt'), { date: frDay(data.to) }) : t('cashJournals.total'), null,
      sum(evs.filter((e) => e.amount > 0).map((e) => e.amount)), sum(evs.filter((e) => e.amount < 0).map((e) => -e.amount)), m === 'ESP' ? bal : sum(evs.map((e) => e.amount))] });
    sections.push({ title: methodLabel(data, m), columns, rows });
  }
  return { sections, notes: [t('cashJournals.cashJournalNote')] };
}

/* ---------------------------------------------------------------- 4. journal des ventes */
function salesJournal(data: JournalData): JournalSection[] {
  const vl = ventilatedLines(data);
  const columns = [col('reference', 'text'), col('designation', 'text'), col('vatRate', 'pct'), col('ht', 'money'), col('vat', 'money'), col('ttc', 'money')];
  const rows: JournalRow[] = [];
  const docs = sortedDocs(data);
  for (const d of docs) {
    rows.push({ tone: 'group', cells: [docLabel(d), `${frDay(d.issue_date)} - ${d.contact_label ?? ''}`, null, null, null, null] });
    for (const l of vl.filter((x) => x.document_id === d.id)) rows.push({ cells: [l.reference ?? '', l.designation, l.vat_rate, l.ht, l.vat, l.ttc] });
    rows.push({ tone: 'subtotal', cells: [null, t('cashJournals.totalDocument'), null, d.total_ht, d.total_vat, d.total_ttc] });
  }
  const ht = sum(docs.map((d) => d.total_ht)); const ttc = sum(docs.map((d) => d.total_ttc));
  const n = docs.filter((d) => d.doc_type !== 'AVO').length;
  rows.push({ tone: 'total', cells: [null, t('cashJournals.totalSales'), null, ht, sum(docs.map((d) => d.total_vat)), ttc] });
  rows.push({ tone: 'total', cells: [null, fillVars(t('cashJournals.basket'), { n: docs.length }), null, n ? r2(ht / n) : null, null, n ? r2(ttc / n) : null] });
  return [{ columns, rows }];
}

/* ---------------------------------------------------------------- 5. ventilations */
type Grain = 'day' | 'month';
const bucketOf = (grain: Grain, day: string) => (grain === 'day' ? day : monthOf(day));
const bucketLabel = (grain: Grain, k: string) => (grain === 'day' ? frDay(k) : frMonth(k));

/** Famille gardée sur `level` niveaux (« R11/03-05/... » → « R11 » au niveau 1). */
export function familyKey(path: string | null, level: number): string {
  if (!path || !path.trim()) return '';
  const parts = path.split('/').map((p) => p.trim()).filter(Boolean);
  return parts.slice(0, Math.max(1, level)).join(' / ');
}

function ventByDocument(data: JournalData, grain: Grain, dim: 'operator' | 'client'): JournalSection[] {
  const margins = documentMargins(data);
  const keyOf = (d: JDocument) => (dim === 'operator' ? d.operator : d.contact_label) || noneLabel();
  const columns = [col(grain, 'text'), col(dim, 'text'), col('count', 'number'), col('ht', 'money'), col('vat', 'money'), col('ttc', 'money'), col('margin', 'money'), col('marginPct', 'pct')];
  const rows: JournalRow[] = [];
  const docs = sortedDocs(data);
  const agg = (ds: JDocument[], label: Cell, key: Cell, tone?: RowTone): JournalRow => {
    const ht = sum(ds.map((d) => d.total_ht)); const mg = sum(ds.map((d) => margins.get(d.id) ?? 0));
    return { tone, cells: [label, key, ds.length, ht, sum(ds.map((d) => d.total_vat)), sum(ds.map((d) => d.total_ttc)), mg, pct(mg, ht)] };
  };
  for (const b of [...new Set(docs.map((d) => bucketOf(grain, d.issue_date)))].sort()) {
    const ds = docs.filter((d) => bucketOf(grain, d.issue_date) === b);
    const keys = [...new Set(ds.map(keyOf))].sort((a, c) => a.localeCompare(c));
    for (const k of keys) rows.push(agg(ds.filter((d) => keyOf(d) === k), bucketLabel(grain, b), k));
    rows.push(agg(ds, bucketLabel(grain, b), t('cashJournals.subtotal'), 'subtotal'));
  }
  if (docs.length) rows.push(agg(docs, t('cashJournals.total'), null, 'total'));
  return [{ columns, rows }];
}

function ventByLine(data: JournalData, grain: Grain, dim: 'family' | 'vat', opts: JournalOptions, detailed = false): JournalSection[] {
  const docDay = new Map(data.documents.map((d) => [d.id, d.issue_date] as const));
  const docById = new Map(data.documents.map((d) => [d.id, d] as const));
  let vl = ventilatedLines(data);
  if (dim === 'vat' && opts.vatRate != null) vl = vl.filter((l) => l.vat_rate === opts.vatRate);
  const level = opts.familyLevel ?? 1;
  const keyOf = (l: VLine): string => (dim === 'vat' ? `${l.vat_rate}` : l.line_type === 'shipping' ? t('cashJournals.shippingLine') : familyKey(l.family, level) || noneLabel());
  const columns = dim === 'vat'
    ? [col(grain, 'text'), col(detailed ? 'document' : 'vatRate', 'text'), ...(detailed ? [col('vatRate', 'text')] : []), col('ht', 'money'), col('vat', 'money'), col('ttc', 'money')]
    : [col(grain, 'text'), col('family', 'text'), col('quantity', 'number'), col('ht', 'money'), col('vat', 'money'), col('ttc', 'money'), col('margin', 'money'), col('marginPct', 'pct')];
  const rows: JournalRow[] = [];
  const agg = (ls: VLine[], label: Cell, key: Cell, tone?: RowTone, doc?: Cell): JournalRow => {
    const ht = sum(ls.map((l) => l.ht)); const vat = sum(ls.map((l) => l.vat)); const ttc = sum(ls.map((l) => l.ttc));
    if (dim === 'vat') return { tone, cells: detailed ? [label, doc ?? null, key, ht, vat, ttc] : [label, key, ht, vat, ttc] };
    const mg = sum(ls.map((l) => l.margin ?? 0));
    return { tone, cells: [label, key, sum(ls.filter((l) => l.line_type !== 'shipping').map((l) => l.quantity)), ht, vat, ttc, mg, pct(mg, ht)] };
  };
  const rateLabel = (k: string) => `${k} %`;
  const buckets = [...new Set(vl.map((l) => bucketOf(grain, docDay.get(l.document_id) ?? '')))].sort();
  for (const b of buckets) {
    const ls = vl.filter((l) => bucketOf(grain, docDay.get(l.document_id) ?? '') === b);
    if (detailed) {
      for (const docId of [...new Set(ls.map((l) => l.document_id))]) {
        const d = docById.get(docId)!;
        const dl = ls.filter((l) => l.document_id === docId);
        for (const k of [...new Set(dl.map(keyOf))].sort((a, c) => Number(a) - Number(c))) rows.push(agg(dl.filter((l) => keyOf(l) === k), bucketLabel(grain, b), rateLabel(k), undefined, docLabel(d)));
      }
    }
    const keys = [...new Set(ls.map(keyOf))].sort((a, c) => (dim === 'vat' ? Number(a) - Number(c) : a.localeCompare(c)));
    for (const k of keys) rows.push(agg(ls.filter((l) => keyOf(l) === k), bucketLabel(grain, b), dim === 'vat' ? rateLabel(k) : k, detailed ? 'subtotal' : undefined));
    rows.push(agg(ls, bucketLabel(grain, b), t('cashJournals.subtotal'), 'subtotal'));
  }
  if (vl.length) rows.push(agg(vl, t('cashJournals.total'), null, 'total'));
  return [{ columns, rows }];
}

/* ---------------------------------------------------------------- 6. mouvements, reports, référence, port */
function movementsJournal(data: JournalData): JournalSection[] {
  const columns = [col('number', 'text'), col('date', 'date'), col('time', 'time'), col('type', 'text'), col('label', 'text'), col('method', 'text'),
    col('in', 'money'), col('out', 'money'), col('vatRate', 'pct'), col('vat', 'money'), col('account', 'text')];
  const rows: JournalRow[] = [];
  const ms = [...data.movements].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  for (const m of [...new Set(ms.map((x) => x.method))]) {
    const xs = ms.filter((x) => x.method === m);
    for (const x of xs) rows.push({ cells: [x.movement_no != null ? String(x.movement_no) : '', localDay(x.occurred_at), localTime(x.occurred_at), x.type_label ?? x.type_code ?? '', x.reason ?? '',
      methodLabel(data, x.method), x.kind === 'in' ? x.amount : null, x.kind === 'out' ? x.amount : null, x.vat_rate, x.vat_amount, x.account_code ?? ''] });
    rows.push({ tone: 'subtotal', cells: [null, null, null, null, fillVars(t('cashJournals.subtotalMethod'), { method: methodLabel(data, m) }), null,
      sum(xs.filter((x) => x.kind === 'in').map((x) => x.amount)), sum(xs.filter((x) => x.kind === 'out').map((x) => x.amount)), null, sum(xs.map((x) => x.vat_amount ?? 0)), null] });
  }
  if (ms.length) rows.push({ tone: 'total', cells: [null, null, null, null, t('cashJournals.cumulInOut'), null,
    sum(ms.filter((x) => x.kind === 'in').map((x) => x.amount)), sum(ms.filter((x) => x.kind === 'out').map((x) => x.amount)), null, sum(ms.map((x) => x.vat_amount ?? 0)), null] });
  return [{ columns, rows }];
}

function reportHistory(data: JournalData): JournalSection[] {
  const columns = [col('number', 'text'), col('method', 'text'), col('date', 'date'), col('kind', 'text'), col('status', 'text'), col('lines', 'number'),
    col('selection', 'money'), col('deposited', 'money'), col('newFloat', 'money'), col('bank', 'text'), col('comment', 'text')];
  const ds = [...data.deposits].filter((d) => localDay(d.created_at) >= data.from).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const rows: JournalRow[] = ds.map((d) => ({ cells: [String(d.number), methodLabel(data, d.method), d.deposit_date, t(`cashDeposits.kind.${d.kind}`), t(`cashDeposits.status.${d.status}`),
    d.line_count, d.lines_total, d.deposited_amount, d.new_float, d.bank_label ?? '', [d.comment, d.cancel_reason].filter(Boolean).join(' / ')] }));
  const act = ds.filter((d) => d.status === 'active');
  if (ds.length) rows.push({ tone: 'total', cells: [null, null, null, null, t('cashJournals.total'), null, null, sum(act.map((d) => d.deposited_amount)), null, null, null] });
  return [{ columns, rows }];
}

function articleSales(data: JournalData, reference: string): JournalSection[] {
  const ref = reference.trim().toLowerCase();
  const columns = [col('date', 'date'), col('document', 'text'), col('client', 'text'), col('designation', 'text'), col('quantity', 'number'), col('ht', 'money'), col('ttc', 'money'), col('margin', 'money')];
  if (!ref) return [{ columns, rows: [] }];
  const docById = new Map(data.documents.map((d) => [d.id, d] as const));
  const ls = ventilatedLines(data).filter((l) => (l.reference ?? '').toLowerCase() === ref);
  const rows: JournalRow[] = ls.map((l) => {
    const d = docById.get(l.document_id)!;
    return { cells: [d.issue_date, docLabel(d), d.contact_label ?? '', l.designation, l.quantity, l.ht, l.ttc, l.margin] };
  }).sort((a, b) => String(a.cells[0]).localeCompare(String(b.cells[0])));
  if (ls.length) rows.push({ tone: 'total', cells: [null, t('cashJournals.total'), null, null, sum(ls.map((l) => l.quantity)), sum(ls.map((l) => l.ht)), sum(ls.map((l) => l.ttc)), sum(ls.map((l) => l.margin ?? 0))] });
  return [{ columns, rows }];
}

function shippingJournal(data: JournalData): JournalSection[] {
  const columns = [col('document', 'text'), col('date', 'date'), col('client', 'text'), col('shippingHt', 'money'), col('vatRate', 'pct'), col('shippingTtc', 'money')];
  const ds = sortedDocs(data).filter((d) => d.shipping_ht !== 0);
  const ttc = (d: JDocument) => r2(d.shipping_ht * (1 + (d.shipping_taxed ? d.shipping_vat_rate : 0) / 100));
  const rows: JournalRow[] = ds.map((d) => ({ cells: [docLabel(d), d.issue_date, d.contact_label ?? '', d.shipping_ht, d.shipping_taxed ? d.shipping_vat_rate : 0, ttc(d)] }));
  if (ds.length) rows.push({ tone: 'total', cells: [t('cashJournals.total'), null, `${ds.length}`, sum(ds.map((d) => d.shipping_ht)), null, sum(ds.map(ttc))] });
  return [{ columns, rows }];
}

/* ---------------------------------------------------------------- point d'entrée */
export function buildJournal(id: JournalId, data: JournalData, opts: JournalOptions = {}): Journal {
  let sections: JournalSection[] = [];
  const notes: string[] = [];
  switch (id) {
    case 'invoices': sections = invoices(data, 'simple'); break;
    case 'invoicesVertical': sections = invoices(data, 'vertical'); break;
    case 'invoicesHorizontal': sections = invoices(data, 'horizontal'); break;
    case 'dayReceipts': sections = dayReceipts(data, 'detail'); break;
    case 'dayReceiptsSimple': sections = dayReceipts(data, 'simple'); break;
    case 'dayReceiptsByMethod': sections = dayReceipts(data, 'byMethod'); break;
    case 'dayRecap': sections = dayRecap(data); break;
    case 'dayRecapHorizontal': sections = periodGrid(data, (r) => r.day, frDay, col('day', 'text')); break;
    case 'monthReceipts': sections = monthReceipts(data, false); break;
    case 'monthReceiptsSimple': sections = monthReceipts(data, true); break;
    case 'cashJournal': { const r = cashJournal(data); sections = r.sections; notes.push(...r.notes); break; }
    case 'salesJournal': sections = salesJournal(data); break;
    case 'ventOperatorDay': sections = ventByDocument(data, 'day', 'operator'); break;
    case 'ventClientDay': sections = ventByDocument(data, 'day', 'client'); break;
    case 'ventClientMonth': sections = ventByDocument(data, 'month', 'client'); break;
    case 'ventFamilyDay': sections = ventByLine(data, 'day', 'family', opts); break;
    case 'ventFamilyMonth': sections = ventByLine(data, 'month', 'family', opts); break;
    case 'ventVatDay': sections = ventByLine(data, 'day', 'vat', opts); break;
    case 'ventVatDayDetail': sections = ventByLine(data, 'day', 'vat', opts, true); break;
    case 'ventVatMonth': sections = ventByLine(data, 'month', 'vat', opts); break;
    case 'movements': sections = movementsJournal(data); break;
    case 'reportHistory': sections = reportHistory(data); break;
    case 'articleSales': sections = articleSales(data, opts.reference ?? ''); if (!(opts.reference ?? '').trim()) notes.push(t('cashJournals.needReference')); break;
    case 'shipping': sections = shippingJournal(data); break;
  }
  if (['ventFamilyDay', 'ventFamilyMonth', 'salesJournal'].includes(id)) notes.push(t('cashJournals.prorataNote'));
  notes.push(t('cashJournals.draftsExcluded'));
  return { id, title: t(`cashJournals.j.${id}`), sections, notes };
}

/** Titre de la période (« du 01/11/2026 au 18/11/2026 »). */
export const periodLabel = (from: string, to: string) => fillVars(t('cashJournals.periodLabel'), { from: frDay(from), to: frDay(to) });
