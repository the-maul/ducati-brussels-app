/**
 * M6 (POS) — Caisse → Clôtures (PDV010, 03/11/2026) : historique des journaux Z figés = journal
 * des recettes. Par mois (ou par jour) : une ligne par Z (numéro, jour, tickets, CA net TVAC, écart
 * et motif), détail du Z, PDF réimprimable depuis l'instantané figé (mention « Réimpression »),
 * PDF original de la GED, export CSV du journal des recettes du jour ou du mois.
 * Un Z ne se rouvre jamais (la base le refuse) : cet écran ne fait que lire.
 */
import { Fragment, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, FileDown, Download, Eye, EyeOff, Archive } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';
import { errorMessage } from '@/lib/mutation-feedback';
import { listClosedSessions, frozenZ, archivedZPdfUrl } from './cash-api';
import { journalCsv, journalCsvFileName, journalRows, journalTotals, zDay, type ZReport } from './z-report';
import { buildZPdf, openPdfBytes } from './z-report-pdf';
import { ZReportView } from './z-report-view';

const eur = (n: number | null | undefined) => (n == null ? '—' : `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`);
const p2 = (n: number) => String(n).padStart(2, '0');
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}`; };

/** Bornes ISO (locales) d'un mois « AAAA-MM » : premier jour inclus, premier jour du mois suivant exclu. */
function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  return { from: new Date(y, m - 1, 1).toISOString(), to: new Date(y, m, 1).toISOString() };
}

/** Libellés des colonnes du CSV du journal des recettes. */
export const journalCsvLabels = () => ({
  number: t('cash.csvNumber'), day: t('cash.csvDay'), register: t('cash.register'), tickets: t('cash.ticketCount'),
  base: t('cash.baseHt'), vat: t('cash.vatAmount'), ttc: t('cash.ttc'), discounts: t('cash.discounts'),
  refunds: t('cash.refundsTtc'), net: t('cash.netSales'), opening: t('cash.openingFloat'), expected: t('cash.theoretical'),
  counted: t('cash.countedCash'), variance: t('cash.variance'), reason: t('cash.varianceReason'), total: t('cash.total'),
});

function downloadCsv(text: string, fileName: string) {
  // BOM UTF-8 : Excel ouvre les accents correctement.
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = fileName; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function ClosuresScreen({ companyId }: { companyId: string }) {
  const [month, setMonth] = useState(thisMonth());
  const [day, setDay] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bounds = useMemo(() => (/^\d{4}-\d{2}$/.test(month) ? monthBounds(month) : null), [month]);
  const { data: sessions, isLoading } = useQuery({
    queryKey: ['cash-closures', companyId, month],
    queryFn: () => listClosedSessions(companyId, bounds?.from, bounds?.to),
    enabled: !!bounds,
  });

  // Seuls les Z figés (numérotés) forment le journal ; une session clôturée avant la migration n'a pas de Z.
  const zs: ZReport[] = useMemo(() => (sessions ?? []).map(frozenZ).filter((z): z is ZReport => !!z && !!z.number), [sessions]);
  const shown = day ? zs.filter((z) => zDay(z) === day) : zs;
  const rows = journalRows(shown);
  const totals = journalTotals(rows);
  const legacyCount = (sessions ?? []).length - zs.length;

  const reprint = async (z: ZReport) => {
    setError(null);
    try { openPdfBytes(await buildZPdf(z, { reprintAt: new Date() })); } catch (e) { setError(errorMessage(e)); }
  };
  const original = async (z: ZReport) => {
    setError(null);
    try {
      const url = await archivedZPdfUrl(z.session_id);
      if (url) window.open(url, '_blank'); else setError(t('cash.zNoArchive'));
    } catch (e) { setError(errorMessage(e)); }
  };
  const exportCsv = () => {
    const period = day || month;
    const register = shown[0]?.register_code ?? 'CAISSE-1';
    downloadCsv(journalCsv(shown, journalCsvLabels()), journalCsvFileName(register, period));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-card p-4">
        <div className="space-y-1">
          <Label>{t('cash.month')}</Label>
          <Input type="month" value={month} onChange={(e) => { setMonth(e.target.value); setDay(''); }} className="w-40" />
        </div>
        <div className="space-y-1">
          <Label>{t('cash.dayOptional')}</Label>
          <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="w-44" />
        </div>
        <p className="flex-1 text-[12px] text-muted-foreground">{t('cash.closuresHint')}</p>
        <Button variant="outline" onClick={exportCsv} disabled={rows.length === 0}><Download /> {day ? t('cash.exportDay') : t('cash.exportMonth')}</Button>
      </div>

      {error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}
      {legacyCount > 0 && <p className="rounded-md bg-info-bg px-3 py-2 text-[12px] text-info">{t('cash.legacySessions')}</p>}

      {isLoading ? <div className="grid place-items-center py-10"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div> : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full border-collapse font-data text-[13px]">
            <thead className="bg-muted"><tr>
              <Th>{t('cash.colZ')}</Th><Th>{t('cash.csvDay')}</Th><Th className="text-right">{t('cash.ticketCount')}</Th>
              <Th className="text-right">{t('cash.refundsTtc')}</Th><Th className="text-right">{t('cash.netSales')}</Th>
              <Th className="text-right">{t('cash.variance')}</Th><Th>{t('cash.varianceReason')}</Th><Th className="w-48" />
            </tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">{t('cash.noClosures')}</td></tr>}
              {rows.map((r) => {
                const z = shown.find((x) => x.number === r.number) as ZReport;
                return (
                  <Fragment key={r.number}>
                    <tr className="border-b border-border">
                      <td className="px-3 py-2 font-bold">{r.number}</td>
                      <td className="px-3 py-2">{r.day}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.ticket_count}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{eur(r.refunds_ttc)}</td>
                      <td className="px-3 py-2 text-right font-bold tabular-nums">{eur(r.net_sales_ttc)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${Math.abs(r.variance ?? 0) > 0.005 ? 'text-danger' : ''}`}>{eur(r.variance)}</td>
                      <td className="px-3 py-2">{r.variance_reason ?? ''}</td>
                      <td className="px-2 py-1 text-right">
                        <Button size="sm" variant="ghost" title={t('cash.viewZ')} onClick={() => setOpen(open === r.number ? null : r.number)}>{open === r.number ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</Button>
                        <Button size="sm" variant="ghost" title={t('cash.reprintZ')} onClick={() => reprint(z)}><FileDown className="size-4" /></Button>
                        <Button size="sm" variant="ghost" title={t('cash.originalZ')} onClick={() => original(z)}><Archive className="size-4" /></Button>
                      </td>
                    </tr>
                    {open === r.number && <tr><td colSpan={8} className="p-3"><ZReportView z={z} showCash /></td></tr>}
                  </Fragment>
                );
              })}
              {rows.length > 0 && (
                <tr className="bg-muted font-bold">
                  <td className="px-3 py-2" colSpan={2}>{t('cash.total')}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{totals.ticket_count}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{eur(totals.refunds_ttc)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{eur(totals.net_sales_ttc)}</td>
                  <td colSpan={3} />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-[10px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{children}</label>;
}
function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
