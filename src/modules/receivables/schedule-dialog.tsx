/**
 * Encaissements (rattrapage G8, 18/11/2026) — « Calculer sur 12 échéances automatique » :
 * échéancier en N fois depuis le pied de facture / le panneau de règlement. Aperçu calculé par
 * `buildSchedule` (mêmes règles que la base), enregistrement par `payment_schedule_create`.
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CalendarClock, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { t } from '@/lib/i18n';
import { errorMessage } from '@/lib/mutation-feedback';
import { listPaymentMethods } from '@/modules/sales/write-api';
import { buildSchedule, validateSchedule, DEFAULT_INSTALLMENTS } from './schedule';
import { createPaymentSchedule, getReceivableSettings } from './api';
import { eur, fmtDate, parseAmount, plusDaysIso } from './helpers';

export function ScheduleDialog({ open, onOpenChange, documentId, companyId, openAmount, onDone }: {
  open: boolean; onOpenChange: (o: boolean) => void; documentId: string; companyId: string;
  /** Reste à payer du document, échéances déjà prévues déduites. */
  openAmount: number; onDone: () => void;
}) {
  const methodsQ = useQuery({ queryKey: ['pay-methods', companyId], queryFn: () => listPaymentMethods(companyId), enabled: open });
  const settingsQ = useQuery({ queryKey: ['receivable-settings', companyId], queryFn: () => getReceivableSettings(companyId), enabled: open, retry: false });
  const [total, setTotal] = useState('');
  const [count, setCount] = useState(String(DEFAULT_INSTALLMENTS));
  const [firstDue, setFirstDue] = useState(plusDaysIso(30));
  const [intervalMonths, setIntervalMonths] = useState('1');
  const [method, setMethod] = useState('');
  const [bank, setBank] = useState('');
  const [cheque, setCheque] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTotal(openAmount > 0 ? openAmount.toFixed(2) : '');
    setError(null);
  }, [open, openAmount]);
  useEffect(() => { if (open && settingsQ.data) setCount(String(settingsQ.data.default_installments)); }, [open, settingsQ.data]);
  const methods = (methodsQ.data ?? []).filter((m) => m.code !== 'STRIPE' && m.code !== 'BA');
  useEffect(() => {
    if (!method && methods.length) setMethod(methods.find((m) => m.code === 'CHQ')?.code ?? methods[0].code);
  }, [methods, method]);

  const input = { total: parseAmount(total), count: Number(count), firstDue, intervalMonths: Number(intervalMonths), firstCheque: cheque };
  const invalid = validateSchedule(input, openAmount);
  const lines = useMemo(() => (invalid ? [] : buildSchedule(input)), [invalid, total, count, firstDue, intervalMonths, cheque]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: () => createPaymentSchedule({ documentId, total: input.total, count: input.count, firstDue, method, intervalMonths: input.intervalMonths, bank, firstCheque: cheque }),
    onSuccess: () => { onOpenChange(false); onDone(); },
    onError: (e) => setError(errorMessage(e)),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!save.isPending) onOpenChange(o); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('receivables.scheduleTitle')}</DialogTitle>
          <DialogDescription>{t('receivables.scheduleHelp')}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label={t('receivables.scheduleTotal')}><Input type="number" step="0.01" value={total} onChange={(e) => setTotal(e.target.value)} className="text-right tabular-nums" /></Field>
          <Field label={t('receivables.scheduleCount')}><Input type="number" min={1} max={60} value={count} onChange={(e) => setCount(e.target.value)} className="text-right tabular-nums" /></Field>
          <Field label={t('receivables.scheduleFirstDue')}><Input type="date" value={firstDue} onChange={(e) => setFirstDue(e.target.value)} /></Field>
          <Field label={t('receivables.scheduleInterval')}><Input type="number" min={1} max={12} value={intervalMonths} onChange={(e) => setIntervalMonths(e.target.value)} className="text-right tabular-nums" /></Field>
          <Field label={t('receivables.colMethod')}>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{methods.map((m) => <SelectItem key={m.code} value={m.code}>{m.label}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label={t('receivables.colBank')}><Input value={bank} onChange={(e) => setBank(e.target.value)} /></Field>
          <Field label={t('receivables.scheduleFirstCheque')}><Input value={cheque} onChange={(e) => setCheque(e.target.value)} className="font-mono" /></Field>
          <div className="flex items-end text-[12px] text-muted-foreground">{t('receivables.scheduleOpen')} : <b className="ml-1 tabular-nums text-foreground">{eur(openAmount)}</b></div>
        </div>
        {invalid && <p className="rounded-md bg-warning-bg px-3 py-2 text-[13px] text-warning">{t(`receivables.scheduleErr_${invalid}`)}</p>}
        {lines.length > 0 && (
          <div className="max-h-64 overflow-auto rounded-md border border-border">
            <table className="w-full border-collapse font-data text-[12px]">
              <thead className="sticky top-0 bg-muted"><tr>
                <th className="px-3 py-1.5 text-left">#</th><th className="px-3 py-1.5 text-left">{t('receivables.colDueDate')}</th>
                <th className="px-3 py-1.5 text-left">{t('receivables.colCheque')}</th><th className="px-3 py-1.5 text-right">{t('receivables.colAmount')}</th>
              </tr></thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.n} className="border-b border-border last:border-0">
                    <td className="px-3 py-1 tabular-nums">{l.n}/{lines.length}</td>
                    <td className="px-3 py-1">{fmtDate(l.dueDate)}</td>
                    <td className="px-3 py-1 font-mono">{l.cheque ?? '—'}</td>
                    <td className="px-3 py-1 text-right tabular-nums">{eur(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>{t('action.cancel')}</Button>
          <Button onClick={() => save.mutate()} disabled={!!invalid || !method || save.isPending}>
            {save.isPending ? <Loader2 className="animate-spin" /> : <CalendarClock />} {t('receivables.scheduleCreate')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-[10px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
