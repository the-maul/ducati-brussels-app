/**
 * M2/M5 (B12) — Impression d'étiquettes EN MASSE pour les articles du magasin
 * (apparel, accessoires, produits dérivés…). Filtre par rayon/recherche, en stock
 * uniquement ; quantité par article = stock réel (modifiable) ; avec/sans prix,
 * avec/sans code-barres. Utilisé après l'intégration d'un tarif.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Tags } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { listStock, type StockRow } from '@/modules/stock/stock-api';
import { printLabels, type LabelItem } from './label-print';
import { effectiveSaleTtc, useRoundSalePrices } from '@/lib/pricing';
import { t } from '@/lib/i18n';

const MAX_ROWS = 500;

export function LabelsBatchDialog({ open, onOpenChange, companyId }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string | null;
}) {
  const roundUp = useRoundSalePrices(companyId);
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [onlyStock, setOnlyStock] = useState(true);
  const [withPrice, setWithPrice] = useState(true);
  const [withBarcode, setWithBarcode] = useState(true);
  const [qtyOverrides, setQtyOverrides] = useState<Record<string, number>>({});
  const [printing, setPrinting] = useState(false);

  const stockQ = useQuery({
    queryKey: ['stock-for-labels', companyId],
    queryFn: () => listStock(companyId!),
    enabled: !!companyId && open,
    staleTime: 60 * 1000,
  });

  const ci = (s: string) => s.trim().toLowerCase();
  const filtered: StockRow[] = useMemo(() => {
    const rows = stockQ.data ?? [];
    return rows.filter((r) => {
      if (onlyStock && !(r.real_qty > 0)) return false;
      if (category && !ci(r.category_path ?? '').includes(ci(category))) return false;
      if (search) {
        const q = ci(search);
        if (!ci(r.reference).includes(q) && !ci(r.designation).includes(q)) return false;
      }
      return true;
    }).slice(0, MAX_ROWS);
  }, [stockQ.data, onlyStock, category, search]);

  const qtyFor = (r: StockRow) => qtyOverrides[r.article_id] ?? Math.max(1, Math.round(r.real_qty));
  const totalLabels = filtered.reduce((acc, r) => acc + qtyFor(r), 0);

  const doPrint = async () => {
    if (!filtered.length) return;
    setPrinting(true);
    try {
      // Prix de vente des articles filtrés (par lots — uniquement si « avec prix »)
      const prices = new Map<string, number>();
      if (withPrice) {
        const ids = filtered.map((r) => r.article_id);
        for (let i = 0; i < ids.length; i += 200) {
          const { data, error } = await supabase
            .from('articles')
            .select('id, sale_price_ttc')
            .in('id', ids.slice(i, i + 200));
          if (error) throw error;
          for (const a of data ?? []) prices.set(a.id, Number(a.sale_price_ttc ?? 0));
        }
      }
      const items: LabelItem[] = filtered.map((r) => ({
        code: r.reference,
        designation: r.designation,
        qty: qtyFor(r),
        withPrice,
        price: withPrice ? effectiveSaleTtc(prices.get(r.article_id) ?? 0, roundUp) : null,
      }));
      printLabels(items, 1, { withBarcode });
    } finally {
      setPrinting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('articles.labelsTitle')}</DialogTitle>
          <DialogDescription>{t('articles.labelsSubtitle')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('articles.labelsCategory')}</label>
            <Input className="w-48" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="APPAREL, ACCESSOIRES…" />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('action.search')}</label>
            <Input className="w-48" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('articles.search')} />
          </div>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <Checkbox checked={onlyStock} onCheckedChange={(v) => setOnlyStock(v === true)} /> {t('articles.labelsOnlyStock')}
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <Checkbox checked={withPrice} onCheckedChange={(v) => setWithPrice(v === true)} /> {t('articles.labelsWithPrice')}
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <Checkbox checked={withBarcode} onCheckedChange={(v) => setWithBarcode(v === true)} /> {t('articles.labelsWithBarcode')}
          </label>
        </div>

        <div className="max-h-80 overflow-auto rounded-md border border-border">
          <table className="w-full border-collapse font-data text-[13px]">
            <thead className="sticky top-0 bg-muted">
              <tr>
                <th className="px-3 py-2 text-left font-ui text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('articles.colRef')}</th>
                <th className="px-3 py-2 text-left font-ui text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('articles.colDesignation')}</th>
                <th className="px-3 py-2 text-right font-ui text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('stock.colReal')}</th>
                <th className="px-3 py-2 text-right font-ui text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('articles.labelsQty')}</th>
              </tr>
            </thead>
            <tbody>
              {stockQ.isLoading && (
                <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground"><Loader2 className="mx-auto size-5 animate-spin" /></td></tr>
              )}
              {!stockQ.isLoading && filtered.length === 0 && (
                <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">{t('articles.labelsEmpty')}</td></tr>
              )}
              {filtered.map((r) => (
                <tr key={r.article_id} className="border-b border-border last:border-0">
                  <td className="px-3 py-1.5 font-mono text-[12px]">{r.reference}</td>
                  <td className="px-3 py-1.5">{r.designation}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.real_qty}</td>
                  <td className="px-3 py-1.5 text-right">
                    <Input
                      type="number" min="1" step="1"
                      className="ml-auto h-7 w-20 text-right tabular-nums"
                      value={qtyFor(r)}
                      onChange={(e) => setQtyOverrides((p) => ({ ...p, [r.article_id]: Math.max(1, Number(e.target.value) || 1) }))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-[13px] tabular-nums text-muted-foreground">
            {filtered.length.toLocaleString('fr-BE')} article(s) — {totalLabels.toLocaleString('fr-BE')} étiquette(s)
          </span>
          <Button onClick={doPrint} disabled={printing || filtered.length === 0}>
            {printing ? <Loader2 className="animate-spin" /> : <Tags />}
            {t('articles.labelsPrint').replace('{n}', totalLabels.toLocaleString('fr-BE'))}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
