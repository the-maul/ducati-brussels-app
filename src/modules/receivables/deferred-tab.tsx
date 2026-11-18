/**
 * Encaissements (rattrapage G8, 18/11/2026) — onglet « Chèques et échéances » : G8 « Liste des
 * chèques à échéance » (client, échéances du … au …, établie à la date du …, Visualiser /
 * Imprimer) + « Gestion des encaissements à échéance » (Modifier cet encaissement, Encaissement
 * immédiat) + « Annuler échéances » (motif obligatoire, tracé).
 */
import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Check, FileDown, Loader2, Pencil, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { t, fillVars } from '@/lib/i18n';
import { errorMessage } from '@/lib/mutation-feedback';
import { markPaymentReceived } from '@/modules/sales/write-api';
import { cancelInstallments, listDeferredPayments, type DeferredRow, type ContactPick } from './api';
import { DeferredEditDialog } from './deferred-edit-dialog';
import { buildTablePdf, openPdf } from './receivables-pdf';
import { eur, exportXlsx, fmtDate, plusDaysIso, todayIso } from './helpers';
import { ContactPicker, DeferredBadge, Empty, Lbl, Th } from './ui-bits';

export function DeferredTab({ companyId, companyName, canWrite }: { companyId: string; companyName: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const [contact, setContact] = useState<ContactPick | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState(plusDaysIso(90));
  const [asOf, setAsOf] = useState(todayIso());
  const [withDone, setWithDone] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<DeferredRow | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ['deferred-payments', companyId, contact?.id, from, to, asOf, withDone],
    queryFn: () => listDeferredPayments(companyId, { dueFrom: from, dueTo: to, contactId: contact?.id, asOf, withDone }),
  });
  const rows = q.data ?? [];
  const pending = rows.filter((r) => r.status === 'attendu');
  const totals = useMemo(() => ({
    pending: pending.reduce((s, r) => s + r.amount, 0),
    overdue: pending.filter((r) => r.is_overdue).reduce((s, r) => s + r.amount, 0),
  }), [pending]);
  const refresh = () => { setSel(new Set()); qc.invalidateQueries({ queryKey: ['deferred-payments'] }); qc.invalidateQueries({ queryKey: ['documents'] }); };

  const receive = useMutation({
    mutationFn: (r: DeferredRow) => markPaymentReceived(r.payment_id, r.document_id),
    onSuccess: refresh, onError: (e) => setError(errorMessage(e)),
  });
  const cancel = useMutation({
    mutationFn: () => cancelInstallments([...sel], reason),
    onSuccess: () => { setCancelOpen(false); setReason(''); refresh(); }, onError: (e) => setError(errorMessage(e)),
  });

  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allPendingSelected = pending.length > 0 && pending.every((r) => sel.has(r.payment_id));

  const tableRows = rows.map((r) => [
    r.number ?? '—', fmtDate(r.issue_date), r.contact_name ?? '—', r.method_label,
    r.installment_no ? `${r.installment_no}/${r.installments ?? '?'}` : '', fmtDate(r.due_date), eur(r.amount),
    r.bank_name ?? '', r.cheque_number ?? '', statusText(r),
  ]);
  const header = [t('receivables.colNumber'), t('receivables.colDate'), t('receivables.colClient'), t('receivables.colMethod'), t('receivables.colInstallment'),
    t('receivables.colDueDate'), t('receivables.colAmount'), t('receivables.colBank'), t('receivables.colCheque'), t('receivables.colStatus')];
  const subtitle = fillVars(t('receivables.deferredSubtitle'), { from: from ? fmtDate(from) : '…', to: to ? fmtDate(to) : '…', asOf: fmtDate(asOf) });

  const print = async () => {
    const w = window.open('', '_blank');
    const bytes = await buildTablePdf({
      title: t('receivables.deferredTitle'), subtitle: `${subtitle}${contact ? ` · ${contact.name}` : ''}`, companyName, landscape: true,
      columns: [{ label: header[0], width: 22 }, { label: header[1], width: 18 }, { label: header[2], width: 40 }, { label: header[3], width: 22 },
        { label: header[4], width: 12 }, { label: header[5], width: 18 }, { label: header[6], width: 20, align: 'right' }, { label: header[7], width: 26 },
        { label: header[8], width: 20 }, { label: header[9], width: 18 }],
      rows: tableRows, totalLabel: t('receivables.totalPending'), totalValue: eur(totals.pending),
    });
    openPdf(bytes, w);
  };
  const exportX = () => exportXlsx(`Echeances_${todayIso()}.xlsx`, t('receivables.tabDeferred'), header,
    rows.map((r) => [r.number, r.issue_date, r.contact_name, r.method_label, r.installment_no ? `${r.installment_no}/${r.installments ?? ''}` : '', r.due_date, r.amount, r.bank_name, r.cheque_number, statusText(r)]));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-card p-3">
        <label className="space-y-1"><Lbl>{t('receivables.colClient')}</Lbl><ContactPicker companyId={companyId} value={contact} onChange={setContact} /></label>
        <label className="space-y-1"><Lbl>{t('receivables.dueFrom')}</Lbl><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" /></label>
        <label className="space-y-1"><Lbl>{t('receivables.dueTo')}</Lbl><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" /></label>
        <label className="space-y-1"><Lbl>{t('receivables.asOf')}</Lbl><Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="w-40" /></label>
        <label className="flex h-9 items-center gap-2 text-[12px] text-muted-foreground">
          <input type="checkbox" checked={withDone} onChange={(e) => setWithDone(e.target.checked)} className="size-4 accent-[var(--ducati-red)]" /> {t('receivables.withDone')}
        </label>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void print()} disabled={!rows.length}><Printer /> {t('receivables.print')}</Button>
          <Button variant="outline" size="sm" onClick={() => void exportX()} disabled={!rows.length}><FileDown /> {t('receivables.exportExcel')}</Button>
          {canWrite && <Button variant="outline" size="sm" onClick={() => { setReason(''); setCancelOpen(true); }} disabled={sel.size === 0}><Ban /> {t('receivables.cancelInstallments')} ({sel.size})</Button>}
        </div>
      </div>
      {error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}
      {q.isLoading ? <div className="grid place-items-center py-10"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
        : q.isError ? <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{errorMessage(q.error)}</p>
        : rows.length === 0 ? <Empty>{t('receivables.noDeferred')}</Empty> : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full border-collapse font-data text-[12px]">
            <thead className="bg-muted"><tr>
              <Th>{canWrite && <input type="checkbox" checked={allPendingSelected} onChange={(e) => setSel(e.target.checked ? new Set(pending.map((r) => r.payment_id)) : new Set())} className="size-4 accent-[var(--ducati-red)]" />}</Th>
              {header.map((h, i) => <Th key={h} className={i === 6 ? 'text-right' : ''}>{h}</Th>)}<Th />
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.payment_id} className="border-b border-border last:border-0">
                  <td className="px-2 py-1.5">{canWrite && r.status === 'attendu' && <input type="checkbox" checked={sel.has(r.payment_id)} onChange={() => toggle(r.payment_id)} className="size-4 accent-[var(--ducati-red)]" />}</td>
                  <td className="px-2 py-1.5 font-mono"><Link to="/sales/$documentId" params={{ documentId: r.document_id }} className="hover:underline">{r.number ?? '—'}</Link></td>
                  <td className="px-2 py-1.5">{fmtDate(r.issue_date)}</td>
                  <td className="px-2 py-1.5">{r.contact_id ? <Link to="/clients/$contactId" params={{ contactId: r.contact_id }} className="hover:underline">{r.contact_name}</Link> : '—'}</td>
                  <td className="px-2 py-1.5">{r.method_label}</td>
                  <td className="px-2 py-1.5 tabular-nums">{r.installment_no ? `${r.installment_no}/${r.installments ?? '?'}` : ''}</td>
                  <td className="px-2 py-1.5">{fmtDate(r.due_date)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{eur(r.amount)}</td>
                  <td className="px-2 py-1.5">{r.bank_name ?? ''}</td>
                  <td className="px-2 py-1.5 font-mono">{r.cheque_number ?? ''}</td>
                  <td className="px-2 py-1.5" title={r.cancel_reason ?? undefined}><DeferredBadge status={r.status} overdue={r.is_overdue} /></td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right">
                    {canWrite && r.status === 'attendu' && (
                      <>
                        <Button size="sm" variant="ghost" title={t('receivables.editDeferred')} onClick={() => setEdit(r)}><Pencil className="size-4" /></Button>
                        <Button size="sm" variant="ghost" title={t('receivables.receiveNow')} onClick={() => receive.mutate(r)} disabled={receive.isPending}><Check className="size-4 text-success" /></Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="bg-muted font-bold">
              <td colSpan={7} className="px-2 py-2 text-right">{t('receivables.totalPending')}</td>
              <td className="px-2 py-2 text-right tabular-nums">{eur(totals.pending)}</td>
              <td colSpan={4} className="px-2 py-2 text-danger tabular-nums">{totals.overdue > 0.005 ? `${t('receivables.stOverdue')} : ${eur(totals.overdue)}` : ''}</td>
            </tr></tfoot>
          </table>
        </div>
      )}

      <DeferredEditDialog payment={edit ? { id: edit.payment_id, amount: edit.amount, due_date: edit.due_date, cheque_number: edit.cheque_number, bank_name: edit.bank_name } : null} onOpenChange={(o) => { if (!o) setEdit(null); }} onDone={refresh} />
      <AlertDialog open={cancelOpen} onOpenChange={(o) => { if (!cancel.isPending) setCancelOpen(o); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('receivables.cancelInstallments')}</AlertDialogTitle>
            <AlertDialogDescription>{fillVars(t('receivables.cancelInstallmentsBody'), { n: String(sel.size) })}</AlertDialogDescription>
          </AlertDialogHeader>
          <label className="space-y-1"><Lbl>{t('receivables.reason')}</Lbl><Input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></label>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancel.isPending}>{t('action.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); cancel.mutate(); }} disabled={cancel.isPending || !reason.trim()}>
              {cancel.isPending ? <Loader2 className="animate-spin" /> : <Ban />} {t('receivables.cancelInstallmentsDo')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function statusText(r: DeferredRow): string {
  if (r.status === 'recu') return t('receivables.stReceived');
  if (r.status === 'annule') return t('receivables.stCancelled');
  return r.is_overdue ? t('receivables.stOverdue') : t('receivables.stUpcoming');
}
