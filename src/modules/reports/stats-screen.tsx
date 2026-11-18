/**
 * M13 — Module statistiques façon G8 (onglets de la page Rapports).
 *
 * G8 (docs/g8-inventaire 08-compta-stats.md) : sélection (familles, fournisseur, marque, référence,
 * client, opérateur, période + périodes prédéfinies), classement sur 4 niveaux + article,
 * onglets Ventes · Meilleures ventes · Remises · Achats · Tableau de bord mois par mois ·
 * Cessions internes · Documents en cours · Indicateurs, exercices comparés, histogramme,
 * Visualiser · Imprimer · Export Excel ; Stats quotidiennes (06-ventes-caisse.md).
 * Comme dans G8, la sélection est appliquée au clic sur « Visualiser ».
 * Calculs en base : `stats_*` (migration 20261118181000) ; logique d'affichage : stats-core.ts.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronDown, ChevronRight, Download, Eye, Loader2, Lock, Printer, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { t, fillVars, getLocale } from '@/lib/i18n';
import { RAYONS_SORTED, sousRayonsFor, categoriesFor } from '@/modules/articles/product-families';
import {
  DIMS_BY_SOURCE, MAX_LEVELS, PERIOD_PRESETS, buildTree, derived, effectiveLevels, exportFileName, exportTreeRows,
  flattenTree, isoDate, keyLabel, presetRange, sumMonths, totals,
  type ExportColumn, type KeyLabeler, type Metrics, type PeriodPreset, type StatsDim, type StatsNode, type StatsRow, type StatsSource,
} from './stats-core';
import {
  getMonthlyStats, getOpenDocuments, getStats, getStatsIndicators, isStatsForbidden, isStatsMissing,
  listCessionTypes, searchStatsContacts, searchStatsSuppliers, type ContactPick, type StatsFilters,
} from './stats-api';
import { downloadXlsx, type SheetRows } from './stats-export';

// ---------------------------------------------------------------- formats

const fmt2 = new Intl.NumberFormat('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtQ = new Intl.NumberFormat('fr-BE', { maximumFractionDigits: 3 });
const eur = (n: number | null | undefined) => (n === null || n === undefined ? '' : `${fmt2.format(n)} €`);
const qty = (n: number | null | undefined) => (n === null || n === undefined ? '' : fmtQ.format(n));
const pct = (n: number | null | undefined) => (n === null || n === undefined ? '' : `${fmt2.format(n)} %`);
const monthName = (m: number) => {
  const s = new Date(2000, m - 1, 1).toLocaleDateString(`${getLocale()}-BE`, { month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

// ---------------------------------------------------------------- sélection

type StatsTab = 'sales' | 'best' | 'discounts' | 'purchases' | 'monthly' | 'cessions' | 'open' | 'indicators' | 'daily';
const TABS: StatsTab[] = ['sales', 'best', 'discounts', 'purchases', 'monthly', 'cessions', 'open', 'indicators', 'daily'];

type Selection = {
  from: string; to: string; preset: PeriodPreset | 'custom'; compare: boolean;
  levels: (StatsDim | '')[]; withArticle: boolean;
  filters: StatsFilters;
  supplierLabel: string; clientLabel: string;
  year: number; dailyDetailed: boolean; bestBy: 'ca' | 'qty';
};

const SOURCE_OF: Partial<Record<StatsTab, StatsSource>> = {
  sales: 'sales', best: 'sales', discounts: 'sales', daily: 'sales', purchases: 'purchases', cessions: 'cessions',
};
const DEFAULT_LEVEL: Record<StatsSource, StatsDim> = { sales: 'brand', purchases: 'supplier', cessions: 'cession' };
/** Onglets qui utilisent le classement à 4 niveaux. */
const WITH_LEVELS: StatsTab[] = ['sales', 'discounts', 'purchases', 'cessions'];

function initialSelection(): Selection {
  const now = new Date();
  return {
    from: `${now.getFullYear()}-01-01`, to: isoDate(now), preset: 'custom', compare: false,
    levels: ['brand', '', '', ''], withArticle: false, filters: { vehicles: 'all' },
    supplierLabel: '', clientLabel: '', year: now.getFullYear(), dailyDetailed: false, bestBy: 'ca',
  };
}

/** Niveaux envoyés pour un onglet (un axe absent de la source est ignoré ; défaut si rien ne reste). */
function levelsFor(tab: StatsTab, s: Selection): StatsDim[] {
  const source = SOURCE_OF[tab] ?? 'sales';
  if (tab === 'best') return ['article'];
  if (tab === 'daily') return s.dailyDetailed ? ['day', 'supplier', 'article'] : ['supplier', 'article'];
  const lv = effectiveLevels(s.levels, s.withArticle, source);
  return lv.length ? lv : effectiveLevels([DEFAULT_LEVEL[source]], s.withArticle, source);
}

/** Filtres utiles à la source : pas de client sur les achats, type de cession sur les cessions seulement. */
function filtersFor(tab: StatsTab, s: Selection): StatsFilters {
  const f: StatsFilters = { ...s.filters };
  const source = SOURCE_OF[tab];
  if (source !== 'sales' && tab !== 'monthly') { delete f.contact_id; }
  if (source === 'purchases') delete f.operator;
  if (source !== 'cessions') delete f.cession_type;
  // Meilleures ventes et stats quotidiennes : par référence (articles et main-d'oeuvre), sans port ni ligne libre.
  if (tab === 'best' || tab === 'daily') f.kind = 'article,labour';
  return f;
}

const labeler = (): KeyLabeler => ({
  none: t('stats.none'),
  special: (k) => t(`stats.special_${k.slice(1)}`),
});

// ---------------------------------------------------------------- écran

export function StatsModule({ companyId }: { companyId: string }) {
  const [tab, setTab] = useState<StatsTab>('sales');
  const [sel, setSel] = useState<Selection>(initialSelection);
  const [applied, setApplied] = useState<Selection | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState<string | null>(null);
  const set = (patch: Partial<Selection>) => setSel((s) => ({ ...s, ...patch }));
  const setF = (patch: Partial<StatsFilters>) => setSel((s) => ({ ...s, filters: { ...s.filters, ...patch } }));

  const source = SOURCE_OF[tab];
  const levels = applied ? levelsFor(tab, applied) : [];
  const filters = applied ? filtersFor(tab, applied) : {};

  const statsQ = useQuery({
    queryKey: ['stats-query', companyId, tab, applied, levels],
    queryFn: () => getStats(companyId, source!, applied!.from, applied!.to, filters, levels, applied!.compare),
    enabled: !!applied && !!source,
    retry: false,
  });
  const monthlyQ = useQuery({
    queryKey: ['stats-monthly', companyId, applied?.year, applied?.filters],
    queryFn: () => getMonthlyStats(companyId, applied!.year, filtersFor('monthly', applied!)),
    enabled: !!applied && tab === 'monthly', retry: false,
  });
  const indicatorsQ = useQuery({
    queryKey: ['stats-indicators', companyId, applied?.from, applied?.to],
    queryFn: () => getStatsIndicators(companyId, applied!.from, applied!.to),
    enabled: !!applied && tab === 'indicators', retry: false,
  });
  const openQ = useQuery({
    queryKey: ['stats-open', companyId, applied ? 1 : 0],
    queryFn: () => getOpenDocuments(companyId),
    enabled: !!applied && tab === 'open', retry: false,
  });
  const cessionTypes = useQuery({ queryKey: ['stats-cession-types', companyId], queryFn: () => listCessionTypes(companyId) });

  const activeQ = tab === 'monthly' ? monthlyQ : tab === 'indicators' ? indicatorsQ : tab === 'open' ? openQ : statsQ;
  const rows = statsQ.data ?? [];
  const tree = useMemo(() => buildTree(rows, levels), [rows, levels.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = useMemo(() => totals(rows), [rows]);

  const onPreset = (p: string) => {
    if (p === 'custom') { set({ preset: 'custom' }); return; }
    const r = presetRange(p as PeriodPreset);
    set({ preset: p as PeriodPreset, from: r.from, to: r.to });
  };

  const doExport = async () => {
    if (!applied) return;
    setExporting(true); setExportErr(null);
    try {
      const sheet = buildExportSheet(tab, applied, levels, tree, total, monthlyQ.data, indicatorsQ.data, openQ.data);
      await downloadXlsx(exportFileName(`${t('stats.title')} ${t(`stats.tab_${tab}`)}`, applied.from, applied.to), [{ name: t(`stats.tab_${tab}`), rows: sheet }]);
    } catch (e) {
      setExportErr(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

  const err = activeQ.error;
  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={(v) => setTab(v as StatsTab)}>
        <TabsList className="h-auto flex-wrap justify-start print:hidden">
          {TABS.map((x) => <TabsTrigger key={x} value={x}>{t(`stats.tab_${x}`)}</TabsTrigger>)}
        </TabsList>
      </Tabs>

      <SelectionPanel
        tab={tab} sel={sel} set={set} setF={setF} onPreset={onPreset} companyId={companyId}
        cessionTypes={cessionTypes.data ?? []}
      />

      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Button onClick={() => setApplied({ ...sel })}><Eye className="size-4" /> {t('stats.show')}</Button>
        <Button variant="outline" onClick={() => window.print()} disabled={!applied}><Printer className="size-4" /> {t('stats.print')}</Button>
        <Button variant="outline" onClick={doExport} disabled={!applied || exporting || !activeQ.data}>
          {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} {t('stats.export')}
        </Button>
        {exportErr && <span className="text-[13px] text-danger">{exportErr}</span>}
        {applied && <span className="text-[12px] text-muted-foreground">{fillVars(t('stats.appliedPeriod'), { from: applied.from, to: applied.to })}</span>}
      </div>

      {!applied && <Notice>{t('stats.notRun')}</Notice>}
      {applied && activeQ.isLoading && <div className="grid place-items-center py-10"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>}
      {applied && err && (
        isStatsMissing(err) ? <Notice tone="warning" icon={<AlertTriangle className="size-4" />}>{t('stats.migrationMissing')}</Notice>
          : isStatsForbidden(err) ? <Notice icon={<Lock className="size-4" />}>{t('stats.forbidden')}</Notice>
          : <Notice tone="danger" icon={<AlertTriangle className="size-4" />}>{fillVars(t('stats.error'), { msg: err instanceof Error ? err.message : String(err) })}</Notice>
      )}

      {applied && !err && activeQ.data && (
        <>
          {(tab === 'sales' || tab === 'discounts' || tab === 'purchases' || tab === 'cessions') && (
            <TreeTable tab={tab} nodes={tree} levels={levels} total={total} compare={applied.compare} />
          )}
          {tab === 'sales' && tree.length > 0 && <Histogram nodes={tree} compare={applied.compare} />}
          {tab === 'best' && <BestTable nodes={tree} total={total} compare={applied.compare} by={applied.bestBy} />}
          {tab === 'daily' && <DailyTable nodes={tree} total={total} detailed={applied.dailyDetailed} />}
          {tab === 'monthly' && monthlyQ.data && <MonthlyTable data={monthlyQ.data} />}
          {tab === 'indicators' && indicatorsQ.data && <IndicatorsTable rows={indicatorsQ.data} />}
          {tab === 'open' && openQ.data && <OpenDocsTable rows={openQ.data} />}
        </>
      )}
      <p className="text-[12px] text-muted-foreground print:hidden">{t('stats.rulesHint')}</p>
    </div>
  );
}

// ---------------------------------------------------------------- panneau de sélection

function SelectionPanel({ tab, sel, set, setF, onPreset, companyId, cessionTypes }: {
  tab: StatsTab; sel: Selection; set: (p: Partial<Selection>) => void; setF: (p: Partial<StatsFilters>) => void;
  onPreset: (p: string) => void; companyId: string; cessionTypes: { code: string; label: string }[];
}) {
  const source = SOURCE_OF[tab] ?? 'sales';
  const fam = (sel.filters.family ?? '').split('-');
  const [rayon, sousRayon, categorie] = [fam[0] ?? '', fam[1] ?? '', fam[2] ?? ''];
  const setFamily = (r: string, s: string, c: string) => setF({ family: [r, s, c].filter(Boolean).join('-') || undefined });
  const dims = DIMS_BY_SOURCE[source];
  const usesPeriod = tab !== 'open' && tab !== 'monthly';
  const usesArticleFilters = tab !== 'open' && tab !== 'indicators';

  return (
    <div className="space-y-3 rounded-md border border-border bg-card p-3 print:hidden">
      {usesPeriod && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label={t('stats.preset')}>
            <Select value={sel.preset} onValueChange={onPreset}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="custom">{t('stats.presetCustom')}</SelectItem>
                {PERIOD_PRESETS.map((p) => <SelectItem key={p} value={p}>{t(`stats.preset_${p}`)}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t('stats.from')}><Input type="date" value={sel.from} onChange={(e) => set({ from: e.target.value, preset: 'custom' })} /></Field>
          <Field label={t('stats.to')}><Input type="date" value={sel.to} onChange={(e) => set({ to: e.target.value, preset: 'custom' })} /></Field>
          {tab !== 'indicators' && tab !== 'daily' && (
            <CheckField checked={sel.compare} onChange={(v) => set({ compare: v })} label={t('stats.compare')} />
          )}
          {tab === 'daily' && (
            <Field label={t('stats.dailyMode')}>
              <Select value={sel.dailyDetailed ? 'detailed' : 'cumul'} onValueChange={(v) => set({ dailyDetailed: v === 'detailed' })}>
                <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cumul">{t('stats.dailyCumul')}</SelectItem>
                  <SelectItem value="detailed">{t('stats.dailyDetailed')}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          )}
          {tab === 'best' && (
            <Field label={t('stats.bestBy')}>
              <Select value={sel.bestBy} onValueChange={(v) => set({ bestBy: v as 'ca' | 'qty' })}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ca">{t('stats.byCa')}</SelectItem>
                  <SelectItem value="qty">{t('stats.byQty')}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          )}
        </div>
      )}
      {tab === 'monthly' && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label={t('stats.year')}>
            <Select value={String(sel.year)} onValueChange={(v) => set({ year: Number(v) })}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Array.from({ length: 12 }, (_, i) => new Date().getFullYear() - i).map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <p className="pb-2 text-[12px] text-muted-foreground">{t('stats.monthlyHint')}</p>
        </div>
      )}

      {WITH_LEVELS.includes(tab) && (
        <div className="flex flex-wrap items-end gap-2">
          {Array.from({ length: MAX_LEVELS }, (_, i) => (
            <Field key={i} label={fillVars(t('stats.level'), { n: i + 1 })}>
              <Select value={sel.levels[i] || 'none'} onValueChange={(v) => {
                const next = [...sel.levels]; next[i] = v === 'none' ? '' : (v as StatsDim); set({ levels: next });
              }}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('stats.levelNone')}</SelectItem>
                  {dims.filter((d) => d !== 'article').map((d) => <SelectItem key={d} value={d}>{t(`stats.dim_${d}`)}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          ))}
          <CheckField checked={sel.withArticle} onChange={(v) => set({ withArticle: v })} label={t('stats.withArticle')} />
        </div>
      )}

      {usesArticleFilters && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label={t('stats.fRayon')}>
            <Select value={rayon || 'all'} onValueChange={(v) => setFamily(v === 'all' ? '' : v, '', '')}>
              <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('stats.fAll')}</SelectItem>
                {RAYONS_SORTED.map((r) => <SelectItem key={r.code} value={r.code}>{r.code} {r.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          {rayon && (
            <Field label={t('stats.fSousRayon')}>
              <Select value={sousRayon || 'all'} onValueChange={(v) => setFamily(rayon, v === 'all' ? '' : v, '')}>
                <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('stats.fAll')}</SelectItem>
                  {sousRayonsFor(rayon).map((s) => <SelectItem key={s.code} value={s.code}>{s.code} {s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          )}
          {rayon && sousRayon && (
            <Field label={t('stats.fCategorie')}>
              <Select value={categorie || 'all'} onValueChange={(v) => setFamily(rayon, sousRayon, v === 'all' ? '' : v)}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('stats.fAll')}</SelectItem>
                  {categoriesFor(rayon, sousRayon).map((c) => <SelectItem key={c.code} value={c.code}>{c.code} {c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field label={t('stats.fSupplier')}>
            <Picker kind="supplier" value={sel.filters.supplier_id ?? ''} label={sel.supplierLabel}
              search={(q) => searchStatsSuppliers(companyId, q)}
              onChange={(p) => { setF({ supplier_id: p?.id }); set({ supplierLabel: p?.label ?? '' }); }} />
          </Field>
          <Field label={t('stats.fBrand')}><Input className="w-36" value={sel.filters.brand ?? ''} onChange={(e) => setF({ brand: e.target.value })} /></Field>
          <Field label={t('stats.fReference')}><Input className="w-36" value={sel.filters.reference ?? ''} onChange={(e) => setF({ reference: e.target.value })} /></Field>
          <Field label={t('stats.fDesignation')}><Input className="w-44" value={sel.filters.designation ?? ''} onChange={(e) => setF({ designation: e.target.value })} /></Field>
          <Field label={t('stats.fBin')}><Input className="w-24" value={sel.filters.bin ?? ''} onChange={(e) => setF({ bin: e.target.value })} /></Field>
          {(source === 'sales' || tab === 'monthly') && (
            <Field label={t('stats.fClient')}>
              <Picker kind="client" value={sel.filters.contact_id ?? ''} label={sel.clientLabel}
                search={(q) => searchStatsContacts(companyId, q)}
                onChange={(p) => { setF({ contact_id: p?.id }); set({ clientLabel: p?.label ?? '' }); }} />
            </Field>
          )}
          {source !== 'purchases' && tab !== 'monthly' && (
            <Field label={t('stats.fOperator')}><Input className="w-32" value={sel.filters.operator ?? ''} onChange={(e) => setF({ operator: e.target.value })} /></Field>
          )}
          {source === 'cessions' && (
            <Field label={t('stats.fCession')}>
              <Select value={sel.filters.cession_type || 'all'} onValueChange={(v) => setF({ cession_type: v === 'all' ? undefined : v })}>
                <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('stats.fAll')}</SelectItem>
                  <SelectItem value="ORO">ORO</SelectItem>
                  {cessionTypes.map((c) => <SelectItem key={c.code} value={c.code}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field label={t('stats.fVehicles')}>
            <Select value={sel.filters.vehicles ?? 'all'} onValueChange={(v) => setF({ vehicles: v as StatsFilters['vehicles'] })}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('stats.vehAll')}</SelectItem>
                <SelectItem value="only">{t('stats.vehOnly')}</SelectItem>
                <SelectItem value="exclude">{t('stats.vehExclude')}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <CheckField checked={!!sel.filters.exclude_reprises} onChange={(v) => setF({ exclude_reprises: v })} label={t('stats.fExcludeReprises')} />
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function CheckField({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex h-9 cursor-pointer items-center gap-2 text-[13px]">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} /> {label}
    </label>
  );
}

/** Choix d'une fiche (fournisseur, client) : saisie puis liste de propositions. */
function Picker({ kind, value, label, search, onChange }: {
  kind: 'supplier' | 'client'; value: string; label: string; search: (q: string) => Promise<ContactPick[]>; onChange: (p: ContactPick | null) => void;
}) {
  const [q, setQ] = useState('');
  const hits = useQuery({ queryKey: ['stats-pick', kind, q], queryFn: () => search(q), enabled: q.trim().length >= 2 });
  if (value) {
    return (
      <div className="flex h-9 w-56 items-center gap-2 rounded-md border border-input bg-background px-3 text-[13px]">
        <span className="truncate">{label || value}</span>
        <button type="button" className="ml-auto text-muted-foreground" aria-label={t('stats.clear')} onClick={() => onChange(null)}><X className="size-3.5" /></button>
      </div>
    );
  }
  return (
    <div className="relative w-56">
      <Input value={q} placeholder={t('stats.search')} onChange={(e) => setQ(e.target.value)} />
      {(hits.data?.length ?? 0) > 0 && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-popover shadow-md">
          {hits.data!.map((h) => (
            <button key={h.id} type="button" className="block w-full px-3 py-1.5 text-left text-[13px] hover:bg-muted"
              onClick={() => { onChange(h); setQ(''); }}>{h.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function Notice({ children, tone, icon }: { children: ReactNode; tone?: 'warning' | 'danger'; icon?: ReactNode }) {
  const cls = tone === 'danger' ? 'border-danger bg-danger-bg text-danger'
    : tone === 'warning' ? 'border-warning bg-warning-bg text-warning'
    : 'border-dashed border-border bg-card text-muted-foreground';
  return <div className={`flex items-center gap-2 rounded-md border px-3 py-3 text-[13px] ${cls}`}>{icon}<span>{children}</span></div>;
}

// ---------------------------------------------------------------- colonnes

type Col = { key: string; header: string; align?: 'right'; cell: (n: StatsNode, d: ReturnType<typeof derived>) => string; raw: ExportColumn['value'] };

function columnsFor(tab: StatsTab, compare: boolean, lastIsArticle: boolean): Col[] {
  const c = (key: string, header: string, cell: Col['cell'], raw: ExportColumn['value']): Col => ({ key, header, align: 'right', cell, raw });
  const cols: Col[] = [];
  const stockCols = lastIsArticle ? [
    c('stock', t('stats.colStock'), (n) => qty(n.m.stock), (n) => n.m.stock),
    c('avail', t('stats.colAvailable'), (n) => qty(n.m.available), (n) => n.m.available),
    c('onorder', t('stats.colOnOrder'), (n) => qty(n.m.onOrder), (n) => n.m.onOrder),
  ] : [];
  if (tab === 'sales') {
    cols.push(
      c('qty', t('stats.colQty'), (n) => qty(n.m.qty), (n) => n.m.qty),
      c('ca', t('stats.colCa'), (n) => eur(n.m.ca), (n) => n.m.ca),
      c('wca', t('stats.colWeightCa'), (_, d) => pct(d.weightCa), (_, d) => d.weightCa),
      c('margin', t('stats.colMargin'), (_, d) => eur(d.margin), (_, d) => d.margin),
      c('mpct', t('stats.colMarginPct'), (_, d) => pct(d.marginPct), (_, d) => d.marginPct),
      c('wm', t('stats.colWeightMargin'), (_, d) => pct(d.weightMargin), (_, d) => d.weightMargin),
      c('docs', t('stats.colDocs'), (n) => (n.m.docs === null ? '' : String(n.m.docs)), (n) => n.m.docs),
      ...stockCols,
    );
    if (compare) cols.push(
      c('qtyn1', t('stats.colQtyN1'), (n) => qty(n.m.qtyN1), (n) => n.m.qtyN1),
      c('can1', t('stats.colCaN1'), (n) => eur(n.m.caN1), (n) => n.m.caN1),
      c('evol', t('stats.colEvol'), (_, d) => pct(d.evolutionCa), (_, d) => d.evolutionCa),
      c('mn1', t('stats.colMarginN1'), (_, d) => eur(d.marginN1), (_, d) => d.marginN1),
    );
  } else if (tab === 'discounts') {
    cols.push(
      c('qty', t('stats.colQty'), (n) => qty(n.m.qty), (n) => n.m.qty),
      c('gross', t('stats.colGross'), (n) => eur(n.m.gross), (n) => n.m.gross),
      c('disc', t('stats.colDiscount'), (_, d) => eur(d.discount), (_, d) => d.discount),
      c('discpct', t('stats.colDiscountPct'), (_, d) => pct(d.discountPct), (_, d) => d.discountPct),
      c('ca', t('stats.colCa'), (n) => eur(n.m.ca), (n) => n.m.ca),
      c('margin', t('stats.colMargin'), (_, d) => eur(d.margin), (_, d) => d.margin),
    );
    if (compare) cols.push(c('can1', t('stats.colCaN1'), (n) => eur(n.m.caN1), (n) => n.m.caN1));
  } else if (tab === 'purchases') {
    cols.push(
      c('qty', t('stats.colQty'), (n) => qty(n.m.qty), (n) => n.m.qty),
      c('amount', t('stats.colAmount'), (n) => eur(n.m.ca), (n) => n.m.ca),
      c('wca', t('stats.colWeight'), (_, d) => pct(d.weightCa), (_, d) => d.weightCa),
      c('docs', t('stats.colReceptions'), (n) => (n.m.docs === null ? '' : String(n.m.docs)), (n) => n.m.docs),
      ...stockCols,
    );
    if (compare) cols.push(
      c('qtyn1', t('stats.colQtyN1'), (n) => qty(n.m.qtyN1), (n) => n.m.qtyN1),
      c('can1', t('stats.colAmountN1'), (n) => eur(n.m.caN1), (n) => n.m.caN1),
      c('evol', t('stats.colEvol'), (_, d) => pct(d.evolutionCa), (_, d) => d.evolutionCa),
    );
  } else if (tab === 'cessions') {
    cols.push(
      c('qty', t('stats.colQty'), (n) => qty(n.m.qty), (n) => n.m.qty),
      c('value', t('stats.colValue'), (n) => eur(n.m.cost), (n) => n.m.cost),
      ...stockCols,
    );
    if (compare) cols.push(
      c('qtyn1', t('stats.colQtyN1'), (n) => qty(n.m.qtyN1), (n) => n.m.qtyN1),
      c('valn1', t('stats.colValueN1'), (n) => eur(n.m.costN1), (n) => n.m.costN1),
    );
  }
  return cols;
}

// ---------------------------------------------------------------- tableau multi-niveaux

const MAX_ROWS = 3000;

function TreeTable({ tab, nodes, levels, total, compare }: { tab: StatsTab; nodes: StatsNode[]; levels: StatsDim[]; total: Metrics; compare: boolean }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const cols = columnsFor(tab, compare, levels[levels.length - 1] === 'article');
  const lab = labeler();
  const visible = flattenTree(nodes, (id) => !collapsed.has(id));
  const toggle = (id: string) => setCollapsed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const parents = flattenTree(nodes, () => true).filter((n) => n.children.length > 0).map((n) => n.id);

  if (nodes.length === 0) return <Notice>{t('stats.empty')}</Notice>;
  return (
    <div className="space-y-2">
      {levels.length > 1 && (
        <div className="flex gap-2 print:hidden">
          <Button size="sm" variant="ghost" onClick={() => setCollapsed(new Set())}>{t('stats.expandAll')}</Button>
          <Button size="sm" variant="ghost" onClick={() => setCollapsed(new Set(parents))}>{t('stats.collapseAll')}</Button>
          <span className="self-center text-[12px] text-muted-foreground">{levels.map((l) => t(`stats.dim_${l}`)).join(' > ')}</span>
        </div>
      )}
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[12px]">
          <thead className="bg-muted">
            <tr><Th>{t('stats.colLabel')}</Th>{cols.map((c) => <Th key={c.key} className="text-right">{c.header}</Th>)}</tr>
          </thead>
          <tbody>
            {visible.slice(0, MAX_ROWS).map((n) => {
              const d = derived(n.m, total);
              const bold = n.children.length > 0;
              return (
                <tr key={n.id} className={`border-b border-border last:border-0 ${bold ? 'bg-muted/40' : ''}`}>
                  <td className="px-3 py-1.5" style={{ paddingLeft: `${12 + n.depth * 18}px` }}>
                    <span className="inline-flex items-center gap-1">
                      {bold ? (
                        <button type="button" className="text-muted-foreground print:hidden" onClick={() => toggle(n.id)} aria-label={t('stats.toggle')}>
                          {collapsed.has(n.id) ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                        </button>
                      ) : <span className="inline-block w-3.5" />}
                      <span className={bold ? 'font-bold' : ''}>{keyLabel(n.dim, n.key, n.label, lab)}</span>
                    </span>
                  </td>
                  {cols.map((c) => <td key={c.key} className={`px-3 py-1.5 text-right tabular-nums ${bold ? 'font-bold' : ''}`}>{c.cell(n, d)}</td>)}
                </tr>
              );
            })}
          </tbody>
          <tfoot className="bg-muted font-bold">
            <tr>
              <td className="px-3 py-2">{t('stats.total')}</td>
              {cols.map((c) => {
                const totalNode: StatsNode = { id: '__t', depth: 0, dim: levels[0], key: '__t', label: null, m: total, children: [] };
                return <td key={c.key} className="px-3 py-2 text-right tabular-nums">{c.cell(totalNode, derived(total, total))}</td>;
              })}
            </tr>
          </tfoot>
        </table>
      </div>
      {visible.length > MAX_ROWS && <p className="text-[12px] text-muted-foreground">{fillVars(t('stats.truncated'), { n: MAX_ROWS })}</p>}
    </div>
  );
}

/** Histogramme du premier niveau (G8 : histogramme / histogramme comparé). Une couleur par exercice. */
function Histogram({ nodes, compare }: { nodes: StatsNode[]; compare: boolean }) {
  const lab = labeler();
  const top = nodes.slice(0, 15);
  const max = Math.max(1, ...top.map((n) => Math.max(Math.abs(n.m.ca), compare ? Math.abs(n.m.caN1) : 0)));
  return (
    <section className="rounded-md border border-border bg-card p-4">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">
        {t('stats.histogram')}{compare && <span className="ml-3 normal-case"><Swatch n /> {t('stats.histN')} <Swatch /> {t('stats.histN1')}</span>}
      </p>
      <div className="space-y-1.5">
        {top.map((n) => (
          <div key={n.id} className="flex items-center gap-3 text-[12px]">
            <span className="w-56 truncate">{keyLabel(n.dim, n.key, n.label, lab)}</span>
            <div className="flex-1 space-y-0.5">
              <div className="h-3 rounded-sm bg-[var(--ducati-black)]" style={{ width: `${(Math.max(0, n.m.ca) / max) * 100}%` }} />
              {compare && <div className="h-2 rounded-sm bg-[var(--gray-400)]" style={{ width: `${(Math.max(0, n.m.caN1) / max) * 100}%` }} />}
            </div>
            <span className="w-28 text-right font-data tabular-nums">{eur(n.m.ca)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Swatch({ n }: { n?: boolean }) {
  return <span className={`mx-1 inline-block size-2.5 rounded-sm align-middle ${n ? 'bg-[var(--ducati-black)]' : 'bg-[var(--gray-400)]'}`} />;
}

// ---------------------------------------------------------------- meilleures ventes, stats quotidiennes

const TOP_N = 100;

function BestTable({ nodes, total, compare, by }: { nodes: StatsNode[]; total: Metrics; compare: boolean; by: 'ca' | 'qty' }) {
  const lab = labeler();
  const list = nodes.filter((n) => !n.key.startsWith('#')).sort((a, b) => (by === 'qty' ? b.m.qty - a.m.qty : b.m.ca - a.m.ca)).slice(0, TOP_N);
  if (list.length === 0) return <Notice>{t('stats.empty')}</Notice>;
  return (
    <div className="space-y-1">
      <p className="text-[12px] text-muted-foreground">{fillVars(t('stats.top'), { n: TOP_N })}</p>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[12px]">
          <thead className="bg-muted"><tr>
            <Th>#</Th><Th>{t('stats.colArticle')}</Th><Th className="text-right">{t('stats.colQty')}</Th><Th className="text-right">{t('stats.colCa')}</Th>
            <Th className="text-right">{t('stats.colWeightCa')}</Th><Th className="text-right">{t('stats.colMargin')}</Th><Th className="text-right">{t('stats.colMarginPct')}</Th>
            <Th className="text-right">{t('stats.colStock')}</Th>
            {compare && <><Th className="text-right">{t('stats.colQtyN1')}</Th><Th className="text-right">{t('stats.colCaN1')}</Th></>}
          </tr></thead>
          <tbody>
            {list.map((n, i) => {
              const d = derived(n.m, total);
              return (
                <tr key={n.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-1.5 tabular-nums text-muted-foreground">{i + 1}</td>
                  <td className="px-3 py-1.5">{keyLabel(n.dim, n.key, n.label, lab)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{qty(n.m.qty)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{eur(n.m.ca)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{pct(d.weightCa)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{eur(d.margin)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{pct(d.marginPct)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{qty(n.m.stock)}</td>
                  {compare && <><td className="px-3 py-1.5 text-right tabular-nums">{qty(n.m.qtyN1)}</td><td className="px-3 py-1.5 text-right tabular-nums">{eur(n.m.caN1)}</td></>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Lignes « article » d'un arbre jour > fournisseur > article ou fournisseur > article, à plat. */
function dailyLines(nodes: StatsNode[], detailed: boolean) {
  const out: { day: string; supplier: StatsNode; article: StatsNode }[] = [];
  const walkSuppliers = (sups: StatsNode[], day: string) => {
    for (const s of sups) for (const a of s.children) out.push({ day, supplier: s, article: a });
  };
  if (detailed) for (const d of nodes) walkSuppliers(d.children, d.key); else walkSuppliers(nodes, '');
  return out;
}

function DailyTable({ nodes, total, detailed }: { nodes: StatsNode[]; total: Metrics; detailed: boolean }) {
  const lab = labeler();
  const lines = dailyLines(nodes, detailed);
  if (lines.length === 0) return <Notice>{t('stats.empty')}</Notice>;
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full border-collapse font-data text-[12px]">
        <thead className="bg-muted"><tr>
          {detailed && <Th>{t('stats.colDay')}</Th>}
          <Th>{t('stats.colArticle')}</Th><Th>{t('stats.colSupplier')}</Th>
          <Th className="text-right">{t('stats.colQty')}</Th><Th className="text-right">{t('stats.colAmount')}</Th>
          <Th className="text-right">{t('stats.colCost')}</Th><Th className="text-right">{t('stats.colMargin')}</Th>
          <Th className="text-right">{t('stats.colMarginPct')}</Th><Th className="text-right">{t('stats.colStock')}</Th>
          <Th className="text-right">{t('stats.colAvailable')}</Th><Th className="text-right">{t('stats.colOnOrder')}</Th>
        </tr></thead>
        <tbody>
          {lines.slice(0, MAX_ROWS).map(({ day, supplier, article }) => {
            const d = derived(article.m, total);
            return (
              <tr key={article.id} className="border-b border-border last:border-0">
                {detailed && <td className="px-3 py-1.5 font-mono text-[12px]">{day}</td>}
                <td className="px-3 py-1.5">{keyLabel('article', article.key, article.label, lab)}</td>
                <td className="px-3 py-1.5">{keyLabel('supplier', supplier.key, supplier.label, lab)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{qty(article.m.qty)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{eur(article.m.ca)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{eur(article.m.cost)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{eur(d.margin)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{pct(d.marginPct)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{qty(article.m.stock)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{qty(article.m.available)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{qty(article.m.onOrder)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot className="bg-muted font-bold"><tr>
          <td className="px-3 py-2" colSpan={detailed ? 3 : 2}>{t('stats.total')}</td>
          <td className="px-3 py-2 text-right tabular-nums">{qty(total.qty)}</td>
          <td className="px-3 py-2 text-right tabular-nums">{eur(total.ca)}</td>
          <td className="px-3 py-2 text-right tabular-nums">{eur(total.cost)}</td>
          <td className="px-3 py-2 text-right tabular-nums">{eur(total.ca - total.cost)}</td>
          <td className="px-3 py-2 text-right tabular-nums">{pct(derived(total, total).marginPct)}</td>
          <td colSpan={3} />
        </tr></tfoot>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------- mois par mois, indicateurs, documents en cours

type MonthlyData = Awaited<ReturnType<typeof getMonthlyStats>>;
type IndicatorRows = Awaited<ReturnType<typeof getStatsIndicators>>;
type OpenRows = Awaited<ReturnType<typeof getOpenDocuments>>;

function evol(a: number, b: number): number | null { return b === 0 ? null : Math.round((1000 * (a - b)) / Math.abs(b)) / 10; }

function MonthlyTable({ data }: { data: MonthlyData }) {
  const tot = sumMonths(data.months);
  const max = Math.max(1, ...data.months.map((m) => Math.max(m.ca_ht, m.ca_ht_n1)));
  const row = (key: string, label: string, m: Omit<MonthlyData['months'][number], 'month'>, bold = false) => (
    <tr key={key} className={`border-b border-border last:border-0 ${bold ? 'bg-muted font-bold' : ''}`}>
      <td className="px-3 py-1.5">{label}</td>
      <td className="px-3 py-1.5 text-right tabular-nums">{qty(m.qty_in)}</td>
      <td className="px-3 py-1.5 text-right tabular-nums">{qty(m.qty_out)}</td>
      <td className="px-3 py-1.5 text-right tabular-nums">{qty(m.qty_out_n1)}</td>
      <td className="px-3 py-1.5 text-right tabular-nums">{qty(m.qty_sold)}</td>
      <td className="px-3 py-1.5 text-right tabular-nums">{qty(m.qty_sold_n1)}</td>
      <td className="px-3 py-1.5 text-right tabular-nums">{eur(m.ca_ht)}</td>
      <td className="px-3 py-1.5 text-right tabular-nums">{eur(m.ca_ht_n1)}</td>
      <td className="px-3 py-1.5 text-right tabular-nums">{pct(evol(m.ca_ht, m.ca_ht_n1))}</td>
      <td className="px-3 py-1.5 text-right tabular-nums">{eur(m.ca_ht - m.cost)}</td>
      <td className="px-3 py-1.5 text-right tabular-nums">{eur(m.purchases_ht)}</td>
      <td className="px-3 py-1.5 text-right tabular-nums">{eur(m.purchases_ht_n1)}</td>
    </tr>
  );
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[12px]">
          <thead className="bg-muted"><tr>
            <Th>{t('stats.month')}</Th><Th className="text-right">{t('stats.qtyIn')}</Th><Th className="text-right">{t('stats.qtyOut')}</Th>
            <Th className="text-right">{t('stats.qtyOutN1')}</Th><Th className="text-right">{t('stats.qtySold')}</Th><Th className="text-right">{t('stats.qtySoldN1')}</Th>
            <Th className="text-right">{t('stats.colCa')}</Th><Th className="text-right">{t('stats.colCaN1')}</Th><Th className="text-right">{t('stats.colEvol')}</Th>
            <Th className="text-right">{t('stats.colMargin')}</Th><Th className="text-right">{t('stats.purchases')}</Th><Th className="text-right">{t('stats.purchasesN1')}</Th>
          </tr></thead>
          <tbody>
            {data.months.map((m) => row(String(m.month), monthName(m.month), m))}
            {row('total', t('stats.total'), tot, true)}
          </tbody>
        </table>
      </div>
      <p className="text-[13px]">{fillVars(t('stats.stockNow'), { qty: qty(data.stock_qty), value: eur(data.stock_value) })}</p>
      <section className="rounded-md border border-border bg-card p-4">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">
          {t('stats.histogram')} <span className="ml-3 normal-case"><Swatch n /> {data.year} <Swatch /> {data.year - 1}</span>
        </p>
        <div className="flex h-40 items-end gap-2">
          {data.months.map((m) => (
            <div key={m.month} className="flex flex-1 flex-col items-center gap-1">
              <div className="flex h-32 w-full items-end justify-center gap-0.5">
                <div className="w-1/2 rounded-sm bg-[var(--ducati-black)]" style={{ height: `${(Math.max(0, m.ca_ht) / max) * 100}%` }} title={eur(m.ca_ht)} />
                <div className="w-1/3 rounded-sm bg-[var(--gray-400)]" style={{ height: `${(Math.max(0, m.ca_ht_n1) / max) * 100}%` }} title={eur(m.ca_ht_n1)} />
              </div>
              <span className="text-[11px] text-muted-foreground">{monthName(m.month).slice(0, 3)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

const docLabel = (code: string) => t(`stats.doc_${code}`);

function IndicatorsTable({ rows }: { rows: IndicatorRows }) {
  if (rows.length === 0) return <Notice>{t('stats.empty')}</Notice>;
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[12px]">
          <thead className="bg-muted"><tr>
            <Th>{t('stats.docType')}</Th><Th className="text-right">{t('stats.created')}</Th><Th className="text-right">{t('stats.createdHt')}</Th>
            <Th className="text-right">{t('stats.avgBasket')}</Th><Th className="text-right">{t('stats.itemsPerDoc')}</Th>
            <Th className="text-right">{t('stats.open')}</Th><Th className="text-right">{t('stats.openHt')}</Th>
            <Th className="text-right">{t('stats.transformed')}</Th><Th className="text-right">{t('stats.rate')}</Th><Th>{t('stats.targets')}</Th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.doc_type} className="border-b border-border last:border-0">
                <td className="px-3 py-1.5">{docLabel(r.doc_type)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{r.created}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{r.doc_type === 'CES' ? eur(r.value) : eur(r.created_ht)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{r.doc_type === 'CES' ? '' : eur(r.avg_basket)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{qty(r.items_per_doc)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{r.open || ''}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{r.open ? eur(r.open_ht) : ''}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{r.transformed || ''}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{r.transformed ? pct(r.rate) : ''}</td>
                <td className="px-3 py-1.5">{Object.entries(r.targets).map(([k, v]) => `${docLabel(k)} ${v}`).join(' · ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[12px] text-muted-foreground">{t('stats.indicatorsHint')}</p>
    </div>
  );
}

function OpenDocsTable({ rows }: { rows: OpenRows }) {
  if (rows.length === 0) return <Notice>{t('stats.empty')}</Notice>;
  const max = Math.max(1, ...rows.map((r) => r.ca_ht));
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[12px]">
          <thead className="bg-muted"><tr>
            <Th>{t('stats.docType')}</Th><Th className="text-right">{t('stats.docsCount')}</Th><Th className="text-right">{t('stats.colQty')}</Th>
            <Th className="text-right">{t('stats.colCa')}</Th><Th className="text-right">{t('stats.colMargin')}</Th><Th className="w-1/3">{t('stats.histogram')}</Th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.doc_type} className="border-b border-border last:border-0">
                <td className="px-3 py-1.5">{docLabel(r.doc_type)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{r.count}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{qty(r.items)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{eur(r.ca_ht)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{r.margin === null ? '' : eur(r.margin)}</td>
                <td className="px-3 py-1.5"><div className="h-3 rounded-sm bg-[var(--ducati-black)]" style={{ width: `${(Math.max(0, r.ca_ht) / max) * 100}%` }} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[12px] text-muted-foreground">{t('stats.openHint')}</p>
    </div>
  );
}

function Th({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}

// ---------------------------------------------------------------- export Excel (contenu de l'onglet)

function buildExportSheet(
  tab: StatsTab, s: Selection, levels: StatsDim[], tree: StatsNode[], total: Metrics,
  monthly?: MonthlyData, indicators?: IndicatorRows, open?: OpenRows,
): SheetRows {
  const lab = labeler();
  const head: SheetRows = [
    [`${t('stats.title')} — ${t(`stats.tab_${tab}`)}`],
    tab === 'monthly' ? [t('stats.year'), s.year] : tab === 'open' ? [] : [t('stats.from'), s.from, t('stats.to'), s.to],
    [],
  ];
  if (tab === 'monthly' && monthly) {
    const rows: SheetRows = [[t('stats.month'), t('stats.qtyIn'), t('stats.qtyOut'), t('stats.qtyOutN1'), t('stats.qtySold'), t('stats.qtySoldN1'),
      t('stats.colCa'), t('stats.colCaN1'), t('stats.colMargin'), t('stats.purchases'), t('stats.purchasesN1')]];
    for (const m of monthly.months) rows.push([monthName(m.month), m.qty_in, m.qty_out, m.qty_out_n1, m.qty_sold, m.qty_sold_n1, m.ca_ht, m.ca_ht_n1, Math.round((m.ca_ht - m.cost) * 100) / 100, m.purchases_ht, m.purchases_ht_n1]);
    const tt = sumMonths(monthly.months);
    rows.push([t('stats.total'), tt.qty_in, tt.qty_out, tt.qty_out_n1, tt.qty_sold, tt.qty_sold_n1, tt.ca_ht, tt.ca_ht_n1, Math.round((tt.ca_ht - tt.cost) * 100) / 100, tt.purchases_ht, tt.purchases_ht_n1]);
    rows.push([], [fillVars(t('stats.stockNow'), { qty: qty(monthly.stock_qty), value: eur(monthly.stock_value) })]);
    return [...head, ...rows];
  }
  if (tab === 'indicators' && indicators) {
    return [...head, [t('stats.docType'), t('stats.created'), t('stats.createdHt'), t('stats.avgBasket'), t('stats.itemsPerDoc'), t('stats.open'), t('stats.openHt'), t('stats.transformed'), t('stats.rate'), t('stats.targets')],
      ...indicators.map((r) => [docLabel(r.doc_type), r.created, r.doc_type === 'CES' ? r.value : r.created_ht, r.avg_basket, r.items_per_doc, r.open, r.open_ht, r.transformed, r.rate,
        Object.entries(r.targets).map(([k, v]) => `${docLabel(k)} ${v}`).join(' · ')])];
  }
  if (tab === 'open' && open) {
    return [...head, [t('stats.docType'), t('stats.docsCount'), t('stats.colQty'), t('stats.colCa'), t('stats.colMargin')],
      ...open.map((r) => [docLabel(r.doc_type), r.count, r.items, r.ca_ht, r.margin])];
  }
  if (tab === 'daily') {
    const rows: SheetRows = [[...(s.dailyDetailed ? [t('stats.colDay')] : []), t('stats.colArticle'), t('stats.colSupplier'), t('stats.colQty'), t('stats.colAmount'),
      t('stats.colCost'), t('stats.colMargin'), t('stats.colMarginPct'), t('stats.colStock'), t('stats.colAvailable'), t('stats.colOnOrder')]];
    for (const { day, supplier, article } of dailyLines(tree, s.dailyDetailed)) {
      const d = derived(article.m, total);
      rows.push([...(s.dailyDetailed ? [day] : []), keyLabel('article', article.key, article.label, lab), keyLabel('supplier', supplier.key, supplier.label, lab),
        article.m.qty, article.m.ca, article.m.cost, d.margin, d.marginPct, article.m.stock, article.m.available, article.m.onOrder]);
    }
    return [...head, ...rows];
  }
  if (tab === 'best') {
    const list = tree.filter((n) => !n.key.startsWith('#')).sort((a, b) => (s.bestBy === 'qty' ? b.m.qty - a.m.qty : b.m.ca - a.m.ca)).slice(0, TOP_N);
    return [...head, ['#', t('stats.colArticle'), t('stats.colQty'), t('stats.colCa'), t('stats.colMargin'), t('stats.colMarginPct'), t('stats.colStock'),
      ...(s.compare ? [t('stats.colQtyN1'), t('stats.colCaN1')] : [])],
      ...list.map((n, i) => { const d = derived(n.m, total); return [i + 1, keyLabel(n.dim, n.key, n.label, lab), n.m.qty, n.m.ca, d.margin, d.marginPct, n.m.stock, ...(s.compare ? [n.m.qtyN1, n.m.caN1] : [])]; })];
  }
  const cols = columnsFor(tab, s.compare, levels[levels.length - 1] === 'article');
  return [...head, ...exportTreeRows(tree, levels, levels.map((l) => t(`stats.dim_${l}`)),
    cols.map((c) => ({ header: c.header, value: c.raw })), lab, total, t('stats.total'))];
}
