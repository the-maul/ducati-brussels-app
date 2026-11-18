/**
 * Encaissements (rattrapage G8, 18/11/2026) — « Modifier cet encaissement » (G8, chèques à
 * échéance) : échéance, banque et n° de chèque d'un règlement ATTENDU. Le montant, le mode et le
 * document ne changent pas (annuler l'échéance puis ressaisir). Trace : audit de la base.
 */
import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2, Save } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { t } from '@/lib/i18n';
import { errorMessage } from '@/lib/mutation-feedback';
import { updateDeferredPayment } from './api';
import { Field } from './schedule-dialog';
import { eur } from './helpers';

export type EditablePayment = {
  id: string; amount: number | string; due_date: string | null;
  cheque_number?: string | null; bank_name?: string | null;
};

export function DeferredEditDialog({ payment, onOpenChange, onDone }: {
  payment: EditablePayment | null; onOpenChange: (o: boolean) => void; onDone: () => void;
}) {
  const [due, setDue] = useState('');
  const [bank, setBank] = useState('');
  const [cheque, setCheque] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!payment) return;
    setDue(payment.due_date ?? ''); setBank(payment.bank_name ?? ''); setCheque(payment.cheque_number ?? ''); setError(null);
  }, [payment]);
  const save = useMutation({
    mutationFn: () => updateDeferredPayment(payment!.id, due || null, bank, cheque),
    onSuccess: () => { onOpenChange(false); onDone(); },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Dialog open={!!payment} onOpenChange={(o) => { if (!save.isPending) onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('receivables.editDeferred')}</DialogTitle>
          <DialogDescription>{payment ? `${t('receivables.colAmount')} : ${eur(Number(payment.amount))}` : ''}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label={t('receivables.colDueDate')}><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
          <Field label={t('receivables.colBank')}><Input value={bank} onChange={(e) => setBank(e.target.value)} /></Field>
          <Field label={t('receivables.colCheque')}><Input value={cheque} onChange={(e) => setCheque(e.target.value)} className="font-mono" /></Field>
        </div>
        {error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>{t('action.cancel')}</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? <Loader2 className="animate-spin" /> : <Save />} {t('receivables.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
