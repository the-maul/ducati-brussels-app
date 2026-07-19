/**
 * M7 — « Offre acceptée » : le client marque son accord. Saisie rapide du
 * montant accepté, avec MIROIR de la meilleure offre marchand (pré-rempli,
 * modifiable) et du marchand à facturer → savoir à qui facturer la moto.
 * Passe la reprise au statut « Accepté ».
 */
import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Check } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { acceptRepriseOffer } from './validate-api';
import { t } from '@/lib/i18n';

export type BestOffer = { amount: number; partnerName: string };

export function AcceptOfferDialog({ open, onOpenChange, oroId, vehicleId, best, onDone }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  oroId: string;
  vehicleId: string | null;
  best: BestOffer | null;
  onDone?: () => void;
}) {
  const qc = useQueryClient();
  // Pré-remplissage depuis la meilleure offre marchand (miroir).
  const initial = useMemo(() => ({
    accepted: best && best.amount > 0 ? String(best.amount) : '',
    bestAmount: best && best.amount > 0 ? String(best.amount) : '',
    partner: best?.partnerName ?? '',
  }), [best]);

  const [accepted, setAccepted] = useState(initial.accepted);
  const [bestAmount, setBestAmount] = useState(initial.bestAmount);
  const [partner, setPartner] = useState(initial.partner);

  const num = (s: string) => { const n = Number(String(s).replace(',', '.')); return Number.isFinite(n) ? n : 0; };

  const save = useMutation({
    mutationFn: () => acceptRepriseOffer(oroId, vehicleId, {
      accepted_amount: num(accepted),
      best_offer_amount: num(bestAmount),
      invoice_partner_name: partner.trim(),
    }),
    onSuccess: () => {
      toast.success(t('tradein.acceptDone'));
      qc.invalidateQueries({ queryKey: ['oro-full', oroId] });
      qc.invalidateQueries({ queryKey: ['oro'] });
      onDone?.();
      onOpenChange(false);
    },
    onError: () => toast.error(t('tradein.errSave')),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('tradein.acceptTitle')}</DialogTitle>
          <DialogDescription>{t('tradein.acceptHint')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Money label={t('tradein.acceptAmount')} value={accepted} onChange={setAccepted} />
          <Money label={t('tradein.acceptBest')} value={bestAmount} onChange={setBestAmount} />
          <div>
            <Label>{t('tradein.acceptPartner')}</Label>
            <Input value={partner} onChange={(e) => setPartner(e.target.value)} placeholder={t('tradein.acceptPartnerPh')} />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('action.cancel')}</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? <Loader2 className="animate-spin" /> : <Check />} {t('tradein.acceptConfirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Money({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="relative">
        <Input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} className="h-11 pr-8 text-right tabular-nums" />
        <span className="absolute right-3 top-2.5 text-muted-foreground">€</span>
      </div>
    </div>
  );
}
