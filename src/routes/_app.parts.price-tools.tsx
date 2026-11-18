import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Eye, Loader2, Plus, Trash2, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/lib/auth/auth-context';
import { useReadOnly } from '@/lib/auth/read-only-context';
import { fillVars, t, pageTitle } from '@/lib/i18n';
import {
  addFamilyRounding, applyPriceChanges, deleteFamilyRounding, listFamilyRounding, selectAllArticles, updateFamilyRounding,
  type SelectedArticle, type SelectionFilters,
} from '@/modules/articles/g8/api';
import {
  bracketChange, familyPrefix, ppcChange, resolveFamilyRounding, roundWithTranches, roundingChange,
  type BracketMode, type FamilyRoundingRule, type PriceBracket, type PriceChange, type RoundingMode,
} from '@/modules/articles/g8/pricing-tools';
import { FamilySelects, SelectionFiltersForm, SupplierSelect, useSuppliers } from '@/modules/articles/g8/selection-filters';
import { Empty, FieldLabel, QueryError, Td, Th, errorText, eur, pct } from '@/modules/articles/g8/ui';
import { listPpcRules } from '@/modules/articles/import/settings-api';
import { supplierName } from '@/modules/purchases/api';

/**
 * M2 — Outils de prix (rattrapage G8 du 18/11/2026) :
 *  - « Paramétrage des arrondis » : grille fournisseur × famille × tranche, puis « Appliquer
 *    arrondis en fiche article » sur une sélection ;
 *  - « Paramétrage PV selon PPC » : les règles de l'import (fournisseur / famille / marque)
 *    appliquées aux articles existants (« Appliquer calcul ») ;
 *  - « Recalcul PA / PV » : 5 tranches de PA, taux d'augmentation (% PA, % PV) ou coefficient.
 * Toujours un aperçu avant l'écriture ; les prix passent par price_changes (règle 3 / B7) ;
 * les verrous G8 (cadenas PA / PV) sont respectés.
 */
export const Route = createFileRoute('/_app/parts/price-tools')({
  head: () => ({ meta: [{ title: pageTitle('partsPriceTools') }] }),
  component: PriceToolsPage,
});

function PriceToolsPage() {
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  if (!activeCompanyId) return null;
  return (
    <>
      <PageHeader
        title={t('g8a.tools.title')}
        description={t('g8a.tools.description')}
        actions={<Button variant="outline" onClick={() => navigate({ to: '/parts' })}><ArrowLeft /> {t('articles.title')}</Button>}
      />
      <Tabs defaultValue="rounding">
        <TabsList>
          <TabsTrigger value="rounding">{t('g8a.tools.tabRounding')}</TabsTrigger>
          <TabsTrigger value="ppc">{t('g8a.tools.tabPpc')}</TabsTrigger>
          <TabsTrigger value="brackets">{t('g8a.tools.tabBrackets')}</TabsTrigger>
        </TabsList>
        <TabsContent value="rounding" className="mt-4"><RoundingTab companyId={activeCompanyId} /></TabsContent>
        <TabsContent value="ppc" className="mt-4"><PpcTab companyId={activeCompanyId} /></TabsContent>
        <TabsContent value="brackets" className="mt-4"><BracketsTab companyId={activeCompanyId} /></TabsContent>
      </Tabs>
    </>
  );
}

/* ─────────────── Aperçu commun puis application ─────────────── */
type Proposal = { article: SelectedArticle; change: PriceChange };

function usePreview(companyId: string, compute: (rows: SelectedArticle[]) => Proposal[]) {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [scanned, setScanned] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const run = async (filters: SelectionFilters) => {
    setLoading(true); setError(null); setProposals(null);
    try {
      const rows = await selectAllArticles(companyId, filters, (n, total) => setProgress({ done: n, total }));
      setScanned(rows.length);
      setProposals(compute(rows));
    } catch (e) { setError(e); }
    finally { setLoading(false); setProgress(null); }
  };
  return { loading, progress, proposals, setProposals, scanned, error, run };
}

function PreviewAndApply({ companyId, preview, origin }: {
  companyId: string; preview: ReturnType<typeof usePreview>; origin: string;
}) {
  const qc = useQueryClient();
  const readOnly = useReadOnly();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const apply = useMutation({
    meta: { success: false, error: false },
    mutationFn: () => applyPriceChanges(companyId, (preview.proposals ?? []).map((p) => p.change), origin, (done, total) => setProgress({ done, total })),
    onSuccess: (r) => {
      setProgress(null);
      toast.success(fillVars(t('g8a.tools.applied'), { done: r.done, locked: r.locked }));
      preview.setProposals(null);
      qc.invalidateQueries({ queryKey: ['articles'] });
    },
    onError: (e) => { setProgress(null); toast.error(errorText(e)); },
  });
  const list = preview.proposals;
  return (
    <div className="space-y-3">
      <QueryError error={preview.error} />
      {preview.progress && <p className="text-[12px] tabular-nums text-muted-foreground">{fillVars(t('g8a.common.reading'), { done: preview.progress.done, total: preview.progress.total })}</p>}
      {list && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm">{fillVars(t('g8a.tools.previewCount'), { n: list.length, scanned: preview.scanned })}</span>
            <Button onClick={() => apply.mutate()} disabled={readOnly || apply.isPending || list.length === 0}>
              {apply.isPending ? <Loader2 className="animate-spin" /> : <Wand2 />} {fillVars(t('g8a.tools.apply'), { n: list.length })}
            </Button>
            {progress && <span className="text-[12px] tabular-nums text-muted-foreground">{fillVars(t('g8a.common.progress'), { done: progress.done, total: progress.total })}</span>}
          </div>
          {list.length === 0 ? <Empty>{t('g8a.tools.nothing')}</Empty> : (
            <div className="max-h-[28rem] overflow-auto rounded-md border border-border">
              <table className="w-full border-collapse font-data text-[13px]">
                <thead className="sticky top-0 bg-muted">
                  <tr>
                    <Th>{t('cascade.colRef')}</Th><Th>{t('cascade.colDesignation')}</Th>
                    <Th className="text-right">{t('g8a.tools.oldPa')}</Th><Th className="text-right">{t('g8a.tools.newPa')}</Th>
                    <Th className="text-right">{t('g8a.tools.oldPv')}</Th><Th className="text-right">{t('g8a.tools.newPv')}</Th>
                    <Th className="text-right">{t('g8a.tools.variation')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {list.slice(0, 1000).map(({ article: a, change: c }) => {
                    const newPv = c.sale_ttc ?? a.sale_price_ttc;
                    const v = a.sale_price_ttc > 0 ? ((newPv / a.sale_price_ttc) - 1) * 100 : null;
                    return (
                      <tr key={a.id} className="border-b border-border last:border-0">
                        <Td className="font-mono text-[12px]">{a.reference}</Td>
                        <Td>{a.designation}</Td>
                        <Td className="text-right tabular-nums text-muted-foreground">{eur(a.purchase_price)}</Td>
                        <Td className="text-right tabular-nums">{c.purchase != null ? eur(c.purchase) : '='}</Td>
                        <Td className="text-right tabular-nums text-muted-foreground">{eur(a.sale_price_ttc)}</Td>
                        <Td className="text-right font-bold tabular-nums">{c.sale_ttc != null ? eur(c.sale_ttc) : '='}</Td>
                        <Td className={`text-right tabular-nums ${v != null && v < 0 ? 'text-danger' : ''}`}>{v != null && c.sale_ttc != null ? pct(Math.round(v * 100) / 100) : ''}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {list.length > 1000 && <p className="px-3 py-2 text-[12px] text-muted-foreground">{fillVars(t('g8a.tools.previewTruncated'), { n: list.length })}</p>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ─────────────── Arrondis par famille × tranche ─────────────── */
function RoundingTab({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const readOnly = useReadOnly();
  const suppliers = useSuppliers(companyId);
  const rulesQ = useQuery({ queryKey: ['g8-family-rounding', companyId], queryFn: () => listFamilyRounding(companyId) });
  const inv = () => qc.invalidateQueries({ queryKey: ['g8-family-rounding', companyId] });
  const [supplier, setSupplier] = useState('');
  const [fam, setFam] = useState({ rayon: '', sousRayon: '', categorie: '' });
  const [upTo, setUpTo] = useState('');
  const [step, setStep] = useState('0.10');
  const [mode, setMode] = useState<RoundingMode>('up');
  const [testValue, setTestValue] = useState('');
  const [filters, setFilters] = useState<SelectionFilters>({});
  const num = (s: string) => Number(s.replace(',', '.'));

  const add = useMutation({
    meta: { success: false },
    mutationFn: () => addFamilyRounding(companyId, {
      supplier_id: supplier || null, category_prefix: familyPrefix(fam.rayon, fam.sousRayon, fam.categorie),
      up_to: upTo.trim() ? num(upTo) : 0, step: num(step), mode,
    }),
    onSuccess: () => { inv(); setUpTo(''); toast.success(t('g8a.tools.ruleAdded')); },
    onError: (e) => toast.error(errorText(e)),
  });
  const del = useMutation({ meta: { success: false }, mutationFn: (id: string) => deleteFamilyRounding(id), onSuccess: inv, onError: (e) => toast.error(errorText(e)) });
  const toggle = useMutation({ meta: { success: false }, mutationFn: (r: { id: string; on: boolean }) => updateFamilyRounding(r.id, { is_active: r.on }), onSuccess: inv, onError: (e) => toast.error(errorText(e)) });

  const rules = rulesQ.data ?? [];
  const supplierLabel = (id: string | null) => (id ? supplierName((suppliers.data ?? []).find((s) => s.id === id) ?? { company_name: '?', first_name: null, last_name: null }) : t('g8a.tools.allSuppliers'));
  const preview = usePreview(companyId, (rows) => rows
    .map((a) => ({ article: a, change: a.price_sale_locked ? null : roundingChange(a, rules) }))
    .filter((x): x is Proposal => !!x.change));
  const tranchesForTest = resolveFamilyRounding(rules, { supplierId: supplier || null, categoryPath: familyPrefix(fam.rayon, fam.sousRayon, fam.categorie) });
  const stepOk = num(step) > 0;

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">{t('g8a.tools.roundingHint')}</p>
      <div className="space-y-3 rounded-md border border-border bg-card p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1"><FieldLabel>{t('g8a.filters.supplier')}</FieldLabel><SupplierSelect companyId={companyId} value={supplier} onChange={setSupplier} /></div>
          <FamilySelects rayon={fam.rayon} sousRayon={fam.sousRayon} categorie={fam.categorie} onChange={setFam} />
          <div className="space-y-1"><FieldLabel>{t('g8a.tools.upTo')}</FieldLabel><Input value={upTo} onChange={(e) => setUpTo(e.target.value)} className="w-28 text-right tabular-nums" placeholder={t('g8a.tools.noLimit')} /></div>
          <div className="space-y-1">
            <FieldLabel>{t('g8a.tools.step')}</FieldLabel>
            <Select value={step} onValueChange={setStep}>
              <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
              <SelectContent>{['0.05', '0.10', '0.50', '1', '5', '10'].map((s) => <SelectItem key={s} value={s}>{eur(Number(s))}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <FieldLabel>{t('g8a.tools.mode')}</FieldLabel>
            <Select value={mode} onValueChange={(v) => setMode(v as RoundingMode)}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="up">{t('g8a.tools.modeUp')}</SelectItem>
                <SelectItem value="nearest">{t('g8a.tools.modeNearest')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={() => add.mutate()} disabled={readOnly || add.isPending || !stepOk}><Plus /> {t('g8a.tools.addRule')}</Button>
        </div>
        <div className="flex flex-wrap items-end gap-2 text-sm">
          <div className="space-y-1"><FieldLabel>{t('g8a.tools.test')}</FieldLabel><Input value={testValue} onChange={(e) => setTestValue(e.target.value)} className="w-28 text-right tabular-nums" placeholder="12,34" /></div>
          {testValue.trim() && (
            <span className="pb-2 tabular-nums">
              {tranchesForTest.length ? fillVars(t('g8a.tools.testResult'), { from: eur(num(testValue)), to: eur(roundWithTranches(num(testValue), tranchesForTest)) }) : t('g8a.tools.testNoRule')}
            </span>
          )}
        </div>
      </div>
      <QueryError error={rulesQ.error} />
      {rules.length === 0 ? (!rulesQ.error && <Empty>{t('g8a.tools.noRule')}</Empty>) : (
        <div className="overflow-auto rounded-md border border-border">
          <table className="w-full border-collapse font-data text-[13px]">
            <thead className="bg-muted">
              <tr><Th>{t('g8a.filters.supplier')}</Th><Th>{t('g8a.tools.family')}</Th><Th className="text-right">{t('g8a.tools.upTo')}</Th><Th className="text-right">{t('g8a.tools.step')}</Th><Th>{t('g8a.tools.mode')}</Th><Th>{t('g8a.tools.active')}</Th><Th /></tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <Td>{supplierLabel(r.supplier_id)}</Td>
                  <Td className="font-mono text-[12px]">{r.category_prefix ?? t('g8a.tools.allFamilies')}</Td>
                  <Td className="text-right tabular-nums">{r.up_to > 0 ? eur(r.up_to) : t('g8a.tools.noLimit')}</Td>
                  <Td className="text-right tabular-nums">{eur(r.step)}</Td>
                  <Td>{t(r.mode === 'nearest' ? 'g8a.tools.modeNearest' : 'g8a.tools.modeUp')}</Td>
                  <Td><Checkbox checked={r.is_active !== false} disabled={readOnly} onCheckedChange={(v) => toggle.mutate({ id: r.id, on: v === true })} /></Td>
                  <Td className="text-right"><Button size="sm" variant="ghost" disabled={readOnly} onClick={() => del.mutate(r.id)}><Trash2 className="size-4 text-danger" /></Button></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="space-y-3 rounded-md border border-border bg-card p-3">
        <h3 className="font-ui text-[15px] font-bold">{t('g8a.tools.applyRoundingTitle')}</h3>
        <SelectionFiltersForm companyId={companyId} value={filters} onChange={setFilters} compact />
        <div className="flex justify-end">
          <Button variant="outline" onClick={() => void preview.run(filters)} disabled={preview.loading || rules.length === 0}>
            {preview.loading ? <Loader2 className="animate-spin" /> : <Eye />} {t('g8a.tools.preview')}
          </Button>
        </div>
        <PreviewAndApply companyId={companyId} preview={preview} origin="rounding" />
      </div>
    </div>
  );
}

/* ─────────────── PV selon le PPC (articles existants) ─────────────── */
function PpcTab({ companyId }: { companyId: string }) {
  const navigate = useNavigate();
  const rulesQ = useQuery({ queryKey: ['ppc-rules', companyId], queryFn: () => listPpcRules(companyId) });
  const [filters, setFilters] = useState<SelectionFilters>({ pv_ppc: '' });
  const rules = (rulesQ.data ?? []).filter((r) => r.is_active !== false);
  const preview = usePreview(companyId, (rows) => rows
    .map((a) => ({ article: a, change: ppcChange(a, rules) }))
    .filter((x): x is Proposal => !!x.change));
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('g8a.tools.ppcHint')}</p>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm">{fillVars(t('g8a.tools.ppcRulesCount'), { n: rules.length })}</span>
        <Button variant="outline" size="sm" onClick={() => navigate({ to: '/parts/import' })}>{t('g8a.tools.ppcEdit')}</Button>
      </div>
      {rules.length > 0 && (
        <div className="overflow-auto rounded-md border border-border">
          <table className="w-full border-collapse font-data text-[13px]">
            <thead className="bg-muted"><tr><Th>{t('g8a.filters.supplier')}</Th><Th>{t('g8a.tools.family')}</Th><Th>{t('g8a.filters.brand')}</Th><Th className="text-right">{t('g8a.tools.pctPpc')}</Th></tr></thead>
            <tbody>
              {rules.map((r, i) => (
                <tr key={r.id ?? i} className="border-b border-border last:border-0">
                  <Td>{r.supplier_name ?? t('g8a.tools.allSuppliers')}</Td>
                  <Td className="font-mono text-[12px]">{r.category_path ?? t('g8a.tools.allFamilies')}</Td>
                  <Td>{r.brand ?? '—'}</Td>
                  <Td className="text-right tabular-nums">{pct(r.pct)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="space-y-3 rounded-md border border-border bg-card p-3">
        <h3 className="font-ui text-[15px] font-bold">{t('g8a.tools.ppcApplyTitle')}</h3>
        <SelectionFiltersForm companyId={companyId} value={filters} onChange={setFilters} compact />
        <div className="flex justify-end">
          <Button variant="outline" onClick={() => void preview.run(filters)} disabled={preview.loading || rules.length === 0}>
            {preview.loading ? <Loader2 className="animate-spin" /> : <Eye />} {t('g8a.tools.preview')}
          </Button>
        </div>
        <PreviewAndApply companyId={companyId} preview={preview} origin="ppc_rule" />
      </div>
    </div>
  );
}

/* ─────────────── Recalcul PA / PV par tranches ─────────────── */
const EMPTY_BRACKETS: Record<string, string>[] = Array.from({ length: 5 }, () => ({ from: '', to: '', paPct: '', pvPct: '', coef: '' }));

function BracketsTab({ companyId }: { companyId: string }) {
  const [filters, setFilters] = useState<SelectionFilters>({});
  const [mode, setMode] = useState<BracketMode>('rate');
  const [rows, setRows] = useState<Record<string, string>[]>(EMPTY_BRACKETS);
  const [useRounding, setUseRounding] = useState(true);
  const roundingQ = useQuery({ queryKey: ['g8-family-rounding', companyId], queryFn: () => listFamilyRounding(companyId).catch(() => []) });
  const n = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));
  const brackets: PriceBracket[] = rows
    .filter((r) => r.from.trim() !== '' || r.to.trim() !== '')
    .map((r) => ({ from: n(r.from), to: n(r.to), paPct: n(r.paPct), pvPct: n(r.pvPct), coef: n(r.coef) }));
  const preview = usePreview(companyId, (list) => {
    const rules: FamilyRoundingRule[] = roundingQ.data ?? [];
    return list.map((a) => {
      const tranches = useRounding ? resolveFamilyRounding(rules, { supplierId: a.supplier_id, categoryPath: a.category_path }) : [];
      const round = tranches.length ? (v: number) => roundWithTranches(v, tranches) : undefined;
      return { article: a, change: bracketChange(a, mode, brackets, round) };
    }).filter((x): x is Proposal => !!x.change);
  });
  const setCell = (i: number, k: string, v: string) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('g8a.tools.bracketsHint')}</p>
      <div className="space-y-3 rounded-md border border-border bg-card p-3">
        <SelectionFiltersForm companyId={companyId} value={filters} onChange={setFilters} compact />
      </div>
      <div className="space-y-3 rounded-md border border-border bg-card p-3">
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm"><input type="radio" checked={mode === 'rate'} onChange={() => setMode('rate')} className="accent-[var(--ducati-red)]" />{t('g8a.tools.modeRate')}</label>
          <label className="flex items-center gap-2 text-sm"><input type="radio" checked={mode === 'coef'} onChange={() => setMode('coef')} className="accent-[var(--ducati-red)]" />{t('g8a.tools.modeCoef')}</label>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={useRounding} onCheckedChange={(v) => setUseRounding(v === true)} />{t('g8a.tools.withRounding')}</label>
        </div>
        <table className="border-collapse font-data text-[13px]">
          <thead>
            <tr>
              <Th>{t('g8a.tools.bracket')}</Th><Th>{t('g8a.tools.paFrom')}</Th><Th>{t('g8a.tools.paTo')}</Th>
              {mode === 'rate' ? <><Th>{t('g8a.tools.pctPa')}</Th><Th>{t('g8a.tools.pctPv')}</Th></> : <Th>{t('g8a.tools.coef')}</Th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <Td className="tabular-nums">{i + 1}</Td>
                <Td><Input value={r.from} onChange={(e) => setCell(i, 'from', e.target.value)} className="h-8 w-24 text-right tabular-nums" /></Td>
                <Td><Input value={r.to} onChange={(e) => setCell(i, 'to', e.target.value)} className="h-8 w-24 text-right tabular-nums" placeholder={t('g8a.tools.noLimit')} /></Td>
                {mode === 'rate' ? (
                  <>
                    <Td><Input value={r.paPct} onChange={(e) => setCell(i, 'paPct', e.target.value)} className="h-8 w-20 text-right tabular-nums" placeholder="%" /></Td>
                    <Td><Input value={r.pvPct} onChange={(e) => setCell(i, 'pvPct', e.target.value)} className="h-8 w-20 text-right tabular-nums" placeholder="%" /></Td>
                  </>
                ) : (
                  <Td><Input value={r.coef} onChange={(e) => setCell(i, 'coef', e.target.value)} className="h-8 w-24 text-right tabular-nums" placeholder="1,80" /></Td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex justify-end">
          <Button variant="outline" onClick={() => void preview.run(filters)} disabled={preview.loading || brackets.length === 0}>
            {preview.loading ? <Loader2 className="animate-spin" /> : <Eye />} {t('g8a.tools.preview')}
          </Button>
        </div>
        <PreviewAndApply companyId={companyId} preview={preview} origin="recalc" />
      </div>
      <p className="flex items-center gap-1 text-[12px] text-muted-foreground"><Check className="size-3" /> {t('g8a.tools.locksNote')}</p>
    </div>
  );
}
