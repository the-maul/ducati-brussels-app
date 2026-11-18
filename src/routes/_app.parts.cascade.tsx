import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, ChevronLeft, ChevronRight, ExternalLink, Loader2, Lock, Search, Wand2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/lib/auth/auth-context';
import { useReadOnly } from '@/lib/auth/read-only-context';
import { MGMT_TYPES } from '@/modules/articles/api';
import { fillVars, t, pageTitle } from '@/lib/i18n';
import {
  applyCascade, applyLibraryBatch, deleteArticlesBatch, selectArticleIds, selectArticlesPage,
  type SelectedArticle, type SelectionFilters,
} from '@/modules/articles/g8/api';
import { CASCADE_ACTIONS, cascadeAction, cascadePayload, type CascadeValue } from '@/modules/articles/g8/cascade-actions';
import { FamilySelects, SelectionFiltersForm, SupplierSelect } from '@/modules/articles/g8/selection-filters';
import { QueryError, Td, Th, errorText, eur, qty } from '@/modules/articles/g8/ui';
import { buildFamilyCode } from '@/modules/articles/product-families';

/**
 * M2 — Modification en cascade des articles (G8 « Modification cascade Art/Lib »), refaite lors
 * du rattrapage G8 du 18/11/2026 : sélection filtrée calculée en base (plus de plafond à
 * 1 000 lignes), 29 actions dont les 23 actions G8 hors nomenclature, envoi en librairie /
 * librairie vers article, suppression (administrateur), case « Confirmer » comme G8.
 * Les prix passent par price_changes (origine « cascade ») ; les autres champs laissent une
 * ligne events par article.
 */
export const Route = createFileRoute('/_app/parts/cascade')({
  head: () => ({ meta: [{ title: pageTitle('partsCascade') }] }),
  component: CascadePage,
});

const PAGE = 200;

function CascadePage() {
  const { activeCompanyId, isAdmin } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const readOnly = useReadOnly();
  const [filters, setFilters] = useState<SelectionFilters>({});
  const [applied, setApplied] = useState<SelectionFilters | null>(null);
  const [rows, setRows] = useState<SelectedArticle[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [scope, setScope] = useState<'all' | 'checked'>('all');
  const [action, setAction] = useState('pv_pct');
  const [val, setVal] = useState<CascadeValue>({});
  const [confirmed, setConfirmed] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = async (f: SelectionFilters, off: number) => {
    if (!activeCompanyId) return;
    setLoading(true); setError(null);
    try {
      const r = await selectArticlesPage(activeCompanyId, f, PAGE, off);
      setRows(r.rows); setTotal(r.total); setOffset(off); setApplied(f);
    } catch (e) { setError(e); }
    finally { setLoading(false); }
  };
  const list = () => { setChecked(new Set()); setResult(null); void load(filters, 0); };

  const def = cascadeAction(action)!;
  const toggle = (id: string) => setChecked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const pageAllChecked = rows.length > 0 && rows.every((r) => checked.has(r.id));
  const targetCount = scope === 'all' ? total : checked.size;

  const apply = useMutation({
    meta: { success: false, error: false },
    mutationFn: async () => {
      if (!activeCompanyId || !applied) return null;
      const payload = cascadePayload(def, val);
      if (!payload.ok) throw new Error(t(payload.error));
      const ids = scope === 'all' ? await selectArticleIds(activeCompanyId, applied) : Array.from(checked);
      if (!ids.length) return null;
      const onProgress = (done: number, n: number) => setProgress({ done, total: n });
      if (def.special === 'library_in' || def.special === 'library_out') {
        const r = await applyLibraryBatch(ids, def.special === 'library_in', onProgress);
        return fillVars(t('g8a.cascade.libraryResult'), { done: r.done, refused: r.refused, unchanged: r.unchanged });
      }
      if (def.special === 'delete') {
        const r = await deleteArticlesBatch(activeCompanyId, ids, onProgress);
        return fillVars(t('g8a.cascade.deleteResult'), { deleted: r.deleted, deactivated: r.deactivated });
      }
      const r = await applyCascade(activeCompanyId, ids, action, payload.value, onProgress);
      return fillVars(t('g8a.cascade.result'), { done: r.done, skipped: r.skipped });
    },
    onSuccess: (msg) => {
      setProgress(null); setConfirmed(false);
      if (msg) setResult(msg);
      qc.invalidateQueries({ queryKey: ['articles'] });
      if (applied) void load(applied, offset);
    },
    onError: (e) => { setProgress(null); setError(e); },
  });

  const isDelete = def.special === 'delete';
  const canApply = !readOnly && !!applied && targetCount > 0 && confirmed && !apply.isPending && (!isDelete || isAdmin());

  return (
    <>
      <PageHeader
        title={t('cascade.title')}
        description={t('g8a.cascade.description')}
        actions={<Button variant="outline" onClick={() => navigate({ to: '/parts' })}><ArrowLeft /> {t('articles.title')}</Button>}
      />
      <p className="mb-4 rounded-md bg-info-bg px-3 py-2 text-[13px] text-info">{t('g8a.cascade.traceNote')}</p>

      {activeCompanyId && (
        <div className="mb-4 space-y-3 rounded-md border border-border bg-card p-3">
          <SelectionFiltersForm companyId={activeCompanyId} value={filters} onChange={setFilters} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setFilters({})}>{t('g8a.filters.reset')}</Button>
            <Button onClick={list} disabled={loading}>{loading ? <Loader2 className="animate-spin" /> : <Search />} {t('g8a.cascade.list')}</Button>
          </div>
        </div>
      )}

      <QueryError error={error} />

      {applied && (
        <div className="mb-4 space-y-3 rounded-md border border-border bg-card p-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label>{t('cascade.action')}</Label>
              <Select value={action} onValueChange={(v) => { setAction(v); setVal({}); setConfirmed(false); }}>
                <SelectTrigger className="w-72"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-80">
                  {CASCADE_ACTIONS.map((a) => <SelectItem key={a.key} value={a.key}>{t(a.label)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <ActionInput companyId={activeCompanyId!} input={def.input} value={val} onChange={setVal} />
            <div className="space-y-1">
              <Label>{t('g8a.cascade.scope')}</Label>
              <Select value={scope} onValueChange={(v) => setScope(v as 'all' | 'checked')}>
                <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{fillVars(t('g8a.cascade.scopeAll'), { n: total })}</SelectItem>
                  <SelectItem value="checked">{fillVars(t('g8a.cascade.scopeChecked'), { n: checked.size })}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {def.price && <p className="text-[12px] text-muted-foreground">{t('g8a.cascade.priceNote')}</p>}
          {isDelete && <p className="rounded-md bg-warning-bg px-3 py-2 text-[12px] text-warning">{t('g8a.cascade.deleteNote')}</p>}
          {def.special === 'library_in' && <p className="text-[12px] text-muted-foreground">{t('g8a.cascade.libraryNote')}</p>}
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={confirmed} onCheckedChange={(v) => setConfirmed(v === true)} />
              {fillVars(t(isDelete ? 'g8a.cascade.confirmDelete' : 'g8a.cascade.confirmChange'), { n: targetCount })}
            </label>
            <Button variant={isDelete ? 'destructive' : 'default'} onClick={() => { setError(null); setResult(null); apply.mutate(); }} disabled={!canApply}>
              {apply.isPending ? <Loader2 className="animate-spin" /> : isDelete && !isAdmin() ? <Lock /> : <Wand2 />}
              {fillVars(t('g8a.cascade.apply'), { n: targetCount })}
            </Button>
            {progress && <span className="text-[12px] tabular-nums text-muted-foreground">{fillVars(t('g8a.common.progress'), { done: progress.done, total: progress.total })}</span>}
            {result && <span className="flex items-center gap-1 text-[13px] text-success"><Check className="size-4" /> {result}</span>}
            {isDelete && !isAdmin() && <span className="text-[12px] text-muted-foreground">{t('g8a.cascade.adminOnly')}</span>}
          </div>
        </div>
      )}

      {applied && (
        <>
          <div className="mb-2 flex items-center justify-between text-[13px] text-muted-foreground">
            <span>{total === 0 ? t('g8a.cascade.none') : fillVars(t('g8a.common.range'), { from: offset + 1, to: offset + rows.length, n: total })}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={loading || offset === 0} onClick={() => void load(applied, Math.max(0, offset - PAGE))}><ChevronLeft /> {t('articles.pagePrev')}</Button>
              <Button variant="outline" size="sm" disabled={loading || offset + rows.length >= total} onClick={() => void load(applied, offset + PAGE)}>{t('articles.pageNext')} <ChevronRight /></Button>
            </div>
          </div>
          <div className="overflow-hidden rounded-md border border-border">
            <div className="max-h-[32rem] overflow-auto">
              <table className="w-full border-collapse font-data text-[13px]">
                <thead className="sticky top-0 bg-muted">
                  <tr>
                    <Th className="w-10 text-center">
                      <Checkbox checked={pageAllChecked} onCheckedChange={(v) => setChecked((s) => {
                        const n = new Set(s);
                        for (const r of rows) { if (v === true) n.add(r.id); else n.delete(r.id); }
                        return n;
                      })} />
                    </Th>
                    <Th>{t('cascade.colRef')}</Th><Th>{t('cascade.colDesignation')}</Th>
                    <Th className="text-right">{t('g8a.cols.paHt')}</Th><Th className="text-right">{t('g8a.cols.pvHt')}</Th><Th className="text-right">{t('g8a.cols.pvTtc')}</Th>
                    <Th className="text-right">{t('g8a.cols.ppcHt')}</Th><Th className="text-right">{t('g8a.cols.ppcTtc')}</Th>
                    <Th>{t('g8a.cols.descriptif')}</Th><Th>{t('g8a.cols.docVisible')}</Th><Th>{t('g8a.cols.bin')}</Th><Th>{t('g8a.cols.supplierRef')}</Th>
                    <Th className="text-right">{t('g8a.cols.real')}</Th><Th className="text-right">{t('g8a.cols.min')}</Th><Th className="text-right">{t('g8a.cols.max')}</Th>
                    <Th>{t('g8a.cols.locks')}</Th><Th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((a) => (
                    <tr key={a.id} className="border-b border-border last:border-0 hover:bg-accent">
                      <Td className="text-center"><Checkbox checked={checked.has(a.id)} onCheckedChange={() => toggle(a.id)} /></Td>
                      <Td className="font-mono text-[12px]">{a.reference}{a.is_library && <span className="ml-1 text-[11px] text-info">{t('g8a.cols.lib')}</span>}</Td>
                      <Td>{a.designation}</Td>
                      <Td className="text-right tabular-nums">{eur(a.purchase_price)}</Td>
                      <Td className="text-right tabular-nums">{eur(a.sale_price_ht)}</Td>
                      <Td className="text-right tabular-nums">{eur(a.sale_price_ttc)}</Td>
                      <Td className="text-right tabular-nums">{eur(a.ppc_ht)}</Td>
                      <Td className="text-right tabular-nums">{eur(a.ppc_ttc)}</Td>
                      <Td className="max-w-[14rem] truncate text-muted-foreground">{a.descriptif ?? ''}</Td>
                      <Td>{a.show_descriptif_on_documents ? t('g8a.common.yes') : t('g8a.common.no')}</Td>
                      <Td className="font-mono text-[12px]">{a.bin_location ?? ''}</Td>
                      <Td className="font-mono text-[12px]">{a.supplier_ref ?? ''}</Td>
                      <Td className="text-right tabular-nums">{qty(a.real_qty)}</Td>
                      <Td className="text-right tabular-nums">{qty(a.stock_min)}</Td>
                      <Td className="text-right tabular-nums">{qty(a.stock_max)}</Td>
                      <Td className="whitespace-nowrap text-[11px] text-muted-foreground">
                        {[a.designation_locked && t('g8a.cols.lockDes'), a.price_purchase_locked && t('g8a.cols.lockPa'), a.price_sale_locked && t('g8a.cols.lockPv')].filter(Boolean).join(' · ')}
                      </Td>
                      <Td>
                        <Button size="sm" variant="ghost" title={t('g8a.cascade.openSheet')} onClick={() => navigate({ to: '/parts/$articleId', params: { articleId: a.id } })}>
                          <ExternalLink className="size-4" />
                        </Button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
      {apply.isError && <p className="mt-3 rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{errorText(apply.error)}</p>}
    </>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{children}</label>;
}

const CONTAINER_UNITS = ['NC', 'Kg', 'L', 'M'];

function ActionInput({ companyId, input, value, onChange }: {
  companyId: string; input: string; value: CascadeValue; onChange: (v: CascadeValue) => void;
}) {
  const set = (k: keyof CascadeValue, v: string) => onChange({ ...value, [k]: v });
  const fam = (value.value ?? '').split('-');
  switch (input) {
    case 'none':
      return null;
    case 'text':
      return <div className="space-y-1"><Label>{t('cascade.value')}</Label><Input value={value.value ?? ''} onChange={(e) => set('value', e.target.value)} className="w-56" /></div>;
    case 'longtext':
      return <div className="space-y-1"><Label>{t('cascade.value')}</Label><Textarea rows={2} value={value.value ?? ''} onChange={(e) => set('value', e.target.value)} className="w-96" /></div>;
    case 'number':
    case 'vat':
      return <div className="space-y-1"><Label>{t('cascade.value')}</Label><Input value={value.value ?? ''} onChange={(e) => set('value', e.target.value)} className="w-32 text-right tabular-nums" placeholder={input === 'vat' ? '21' : ''} /></div>;
    case 'percent':
      return <div className="space-y-1"><Label>{t('cascade.value')}</Label><Input value={value.value ?? ''} onChange={(e) => set('value', e.target.value)} className="w-32 text-right tabular-nums" placeholder={t('g8a.cascade.pctPlaceholder')} /></div>;
    case 'supplier':
      return <div className="space-y-1"><Label>{t('g8a.filters.supplier')}</Label><SupplierSelect companyId={companyId} value={value.value ?? ''} onChange={(v) => set('value', v)} allowAll={false} /></div>;
    case 'family':
      return (
        <FamilySelects rayon={fam[0] ?? ''} sousRayon={fam[1] ?? ''} categorie={fam[2] ?? ''}
          onChange={(v) => set('value', buildFamilyCode(v.rayon, v.sousRayon, v.categorie) || v.rayon)} />
      );
    case 'mgmt':
      return (
        <div className="space-y-1">
          <Label>{t('cascade.value')}</Label>
          <Select value={value.value ?? ''} onValueChange={(v) => set('value', v)}>
            <SelectTrigger className="w-56"><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>{MGMT_TYPES.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      );
    case 'container':
      return (
        <>
          <div className="space-y-1"><Label>{t('g8a.cascade.containerQty')}</Label><Input value={value.qty ?? ''} onChange={(e) => set('qty', e.target.value)} className="w-24 text-right tabular-nums" /></div>
          <div className="space-y-1">
            <Label>{t('g8a.cascade.containerUnit')}</Label>
            <Input list="g8-cascade-units" value={value.unit ?? ''} onChange={(e) => set('unit', e.target.value)} className="w-24" />
            <datalist id="g8-cascade-units">{CONTAINER_UNITS.map((u) => <option key={u} value={u} />)}</datalist>
          </div>
        </>
      );
    case 'minmax':
      return (
        <>
          <div className="space-y-1"><Label>{t('articles.stockMin')}</Label><Input value={value.min ?? ''} onChange={(e) => set('min', e.target.value)} className="w-24 text-right tabular-nums" /></div>
          <div className="space-y-1"><Label>{t('articles.stockMax')}</Label><Input value={value.max ?? ''} onChange={(e) => set('max', e.target.value)} className="w-24 text-right tabular-nums" /></div>
        </>
      );
    default:
      return null;
  }
}
