/**
 * Encaissements (rattrapage G8, 18/11/2026) — « Régulariser » (G8 : liste des clients débiteurs →
 * Régularisations et encaissements) : encaisser UN montant sur plusieurs factures d'un client
 * (plus anciennes d'abord, `allocateAmount`), et compenser ses avoirs / trop-perçus avec ses
 * factures (lettrage AVO, `compensationPairs`). Chaque règlement passe par `addPayments` : mêmes
 * contrôles qu'au pied de facture (caisse ouverte pour les espèces, plafond légal, audit).
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeftRight, Check, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { t } from '@/lib/i18n';
import { errorMessage } from '@/lib/mutation-feedback';
import { addPayments, listPaymentMethods, CREDIT_SETTLEMENT_METHOD } from '@/modules/sales/write-api';
import { listDebtorsDetailed } from './api';
import { allocateAmount, compensationPairs } from './schedule';
import { Field } from './schedule-dialog';
import { eur, fmtDate, parseAmount } from './helpers';

const HIDDEN_METHODS = ['STRIPE', 'BA', 'DOM', 'ARR', 'AVO'];

export function RegularizeDialog({ companyId, contact, onClose, onDone }: {
  companyId: string; contact: { id: string; name: string } | null; onClose: () => void; onDone: () => void;
}) {
  const open = !!contact;
  const debitsQ = useQuery({ queryKey: ['regularize', 'debit', contact?.id], queryFn: () => listDebtorsDetailed(companyId, { contactId: contact!.id, side: 'debit' }), enabled: open });
  const creditsQ = useQuery({ queryKey: ['regularize', 'credit', contact?.id], queryFn: () => listDebtorsDetailed(companyId, { contactId: contact!.id, side: 'credit' }), enabled: open });
  const methodsQ = useQuery({ queryKey: ['pay-methods', companyId], queryFn: () => listPaymentMethods(companyId), enabled: open });
  const methods = (methodsQ.data ?? []).filter((m) => !HIDDEN_METHODS.includes(m.code));
  const debits = debitsQ.data ?? [];
  const credits = creditsQ.data ?? [];
  const totalDue = debits.reduce((s, r) => s + r.amount_due, 0);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('');
  const [cheque, setCheque] = useState('');
  const [bank, setBank] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setAmount(''); setCheque(''); setBank(''); setError(null); } }, [open, contact?.id]);
  useEffect(() => { if (!method && methods.length) setMethod(methods[0].code); }, [methods, method]);

  const targets = debits.map((r) => ({ id: r.document_id, due: r.amount_due, dueDate: r.due_date }));
  const alloc = useMemo(() => allocateAmount(parseAmount(amount), targets), [amount, debits]); // eslint-disable-line react-hooks/exhaustive-deps
  const pairs = useMemo(() => compensationPairs(targets, credits.map((r) => ({ id: r.document_id, due: r.amount_due, dueDate: r.due_date }))), [debits, credits]); // eslint-disable-line react-hooks/exhaustive-deps
  const numberOf = (id: string) => [...debits, ...credits].find((r) => r.document_id === id)?.number ?? '—';

  const pay = useMutation({
    mutationFn: async () => {
      if (alloc.allocations.length === 0) throw new Error(t('receivables.regNeedAmount'));
      if (alloc.left > 0.005) throw new Error(t('receivables.regTooMuch'));
      for (const a of alloc.allocations) {
        await addPayments(a.id, [{ method, amount: a.amount, status: 'recu', chequeNumber: cheque || null, bankName: bank || null, note: t('receivables.regNote') }]);
      }
    },
    onSuccess: () => { onDone(); onClose(); },
    onError: (e) => setError(errorMessage(e)),
  });
  const compensate = useMutation({
    mutationFn: async () => {
      for (const p of pairs) {
        await addPayments(p.debitId, [{ method: CREDIT_SETTLEMENT_METHOD, amount: p.amount, status: 'recu', note: `${t('receivables.compensatedBy')} ${numberOf(p.creditId)}` }]);
        await addPayments(p.creditId, [{ method: CREDIT_SETTLEMENT_METHOD, amount: -p.amount, status: 'recu', note: `${t('receivables.compensates')} ${numberOf(p.debitId)}` }]);
      }
    },
    onSuccess: () => { onDone(); onClose(); },
    onError: (e) => setError(errorMessage(e)),
  });
  const busy = pay.isPending || compensate.isPending;
  const allocated = new Map(alloc.allocations.map((a) => [a.id, a.amount]));

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('receivables.regularize')} · {contact?.name}</DialogTitle>
          <DialogDescription>{t('receivables.regularizeHelp')}</DialogDescription>
        </DialogHeader>
        <div className="max-h-56 overflow-auto rounded-md border border-border">
          <table className="w-full border-collapse font-data text-[12px]">
            <thead className="sticky top-0 bg-muted"><tr>
              <th className="px-2 py-1.5 text-left">{t('receivables.colNumber')}</th><th className="px-2 py-1.5 text-left">{t('receivables.colDueDate')}</th>
              <th className="px-2 py-1.5 text-right">{t('receivables.colAmountDue')}</th><th className="px-2 py-1.5 text-right">{t('receivables.regAllocated')}</th>
            </tr></thead>
            <tbody>
              {[...debits, ...credits].map((r) => (
                <tr key={r.document_id} className="border-b border-border last:border-0">
                  <td className="px-2 py-1 font-mono">{r.number ?? '—'}</td>
                  <td className="px-2 py-1">{fmtDate(r.due_date)}</td>
                  <td className={`px-2 py-1 text-right tabular-nums ${r.amount_due < 0 ? 'text-info' : ''}`}>{eur(r.amount_due)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{allocated.has(r.document_id) ? eur(allocated.get(r.document_id)!) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label={`${t('receivables.colAmount')} (${eur(totalDue)})`}><Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="text-right tabular-nums" /></Field>
          <Field label={t('receivables.colMethod')}>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{methods.map((m) => <SelectItem key={m.code} value={m.code}>{m.label}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label={t('receivables.colCheque')}><Input value={cheque} onChange={(e) => setCheque(e.target.value)} className="font-mono" /></Field>
          <Field label={t('receivables.colBank')}><Input value={bank} onChange={(e) => setBank(e.target.value)} /></Field>
        </div>
        {alloc.left > 0.005 && <p className="rounded-md bg-warning-bg px-3 py-2 text-[13px] text-warning">{t('receivables.regTooMuch')}</p>}
        {error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}
        <DialogFooter className="flex-wrap gap-2">
          {pairs.length > 0 && (
            <Button variant="outline" onClick={() => { setError(null); compensate.mutate(); }} disabled={busy}>
              {compensate.isPending ? <Loader2 className="animate-spin" /> : <ArrowLeftRight />} {t('receivables.compensate')} ({eur(pairs.reduce((s, p) => s + p.amount, 0))})
            </Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={busy}>{t('action.cancel')}</Button>
          <Button onClick={() => { setError(null); pay.mutate(); }} disabled={busy || !method || alloc.allocations.length === 0 || alloc.left > 0.005}>
            {pay.isPending ? <Loader2 className="animate-spin" /> : <Check />} {t('receivables.regDo')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
