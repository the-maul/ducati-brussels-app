/**
 * Encaissements (rattrapage G8, 18/11/2026) — onglet « Clients débiteurs / créditeurs » : G8
 * « Liste des clients débiteurs » (client ; échéances du … jusqu'au … ; établie à la date du … ;
 * clients avec encaissements à échéances ; tri alphabétique / code client / date de facture /
 * compte comptable ; débiteurs / créditeurs ; dernière relance ; compte comptable ; total ;
 * Régulariser ; Exporter ; Visualiser / Imprimer liste et facture). Brouillons exclus.
 */
import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, FileDown, HandCoins, Loader2, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { t, fillVars } from '@/lib/i18n';
import { errorMessage } from '@/lib/mutation-feedback';
import { getDocumentFull } from '@/modules/sales/write-api';
import { openSalesPdfPreview } from '@/modules/sales/document-pdf-data';
import { listDebtorsDetailed, type ContactPick, type DebtorDetailRow } from './api';
import { RegularizeDialog } from './regularize-dialog';
import { buildTablePdf, openPdf } from './receivables-pdf';
import { eur, exportXlsx, fmtDate, todayIso } from './helpers';
import { ContactPicker, Empty, Lbl, Th } from './ui-bits';

type Sort = 'name' | 'code' | 'date' | 'account';

export function sortDebtors(rows: DebtorDetailRow[], sort: Sort): DebtorDetailRow[] {
  const s = [...rows];
  const by = (a: string | null | undefined, b: string | null | undefined) => String(a ?? '').localeCompare(String(b ?? ''), 'fr', { numeric: true });
  s.sort((a, b) => {
    if (sort === 'code') return by(a.contact_code, b.contact_code) || by(a.issue_date, b.issue_date);
    if (sort === 'date') return by(a.issue_date, b.issue_date) || by(a.number, b.number);
    if (sort === 'account') return by(a.accounting_account, b.accounting_account) || by(a.contact_name, b.contact_name);
    return by(a.contact_name, b.contact_name) || by(a.issue_date, b.issue_date);
  });
  return s;
}

export function DebtorsTab({ companyId, companyName, canWrite }: { companyId: string; companyName: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const [contact, setContact] = useState<ContactPick | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [asOf, setAsOf] = useState(todayIso());
  const [side, setSide] = useState<'debit' | 'credit'>('debit');
  const [onlyScheduled, setOnlyScheduled] = useState(false);
  const [sort, setSort] = useState<Sort>('name');
  const [reg, setReg] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ['debtors-detailed', companyId, contact?.id, from, to, asOf, side, onlyScheduled],
    queryFn: () => listDebtorsDetailed(companyId, { contactId: contact?.id, dueFrom: from, dueTo: to, asOf, side, onlyScheduled }),
  });
  const rows = useMemo(() => sortDebtors(q.data ?? [], sort), [q.data, sort]);
  const total = rows.reduce((s, r) => s + r.amount_due, 0);
  const clients = new Set(rows.map((r) => r.contact_id)).size;

  const header = [t('receivables.colCode'), t('receivables.colClient'), t('receivables.colNumber'), t('receivables.colDate'), t('receivables.colDueDate'),
    t('receivables.colTtc'), t('receivables.colBalance'), t('receivables.colLastType'), t('receivables.colLastDate'), t('receivables.colAccount')];
  const asCells = (r: DebtorDetailRow) => [r.contact_code ?? '', r.contact_name, r.number ?? '—', fmtDate(r.issue_date), fmtDate(r.due_date),
    eur(r.total_ttc), eur(r.amount_due), r.last_code ? `${r.last_code} ${r.last_label ?? ''}` : '', r.last_date ? fmtDate(r.last_date) : '', r.accounting_account ?? ''];
  const title = side === 'credit' ? t('receivables.creditorsTitle') : t('receivables.debtorsTitle');
  const subtitle = fillVars(t('receivables.deferredSubtitle'), { from: from ? fmtDate(from) : '…', to: to ? fmtDate(to) : '…', asOf: fmtDate(asOf) });

  const print = async () => {
    const w = window.open('', '_blank');
    openPdf(await buildTablePdf({
      title, subtitle, companyName, landscape: true,
      columns: [{ label: header[0], width: 14 }, { label: header[1], width: 44 }, { label: header[2], width: 22 }, { label: header[3], width: 18 }, { label: header[4], width: 18 },
        { label: header[5], width: 20, align: 'right' }, { label: header[6], width: 20, align: 'right' }, { label: header[7], width: 32 }, { label: header[8], width: 18 }, { label: header[9], width: 18 }],
      rows: rows.map(asCells), totalLabel: `${t('receivables.totalDue')} (${clients} ${t('receivables.clientsShort')})`, totalValue: eur(total),
    }), w);
  };
  const exportX = () => exportXlsx(`${side === 'credit' ? 'Clients_crediteurs' : 'Clients_debiteurs'}_${asOf}.xlsx`, title, header,
    rows.map((r) => [r.contact_code, r.contact_name, r.number, r.issue_date, r.due_date, r.total_ttc, r.amount_due, r.last_code ? `${r.last_code} ${r.last_label ?? ''}` : '', r.last_date ? r.last_date.slice(0, 10) : '', r.accounting_account]));
  const viewInvoice = async (id: string) => { try { await openSalesPdfPreview(await getDocumentFull(id)); } catch (e) { setError(errorMessage(e)); } };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-card p-3">
        <label className="space-y-1"><Lbl>{t('receivables.colClient')}</Lbl><ContactPicker companyId={companyId} value={contact} onChange={setContact} /></label>
        <label className="space-y-1"><Lbl>{t('receivables.dueFrom')}</Lbl><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" /></label>
        <label className="space-y-1"><Lbl>{t('receivables.dueTo')}</Lbl><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" /></label>
        <label className="space-y-1"><Lbl>{t('receivables.asOf')}</Lbl><Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="w-40" /></label>
        <label className="space-y-1"><Lbl>{t('receivables.side')}</Lbl>
          <Select value={side} onValueChange={(v) => setSide(v as 'debit' | 'credit')}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="debit">{t('receivables.debtorsTitle')}</SelectItem><SelectItem value="credit">{t('receivables.creditorsTitle')}</SelectItem></SelectContent>
          </Select>
        </label>
        <label className="space-y-1"><Lbl>{t('receivables.sortBy')}</Lbl>
          <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="name">{t('receivables.sortName')}</SelectItem><SelectItem value="code">{t('receivables.sortCode')}</SelectItem>
              <SelectItem value="date">{t('receivables.sortDate')}</SelectItem><SelectItem value="account">{t('receivables.sortAccount')}</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label className="flex h-9 items-center gap-2 text-[12px] text-muted-foreground">
          <input type="checkbox" checked={onlyScheduled} onChange={(e) => setOnlyScheduled(e.target.checked)} className="size-4 accent-[var(--ducati-red)]" /> {t('receivables.onlyScheduled')}
        </label>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void print()} disabled={!rows.length}><Printer /> {t('receivables.print')}</Button>
          <Button variant="outline" size="sm" onClick={() => void exportX()} disabled={!rows.length}><FileDown /> {t('receivables.exportExcel')}</Button>
        </div>
      </div>
      {error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}
      {q.isLoading ? <div className="grid place-items-center py-10"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
        : q.isError ? <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{errorMessage(q.error)}</p>
        : rows.length === 0 ? <Empty>{t('receivables.noDebtors')}</Empty> : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full border-collapse font-data text-[12px]">
            <thead className="bg-muted"><tr>{header.map((h, i) => <Th key={h} className={i === 5 || i === 6 ? 'text-right' : ''}>{h}</Th>)}<Th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.document_id} className="border-b border-border last:border-0">
                  <td className="px-2 py-1.5 font-mono">{r.contact_code ?? ''}</td>
                  <td className="px-2 py-1.5"><Link to="/clients/$contactId" params={{ contactId: r.contact_id }} className="hover:underline">{r.contact_name}</Link></td>
                  <td className="px-2 py-1.5 font-mono"><Link to="/sales/$documentId" params={{ documentId: r.document_id }} className="hover:underline">{r.number ?? '—'}</Link></td>
                  <td className="px-2 py-1.5">{fmtDate(r.issue_date)}</td>
                  <td className={`px-2 py-1.5 ${r.due_date < asOf && r.amount_due > 0 ? 'text-danger' : ''}`}>{fmtDate(r.due_date)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{eur(r.total_ttc)}</td>
                  <td className={`px-2 py-1.5 text-right font-bold tabular-nums ${r.amount_due > 0 ? 'text-danger' : 'text-info'}`}>{eur(r.amount_due)}</td>
                  <td className="px-2 py-1.5">{r.last_code ? `${r.last_code} · ${r.last_label ?? ''}` : '—'}</td>
                  <td className="px-2 py-1.5">{r.last_date ? fmtDate(r.last_date) : '—'}</td>
                  <td className="px-2 py-1.5 font-mono">{r.accounting_account ?? ''}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right">
                    <Button size="sm" variant="ghost" title={t('receivables.viewInvoice')} onClick={() => void viewInvoice(r.document_id)}><Eye className="size-4" /></Button>
                    {canWrite && <Button size="sm" variant="ghost" title={t('receivables.regularize')} onClick={() => setReg({ id: r.contact_id, name: r.contact_name })}><HandCoins className="size-4" /></Button>}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="bg-muted font-bold">
              <td colSpan={6} className="px-2 py-2 text-right">{t('receivables.totalDue')} ({clients} {t('receivables.clientsShort')})</td>
              <td className="px-2 py-2 text-right tabular-nums">{eur(total)}</td><td colSpan={4} />
            </tr></tfoot>
          </table>
        </div>
      )}
      <RegularizeDialog companyId={companyId} contact={reg} onClose={() => setReg(null)}
        onDone={() => { qc.invalidateQueries({ queryKey: ['debtors-detailed'] }); qc.invalidateQueries({ queryKey: ['regularize'] }); qc.invalidateQueries({ queryKey: ['documents'] }); }} />
    </div>
  );
}
