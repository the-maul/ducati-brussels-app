/**
 * M2/M5 (B12) — Impression d'étiquettes EN MASSE pour les articles du magasin
 * (apparel, accessoires, produits dérivés…). Filtre par rayon/recherche, en stock
 * uniquement ; quantité par article = stock réel (modifiable) ; avec/sans prix,
 * avec/sans code-barres ; FORMAT D'ÉTIQUETTE personnalisable (éditeur B12).
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Loader2, Tags, Pencil } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { listStock, type StockRow } from '@/modules/stock/stock-api';
import { effectiveSaleTtc, useRoundSalePrices } from '@/lib/pricing';
import { listTemplates } from './labels/templates-api';
import { printLabelsWithTemplate, type TemplateLabelItem } from './labels/render';
import { QuickLabelDialog } from './labels/quick-label';
import type { LabelData, LabelTemplateConfig } from './labels/template-types';
import { t } from '@/lib/i18n';

const MAX_ROWS = 500;

export function LabelsBatchDialog({ open, onOpenChange, companyId }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string | null;
}) {
  const roundUp = useRoundSalePrices(companyId);
  const navigate = useNavigate();
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [onlyStock, setOnlyStock] = useState(true);
  const [withPrice, setWithPrice] = useState(true);
  const [withBarcode, setWithBarcode] = useState(true);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [qtyOverrides, setQtyOverrides] = useState<Record<string, number>>({});
  const [printing, setPrinting] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);

  const stockQ = useQuery({
    queryKey: ['stock-for-labels', companyId],
    queryFn: () => listStock(companyId!),
    enabled: !!companyId && open,
    staleTime: 60 * 1000,
  });

  const templatesQ = useQuery({
    queryKey: ['label-templates', companyId],
    queryFn: () => listTemplates(companyId!),
    enabled: !!companyId && open,
  });
  const templates = templatesQ.data ?? [];
  const template = templates.find((x) => x.id === templateId) ?? templates.find((x) => x.is_default) ?? templates[0] ?? null;

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
    if (!filtered.length || !template) return;
    setPrinting(true);
    try {
      // Prix de vente des articles filtrés (par lots — uniquement si « avec prix »)
      const prices = new Map<string, { ttc: number; ht: number }>();
      if (withPrice) {
        const ids = filtered.map((r) => r.article_id);
        for (let i = 0; i < ids.length; i += 200) {
          const { data, error } = await supabase
            .from('articles')
            .select('id, sale_price_ttc, sale_price_ht')
            .in('id', ids.slice(i, i + 200));
          if (error) throw error;
          for (const a of data ?? []) {
            prices.set(a.id, { ttc: Number(a.sale_price_ttc ?? 0), ht: Number((a as { sale_price_ht?: number }).sale_price_ht ?? 0) });
          }
        }
      }
      // Surcharges « avec prix / avec code-barres » sur le format choisi
      const cfg: LabelTemplateConfig = {
        ...template.config,
        elements: template.config.elements.map((e) =>
          (e.key === 'price_ttc' || e.key === 'price_ht' || e.key === 'price_promo') && !withPrice
            ? { ...e, visible: false } : e),
        barcode: { ...template.config.barcode, visible: template.config.barcode.visible && withBarcode },
      };
      const items: TemplateLabelItem[] = filtered.map((r) => {
        const p = prices.get(r.article_id);
        const data: LabelData = {
          reference: r.reference,
          designation: r.designation,
          price_ttc: withPrice && p ? effectiveSaleTtc(p.ttc, roundUp) : null,
          price_ht: withPrice && p ? p.ht : null,
          price_promo: null,
          discount: null,
          store_name: t('app.name'),
          bin: r.bin_location,
          pack_qty: null,
          barcode_value: r.reference,
        };
        return { data, qty: qtyFor(r) };
      });
      printLabelsWithTemplate(cfg, items);
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

        {/* Format d'étiquette + personnalisation (éditeur) */}
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <label className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('articles.labelsFormat')}</label>
            <Select value={template?.id ?? undefined} onValueChange={setTemplateId}>
              <SelectTrigger className="w-56"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>{templates.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Button variant="outline" size="sm" onClick={() => { onOpenChange(false); navigate({ to: '/parts/labels' }); }}>
            <Pencil className="size-4" /> {t('articles.labelsCustomize')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setQuickOpen(true)}>
            <Tags className="size-4" /> {t('articles.quickTitle')}
          </Button>
        </div>
        <QuickLabelDialog open={quickOpen} onOpenChange={setQuickOpen} companyId={companyId} />

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
          <Button onClick={doPrint} disabled={printing || filtered.length === 0 || !template}>
            {printing ? <Loader2 className="animate-spin" /> : <Tags />}
            {t('articles.labelsPrint').replace('{n}', totalLabels.toLocaleString('fr-BE'))}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
