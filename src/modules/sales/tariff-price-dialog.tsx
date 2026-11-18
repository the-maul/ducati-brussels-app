/**
 * M1 / M6 — « Tarifications » (G8, bouton de la saisie d'un document) : fixer a la volee le prix
 * d'un article dans le tarif du client, sans quitter la vente. Affiche le prix de base (HT / TTC /
 * PA) et le prix tarif (HT / TTC lies). Enregistre dans le tarif commun du client, sinon dans ses
 * propres tarifs (fiche client, onglet Tarifs). Rattrapage G8 du 18/11/2026.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Tag } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { t, fillVars } from '@/lib/i18n';
import { errorMessage } from '@/lib/mutation-feedback';
import { setArticlePriceForClient, type CustomerPricer } from './customer-pricing-api';

const eur = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`;
const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (s: string) => { const n = Number(String(s).replace(',', '.')); return Number.isFinite(n) ? n : 0; };

export function TariffPriceDialog({ companyId, contactId, pricer, article, baseHt, vatRate, currentNetHt, onClose, onSaved }: {
  companyId: string; contactId: string; pricer: CustomerPricer;
  article: { id: string; reference: string; designation: string };
  baseHt: number; vatRate: number; currentNetHt: number;
  onClose: () => void; onSaved: () => void;
}) {
  const vf = 1 + (Number(vatRate) || 0) / 100;
  const [ht, setHt] = useState(currentNetHt > 0 ? String(r2(currentNetHt)) : '');
  const [ttc, setTtc] = useState(currentNetHt > 0 ? String(r2(currentNetHt * vf)) : '');
  const [busy, setBusy] = useState(false);
  const { data: pa } = useQuery({
    queryKey: ['article-pa', article.id],
    queryFn: async () => Number((await supabase.from('articles').select('purchase_price').eq('id', article.id).maybeSingle()).data?.purchase_price ?? 0),
  });
  const { data: list } = useQuery({ queryKey: ['client-price-list-dialog', contactId, pricer.contact?.price_list_id ?? null], queryFn: () => pricer.priceList() });
  const intoList = !!list && list.depth === 1;

  const save = async () => {
    const value = num(ht);
    if (!(value > 0)) return;
    setBusy(true);
    try {
      const r = await setArticlePriceForClient({ companyId, contactId, pricer, articleId: article.id, reference: article.reference, netHt: value });
      toast.success(r.target === 'list' ? fillVars(t('clientRules.tariffSaved'), { code: r.listCode ?? '' }) : t('clientRules.tariffSavedClient'));
      onSaved();
    } catch (e) { toast.error(errorMessage(e)); }
    setBusy(false);
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Tag className="size-5" /> {t('clientRules.tariffTitle')}</DialogTitle>
          <DialogDescription>
            <span className="font-mono">{article.reference}</span> — {article.designation}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-3 gap-2 rounded-md bg-muted p-3 font-data tabular-nums">
            <div><p className="text-[11px] uppercase text-muted-foreground">{t('clientRules.tariffBase')} {t('clientRules.ht')}</p><p>{eur(baseHt)}</p></div>
            <div><p className="text-[11px] uppercase text-muted-foreground">{t('clientRules.tariffBase')} {t('clientRules.ttc')}</p><p>{eur(baseHt * vf)}</p></div>
            <div><p className="text-[11px] uppercase text-muted-foreground">{t('clientRules.tariffPurchase')}</p><p>{pa != null ? eur(pa) : '—'}</p></div>
          </div>
          <p className="text-[12px] text-muted-foreground">{t('clientRules.tariffCurrent')} : <b className="tabular-nums">{eur(currentNetHt)} {t('clientRules.ht')}</b></p>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('clientRules.tariffNewHt')}</span>
              <Input type="number" step="0.01" min="0" value={ht} autoFocus className="text-right tabular-nums"
                onChange={(e) => { setHt(e.target.value); setTtc(e.target.value.trim() ? String(r2(num(e.target.value) * vf)) : ''); }} />
            </label>
            <label className="space-y-1">
              <span className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('clientRules.tariffNewTtc')}</span>
              <Input type="number" step="0.01" min="0" value={ttc} className="text-right tabular-nums"
                onChange={(e) => { setTtc(e.target.value); setHt(e.target.value.trim() ? String(r2(num(e.target.value) / vf)) : ''); }} />
            </label>
          </div>
          <p className="rounded-md bg-info-bg px-3 py-2 text-[12px] text-info">
            {intoList ? fillVars(t('clientRules.tariffIntoList'), { code: list?.code ?? '' }) : t('clientRules.tariffIntoClient')}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button onClick={save} disabled={busy || !(num(ht) > 0)}>{busy ? <Loader2 className="animate-spin" /> : <Tag />} {t('clientRules.tariffSave')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
