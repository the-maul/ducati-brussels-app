/**
 * M6 (POS) — Bordereau de remise en banque (G8 : « Remise en banque : espèces/cash n° 1 » : banque, BIC,
 * IBAN, domiciliation, lignes client / opération / date / montant, total des encaissements, nombre de
 * lignes, montant remis / montant reporté). Logique pure : un `Journal` rendu par `cash-journals-export.ts`
 * (PDF / Excel). Testé dans tests/caisse-journaux.test.ts.
 */
import { t, fillVars } from '@/lib/i18n';
import { localDay, type Journal, type JournalRow } from './cash-journals';
import type { DepositSourceType } from './cash-deposit-rules';

export type SlipDeposit = {
  number: number; method: string; kind: string; status: string; deposit_date: string; period_from: string | null; period_to: string;
  lines_total: number; deposited_amount: number; new_float: number | null; line_count: number;
  bank_label: string | null; bank_iban: string | null; bank_bic: string | null; comment: string | null;
  cancel_reason?: string | null;
};
export type SlipLine = { source_type: DepositSourceType; occurred_at: string; label: string | null; contact_label: string | null; document_number: string | null; amount: number };

/** Libellé d'une ligne de remise dans la langue de l'utilisateur (report, écarts : traduits). */
export function sourceLabel(l: Pick<SlipLine, 'source_type' | 'label' | 'occurred_at'>): string {
  if (l.source_type === 'report') return fillVars(t('cashDeposits.src.reportOf'), { date: frDate(l.occurred_at) });
  if (l.source_type === 'opening_gap') return t('cashDeposits.src.opening_gap');
  if (l.source_type === 'closing_gap') return `${t('cashDeposits.src.closing_gap')} ${(l.label ?? '').replace(/^[^ ]+ de cl[oô]ture ?/i, '')}`.trim();
  return l.label ?? '';
}
const frDate = (iso: string) => { const d = localDay(iso); return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`; };

export function depositSlipJournal(d: SlipDeposit, lines: SlipLine[], methodLabel: string): Journal {
  const title = fillVars(t('cashDeposits.slipTitle'), { method: methodLabel, number: d.number });
  const info: JournalRow[] = [
    { cells: [t('cashDeposits.depositDate'), d.deposit_date] },
    { cells: [t('cashDeposits.bank'), d.bank_label ?? '-'] },
    { cells: ['IBAN', d.bank_iban ?? '-'] },
    { cells: ['BIC', d.bank_bic ?? '-'] },
  ];
  if (d.comment) info.push({ cells: [t('cashDeposits.comment'), d.comment] });
  if (d.status === 'annulee') info.push({ cells: [t('cashDeposits.status.annulee'), d.cancel_reason ?? ''] });
  const rows: JournalRow[] = lines.map((l) => ({ cells: [l.contact_label ?? '', sourceLabel(l), l.document_number ?? '', localDay(l.occurred_at), l.amount] }));
  rows.push({ tone: 'total', cells: [fillVars(t('cashDeposits.lineCount'), { n: lines.length }), t('cashDeposits.totalReceipts'), null, null, d.lines_total] });
  const totals: JournalRow[] = [
    { cells: [t(d.kind === 'archive' ? 'cashDeposits.archivedNoDeposit' : 'cashDeposits.depositedAmount'), d.deposited_amount] },
  ];
  if (d.new_float != null) totals.push({ cells: [t('cashDeposits.carriedAmount'), d.new_float] });
  return {
    id: 'depositSlip', title,
    sections: [
      { columns: [{ label: t('cashDeposits.slipInfo'), kind: 'text' }, { label: '', kind: 'text' }], rows: info },
      { columns: [{ label: t('cashJournals.col.client'), kind: 'text' }, { label: t('cashJournals.col.operation'), kind: 'text' }, { label: t('cashJournals.col.document'), kind: 'text' }, { label: t('cashJournals.col.date'), kind: 'date' }, { label: t('cashJournals.col.amount'), kind: 'money' }], rows },
      { columns: [{ label: t('cashJournals.total'), kind: 'text' }, { label: t('cashJournals.col.amount'), kind: 'money' }], rows: totals },
    ],
    notes: [],
  };
}
