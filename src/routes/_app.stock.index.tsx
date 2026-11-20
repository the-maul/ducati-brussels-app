import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState, useMemo, useEffect, type ReactNode } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, ClipboardList, History, Gift, SlidersHorizontal, X, Download, AlertTriangle, TrendingDown, Scale, FileSpreadsheet, Tags, ChevronLeft, ChevronRight, Search, PackageX } from 'lucide-react';
import { StatusBadge } from '@/components/status-badge';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/lib/auth/auth-context';
import { listStockHistory, stockScreenPage, listStockScreenAll, type StockRow, type StockScreenFilters } from '@/modules/stock/stock-api';
import { stockAlert } from '@/modules/stock/stock-alert';
import { formatEur } from '@/lib/format-eur';
import { downloadStockCsv } from '@/modules/stock/stock-export';
import { listSuppliers, supplierName } from '@/modules/purchases/api';
import { RAYONS_SORTED } from '@/modules/articles/product-families';
import { t, pageTitle, fillVars } from '@/lib/i18n';

export const Route = createFileRoute('/_app/stock/')({
  head: () => ({ meta: [{ title: pageTitle('stock') }] }),
  component: StockList,
});

// Revue UX (20/11) : separateur de milliers (801 519,71 € et non 801519,71 €), comme le reste de l'ecran.
const eur = formatEur;

/**
 * Lot design « ecrans de travail » (20/11/2026) : 50 ou 100 lignes par page (comme la liste des
 * contacts), recherche en premier avec le focus a l'ouverture, badge Rupture / Stock negatif,
 * « Inventaire » en bouton secondaire (le geste du quotidien est la recherche, pas l'inventaire).
 */
const PAGE_SIZES = [50, 100] as const;

/** Filtres multicritères de l'écran (état). */
type FiltersState = { supplierId: string; rayon: string; dateFrom: string; dateTo: string };
const EMPTY_FILTERS: FiltersState = { supplierId: '', rayon: '', dateFrom: '', dateTo: '' };

function countActive(f: FiltersState): number {
  let n = 0;
  if (f.supplierId) n++;
  if (f.rayon) n++;
  if (f.dateFrom) n++;
  if (f.dateTo) n++;
  return n;
}

function StockList() {
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  // Perf 2 (20/11/2026) : la liste est paginee et filtree en base ; par defaut les articles en stock.
  const [onlyStocked, setOnlyStocked] = useState(true);
  const [belowMin, setBelowMin] = useState(false);
  const [reorderView, setReorderView] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [f, setF] = useState<FiltersState>(EMPTY_FILTERS);
  const set = <K extends keyof FiltersState>(k: K, v: FiltersState[K]) => setF((p) => ({ ...p, [k]: v }));
  const active = countActive(f);
  const [histo, setHisto] = useState<StockRow | null>(null);

  const [deb, setDeb] = useState('');
  useEffect(() => { const id = setTimeout(() => setDeb(term.trim()), 250); return () => clearTimeout(id); }, [term]);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0]);
  const [exporting, setExporting] = useState(false);
  const { data: suppliers } = useQuery({
    queryKey: ['suppliers-filter', activeCompanyId],
    queryFn: () => listSuppliers(activeCompanyId!, '', 500),
    enabled: !!activeCompanyId,
    staleTime: 5 * 60 * 1000,
  });
  const supplierById = useMemo(() => new Map((suppliers ?? []).map((s) => [s.id, supplierName(s)])), [suppliers]);
  const rayon = useMemo(() => RAYONS_SORTED.find((r) => r.code === f.rayon), [f.rayon]);

  // Memes filtres qu'avant, appliques en base (stock_screen_page) ; total et valeur calcules en base.
  // TODO: filtrer par date de dernier mouvement (nécessite jointure sur stock_moves)
  const filters = useMemo<StockScreenFilters>(() => ({
    q: deb, only_stocked: onlyStocked, below_min: belowMin, reorder: reorderView,
    supplier_id: f.supplierId || undefined, rayon_code: rayon?.code, rayon_label: rayon?.label,
  }), [deb, onlyStocked, belowMin, reorderView, f.supplierId, rayon]);
  const filtersKey = JSON.stringify(filters);
  useEffect(() => { setPage(0); }, [filtersKey, pageSize]);
  const { data, isLoading } = useQuery({
    queryKey: ['stock', activeCompanyId, 'screen', filtersKey, page, pageSize],
    queryFn: () => stockScreenPage(activeCompanyId!, filters, pageSize, page * pageSize),
    enabled: !!activeCompanyId,
    placeholderData: keepPreviousData,
  });
  const displayed = data?.rows ?? [];
  const filtered = displayed;
  const reorderRows = displayed;
  const total = data?.total ?? 0;
  const totalValue = data?.value ?? 0;
  const lastPage = Math.max(0, Math.ceil(total / pageSize) - 1);

  // Export COMPLET du stock filtre (toutes les pages), pas seulement la page affichee.
  const exportAll = async () => {
    setExporting(true);
    try { downloadStockCsv(await listStockScreenAll(activeCompanyId!, filters)); }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setExporting(false); }
  };

  return (
    <>
      <PageHeader
        title={t('stock.title')}
        description={t('stock.subtitle')}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => navigate({ to: '/stock/edition' })}><FileSpreadsheet /> {t('stockG8.nav.edition')}</Button>
            <Button variant="outline" onClick={() => navigate({ to: '/stock/readjust' })}><Scale /> {t('stockG8.nav.readjust')}</Button>
            <Button variant="outline" onClick={() => navigate({ to: '/stock/labels' })}><Tags /> {t('stockG8.nav.labels')}</Button>
            <Button variant="outline" onClick={() => navigate({ to: '/stock/cessions' })}><Gift /> {t('stock.cessions')}</Button>
            <Button variant="outline" onClick={() => navigate({ to: '/stock/depreciation' })}><TrendingDown /> {t('stock.deprecBtn')}</Button>
            <Button variant="outline" onClick={() => navigate({ to: '/stock/inventory' })}><ClipboardList /> {t('stock.inventory')}</Button>
          </div>
        }
      />

      <div className="mb-2 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input autoFocus type="search" value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t('stock.search')} aria-label={t('designEcrans.stockSearchLabel')} className="h-10 pl-9 text-[15px]" />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={onlyStocked} onChange={(e) => setOnlyStocked(e.target.checked)} className="size-4 accent-[var(--ducati-red)]" /> {t('stock.onlyStocked')}</label>
        <label className="flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={belowMin} onChange={(e) => setBelowMin(e.target.checked)} className="size-4 accent-[var(--ducati-red)]" /> {t('stock.belowMin')}</label>
        {/* Bouton bascule : etat « enfonce » en contour accentue, jamais en rouge (le rouge = action principale). */}
        <Button variant="outline" aria-pressed={filtersOpen || active > 0} className={active > 0 || filtersOpen ? 'border-foreground bg-accent font-bold' : undefined} onClick={() => setFiltersOpen((o) => !o)}>
          <SlidersHorizontal /> {t('stock.filters')}{active > 0 ? ` (${active})` : ''}
        </Button>
        <Button variant="outline" aria-pressed={reorderView} className={reorderView ? 'border-foreground bg-accent font-bold' : undefined} onClick={() => setReorderView((o) => !o)}>
          <AlertTriangle /> {t('stock.reorderView')}
        </Button>
        <Button variant="outline" onClick={() => { void exportAll(); }} disabled={total === 0 || exporting || !activeCompanyId}>
          {exporting ? <Loader2 className="animate-spin" /> : <Download />} {exporting ? t('stock.exporting') : t('stock.export')}
        </Button>
        <span className="ml-auto font-data text-sm tabular-nums">{t('stock.totalValue')} : <b>{eur(totalValue)}</b></span>
      </div>

      {filtersOpen && (
        <div className="mb-4 rounded-md border border-border bg-card p-3 shadow-[var(--shadow-card)]">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FilterField label={t('stock.filterSupplier')}>
              <FilterSelect
                value={f.supplierId}
                onChange={(v) => set('supplierId', v)}
                options={(suppliers ?? []).map((s) => ({ value: s.id, label: supplierName(s) }))}
              />
            </FilterField>
            <FilterField label={t('stock.filterRayon')}>
              <FilterSelect
                value={f.rayon}
                onChange={(v) => set('rayon', v)}
                options={RAYONS_SORTED.map((r) => ({ value: r.code, label: `${r.code} ${r.label}` }))}
              />
            </FilterField>
            <FilterField label={t('stock.filterDateFrom')}>
              <Input type="date" value={f.dateFrom} onChange={(e) => set('dateFrom', e.target.value)} />
            </FilterField>
            <FilterField label={t('stock.filterDateTo')}>
              <Input type="date" value={f.dateTo} onChange={(e) => set('dateTo', e.target.value)} />
            </FilterField>
            <div className="flex flex-wrap items-end gap-4 pb-1 sm:col-span-2 lg:col-span-4">
              <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={() => setF(EMPTY_FILTERS)} disabled={active === 0}>
                <X /> {t('stock.filterReset')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {reorderView ? (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full border-collapse font-data text-[13px]">
            <thead className="bg-muted">
              <tr>
                <Th>{t('stock.colRef')}</Th><Th>{t('stock.colDesignation')}</Th><Th>{t('stock.colBin')}</Th>
                <Th className="text-right">{t('stock.colAvailable')}</Th><Th className="text-right">{t('stock.colMin')}</Th>
                <Th className="text-right">{t('stock.colGap')}</Th><Th>{t('stock.colSupplier')}</Th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={7} className="px-3 py-6 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></td></tr>}
              {data && reorderRows.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">{t('stock.reorderEmpty')}</td></tr>}
              {reorderRows.map((r) => {
                const backOrder = r.available_qty < 0;
                const gap = Math.max(r.stock_min - r.available_qty, -r.available_qty);
                return (
                  <tr key={r.article_id} className="border-b border-border last:border-0 hover:bg-accent">
                    <td className="px-3 py-2 font-mono text-[12px]">{r.reference}</td>
                    <td className="px-3 py-2">{r.designation}</td>
                    <td className="px-3 py-2 font-mono text-[12px]">{r.bin_location ?? '—'}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${backOrder ? 'font-bold text-danger' : ''}`}><AvailableCell row={r} /></td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.stock_min}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${backOrder ? 'font-bold text-danger' : ''}`}>{gap}</td>
                    <td className="px-3 py-2">{r.supplier_id ? (supplierById.get(r.supplier_id) ?? '—') : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full border-collapse font-data text-[13px]">
            <thead className="bg-muted">
              <tr><Th>{t('stock.colRef')}</Th><Th>{t('stock.colDesignation')}</Th><Th>{t('stock.colBin')}</Th><Th className="text-right">{t('stock.colReal')}</Th><Th className="text-right">{t('stock.colReserved')}</Th><Th className="text-right">{t('stock.colAvailable')}</Th><Th className="text-right">{t('stock.colPamp')}</Th><Th className="text-right">{t('stock.colValue')}</Th><Th className="w-10" /></tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={9} className="px-3 py-6 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></td></tr>}
              {data && filtered.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">{t('stock.empty')}</td></tr>}
              {filtered.map((r) => {
                const low = r.stock_min > 0 && r.available_qty < r.stock_min;
                return (
                  <tr key={r.article_id} className="border-b border-border last:border-0 hover:bg-accent">
                    <td className="px-3 py-2 font-mono text-[12px]">{r.reference}</td>
                    <td className="px-3 py-2">{r.designation}</td>
                    <td className="px-3 py-2 font-mono text-[12px]">{r.bin_location ?? '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.real_qty}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.reserved_qty || ''}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${low ? 'font-bold text-danger' : ''}`}><AvailableCell row={r} /></td>
                    <td className="px-3 py-2 text-right tabular-nums">{eur(r.pamp)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{eur(r.stock_value)}</td>
                    <td className="px-2 py-1 text-center"><Button size="sm" variant="ghost" title={t('stock.history')} onClick={() => setHisto(r)}><History className="size-4 text-muted-foreground" /></Button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {total > PAGE_SIZES[0] && (
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2 font-data text-[13px] tabular-nums text-muted-foreground">
          <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
            <SelectTrigger className="h-8 w-32" aria-label={fillVars(t('designEcrans.stockPageSize'), { n: pageSize })}><SelectValue /></SelectTrigger>
            <SelectContent>{PAGE_SIZES.map((n) => <SelectItem key={n} value={String(n)}>{fillVars(t('designEcrans.stockPageSize'), { n })}</SelectItem>)}</SelectContent>
          </Select>
          <span>{fillVars(t('stock.pageOf'), { from: page * pageSize + 1, to: Math.min(total, (page + 1) * pageSize), total })}</span>
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}><ChevronLeft /> {t('stock.pagePrev')}</Button>
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(lastPage, p + 1))} disabled={page >= lastPage}>{t('stock.pageNext')} <ChevronRight /></Button>
        </div>
      )}

      {histo && <HistoryDialog row={histo} onClose={() => setHisto(null)} />}
    </>
  );
}

function HistoryDialog({ row, onClose }: { row: StockRow; onClose: () => void }) {
  const { data, isLoading } = useQuery({ queryKey: ['stock-history', row.article_id], queryFn: () => listStockHistory(row.article_id) });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>{t('stock.historyOf').replace('{ref}', row.reference)}</DialogTitle></DialogHeader>
        {isLoading ? <div className="grid place-items-center py-10"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div> : (
          <div className="max-h-[60vh] overflow-auto rounded-md border border-border">
            <table className="w-full border-collapse font-data text-[13px]">
              <thead className="bg-muted sticky top-0"><tr><Th>{t('stock.colDate')}</Th><Th>{t('stock.colType')}</Th><Th className="text-right">{t('stock.colQty')}</Th><Th>{t('stock.colOrigin')}</Th><Th>{t('stock.colRefDoc')}</Th></tr></thead>
              <tbody>
                {(data ?? []).length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-center text-muted-foreground">{t('stock.noHistory')}</td></tr>}
                {(data ?? []).map((m) => (
                  <tr key={m.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-1.5 font-mono text-[12px]">{new Date(m.occurred_at).toLocaleString('fr-BE')}</td>
                    <td className="px-3 py-1.5">{m.move_type}{m.is_reservation ? ' (rés.)' : ''}</td>
                    <td className={`px-3 py-1.5 text-right tabular-nums ${Number(m.qty_delta) < 0 ? 'text-danger' : ''}`}>{Number(m.qty_delta) > 0 ? '+' : ''}{Number(m.qty_delta)}</td>
                    <td className="px-3 py-1.5">{m.origin}</td>
                    <td className="px-3 py-1.5 font-mono text-[12px]">{m.ref ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Disponible + badge « Stock negatif » / « Rupture » (danger : couleur + icone + libelle). */
function AvailableCell({ row }: { row: StockRow }) {
  const alert = stockAlert(row);
  if (!alert) return <>{row.available_qty}</>;
  return (
    <span className="inline-flex items-center justify-end gap-2" title={t(alert === 'negative' ? 'designEcrans.stockNegativeHint' : 'designEcrans.stockOutHint')}>
      <StatusBadge tone="danger" icon={alert === 'negative' ? AlertTriangle : PackageX} label={t(alert === 'negative' ? 'designEcrans.stockNegative' : 'designEcrans.stockOut')} />
      <span className="font-bold text-danger">{row.available_qty}</span>
    </span>
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

function FilterSelect({ value, onChange, options, disabled }: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  const safe = options.filter((o) => o.value !== '' && o.value !== ALL_SENTINEL);
  return (
    <Select value={value || ALL_SENTINEL} onValueChange={(v) => onChange(v === ALL_SENTINEL ? '' : v)} disabled={disabled}>
      <SelectTrigger><SelectValue /></SelectTrigger>
      <SelectContent className="max-h-72">
        <SelectItem value={ALL_SENTINEL}>{t('stock.filterAll')}</SelectItem>
        {safe.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
