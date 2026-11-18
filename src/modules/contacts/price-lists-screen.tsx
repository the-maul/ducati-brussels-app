/**
 * M1 — Tarifs clients communs (G8 : Fichiers > Clients > Ajout/Modif/Suppr Tarif client).
 * Rattrapage G8 du 18/11/2026. Liste des tarifs (code, base, libelle, promotion, remise affichee,
 * clients rattaches ; Nouveau, Dupliquer, Supprimer) et fiche d'un tarif : lignes par reference /
 * famille / fournisseur / marque / tout le catalogue, remise % ou coefficient ou prix net, 4 paliers
 * de quantite, dates de debut et de fin ; « Modifications globales » sur la selection ; import d'un
 * fichier (Excel / CSV). Le calcul du prix a la vente : src/modules/sales/customer-pricing.ts.
 */
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import { Loader2, Plus, Trash2, Copy, Save, Upload, Tag, Info } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusBadge } from '@/components/status-badge';
import { useConfirm } from '@/components/confirm-provider';
import { t, fillVars } from '@/lib/i18n';
import { errorMessage } from '@/lib/mutation-feedback';
import { searchSaleArticles } from '@/modules/sales/write-api';
import { listSuppliers, supplierName } from '@/modules/purchases/api';
import { cleanTiers, type PriceKind, type PriceTier } from '@/modules/sales/customer-pricing';
import { parsePriceListSheet } from '@/modules/sales/price-list-import';
import {
  listPriceLists, savePriceList, deletePriceList, duplicatePriceList, countClientsByList, listPriceListRules, addPriceListRules,
  updatePriceListRules, deletePriceListRules, articlesByReference, articleRefsByIds, type PriceList, type PriceListRuleInput,
} from '@/modules/sales/customer-pricing-api';

const NONE = '__none__';
const SCOPES = ['all', 'reference', 'family', 'supplier', 'brand'] as const;
const KINDS: PriceKind[] = ['discount', 'coefficient', 'net'];
const num = (s: string) => { const n = Number(String(s).replace(',', '.')); return Number.isFinite(n) ? n : NaN; };

export function PriceListsScreen({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const lists = useQuery({ queryKey: ['price-lists', companyId], queryFn: () => listPriceLists(companyId) });
  const counts = useQuery({ queryKey: ['price-lists-count', companyId], queryFn: () => countClientsByList(companyId), enabled: !!lists.data });
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['price-lists', companyId] }); void qc.invalidateQueries({ queryKey: ['price-lists-count', companyId] }); };

  if (lists.isLoading) return <div className="grid place-items-center py-10"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
  if (lists.data === null) return <p className="flex gap-2 rounded-md bg-info-bg px-3 py-2 text-[13px] text-info"><Info className="mt-0.5 size-4 shrink-0" /> {t('priceLists.missing')}</p>;
  const all = lists.data ?? [];
  const current = all.find((l) => l.id === selected) ?? null;

  const duplicate = async (l: PriceList) => {
    const code = window.prompt(t('priceLists.duplicateCode'), `${l.code}-2`);
    if (!code?.trim()) return;
    try { const id = await duplicatePriceList(l, code.trim()); refresh(); setSelected(id); toast.success(t('priceLists.saved')); }
    catch (e) { toast.error(errorMessage(e)); }
  };
  const remove = async (l: PriceList) => {
    const ok = await confirm({ variant: 'delete', title: t('priceLists.delete'), message: fillVars(t('priceLists.deleteConfirm'), { code: l.code }) });
    if (!ok) return;
    try { await deletePriceList(l.id); if (selected === l.id) setSelected(null); refresh(); }
    catch (e) { toast.error(errorMessage(e)); }
  };

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[420px_1fr]">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('priceLists.title')}</p>
          <Button size="sm" onClick={() => { setCreating(true); setSelected(null); }}><Plus /> {t('priceLists.new')}</Button>
        </div>
        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full border-collapse font-data text-[12px]">
            <thead className="bg-muted"><tr><Th>{t('priceLists.code')}</Th><Th>{t('priceLists.label')}</Th><Th>{t('priceLists.base')}</Th><Th className="text-right">{t('priceLists.clients')}</Th><Th /></tr></thead>
            <tbody>
              {all.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-center text-muted-foreground">{t('priceLists.none')}</td></tr>}
              {all.map((l) => (
                <tr key={l.id} onClick={() => { setSelected(l.id); setCreating(false); }}
                  className={`cursor-pointer border-b border-border last:border-0 hover:bg-accent ${selected === l.id ? 'bg-accent' : ''} ${l.is_active === false ? 'text-muted-foreground line-through' : ''}`}>
                  <td className="px-3 py-1.5 font-bold">{l.code}</td>
                  <td className="px-3 py-1.5">
                    {l.label}
                    {l.is_promo && <span className="ml-1"><StatusBadge tone="info" icon={Tag} label={t('clientRules.promo')} /></span>}
                  </td>
                  <td className="px-3 py-1.5">{all.find((b) => b.id === l.base_list_id)?.code ?? '—'}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{counts.data?.get(l.id) ?? 0}</td>
                  <td className="whitespace-nowrap px-1 py-1 text-right" onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" variant="ghost" title={t('priceLists.duplicate')} onClick={() => duplicate(l)}><Copy className="size-3.5" /></Button>
                    <Button size="sm" variant="ghost" title={t('priceLists.delete')} onClick={() => remove(l)}><Trash2 className="size-3.5 text-danger" /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-4">
        {creating && <ListHeaderForm companyId={companyId} lists={all} list={null} onSaved={(id) => { refresh(); setCreating(false); setSelected(id); }} />}
        {current && (
          <>
            <ListHeaderForm key={current.id} companyId={companyId} lists={all} list={current} onSaved={() => refresh()} />
            <RulesEditor key={`r-${current.id}`} companyId={companyId} list={current} />
          </>
        )}
        {!creating && !current && <p className="rounded-md border border-dashed border-border bg-card py-10 text-center text-sm text-muted-foreground">{t('priceLists.pick')}</p>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ en-tete du tarif */
function ListHeaderForm({ companyId, lists, list, onSaved }: { companyId: string; lists: PriceList[]; list: PriceList | null; onSaved: (id: string) => void }) {
  const [code, setCode] = useState(list?.code ?? '');
  const [label, setLabel] = useState(list?.label ?? '');
  const [base, setBase] = useState(list?.base_list_id ?? NONE);
  const [promo, setPromo] = useState(!!list?.is_promo);
  const [show, setShow] = useState(list ? list.show_discount !== false : true);
  const [active, setActive] = useState(list ? list.is_active !== false : true);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!code.trim()) return;
    setBusy(true);
    try {
      const id = await savePriceList({ id: list?.id, company_id: companyId, code, label, base_list_id: base === NONE ? null : base, is_promo: promo, show_discount: show, is_active: active });
      toast.success(t('priceLists.saved'));
      onSaved(id);
    } catch (e) { toast.error(errorMessage(e)); }
    setBusy(false);
  };
  return (
    <div className="grid grid-cols-1 gap-3 rounded-md border border-border bg-card p-4 sm:grid-cols-3">
      <Field label={t('priceLists.code')}><Input value={code} onChange={(e) => setCode(e.target.value)} className="font-mono" /></Field>
      <Field label={t('priceLists.label')}><Input value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
      <Field label={t('priceLists.base')}>
        <Select value={base} onValueChange={setBase}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t('priceLists.noBase')}</SelectItem>
            {lists.filter((l) => l.id !== list?.id).map((l) => <SelectItem key={l.id} value={l.id}>{l.code}{l.label ? ` — ${l.label}` : ''}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>
      <div className="col-span-full flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2"><Checkbox checked={promo} onCheckedChange={(v) => setPromo(v === true)} /> {t('priceLists.promo')}</label>
        <label className="flex items-center gap-2"><Checkbox checked={show} onCheckedChange={(v) => setShow(v === true)} /> {t('priceLists.showDiscount')}</label>
        <label className="flex items-center gap-2"><Checkbox checked={active} onCheckedChange={(v) => setActive(v === true)} /> {t('priceLists.active')}</label>
        <span className="text-[12px] text-muted-foreground">{t('priceLists.baseHint')}</span>
        <Button className="ml-auto" onClick={save} disabled={busy || !code.trim()}>{busy ? <Loader2 className="animate-spin" /> : <Save />} {t('priceLists.save')}</Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ lignes du tarif */
type TierDraft = { qty: string; value: string };
const emptyTiers = (): TierDraft[] => [{ qty: '1', value: '' }, { qty: '', value: '' }, { qty: '', value: '' }, { qty: '', value: '' }];
const tiersOf = (d: TierDraft[]): PriceTier[] => cleanTiers(d.filter((x) => x.value.trim() !== '').map((x) => ({ min_qty: x.qty.trim() ? num(x.qty) : 1, value: num(x.value) })));
const tierLabel = (kind: string, v: number) => (kind === 'discount' ? `${String(v).replace('.', ',')} %` : kind === 'coefficient' ? `× ${String(v).replace('.', ',')}` : `${v.toFixed(2).replace('.', ',')} €`);

function RulesEditor({ companyId, list }: { companyId: string; list: PriceList }) {
  const qc = useQueryClient();
  const rules = useQuery({ queryKey: ['price-list-rules', list.id], queryFn: () => listPriceListRules(list.id) });
  const articleIds = useMemo(() => (rules.data ?? []).map((r) => r.article_id).filter(Boolean) as string[], [rules.data]);
  const supplierIds = useMemo(() => (rules.data ?? []).map((r) => r.supplier_id).filter(Boolean) as string[], [rules.data]);
  const refs = useQuery({ queryKey: ['price-list-rule-refs', list.id, articleIds.join(',')], queryFn: () => articleRefsByIds(articleIds), enabled: articleIds.length > 0 });
  const suppliers = useQuery({ queryKey: ['price-list-suppliers', companyId], queryFn: () => listSuppliers(companyId, '', 500), enabled: supplierIds.length > 0 });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['price-list-rules', list.id] }); setSel(new Set()); };

  // Nouvelle ligne
  const [scope, setScope] = useState<(typeof SCOPES)[number]>('all');
  const [kind, setKind] = useState<PriceKind>('discount');
  const [tiers, setTiers] = useState<TierDraft[]>(emptyTiers());
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [target, setTarget] = useState(''); const [targetId, setTargetId] = useState<string | null>(null); const [targetLabel, setTargetLabel] = useState('');
  const artQ = useQuery({ queryKey: ['pl-art', companyId, target], queryFn: () => searchSaleArticles(companyId, target), enabled: scope === 'reference' && !targetId && target.trim().length >= 2 });
  const supQ = useQuery({ queryKey: ['pl-sup', companyId, target], queryFn: () => listSuppliers(companyId, target, 20), enabled: scope === 'supplier' && !targetId });
  const [busy, setBusy] = useState(false);

  const add = async () => {
    const tt = tiersOf(tiers);
    if (!tt.length) { toast.error(t('priceLists.needValue')); return; }
    if ((scope === 'reference' || scope === 'supplier') && !targetId) { toast.error(t('priceLists.needTarget')); return; }
    if ((scope === 'family' || scope === 'brand') && !target.trim()) { toast.error(t('priceLists.needTarget')); return; }
    const row: PriceListRuleInput = {
      company_id: companyId, price_list_id: list.id, scope, kind, tiers: tt, date_from: from || null, date_to: to || null,
      article_id: scope === 'reference' ? targetId : null, supplier_id: scope === 'supplier' ? targetId : null,
      family_code: scope === 'family' ? target.trim() : null, brand: scope === 'brand' ? target.trim() : null,
    };
    setBusy(true);
    try { await addPriceListRules([row]); setTiers(emptyTiers()); setTarget(''); setTargetId(null); setTargetLabel(''); refresh(); }
    catch (e) { toast.error(errorMessage(e)); }
    setBusy(false);
  };

  // Modifications globales
  const [gFrom, setGFrom] = useState(''); const [gTo, setGTo] = useState(''); const [gCoef, setGCoef] = useState(''); const [gDisc, setGDisc] = useState('');
  const applyGlobal = async () => {
    const ids = [...sel];
    if (!ids.length) return;
    const patch: Parameters<typeof updatePriceListRules>[1] = {};
    if (gFrom) patch.date_from = gFrom;
    if (gTo) patch.date_to = gTo;
    if (gCoef.trim()) { patch.kind = 'coefficient'; patch.tiers = [{ min_qty: 1, value: num(gCoef) }]; }
    else if (gDisc.trim()) { patch.kind = 'discount'; patch.tiers = [{ min_qty: 1, value: num(gDisc) }]; }
    if (!Object.keys(patch).length) return;
    try { await updatePriceListRules(ids, patch); toast.success(t('priceLists.saved')); refresh(); }
    catch (e) { toast.error(errorMessage(e)); }
  };
  const removeSelected = async () => {
    try { await deletePriceListRules([...sel]); refresh(); } catch (e) { toast.error(errorMessage(e)); }
  };

  // Import fichier
  const fileRef = useRef<HTMLInputElement>(null);
  const onFile = async (f: File | null) => {
    if (!f) return;
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: true });
      const parsed = parsePriceListSheet(rows);
      if (parsed.missingReference) { toast.error(t('priceLists.importNoRef')); return; }
      const ids = await articlesByReference(companyId, parsed.rules.map((r) => r.reference));
      const unknown = parsed.rules.filter((r) => !ids.has(r.reference.toUpperCase())).map((r) => r.reference);
      const n = await addPriceListRules(parsed.rules.filter((r) => ids.has(r.reference.toUpperCase())).map((r) => ({
        company_id: companyId, price_list_id: list.id, scope: 'reference', article_id: ids.get(r.reference.toUpperCase()) ?? null,
        kind: r.kind, tiers: r.tiers, date_from: r.date_from, date_to: r.date_to,
      })));
      toast.success(fillVars(t('priceLists.importDone'), { n }));
      if (unknown.length) toast.warning(fillVars(t('priceLists.importUnknown'), { n: unknown.length, refs: unknown.slice(0, 15).join(', ') }));
      if (parsed.errors.length) toast.warning(fillVars(t('priceLists.importErrors'), { n: parsed.errors.length, rows: parsed.errors.slice(0, 20).map((e) => e.row).join(', ') }));
      refresh();
    } catch (e) { toast.error(errorMessage(e)); }
    finally { if (fileRef.current) fileRef.current.value = ''; }
  };

  const supName = (id: string | null | undefined) => { const s = suppliers.data?.find((x) => x.id === id); return s ? supplierName(s) : '…'; };
  const targetText = (r: { scope: string; article_id?: string | null; supplier_id?: string | null; family_code?: string | null; brand?: string | null }) => {
    if (r.scope === 'reference') { const a = r.article_id ? refs.data?.get(r.article_id) : undefined; return a ? `${a.reference} — ${a.designation}` : '…'; }
    if (r.scope === 'supplier') return supName(r.supplier_id);
    if (r.scope === 'family') return r.family_code ?? '';
    if (r.scope === 'brand') return r.brand ?? '';
    return '';
  };
  const data = rules.data ?? [];
  const allChecked = data.length > 0 && data.every((r) => sel.has(r.id));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('priceLists.rules')} — {list.code}</p>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0] ?? null)} />
        <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}><Upload /> {t('priceLists.import')}</Button>
      </div>
      <p className="text-[12px] text-muted-foreground">{t('priceLists.importHint')}</p>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[12px]">
          <thead className="bg-muted">
            <tr>
              <Th className="w-8"><Checkbox checked={allChecked} onCheckedChange={(v) => setSel(v === true ? new Set(data.map((r) => r.id)) : new Set())} /></Th>
              <Th>{t('priceLists.scope')}</Th><Th>{t('priceLists.target')}</Th><Th>{t('priceLists.kind')}</Th>
              {[1, 2, 3, 4].map((n) => <Th key={n} className="text-right">{fillVars(t('priceLists.tier'), { n })}</Th>)}
              <Th>{t('priceLists.dateFrom')}</Th><Th>{t('priceLists.dateTo')}</Th>
            </tr>
          </thead>
          <tbody>
            {rules.isLoading && <tr><td colSpan={10} className="py-4 text-center"><Loader2 className="mx-auto size-4 animate-spin" /></td></tr>}
            {!rules.isLoading && data.length === 0 && <tr><td colSpan={10} className="px-3 py-4 text-center text-muted-foreground">{t('priceLists.noRules')}</td></tr>}
            {data.map((r) => {
              const tt = cleanTiers(Array.isArray(r.tiers) ? (r.tiers as PriceTier[]) : []);
              return (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-1.5"><Checkbox checked={sel.has(r.id)} onCheckedChange={(v) => setSel((s) => { const n = new Set(s); if (v === true) n.add(r.id); else n.delete(r.id); return n; })} /></td>
                  <td className="px-3 py-1.5">{t(`priceLists.scope_${r.scope}`)}</td>
                  <td className="max-w-64 truncate px-3 py-1.5">{targetText(r)}</td>
                  <td className="px-3 py-1.5">{t(`priceLists.kind_${r.kind}`)}</td>
                  {[0, 1, 2, 3].map((i) => (
                    <td key={i} className="px-3 py-1.5 text-right tabular-nums">{tt[i] ? <>{tierLabel(r.kind, tt[i].value)} <span className="text-muted-foreground">({t('priceLists.from')} {tt[i].min_qty})</span></> : ''}</td>
                  ))}
                  <td className="px-3 py-1.5 tabular-nums">{r.date_from ?? ''}</td>
                  <td className="px-3 py-1.5 tabular-nums">{r.date_to ?? ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {sel.size > 0 && (
        <div className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-card p-3">
          <p className="w-full text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('priceLists.globalTitle')} · {fillVars(t('priceLists.selected'), { n: sel.size })}</p>
          <Field label={t('priceLists.dateFrom')}><Input type="date" value={gFrom} onChange={(e) => setGFrom(e.target.value)} /></Field>
          <Field label={t('priceLists.dateTo')}><Input type="date" value={gTo} onChange={(e) => setGTo(e.target.value)} /></Field>
          <Field label={t('priceLists.kind_coefficient')}><Input value={gCoef} onChange={(e) => { setGCoef(e.target.value); if (e.target.value) setGDisc(''); }} className="w-24 text-right tabular-nums" /></Field>
          <Field label={t('priceLists.kind_discount')}><Input value={gDisc} onChange={(e) => { setGDisc(e.target.value); if (e.target.value) setGCoef(''); }} className="w-24 text-right tabular-nums" /></Field>
          <Button onClick={applyGlobal}>{t('priceLists.apply')}</Button>
          <Button variant="outline" className="text-danger" onClick={removeSelected}><Trash2 /> {t('priceLists.deleteSelected')}</Button>
        </div>
      )}

      <div className="space-y-2 rounded-md border border-dashed border-border p-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
          <Field label={t('priceLists.scope')}>
            <Select value={scope} onValueChange={(v) => { setScope(v as (typeof SCOPES)[number]); setTarget(''); setTargetId(null); setTargetLabel(''); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{SCOPES.map((s) => <SelectItem key={s} value={s}>{t(`priceLists.scope_${s}`)}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <div className="sm:col-span-2">
            {scope !== 'all' && (
              <Field label={t('priceLists.target')}>
                {targetId ? (
                  <div className="flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm">
                    <span className="truncate">{targetLabel}</span>
                    <button type="button" className="ml-auto text-muted-foreground hover:text-danger" onClick={() => { setTargetId(null); setTargetLabel(''); setTarget(''); }}>×</button>
                  </div>
                ) : (
                  <div className="relative">
                    <Input value={target} onChange={(e) => setTarget(e.target.value)}
                      placeholder={scope === 'reference' ? t('priceLists.articleSearch') : scope === 'supplier' ? t('priceLists.supplierSearch') : scope === 'family' ? t('priceLists.familyPlaceholder') : t('priceLists.brandPlaceholder')} />
                    {scope === 'reference' && (artQ.data ?? []).length > 0 && (
                      <Dropdown>{(artQ.data ?? []).slice(0, 10).map((a) => (
                        <button key={a.id} type="button" className="block w-full px-3 py-1.5 text-left text-sm hover:bg-accent" onClick={() => { setTargetId(a.id); setTargetLabel(`${a.reference} — ${a.designation}`); }}>
                          <span className="font-mono text-[12px]">{a.reference}</span> {a.designation}
                        </button>
                      ))}</Dropdown>
                    )}
                    {scope === 'supplier' && (supQ.data ?? []).length > 0 && target.trim().length > 0 && (
                      <Dropdown>{(supQ.data ?? []).slice(0, 10).map((s) => (
                        <button key={s.id} type="button" className="block w-full px-3 py-1.5 text-left text-sm hover:bg-accent" onClick={() => { setTargetId(s.id); setTargetLabel(supplierName(s)); }}>{supplierName(s)}</button>
                      ))}</Dropdown>
                    )}
                  </div>
                )}
              </Field>
            )}
          </div>
          <Field label={t('priceLists.kind')}>
            <Select value={kind} onValueChange={(v) => setKind(v as PriceKind)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{KINDS.map((k) => <SelectItem key={k} value={k}>{t(`priceLists.kind_${k}`)}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
          {tiers.map((x, i) => (
            <div key={i} className={`grid grid-cols-2 gap-1 ${i === 0 ? '' : ''}`}>
              <Field label={`${fillVars(t('priceLists.tier'), { n: i + 1 })} · ${t('priceLists.tierQty')}`}>
                <Input value={x.qty} disabled={i === 0} onChange={(e) => setTiers((ts) => ts.map((y, j) => (j === i ? { ...y, qty: e.target.value } : y)))} className="text-right tabular-nums" />
              </Field>
              <Field label={t('priceLists.tierValue')}>
                <Input value={x.value} onChange={(e) => setTiers((ts) => ts.map((y, j) => (j === i ? { ...y, value: e.target.value } : y)))} className="text-right tabular-nums" />
              </Field>
            </div>
          ))}
          <Field label={t('priceLists.dateFrom')}><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label={t('priceLists.dateTo')}><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        <div className="flex justify-end"><Button onClick={add} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <Plus />} {t('priceLists.addRule')}</Button></div>
      </div>
    </div>
  );
}

function Dropdown({ children }: { children: ReactNode }) {
  return <div className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-popover shadow-[var(--shadow-modal)]">{children}</div>;
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-1"><label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</label>{children}</div>;
}
function Th({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
