import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Loader2, Plus, Upload, FolderTree, Wand2, Tags, ArrowRight, SlidersHorizontal, X, Copy, ShoppingCart } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/lib/auth/auth-context';
import { listArticles, listArticleFacets, getSupplierAvailability, duplicateArticle, type ArticleFilters } from '@/modules/articles/api';
import { yearOptions } from '@/modules/articles/article-form';
import { RAYONS_SORTED, sousRayonsFor, categoriesFor } from '@/modules/articles/product-families';
import { listSuppliers, supplierName, addToReorderProposal } from '@/modules/purchases/api';
import { listStock } from '@/modules/stock/stock-api';
import { LabelsBatchDialog } from '@/modules/articles/labels-batch';
import { effectiveSaleTtc, useRoundSalePrices } from '@/lib/pricing';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/parts/')({
  head: () => ({ meta: [{ title: 'Pièces & Accessoires — Ducati Bruxelles' }] }),
  component: ArticlesList,
});

function fmtEur(n: number): string {
  const s = (Math.round(n * 100) / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!,))/g, ' ');
  return `${s} €`;
}

type StockChoice = 'all' | 'pos' | 'neg' | 'zero';

/** Filtres multicritères de la liste (état écran). */
type FiltersState = {
  supplierId: string;
  stock: StockChoice;
  year: string;
  rayon: string;
  sousRayon: string;
  categorie: string;
  brand: string;
  size: string;
  color: string;
  paLocked: boolean;
  pvLocked: boolean;
};

const EMPTY_FILTERS: FiltersState = {
  supplierId: '', stock: 'all', year: '', rayon: '', sousRayon: '', categorie: '',
  brand: '', size: '', color: '', paLocked: false, pvLocked: false,
};

function countActive(f: FiltersState): number {
  let n = 0;
  if (f.supplierId) n++;
  if (f.stock !== 'all') n++;
  if (f.year) n++;
  if (f.rayon) n++; // sous-rayon/catégorie comptent avec le rayon (même critère famille)
  if (f.brand) n++;
  if (f.size) n++;
  if (f.color) n++;
  if (f.paLocked) n++;
  if (f.pvLocked) n++;
  return n;
}

function ArticlesList() {
  const { activeCompanyId } = useAuth();
  const roundUp = useRoundSalePrices(activeCompanyId);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [f, setF] = useState<FiltersState>(EMPTY_FILTERS);
  const set = <K extends keyof FiltersState>(k: K, v: FiltersState[K]) => setF((p) => ({ ...p, [k]: v }));
  const active = countActive(f);

  const duplicate = useMutation({
    mutationFn: (articleId: string) => duplicateArticle(articleId),
    onSuccess: (newId) => {
      qc.invalidateQueries({ queryKey: ['articles'] });
      toast.success(t('articles.duplicated'));
      navigate({ to: '/parts/$articleId', params: { articleId: newId } });
    },
    onError: () => toast.error(t('articles.errDuplicate')),
  });

  useEffect(() => {
    const id = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(id);
  }, [search]);

  // Changement de société : les filtres de l'ancienne société (uuid fournisseur,
  // marques…) n'ont plus de sens — remise à zéro.
  useEffect(() => { setF(EMPTY_FILTERS); }, [activeCompanyId]);

  // Le filtre Stocks croise côté client : plafond serveur élargi pour limiter la troncature.
  const limit = f.stock !== 'all' ? 5000 : 500;
  const filters: ArticleFilters = {
    search: debounced,
    supplierId: f.supplierId || undefined,
    year: f.year ? Number(f.year) : undefined,
    rayon: f.rayon || undefined,
    sousRayon: f.sousRayon || undefined,
    categorie: f.categorie || undefined,
    brand: f.brand || undefined,
    size: f.size || undefined,
    color: f.color || undefined,
    paLocked: f.paLocked || undefined,
    pvLocked: f.pvLocked || undefined,
    limit,
  };

  const { data, isLoading, error } = useQuery({
    // clé = filtres SERVEUR uniquement (f.stock ne change pas la requête : croisement client)
    queryKey: ['articles', activeCompanyId, filters],
    queryFn: () => listArticles(activeCompanyId!, filters),
    enabled: !!activeCompanyId,
  });

  // Options des menus déroulants (valeurs réellement présentes dans le référentiel)
  const { data: facets } = useQuery({
    queryKey: ['article-facets', activeCompanyId],
    queryFn: () => listArticleFacets(activeCompanyId!),
    enabled: !!activeCompanyId && filtersOpen,
    staleTime: 5 * 60 * 1000,
  });
  const { data: suppliers } = useQuery({
    queryKey: ['suppliers-filter', activeCompanyId],
    queryFn: () => listSuppliers(activeCompanyId!, '', 500),
    enabled: !!activeCompanyId && filtersOpen,
    staleTime: 5 * 60 * 1000,
  });
  // Stock réel/réservé/disponible (somme de stock_moves) — chargé en permanence pour
  // alimenter les colonnes du tableau ET le filtre Stocks (croisement client).
  const { data: stockRows, error: stockError } = useQuery({
    queryKey: ['stock-for-filter', activeCompanyId],
    queryFn: () => listStock(activeCompanyId!),
    enabled: !!activeCompanyId,
    staleTime: 60 * 1000,
  });
  const stockById = useMemo(() => new Map(stockRows?.map((r) => [r.article_id, r]) ?? []), [stockRows]);

  const rows = useMemo(() => {
    if (!data) return data;
    if (f.stock === 'all') return data;
    if (stockError) return data; // stock indisponible : liste non filtrée + bandeau d'erreur
    if (!stockRows) return undefined; // stock en cours de chargement
    return data.filter((a) => {
      const q = stockById.get(a.id)?.real_qty ?? 0;
      return f.stock === 'pos' ? q > 0 : f.stock === 'neg' ? q < 0 : q === 0;
    });
  }, [data, stockRows, stockById, stockError, f.stock]);

  const yearsList = facets?.years?.length ? facets.years : yearOptions();

  return (
    <>
      <PageHeader
        title={t('articles.title')}
        description={t('articles.subtitle')}
        actions={
          <>
            <Button variant="outline" onClick={() => navigate({ to: '/parts/families' })}>
              <FolderTree /> Familles
            </Button>
            <Button variant="outline" onClick={() => navigate({ to: '/parts/cascade' })}>
              <Wand2 /> Cascade
            </Button>
            <Button variant="outline" onClick={() => navigate({ to: '/parts/import' })}>
              <Upload /> {t('articles.import')}
            </Button>
            <Button variant="outline" onClick={() => setLabelsOpen(true)}>
              <Tags /> {t('articles.labelsBtn')}
            </Button>
            <Button onClick={() => navigate({ to: '/parts/new' })}>
              <Plus /> {t('articles.new')}
            </Button>
          </>
        }
      />

      <div className="sticky top-0 z-20 flex items-center gap-2 bg-background pb-2">
        <div className="relative max-w-md flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('articles.search')} className="pl-9" />
        </div>
        <Button variant={active > 0 ? 'default' : 'outline'} onClick={() => setFiltersOpen((o) => !o)}>
          <SlidersHorizontal /> {t('articles.filters')}{active > 0 ? ` (${active})` : ''}
        </Button>
        {rows && <span className="text-sm text-muted-foreground">{rows.length}</span>}
      </div>

      {filtersOpen && (
        <div className="mb-4 rounded-md border border-border bg-card p-3 shadow-[var(--shadow-card)]">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FilterField label={t('articles.filterSupplier')}>
              <FilterSelect
                value={f.supplierId}
                onChange={(v) => set('supplierId', v)}
                options={(suppliers ?? []).map((s) => ({ value: s.id, label: supplierName(s) }))}
              />
            </FilterField>
            <FilterField label={t('articles.filterStock')}>
              <Select value={f.stock} onValueChange={(v) => set('stock', v as StockChoice)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('articles.stockAll')}</SelectItem>
                  <SelectItem value="pos">{t('articles.stockPos')}</SelectItem>
                  <SelectItem value="neg">{t('articles.stockNeg')}</SelectItem>
                  <SelectItem value="zero">{t('articles.stockZero')}</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label={t('articles.year')}>
              <FilterSelect
                value={f.year}
                onChange={(v) => set('year', v)}
                options={yearsList.map((y) => ({ value: String(y), label: String(y) }))}
              />
            </FilterField>
            <FilterField label={t('articles.rayon')}>
              <FilterSelect
                value={f.rayon}
                onChange={(v) => setF((p) => ({ ...p, rayon: v, sousRayon: '', categorie: '' }))}
                options={RAYONS_SORTED.map((r) => ({ value: r.code, label: `${r.code} ${r.label}` }))}
              />
            </FilterField>
            <FilterField label={t('articles.subRayon')}>
              <FilterSelect
                value={f.sousRayon}
                onChange={(v) => setF((p) => ({ ...p, sousRayon: v, categorie: '' }))}
                options={sousRayonsFor(f.rayon).map((s) => ({ value: s.code, label: `${s.code} ${s.label}` }))}
                disabled={!f.rayon}
              />
            </FilterField>
            <FilterField label={t('articles.categoryLevel')}>
              <FilterSelect
                value={f.categorie}
                onChange={(v) => set('categorie', v)}
                options={categoriesFor(f.rayon, f.sousRayon).map((c) => ({ value: c.code, label: `${c.code} ${c.label}` }))}
                disabled={!f.sousRayon}
              />
            </FilterField>
            <FilterField label={t('articles.brand')}>
              <FilterSelect
                value={f.brand}
                onChange={(v) => set('brand', v)}
                options={(facets?.brands ?? []).map((b) => ({ value: b, label: b }))}
              />
            </FilterField>
            <FilterField label={t('articles.size')}>
              <FilterSelect
                value={f.size}
                onChange={(v) => set('size', v)}
                options={(facets?.sizes ?? []).map((s) => ({ value: s, label: s }))}
              />
            </FilterField>
            <FilterField label={t('articles.color')}>
              <FilterSelect
                value={f.color}
                onChange={(v) => set('color', v)}
                options={(facets?.colors ?? []).map((c) => ({ value: c, label: c }))}
              />
            </FilterField>
            <div className="flex flex-wrap items-end gap-4 pb-1 sm:col-span-2 lg:col-span-3">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={f.paLocked} onCheckedChange={(v) => set('paLocked', v === true)} />
                {t('articles.priceLockPurchase')}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={f.pvLocked} onCheckedChange={(v) => set('pvLocked', v === true)} />
                {t('articles.priceLockSale')}
              </label>
              <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={() => setF(EMPTY_FILTERS)} disabled={active === 0}>
                <X /> {t('articles.filterReset')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {(error || stockError) && (
        <div className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">
          <p>{t('articles.errLoad')}</p>
          <p className="mt-1 font-mono text-[11px] opacity-80">{((error || stockError) as Error).message}</p>
        </div>
      )}

      {data && data.length >= limit && (
        <div className="mb-2 rounded-md bg-info-bg px-3 py-2 text-[13px] text-info">
          {t('articles.truncated').replace('{n}', String(limit))}
        </div>
      )}

      <div className="overflow-auto rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="sticky top-11 z-10 bg-muted">
            <tr>
              <Th>{t('articles.colRef')}</Th>
              <Th>{t('articles.colDesignation')}</Th>
              <Th>{t('articles.colSupplierAvail')}</Th>
              <Th className="text-right">{t('articles.colRealStock')}</Th>
              <Th className="text-right">{t('articles.colReserved')}</Th>
              <Th className="text-right">{t('articles.colAvailable')}</Th>
              <Th>{t('articles.colStock')}</Th>
              <Th>{t('articles.binLocation2')}</Th>
              <Th className="text-right">{t('articles.colOnProposal')}</Th>
              <Th className="text-right">{t('articles.colOnOrder')}</Th>
              <Th className="text-right">{t('articles.colPrice')}</Th>
              <Th className="w-20" />
            </tr>
          </thead>
          <tbody>
            {(isLoading || (data && !rows)) && (
              <tr><td colSpan={12} className="px-3 py-6 text-center text-muted-foreground"><Loader2 className="mx-auto size-5 animate-spin" /></td></tr>
            )}
            {rows && rows.length === 0 && (
              <tr><td colSpan={12} className="px-3 py-6 text-center text-muted-foreground">{t('articles.empty')}</td></tr>
            )}
            {rows?.map((a) => {
              const isReplaced = !!a.superseded_by_id;
              const replTitle = a.replacement?.reference
                ? t('articles.replacedBy').replace('{ref}', a.replacement.reference)
                : t('articles.replacedBadge');
              const avail = getSupplierAvailability(a);
              const availTone = avail === 'green' ? 'bg-success' : avail === 'yellow' ? 'bg-warning' : avail === 'red' ? 'bg-danger' : 'bg-neutral-bg';
              const availLabel = avail === 'green' ? t('articles.availGreen') : avail === 'yellow' ? t('articles.availYellow') : avail === 'red' ? t('articles.availRed') : t('articles.availUnknown');
              const stock = stockById.get(a.id);
              const realQty = stock?.real_qty;
              const reservedQty = stock?.reserved_qty;
              const availableQty = stock ? (reservedQty != null ? stock.real_qty - reservedQty : stock.real_qty) : undefined;
              const bin2 = (a as { bin_location2?: string | null }).bin_location2;
              return (
              <tr
                key={a.id}
                onClick={() => navigate({ to: '/parts/$articleId', params: { articleId: a.id } })}
                title={isReplaced ? replTitle : undefined}
                className={`cursor-pointer border-b border-border last:border-0 hover:bg-accent ${isReplaced ? 'opacity-55' : ''}`}
              >
                <td className="px-3 py-2 font-mono text-[12px]">{a.reference}</td>
                <td className="px-3 py-2 font-medium">
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <span className={isReplaced ? 'line-through decoration-1' : ''}>{a.designation}</span>
                    {isReplaced && (
                      <StatusBadge tone="warning" icon={ArrowRight} label={a.replacement?.reference ? `${t('articles.replacedBadge')} → ${a.replacement.reference}` : t('articles.replacedBadge')} />
                    )}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span className={`inline-block size-2.5 rounded-full ${availTone}`} title={availLabel} />
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{realQty != null ? realQty : '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{reservedQty != null ? reservedQty : '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{availableQty != null ? availableQty : '—'}</td>
                <td className="px-3 py-2 font-mono text-[12px]">{a.bin_location ?? '—'}</td>
                <td className="px-3 py-2 font-mono text-[12px]">{bin2 || '—'}</td>
                {/* TODO: brancher quantités en proposition/commande (M4 achats) */}
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">—</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">—</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtEur(effectiveSaleTtc(a.sale_price_ttc, roundUp))}</td>
                <td className="px-1 py-2 text-right">
                  <Button
                    variant="ghost" size="sm" title={t('articles.proposeOrder')} aria-label={t('articles.proposeOrder')}
                    onClick={(e) => {
                      e.stopPropagation();
                      toast.info(t('articles.proposedToOrder'));
                      navigate(addToReorderProposal(activeCompanyId!, a.id));
                    }}
                  >
                    <ShoppingCart className="size-4" />
                  </Button>
                  <Button
                    variant="ghost" size="sm" title={t('articles.duplicate')} aria-label={t('articles.duplicate')}
                    disabled={duplicate.isPending}
                    onClick={(e) => { e.stopPropagation(); duplicate.mutate(a.id); }}
                  >
                    <Copy className="size-4" />
                  </Button>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <LabelsBatchDialog open={labelsOpen} onOpenChange={setLabelsOpen} companyId={activeCompanyId} />
    </>
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

/**
 * Select de filtre : premier item « Tous » (valeur vide côté état).
 * Une valeur de donnée vide ou égale à la sentinelle est écartée des options
 * (SelectItem interdit la valeur vide ; la sentinelle doit rester unique).
 */
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
        <SelectItem value={ALL_SENTINEL}>{t('articles.filterAll')}</SelectItem>
        {safe.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function Th({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <th className={`px-3 py-2 text-left font-ui text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>
      {children}
    </th>
  );
}
