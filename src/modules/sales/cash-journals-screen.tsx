/**
 * M6 (POS) — Caisse → Journaux (G8 : Journal de caisse › Édition, rattrapage G8 du 18/11/2026, PDV008).
 * Période, journaux à cocher (groupés comme dans G8), aperçu à l'écran du journal cliqué, « Visualiser /
 * imprimer la sélection » (PDF A4 paysage) et « Exporter la sélection » (Excel, une feuille par journal).
 * Brouillons et documents annulés exclus (`cash_journal_data`). Options : niveau de famille, taux de TVA,
 * référence (détail des ventes pour une référence).
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, FileDown, FileSpreadsheet, Info } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { t } from '@/lib/i18n';
import { errorMessage } from '@/lib/mutation-feedback';
import { DepositsUnavailable, getJournalData } from './cash-deposit-api';
import { buildJournal, localDay, periodLabel, type Journal, type JournalId } from './cash-journals';
import { buildJournalsPdf, buildJournalsXlsx, downloadBytes, formatCell, isRightAligned } from './cash-journals-export';
import { openPdfBytes } from './z-report-pdf';

/** Journaux par famille, dans l'ordre de l'écran G8. */
const GROUPS: { key: string; ids: JournalId[] }[] = [
  { key: 'invoices', ids: ['invoices', 'invoicesVertical', 'invoicesHorizontal'] },
  { key: 'receipts', ids: ['dayReceipts', 'dayReceiptsSimple', 'dayReceiptsByMethod', 'dayRecap', 'dayRecapHorizontal', 'monthReceipts', 'monthReceiptsSimple'] },
  { key: 'cash', ids: ['cashJournal', 'movements', 'reportHistory'] },
  { key: 'sales', ids: ['salesJournal', 'articleSales', 'shipping'] },
  { key: 'vent', ids: ['ventOperatorDay', 'ventClientDay', 'ventFamilyDay', 'ventVatDay', 'ventVatDayDetail', 'ventClientMonth', 'ventFamilyMonth', 'ventVatMonth'] },
];
const today = () => localDay(new Date().toISOString());
const monthStart = () => `${today().slice(0, 8)}01`;

export function CashJournalsScreen({ companyId, companyName }: { companyId: string; companyName: string }) {
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [checked, setChecked] = useState<Set<JournalId>>(new Set(['cashJournal']));
  const [current, setCurrent] = useState<JournalId>('cashJournal');
  const [familyLevel, setFamilyLevel] = useState('1');
  const [vatRate, setVatRate] = useState('all');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState<'pdf' | 'xlsx' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to;
  const { data, isLoading, error: loadError } = useQuery({
    queryKey: ['cash-journal-data', companyId, from, to],
    queryFn: () => getJournalData(companyId, from, to),
    enabled: valid, retry: false,
  });
  const opts = { familyLevel: Number(familyLevel), vatRate: vatRate === 'all' ? null : Number(vatRate), reference };
  const rates = useMemo(() => [...new Set((data?.lines ?? []).map((l) => l.vat_rate))].sort((a, b) => a - b), [data]);
  const preview: Journal | null = useMemo(() => (data ? buildJournal(current, data, opts) : null), [data, current, familyLevel, vatRate, reference]); // eslint-disable-line react-hooks/exhaustive-deps
  const head = { companyName, period: periodLabel(from, to) };
  const selection = () => (data ? JOURNAL_ORDER.filter((id) => checked.has(id)).map((id) => buildJournal(id, data, opts)) : []);

  const exportPdf = async () => {
    setError(null); setBusy('pdf');
    try { openPdfBytes(await buildJournalsPdf(selection(), head)); } catch (e) { setError(errorMessage(e)); } finally { setBusy(null); }
  };
  const exportXlsx = () => {
    setError(null); setBusy('xlsx');
    try { downloadBytes(buildJournalsXlsx(selection(), head), `journaux-caisse-${from}-${to}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(null); }
  };
  const toggle = (id: JournalId, v: boolean) => setChecked((s) => { const n = new Set(s); if (v) n.add(id); else n.delete(id); return n; });

  if (loadError instanceof DepositsUnavailable) {
    return <p className="flex items-center gap-2 rounded-md bg-info-bg px-3 py-2 text-[13px] text-info"><Info className="size-4" /> {t('cashJournals.unavailable')}</p>;
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-card p-4">
        <Field label={t('cashDeposits.periodFrom')}><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" /></Field>
        <Field label={t('cashDeposits.periodTo')}><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" /></Field>
        <Button variant="outline" size="sm" onClick={() => { setFrom(today()); setTo(today()); }}>{t('cashJournals.today')}</Button>
        <Button variant="outline" size="sm" onClick={() => { setFrom(monthStart()); setTo(today()); }}>{t('cashJournals.thisMonth')}</Button>
        <Field label={t('cashJournals.familyLevel')}>
          <Select value={familyLevel} onValueChange={setFamilyLevel}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>{['1', '2', '3', '9'].map((l) => <SelectItem key={l} value={l}>{l === '9' ? t('cashJournals.familyFull') : `${t('cashJournals.level')} ${l}`}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label={t('cashJournals.vatRateFilter')}>
          <Select value={vatRate} onValueChange={setVatRate}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">{t('cashJournals.allRates')}</SelectItem>{rates.map((r) => <SelectItem key={r} value={String(r)}>{r} %</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label={t('cashJournals.referenceFilter')}><Input value={reference} onChange={(e) => setReference(e.target.value)} className="w-44" /></Field>
      </div>
      {!valid && <p className="text-[12px] text-warning">{t('cashJournals.badPeriod')}</p>}
      {loadError && !(loadError instanceof DepositsUnavailable) && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{errorMessage(loadError)}</p>}
      {error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        <div className="space-y-3 rounded-md border border-border bg-card p-3">
          {GROUPS.map((g) => (
            <div key={g.key} className="space-y-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t(`cashJournals.group.${g.key}`)}</p>
              {g.ids.map((id) => (
                <div key={id} className={`flex items-center gap-2 rounded-sm px-1 py-0.5 text-[13px] ${current === id ? 'bg-muted font-bold' : ''}`}>
                  <Checkbox checked={checked.has(id)} onCheckedChange={(v) => toggle(id, v === true)} aria-label={t(`cashJournals.j.${id}`)} />
                  <button type="button" className="text-left" onClick={() => setCurrent(id)}>{t(`cashJournals.j.${id}`)}</button>
                </div>
              ))}
            </div>
          ))}
          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <Button onClick={exportPdf} disabled={!data || checked.size === 0 || busy != null}>{busy === 'pdf' ? <Loader2 className="animate-spin" /> : <FileDown />} {t('cashJournals.pdfSelection')}</Button>
            <Button variant="outline" onClick={exportXlsx} disabled={!data || checked.size === 0 || busy != null}>{busy === 'xlsx' ? <Loader2 className="animate-spin" /> : <FileSpreadsheet />} {t('cashJournals.xlsxSelection')}</Button>
          </div>
        </div>
        <div className="min-w-0 space-y-3">
          {isLoading && <div className="grid place-items-center py-16"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>}
          {preview && <JournalView journal={preview} period={head.period} />}
        </div>
      </div>
    </div>
  );
}

const JOURNAL_ORDER: JournalId[] = GROUPS.flatMap((g) => g.ids);

/** Aperçu écran d'un journal (mêmes tableaux que le PDF). */
export function JournalView({ journal, period }: { journal: Journal; period: string }) {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-bold">{journal.title}</p>
        <p className="font-data text-[12px] text-muted-foreground">{period}</p>
      </div>
      {journal.sections.length === 0 && <p className="text-[13px] text-muted-foreground">{t('cashJournals.empty')}</p>}
      {journal.sections.map((sec, i) => (
        <div key={i} className="overflow-x-auto rounded-md border border-border">
          {sec.title && <p className="border-b border-border bg-muted px-3 py-1.5 text-[12px] font-bold">{sec.title}</p>}
          <table className="w-full border-collapse font-data text-[12px]">
            <thead className="bg-muted"><tr>
              {sec.columns.map((c, k) => <th key={k} className={`whitespace-nowrap px-2 py-1.5 font-ui text-[10px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${isRightAligned(c.kind) ? 'text-right' : 'text-left'}`}>{c.label}</th>)}
            </tr></thead>
            <tbody>
              {sec.rows.length === 0 && <tr><td colSpan={sec.columns.length} className="px-2 py-4 text-center text-muted-foreground">{t('cashJournals.empty')}</td></tr>}
              {sec.rows.map((r, k) => (
                <tr key={k} className={`border-b border-border last:border-0 ${r.tone === 'total' || r.tone === 'subtotal' ? 'bg-muted font-bold' : r.tone === 'group' ? 'font-bold' : r.tone === 'detail' ? 'text-muted-foreground' : ''}`}>
                  {r.cells.map((c, n) => {
                    const kind = sec.columns[n]?.kind ?? 'text';
                    return <td key={n} className={`px-2 py-1 ${isRightAligned(kind) ? 'text-right tabular-nums' : ''} ${typeof c === 'number' && c < 0 && kind === 'money' ? 'text-danger' : ''}`}>{formatCell(c, kind)}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {journal.notes.map((n, i) => <p key={i} className="text-[11px] text-muted-foreground">{n}</p>)}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><span className="block text-[10px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</span>{children}</div>;
}
