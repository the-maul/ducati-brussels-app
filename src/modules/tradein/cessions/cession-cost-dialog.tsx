/**
 * Fenetre « prix de revient » a la validation d'une cession (G8 : fenetre CESSION VO) :
 * prix brut (PV conseille HT/TTC, prix d'achat, marge PA), prix net (ancien prix de revient +
 * cession actuelle + autres cessions + options = nouveau prix de revient), marge PR (€ / %),
 * prix de vente client HT / TTC. La base recalcule tout a la validation (valeurs du jour).
 */
import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { t } from '@/lib/i18n';
import { getCostContext } from './api';
import { computeCostWindow } from './rules';

const eur = (n: number | null | undefined) => (n == null ? '—' : `${(Math.round(Number(n) * 100) / 100).toFixed(2).replace('.', ',')} €`);
const pct = (n: number | null | undefined) => (n == null ? '—' : `${n.toFixed(2).replace('.', ',')} %`);
const num = (s: string) => { const n = Number(String(s).replace(',', '.')); return Number.isFinite(n) ? n : 0; };

export function CessionCostDialog({ open, onOpenChange, cessionId, hasVehicle, pending, onConfirm }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  cessionId: string;
  hasVehicle: boolean;
  pending: boolean;
  onConfirm: (options: number) => void;
}) {
  const ctx = useQuery({ queryKey: ['cession-cost-ctx', cessionId], queryFn: () => getCostContext(cessionId), enabled: open });
  const [options, setOptions] = useState('0');
  const [sale, setSale] = useState<string | null>(null);

  const c = ctx.data;
  const saleTtc = sale != null ? num(sale) : (c?.sale_price_ttc ?? null);
  const w = c ? computeCostWindow({
    purchasePrice: c.purchase_price, legacyOro: c.legacy_oro, otherCessions: c.other_cessions,
    currentCost: c.current_cost, accounted: c.accounted, options: num(options), saleTtc, vatRate: c.vat_rate,
  }) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('cession.costTitle')}</DialogTitle>
          <DialogDescription>{hasVehicle ? t('cession.costHint') : t('cession.costNoVehicle')}</DialogDescription>
        </DialogHeader>
        {!c || !w ? (
          <div className="grid place-items-center py-8"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-4 font-data text-[13px]">
            {hasVehicle && (
              <Block title={t('cession.costGross')}>
                <Row label={t('cession.salePriceAdvised')} value={`${eur(w.saleHt)} HT · ${eur(w.saleTtc)} TTC`} />
                <Row label={t('cession.purchasePrice')} value={eur(c.purchase_price)} />
                <Row label={t('cession.marginPa')} value={`${eur(w.marginPa)} · ${pct(w.marginPaPct)}`} tone={w.marginPa != null && w.marginPa < 0 ? 'danger' : undefined} />
              </Block>
            )}
            <Block title={t('cession.costNet')}>
              {hasVehicle && <Row label={t('cession.previousCost')} value={eur(w.previousCost)} />}
              <Row label={`${t('cession.currentCession')} (${c.accounted ? t('cession.accounted') : t('cession.notAccounted')})`} value={eur(c.current_cost)} />
              {hasVehicle && <Row label={t('cession.otherCessions')} value={eur(w.otherCessions)} />}
              <div className="flex items-center justify-between gap-3 py-1">
                <span className="text-muted-foreground">{t('cession.options')}</span>
                <Input type="number" step="0.01" min="0" value={options} onChange={(e) => setOptions(e.target.value)} className="h-8 w-32 text-right tabular-nums" />
              </div>
              {hasVehicle && <Row label={t('cession.newCost')} value={eur(w.newCost)} strong />}
            </Block>
            {hasVehicle && (
              <Block title={t('cession.marginPr')}>
                <div className="flex items-center justify-between gap-3 py-1">
                  <span className="text-muted-foreground">{t('cession.salePriceClient')} TTC</span>
                  <Input type="number" step="0.01" min="0" value={sale ?? String(c.sale_price_ttc ?? '')} onChange={(e) => setSale(e.target.value)} className="h-8 w-32 text-right tabular-nums" />
                </div>
                <Row label={`${t('cession.salePriceClient')} HT`} value={eur(w.saleHt)} />
                <Row label={t('cession.marginPr')} value={`${eur(w.marginPr)} · ${pct(w.marginPrPct)}`} strong tone={w.marginPr != null && w.marginPr < 0 ? 'danger' : 'success'} />
                <p className="text-[12px] text-muted-foreground">{t('cession.saleSimulationHint')}</p>
              </Block>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('cession.cancelBtn')}</Button>
          <Button onClick={() => onConfirm(num(options))} disabled={pending || !c}>
            {pending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} {t('cession.validateConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="mb-1 font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

function Row({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: 'danger' | 'success' }) {
  const color = tone === 'danger' ? 'text-danger' : tone === 'success' ? 'text-success' : '';
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className={`tabular-nums ${strong ? 'font-bold' : ''} ${color}`}>{value}</span>
    </div>
  );
}
