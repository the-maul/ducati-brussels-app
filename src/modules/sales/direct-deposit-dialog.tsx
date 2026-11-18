/**
 * M6 — Fenêtre « Acompte direct » (G8 Ventes › Acompte direct) : client, mode de règlement,
 * montant, date, commentaire ; l'opérateur est l'utilisateur connecté. Crée un document ACD
 * réglé, imputable ensuite sur un document du client. Lot G8 du 18/11/2026.
 */
import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Wallet, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/lib/auth/auth-context';
import { t } from '@/lib/i18n';
import { errorMessage } from '@/lib/mutation-feedback';
import { contactDisplayName, type Contact } from '@/modules/contacts/api';
import { ContactPicker } from './document-editor';
import { listPaymentMethods } from './write-api';
import { createDirectDeposit } from './direct-deposit-api';
import { todayIso } from './document-list';
import { STRIPE_METHOD } from './stripe-pay-rules';
import { CASH_ROUNDING_METHOD } from './cash-rounding';

export function DirectDepositDialog({ companyId, initialContact, onClose }: { companyId: string; initialContact?: Contact | null; onClose: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { profile, user } = useAuth();
  const [contact, setContact] = useState<Contact | null>(initialContact ?? null);
  const [method, setMethod] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayIso());
  const [comment, setComment] = useState('');
  const methodsQ = useQuery({ queryKey: ['payment-methods', companyId], queryFn: () => listPaymentMethods(companyId), staleTime: 300_000 });
  // Ni l'arrondi technique des especes, ni le QR Stripe (confirme par la banque, jamais saisi a la main).
  const methods = (methodsQ.data ?? []).filter((m) => m.code !== CASH_ROUNDING_METHOD && m.code !== STRIPE_METHOD);
  const value = Number(amount.replace(',', '.'));
  const save = useMutation({
    meta: { success: false, error: false },
    mutationFn: () => createDirectDeposit({ companyId, contactId: contact!.id, method: method || methods[0]?.code || '', amount: value, date, comment }),
    onSuccess: (id) => {
      toast.success(t('directDeposit.created'));
      qc.invalidateQueries({ queryKey: ['sales-doc-list'] });
      qc.invalidateQueries({ queryKey: ['client-docs-payments'] });
      onClose();
      navigate({ to: '/sales/$documentId', params: { documentId: id } });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const ready = !!contact && Number.isFinite(value) && value > 0 && !!(method || methods[0]);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('directDeposit.title')}</DialogTitle>
          <DialogDescription>{t('directDeposit.hint')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>{t('sales.client')}</Label>
            {contact ? (
              <div className="flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm">
                <span className="truncate">{contactDisplayName(contact)}</span>
                <button type="button" onClick={() => setContact(null)} className="ml-auto text-muted-foreground hover:text-danger" aria-label={t('sales.filterReset')}><X className="size-4" /></button>
              </div>
            ) : <ContactPicker companyId={companyId} onPick={setContact} />}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t('directDeposit.method')}</Label>
              <Select value={method || methods[0]?.code || ''} onValueChange={setMethod}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{methods.map((m) => <SelectItem key={m.code} value={m.code}>{m.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t('directDeposit.amount')}</Label>
              <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="tabular-nums" />
            </div>
            <div className="space-y-1.5">
              <Label>{t('directDeposit.date')}</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('sales.operator')}</Label>
              <Input value={profile?.full_name?.trim() || profile?.email || user?.email || ''} readOnly disabled />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>{t('directDeposit.comment')}</Label>
            <Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button onClick={() => save.mutate()} disabled={!ready || save.isPending}>
            {save.isPending ? <Loader2 className="animate-spin" /> : <Wallet />} {t('directDeposit.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
