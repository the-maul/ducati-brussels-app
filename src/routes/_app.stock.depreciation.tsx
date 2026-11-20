import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState, useMemo, useEffect, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { ArrowLeft, Loader2, TrendingDown, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/lib/auth/auth-context';
import { stockScreenPage, listArticleLabels, STOCK_SCREEN_PAGE, type StockRow, type StockScreenFilters } from '@/modules/stock/stock-api';
import { listDepreciations, createDepreciation, cancelDepreciation, getTotalDepreciation, type StockDepreciation } from '@/modules/stock/depreciation-api';
import { listSuppliers, supplierName } from '@/modules/purchases/api';
import { RAYONS_SORTED } from '@/modules/articles/product-families';
import { t, pageTitle, fillVars } from '@/lib/i18n';

export const Route = createFileRoute('/_app/stock/depreciation')({
  head: () => ({ meta: [{ title: pageTitle('stockDepreciation') }] }),
  component: DepreciationPage,
});

const eur = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`;

function DepreciationPage() {
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [supplierId, setSupplierId] = useState('');
  const [rayonCode, setRayonCode] = useState('');
  const [onlyDormant, setOnlyDormant] = useState(false);

  const [page, setPage] = useState(0);
  const { data: suppliers } = useQuery({
    queryKey: ['suppliers-filter', activeCompanyId],
    queryFn: () => listSuppliers(activeCompanyId!, '', 500),
    enabled: !!activeCompanyId,
    staleTime: 5 * 60 * 1000,
  });
  const { data: depreciations, isLoading: loadingDeprec } = useQuery({
    queryKey: ['stock-depreciations', activeCompanyId],
    queryFn: () => listDepreciations(activeCompanyId!),
    enabled: !!activeCompanyId,
  });
  // Reference / designation des articles deprecies (avant : pris dans le stock complet).
  const deprecIds = useMemo(() => (depreciations ?? []).map((d) => d.article_id), [depreciations]);
  const { data: labelById } = useQuery({
    queryKey: ['article-labels', deprecIds],
    queryFn: () => listArticleLabels(deprecIds),
    enabled: deprecIds.length > 0,
    staleTime: 300_000,
  });
  const { data: totalDeprec } = useQuery({
    queryKey: ['stock-depreciations-total', activeCompanyId],
    queryFn: () => getTotalDepreciation(activeCompanyId!),
    enabled: !!activeCompanyId,
  });

  const rayon = useMemo(() => RAYONS_SORTED.find((r) => r.code === rayonCode), [rayonCode]);

  // Perf 2 (20/11/2026) : memes filtres qu'avant, appliques en base, liste paginee (100 lignes).
  // TODO: affiner « stock dormant » avec la date du dernier mouvement (jointure stock_moves) ;
  // heuristique actuelle : article encore disponible en stock.
  const filters = useMemo<StockScreenFilters>(() => ({
    supplier_id: supplierId || undefined, rayon_code: rayon?.code, rayon_label: rayon?.label, dormant: onlyDormant,
  }), [supplierId, rayon, onlyDormant]);
  const filtersKey = JSON.stringify(filters);
  useEffect(() => { setPage(0); }, [filtersKey]);
  const { data: stockPage, isLoading } = useQuery({
    queryKey: ['stock', activeCompanyId, 'depreciation', filtersKey, page],
    queryFn: () => stockScreenPage(activeCompanyId!, filters, STOCK_SCREEN_PAGE, page * STOCK_SCREEN_PAGE),
    enabled: !!activeCompanyId,
    placeholderData: keepPreviousData,
  });
  const stock = stockPage?.rows;
  const filtered = stock ?? [];
  const total = stockPage?.total ?? 0;
  const lastPage = Math.max(0, Math.ceil(total / STOCK_SCREEN_PAGE) - 1);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['stock-depreciations', activeCompanyId] });
    qc.invalidateQueries({ queryKey: ['stock-depreciations-total', activeCompanyId] });
  };

  const apply = useMutation({
    // Toast sur mesure émis ici : on coupe le toast global (mutation-feedback).
    meta: { success: false, error: false },
    mutationFn: (p: { articleId: string; rate: number; reason: string; baseValue: number }) =>
      createDepreciation({ companyId: activeCompanyId!, articleId: p.articleId, rate: p.rate, reason: p.reason, baseValue: p.baseValue }),
    onSuccess: () => { invalidate(); toast.success(t('stock.deprecApplied')); },
    onError: () => toast.error(t('stock.deprecErr')),
  });
  const cancel = useMutation({
    // Toast sur mesure émis ici : on coupe le toast global (mutation-feedback).
    meta: { success: false, error: false },
    mutationFn: (id: string) => cancelDepreciation(id),
    onSuccess: () => { invalidate(); toast.success(t('stock.deprecCancelled')); },
    onError: () => toast.error(t('stock.deprecErr')),
  });

  return (
    <>
      <PageHeader
        title={t('stock.deprecTitle')}
        description={t('stock.deprecSubtitle')}
        actions={<Button variant="outline" onClick={() => navigate({ to: '/stock' })}><ArrowLeft /> {t('stock.title')}</Button>}
      />

      <div className="mb-4 rounded-md border border-border bg-card p-3 shadow-[var(--shadow-card)]">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <FilterField label={t('stock.filterSupplier')}>
            <FilterSelect value={supplierId} onChange={setSupplierId} options={(suppliers ?? []).map((s) => ({ value: s.id, label: supplierName(s) }))} />
          </FilterField>
          <FilterField label={t('stock.filterRayon')}>
            <FilterSelect value={rayonCode} onChange={setRayonCode} options={RAYONS_SORTED.map((r) => ({ value: r.code, label: `${r.code} ${r.label}` }))} />
          </FilterField>
          <div className="flex items-end pb-1.5">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={onlyDormant} onChange={(e) => setOnlyDormant(e.target.checked)} className="size-4 accent-[var(--ducati-red)]" />
              {t('stock.deprecDormant')}
            </label>
          </div>
        </div>
      </div>

      <div className="mb-6 overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted">
            <tr>
              <Th>{t('stock.colRef')}</Th><Th>{t('stock.colDesignation')}</Th>
              <Th className="text-right">{t('stock.colValue')}</Th>
              <Th className="text-right">{t('stock.deprecRate')}</Th>
              <Th className="text-right">{t('stock.deprecPreview')}</Th>
              <Th className="w-40" />
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={6} className="px-3 py-6 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></td></tr>}
            {stock && filtered.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">{t('stock.empty')}</td></tr>}
            {filtered.map((r) => (
              <DepreciationRow
                key={r.article_id}
                row={r}
                pending={apply.isPending}
                onApply={(rate, reason) => apply.mutate({ articleId: r.article_id, rate, reason, baseValue: r.stock_value })}
              />
            ))}
          </tbody>
        </table>
      </div>
      {total > STOCK_SCREEN_PAGE && (
        <div className="-mt-4 mb-6 flex items-center justify-end gap-2 font-data text-[13px] tabular-nums text-muted-foreground">
          <span>{fillVars(t('stock.pageOf'), { from: page * STOCK_SCREEN_PAGE + 1, to: Math.min(total, (page + 1) * STOCK_SCREEN_PAGE), total })}</span>
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}><ChevronLeft /> {t('stock.pagePrev')}</Button>
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(lastPage, p + 1))} disabled={page >= lastPage}>{t('stock.pageNext')} <ChevronRight /></Button>
        </div>
      )}

      <h2 className="mb-2 font-ui text-[15px] font-bold text-foreground">{t('stock.deprecActive')}</h2>
      <div className="mb-2 flex items-center gap-2 text-[13px] text-muted-foreground">
        <TrendingDown className="size-4" /> {t('stock.deprecTotal')} : <b className="font-data tabular-nums text-foreground">{eur(totalDeprec ?? 0)}</b>
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted">
            <tr>
              <Th>{t('stock.colDate')}</Th><Th>{t('stock.colRef')}</Th><Th>{t('stock.colDesignation')}</Th>
              <Th className="text-right">{t('stock.deprecRate')}</Th>
              <Th className="text-right">{t('stock.colValue')}</Th>
              <Th>{t('stock.deprecReason')}</Th><Th className="w-16" />
            </tr>
          </thead>
          <tbody>
            {loadingDeprec && <tr><td colSpan={7} className="px-3 py-6 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></td></tr>}
            {depreciations && depreciations.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">{t('stock.deprecEmpty')}</td></tr>}
            {depreciations?.map((d) => (
              <DepreciationRowActive key={d.id} d={d} article={labelById?.get(d.article_id)} onCancel={() => cancel.mutate(d.id)} pending={cancel.isPending} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function DepreciationRow({ row, pending, onApply }: { row: StockRow; pending: boolean; onApply: (rate: number, reason: string) => void }) {
  const [rate, setRate] = useState('');
  const [reason, setReason] = useState('');
  const rateNum = Number(String(rate).replace(',', '.'));
  const valid = Number.isFinite(rateNum) && rateNum > 0 && rateNum <= 100;
  const preview = valid ? row.stock_value * (rateNum / 100) : 0;
  return (
    <tr className="border-b border-border last:border-0 hover:bg-accent">
      <td className="px-3 py-2 font-mono text-[12px]">{row.reference}</td>
      <td className="px-3 py-2">{row.designation}</td>
      <td className="px-3 py-2 text-right tabular-nums">{eur(row.stock_value)}</td>
      <td className="px-3 py-2 text-right">
        <Input type="number" min="0" max="100" step="0.5" value={rate} onChange={(e) => setRate(e.target.value)} className="ml-auto w-20 text-right tabular-nums" placeholder="%" />
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{valid ? eur(preview) : '—'}</td>
      <td className="px-2 py-1">
        <div className="flex items-center gap-1.5">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('stock.deprecReason')} className="w-28" />
          <Button size="sm" disabled={!valid || pending} onClick={() => { onApply(rateNum, reason); setRate(''); setReason(''); }}>
            {pending ? <Loader2 className="animate-spin" /> : t('stock.deprecApply')}
          </Button>
        </div>
      </td>
    </tr>
  );
}

function DepreciationRowActive({ d, article, onCancel, pending }: { d: StockDepreciation; article: Pick<StockRow, 'reference' | 'designation'> | undefined; onCancel: () => void; pending: boolean }) {
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-3 py-2 font-mono text-[12px]">{new Date(d.created_at).toLocaleDateString('fr-BE')}</td>
      <td className="px-3 py-2 font-mono text-[12px]">{article?.reference ?? '—'}</td>
      <td className="px-3 py-2">{article?.designation ?? '—'}</td>
      <td className="px-3 py-2 text-right tabular-nums">{d.rate} %</td>
      <td className="px-3 py-2 text-right tabular-nums text-danger">-{eur(d.depreciated_value)}</td>
      <td className="px-3 py-2 text-muted-foreground">{d.reason ?? '—'}</td>
      <td className="px-2 py-1 text-center">
        <Button variant="ghost" size="sm" title={t('stock.deprecCancel')} disabled={pending} onClick={onCancel}><X className="size-4 text-danger" /></Button>
      </td>
    </tr>
  );
}

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

/** Select de filtre : premier item « Tous » (valeur vide côté état). */
const ALL_SENTINEL = '__tous__';

function FilterSelect({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  const safe = options.filter((o) => o.value !== '' && o.value !== ALL_SENTINEL);
  return (
    <Select value={value || ALL_SENTINEL} onValueChange={(v) => onChange(v === ALL_SENTINEL ? '' : v)}>
      <SelectTrigger><SelectValue /></SelectTrigger>
      <SelectContent className="max-h-72">
        <SelectItem value={ALL_SENTINEL}>{t('stock.filterAll')}</SelectItem>
        {safe.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function Th({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
