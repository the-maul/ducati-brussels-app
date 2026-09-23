import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Loader2, Plus, Upload, FolderTree, Wand2, Tags, ArrowRight, SlidersHorizontal, X, Copy, ShoppingCart, FilePenLine, GitMerge, Store, ChevronLeft, ChevronRight } from 'lucide-react';
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
import { listArticleFacets, duplicateArticle, type ArticleLinkFilter } from '@/modules/articles/api';
import { listArticlesPage, ArticleListUnavailableError, type ArticleListRow, type StockChoice } from '@/modules/articles/list-api';
import { SourceLogos } from '@/modules/articles/links-ui';
import { ArticleThumb } from '@/modules/articles/article-thumb';
import { UnlinkedProductsAlert } from '@/modules/articles/unlinked-alert';
import { yearOptions } from '@/modules/articles/article-form';
import { RAYONS_SORTED, sousRayonsFor, categoriesFor } from '@/modules/articles/product-families';
import { listSuppliers, supplierName, addToReorderProposal } from '@/modules/purchases/api';
import { LabelsBatchDialog } from '@/modules/articles/labels-batch';
import { CatalogSearchHint } from '@/modules/catalog/catalog-search-hint';
import { effectiveSaleTtc, useRoundSalePrices } from '@/lib/pricing';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/parts/')({
  head: () => ({ meta: [{ title: 'Pièces & Accessoires — Ducati Bruxelles' }] }),
  component: ArticlesList,
});

/** Taille d'une page. Le plafond PostgREST du projet est de 1 000 lignes. */
const PAGE_SIZE = 200;

function fmtEur(n: number): string {
  const s = (Math.round(n * 100) / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!,))/g, ' ');
  return `${s} €`;
}

function fill(s: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(String(v)), s);
}

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
  toComplete: boolean;
  /** relié à Shopify / au catalogue Ducati / non relié (décision M-25) */
  links: '' | ArticleLinkFilter;
};

const EMPTY_FILTERS: FiltersState = {
  supplierId: '', stock: 'all', year: '', rayon: '', sousRayon: '', categorie: '',
  brand: '', size: '', color: '', paLocked: false, pvLocked: false, toComplete: false, links: '',
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
  if (f.toComplete) n++;
  if (f.links) n++;
  return n;
}

function ArticlesList() {
  const { activeCompanyId, isAdmin, hasRole } = useAuth();
  const roundUp = useRoundSalePrices(activeCompanyId);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [f, setF] = useState<FiltersState>(EMPTY_FILTERS);
  const [page, setPage] = useState(0);
  const set = <K extends keyof FiltersState>(k: K, v: FiltersState[K]) => setF((p) => ({ ...p, [k]: v }));
  const active = countActive(f);

  const duplicate = useMutation({
    // Toast sur mesure émis ici : on coupe le toast global (mutation-feedback).
    meta: { success: false, error: false },
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
  // Tout changement de critère ramène à la première page.
  useEffect(() => { setPage(0); }, [debounced, f, activeCompanyId]);

  // TOUT est filtré en base, stock compris (fonction `article_list_page`).
  // Avant le 23/09/2026 le stock était croisé dans le navigateur à partir de la
  // liste complète des articles : PostgREST la coupait à 1 000 lignes sans le
  // dire et le filtre « stock positif » ne trouvait jamais rien.
  const query = useMemo(() => ({
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
    toComplete: f.toComplete || undefined,
    links: f.links || undefined,
    stock: f.stock,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  }), [debounced, f, page]);

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['articles', activeCompanyId, query],
    queryFn: () => listArticlesPage(activeCompanyId!, query),
    enabled: !!activeCompanyId,
    placeholderData: (prev) => prev,   // pagination sans clignotement
    retry: false,
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

  const rows = data?.rows;
  const total = data?.total ?? 0;
  const lastPage = Math.max(Math.ceil(total / PAGE_SIZE) - 1, 0);
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
            <Button variant="outline" onClick={() => navigate({ to: '/parts/links' })}>
              <GitMerge /> {t('links.toolLinks')}
            </Button>
            {(isAdmin() || hasRole('vendeur')) && (
              <Button variant="outline" onClick={() => navigate({ to: '/parts/shopify' })}>
                <Store /> {t('links.toolShopify')}
              </Button>
            )}
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

      {/* Un seul catalogue (M-25) : le DMS est la source ; un produit du site sans article est signalé. */}
      <UnlinkedProductsAlert />

      <div className="sticky top-0 z-20 flex items-center gap-2 bg-background pb-2">
        <div className="relative max-w-md flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('articles.search')} className="pl-9" />
        </div>
        <Button variant={active > 0 ? 'default' : 'outline'} onClick={() => setFiltersOpen((o) => !o)}>
          <SlidersHorizontal /> {t('articles.filters')}{active > 0 ? ` (${active})` : ''}
        </Button>
        {data && !error && (
          <span className="text-sm tabular-nums text-muted-foreground">
            {total === 0
              ? t('articles.pageNone')
              : fill(t('articles.pageRange'), {
                from: page * PAGE_SIZE + 1,
                to: page * PAGE_SIZE + (rows?.length ?? 0),
                n: total.toLocaleString('fr-BE'),
              })}
          </span>
        )}
        {isFetching && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
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
            <FilterField label={t('links.filterLinks')}>
              <FilterSelect
                value={f.links}
                onChange={(v) => set('links', v as FiltersState['links'])}
                options={[
                  { value: 'shopify', label: t('links.linksShopify') },
                  { value: 'not_shopify', label: t('links.linksNotShopify') },
                  { value: 'ducati', label: t('links.linksDucati') },
                  { value: 'g8', label: t('links.linksG8') },
                  { value: 'none', label: t('links.linksNone') },
                ]}
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
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={f.toComplete} onCheckedChange={(v) => set('toComplete', v === true)} />
                {t('ecatalog.filterToComplete')}
              </label>
              <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={() => setF(EMPTY_FILTERS)} disabled={active === 0}>
                <X /> {t('articles.filterReset')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Repli lisible : jamais une liste vide silencieuse quand la requête échoue. */}
      {error && (
        <div className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">
          <p>{error instanceof ArticleListUnavailableError ? t('articles.listUnavailable') : t('articles.errLoad')}</p>
          {!(error instanceof ArticleListUnavailableError) && (
            <p className="mt-1 font-mono text-[11px] opacity-80">{(error as Error).message}</p>
          )}
        </div>
      )}

      <div className="overflow-auto rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="sticky top-11 z-10 bg-muted">
            <tr>
              <Th className="w-14">{t('articles.colImage')}</Th>
              <Th>{t('articles.colRef')}</Th>
              <Th>{t('articles.colDesignation')}</Th>
              <Th>{t('articles.colSources')}</Th>
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
            {isLoading && (
              <tr><td colSpan={14} className="px-3 py-6 text-center text-muted-foreground"><Loader2 className="mx-auto size-5 animate-spin" /></td></tr>
            )}
            {!isLoading && !error && rows && rows.length === 0 && (
              <tr><td colSpan={14} className="px-3 py-6 text-center text-muted-foreground">
                {t('articles.empty')}
                {/* Mission 06 : la référence n'est pas un article du DMS mais peut exister chez Ducati. */}
                {activeCompanyId && debounced.trim() && <CatalogSearchHint companyId={activeCompanyId} q={debounced} />}
              </td></tr>
            )}
            {rows?.map((a) => (
              <ArticleRow
                key={a.id}
                a={a}
                roundUp={roundUp}
                duplicating={duplicate.isPending}
                onOpen={() => navigate({ to: '/parts/$articleId', params: { articleId: a.id } })}
                onDuplicate={() => duplicate.mutate(a.id)}
                onPropose={() => {
                  toast.info(t('articles.proposedToOrder'));
                  navigate(addToReorderProposal(activeCompanyId!, a.id));
                }}
              />
            ))}
          </tbody>
        </table>
      </div>

      {total > PAGE_SIZE && (
        <div className="mt-2 flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" disabled={page === 0 || isFetching} onClick={() => setPage((p) => Math.max(p - 1, 0))}>
            <ChevronLeft /> {t('articles.pagePrev')}
          </Button>
          <Button variant="outline" size="sm" disabled={page >= lastPage || isFetching} onClick={() => setPage((p) => Math.min(p + 1, lastPage))}>
            {t('articles.pageNext')} <ChevronRight />
          </Button>
        </div>
      )}

      <LabelsBatchDialog open={labelsOpen} onOpenChange={setLabelsOpen} companyId={activeCompanyId} />
    </>
  );
}

function ArticleRow({ a, roundUp, duplicating, onOpen, onDuplicate, onPropose }: {
  a: ArticleListRow;
  roundUp: boolean;
  duplicating: boolean;
  onOpen: () => void;
  onDuplicate: () => void;
  onPropose: () => void;
}) {
  const isReplaced = !!a.superseded_by_id;
  const replTitle = a.replacement_reference
    ? t('articles.replacedBy').replace('{ref}', a.replacement_reference)
    : t('articles.replacedBadge');
  const avail = a.supplier_availability;
  const availTone = avail === 'green' ? 'bg-success' : avail === 'yellow' ? 'bg-warning' : avail === 'red' ? 'bg-danger' : 'bg-neutral-bg';
  const availLabel = avail === 'green' ? t('articles.availGreen') : avail === 'yellow' ? t('articles.availYellow') : avail === 'red' ? t('articles.availRed') : t('articles.availUnknown');
  // Prix de vente manquant (article créé au vol, reprise G8 incomplète) : on le DIT.
  const price = effectiveSaleTtc(a.sale_price_ttc, roundUp);
  const priceMissing = a.sale_price_ttc == null || Number(a.sale_price_ttc) === 0;

  return (
    <tr
      onClick={onOpen}
      title={isReplaced ? replTitle : undefined}
      className={`cursor-pointer border-b border-border last:border-0 hover:bg-accent ${isReplaced ? 'opacity-55' : ''}`}
    >
      <td className="px-3 py-1.5">
        <ArticleThumb url={a.image_url} source={a.image_source} alt={a.designation} size={40} />
      </td>
      <td className="px-3 py-2 font-mono text-[12px]">{a.reference}</td>
      <td className="px-3 py-2 font-medium">
        <span className="inline-flex flex-wrap items-center gap-2">
          <span className={isReplaced ? 'line-through decoration-1' : ''}>{a.designation}</span>
          {a.to_complete && <StatusBadge tone="info" icon={FilePenLine} label={t('ecatalog.toCompleteBadge')} />}
          {isReplaced && (
            <StatusBadge tone="warning" icon={ArrowRight} label={a.replacement_reference ? `${t('articles.replacedBadge')} → ${a.replacement_reference}` : t('articles.replacedBadge')} />
          )}
        </span>
      </td>
      <td className="px-3 py-2">
        <SourceLogos flags={{ g8: a.link_g8, shopify: a.link_shopify, ducati: a.link_ducati }} />
      </td>
      <td className="px-3 py-2">
        <span className={`inline-block size-2.5 rounded-full ${availTone}`} title={availLabel} />
      </td>
      <td className="px-3 py-2 text-right tabular-nums">{a.real_qty}</td>
      <td className="px-3 py-2 text-right tabular-nums">{a.reserved_qty}</td>
      <td className="px-3 py-2 text-right tabular-nums">{a.available_qty}</td>
      <td className="px-3 py-2 font-mono text-[12px]">{a.bin_location ?? '—'}</td>
      <td className="px-3 py-2 font-mono text-[12px]">{a.bin_location2 || '—'}</td>
      {/* TODO: brancher quantités en proposition/commande (M4 achats) */}
      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">—</td>
      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">—</td>
      <td className="px-3 py-2 text-right tabular-nums">
        {priceMissing
          ? <span className="text-warning">{t('articles.priceToComplete')}</span>
          : fmtEur(price)}
      </td>
      <td className="px-1 py-2 text-right">
        <Button
          variant="ghost" size="sm" title={t('articles.proposeOrder')} aria-label={t('articles.proposeOrder')}
          onClick={(e) => { e.stopPropagation(); onPropose(); }}
        >
          <ShoppingCart className="size-4" />
        </Button>
        <Button
          variant="ghost" size="sm" title={t('articles.duplicate')} aria-label={t('articles.duplicate')}
          disabled={duplicating}
          onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
        >
          <Copy className="size-4" />
        </Button>
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

// children optionnel : certaines colonnes n'ont pas d'en-tete (colonne d'actions).
function Th({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return (
    <th className={`px-3 py-2 text-left font-ui text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>
      {children}
    </th>
  );
}
