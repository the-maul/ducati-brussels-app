/**
 * M5 — Édition du stock multi-critères (G8 « État de stock › Édition de stock multi-critères »).
 * 8 onglets G8 + articles en rupture ; familles (rayon › sous-rayon › catégorie), fournisseur,
 * marque, casier, types de gestion ; stocks nuls / négatifs / démo / dépôts inclus, exclus ou
 * uniquement ; achats et ventes d'une période ; classement sur 4 niveaux avec sous-totaux ;
 * valeur au PAMP ; export Excel ; impression (dont feuilles d'inventaire par rayon / fournisseur /
 * casier / référence). Copies de stock : génération à la demande + consultation (B4).
 * Lecture seule : la sélection est filtrée et paginée en base (`stock_edition`).
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, Download, Eye, Loader2, Printer } from 'lucide-react';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusBadge } from '@/components/status-badge';
import { t, fillVars } from '@/lib/i18n';
import { listSuppliers, supplierName } from '@/modules/purchases/api';
import { RAYONS_SORTED } from '@/modules/articles/product-families';
import { listEdition, listBrands, listSnapshots, generatePhoto, TooManyRowsError, type EditionRow } from './g8-api';
import {
  EDITION_VIEWS, DEFAULT_FILTERS, SORT_KEYS, filtersToJson, sortEditionRows, sortValue, viewNeedsSnapshot,
  type EditionView, type EditionFilters, type SortKey, type TriState,
} from './edition-rules';
import { printSheet, fmtNum, type SheetColumn, type SheetGroup } from './print-sheets';

const NONE = '__none__';
const TYPES = ['A', 'V', 'O', 'P', 'D', 'M', 'N'];
const TRI: TriState[] = ['inclus', 'exclus', 'uniquement'];
const eur = (n: number | null | undefined) => (n == null ? '' : `${(Math.round(n * 100) / 100).toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`);
const day = (s: string | null) => (s ? new Date(s).toLocaleDateString('fr-BE') : '');
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e));

type Col = { key: string; label: string; right?: boolean; show: (r: EditionRow) => string; raw: (r: EditionRow) => string | number | null; qty?: (r: EditionRow) => number; value?: (r: EditionRow) => number };

function columnsFor(view: EditionView, period: boolean): Col[] {
  const L = (k: string) => t(`stockG8.edition.${k}`);
  const q = (k: keyof EditionRow, label: string): Col => ({ key: k, label, right: true, show: (r) => fmtNum(Number(r[k] ?? 0)), raw: (r) => Number(r[k] ?? 0) });
  const m = (k: keyof EditionRow, label: string): Col => ({ key: k, label, right: true, show: (r) => eur(r[k] as number | null), raw: (r) => (r[k] == null ? null : Number(r[k])) });
  const d = (k: keyof EditionRow, label: string): Col => ({ key: k, label, show: (r) => day(r[k] as string | null), raw: (r) => (r[k] ? String(r[k]).slice(0, 10) : null) });
  const tx = (k: keyof EditionRow, label: string): Col => ({ key: k, label, show: (r) => String(r[k] ?? ''), raw: (r) => (r[k] == null ? null : String(r[k])) });
  const head: Col[] = [tx('reference', L('colCode')), tx('designation', L('colDesignation')), tx('supplier_name', L('colSupplier')), tx('bin_location', L('colBin')), tx('mgmt_type', L('colType'))];
  const per = period ? [q('qty_in', L('colQtyIn')), q('qty_out', L('colQtyOut'))] : [];
  const withTotals = (c: Col[], qtyKey: keyof EditionRow, valKey: keyof EditionRow) =>
    c.map((x) => (x.key === qtyKey ? { ...x, qty: (r: EditionRow) => Number(r[qtyKey] ?? 0) } : x.key === valKey ? { ...x, value: (r: EditionRow) => Number(r[valKey] ?? 0) } : x));
  switch (view) {
    case 'arrete': case 'copie': case 'non_reajuste': case 'date':
      return withTotals([...head, q('ref_qty', L('colStock')), m('ref_pamp', L('colPamp')), m('ref_value', L('colValue')),
        ...(view === 'date' ? [q('real_qty', t('stockG8.count.colReal'))] : []), tx('supplier_ref', L('colSupplierRef')), tx('serial_no', L('colSerial')), ...per], 'ref_qty', 'ref_value');
    case 'ecart':
      return withTotals([...head, q('ref_qty', L('colInitial')),
        { key: 'cnt', label: L('colCounted'), right: true, show: (r) => fmtNum(r.ref_qty + (r.gap_qty ?? 0)), raw: (r) => r.ref_qty + (r.gap_qty ?? 0) },
        q('gap_qty', L('colGap')), m('ref_pamp', L('colPamp')), m('gap_value', L('colGapValue'))], 'gap_qty', 'gap_value');
    case 'depreciation':
      return withTotals([...head, q('real_qty', L('colStock')), m('pamp', L('colPamp')), m('stock_value', L('colValue')), m('depreciated_value', L('colDeprec')),
        { key: 'net', label: L('colNet'), right: true, show: (r) => eur(r.stock_value - r.depreciated_value), raw: (r) => r.stock_value - r.depreciated_value },
        d('last_out', L('colLastOut'))], 'real_qty', 'stock_value');
    case 'invendus':
      return withTotals([...head, q('real_qty', L('colStock')), m('pamp', L('colPamp')), m('stock_value', L('colValue')), d('last_sale', L('colLastSale')), d('last_in', L('colLastIn'))], 'real_qty', 'stock_value');
    case 'rupture':
      return withTotals([...head, q('real_qty', L('colStock')), q('reserved_qty', L('colReserved')), q('available_qty', L('colAvailable')),
        q('stock_min', L('colMin')), q('on_order_qty', L('colOnOrder')), d('last_out', L('colLastOut')), tx('supplier_ref', L('colSupplierRef'))], 'available_qty', 'stock_value');
    default:
      return withTotals([...head, q('real_qty', L('colStock')), q('reserved_qty', L('colReserved')), q('on_order_qty', L('colOnOrder')), q('available_qty', L('colAvailable')),
        m('pamp', L('colPamp')), m('stock_value', L('colValue')), d('last_in', L('colLastIn')), d('last_out', L('colLastOut')),
        tx('supplier_ref', L('colSupplierRef')), tx('barcode', L('colBarcode')), tx('serial_no', L('colSerial')), ...per], 'real_qty', 'stock_value');
  }
}

export function EditionScreen({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const [view, setView] = useState<EditionView>('reel');
  const [f, setF] = useState<EditionFilters>(DEFAULT_FILTERS);
  const [rayon, setRayon] = useState(''); const [sous, setSous] = useState(''); const [cat, setCat] = useState('');
  const [levels, setLevels] = useState<SortKey[]>(['rayon', 'reference']);
  const [applied, setApplied] = useState<{ view: EditionView; f: Record<string, unknown>; period: boolean } | null>(null);
  const set = <K extends keyof EditionFilters>(k: K, v: EditionFilters[K]) => setF((p) => ({ ...p, [k]: v }));

  const suppliersQ = useQuery({ queryKey: ['suppliers-filter', companyId], queryFn: () => listSuppliers(companyId, '', 500), staleTime: 300_000 });
  const brandsQ = useQuery({ queryKey: ['stock-brands', companyId], queryFn: () => listBrands(companyId), staleTime: 300_000 });
  const snapsQ = useQuery({ queryKey: ['stock-snapshots', companyId], queryFn: () => listSnapshots(companyId) });
  const needSnap = viewNeedsSnapshot(view);
  const snaps = (snapsQ.data ?? []).filter((s) => (needSnap === 'arrete' ? s.kind === 'arrete' : s.kind !== 'arrete'));

  const rayonNode = RAYONS_SORTED.find((r) => r.code === rayon);
  const sousNode = rayonNode?.sousRayons.find((s) => s.code === sous);
  const category = [rayon, sous, cat].filter(Boolean).join('-');

  const dataQ = useQuery({
    queryKey: ['stock-edition', companyId, applied],
    queryFn: () => listEdition(companyId, applied!.view, applied!.f),
    enabled: !!applied,
    retry: false,
  });
  const cols = useMemo(() => columnsFor(applied?.view ?? view, applied?.period ?? false), [applied, view]);
  const rows = useMemo(() => sortEditionRows(dataQ.data ?? [], levels), [dataQ.data, levels]);
  const totalValue = rows[0]?.total_value ?? 0;

  const show = () => {
    if (needSnap && !f.snapshotId) { toast.error(t('stockG8.edition.needSnapshot')); return; }
    setApplied({ view, f: filtersToJson({ ...f, category }), period: !!f.from });
  };

  const newCopy = async () => {
    try {
      const id = await generatePhoto(companyId, 'copie');
      toast.success(t('stockG8.edition.copyCreated'));
      await qc.invalidateQueries({ queryKey: ['stock-snapshots', companyId] });
      set('snapshotId', id);
    } catch (e) { toast.error(errMsg(e)); }
  };

  const title = () => `${t('stockG8.edition.title')} — ${t(`stockG8.edition.view_${applied?.view ?? view}`)}`;
  const printedOn = () => fillVars(t('stockG8.sheet.printedOn'), { date: new Date().toLocaleString('fr-BE') });

  /** Groupes du 1er niveau de classement, avec sous-totaux quantité / valeur. */
  const grouped = (level: SortKey, sheet: boolean): { columns: SheetColumn[]; groups: SheetGroup[]; total: (string | number | null)[] } => {
    const qtyCol = cols.findIndex((c) => c.qty); const valCol = cols.findIndex((c) => c.value);
    const columns: SheetColumn[] = sheet
      ? [{ label: cols[0].label }, { label: cols[1].label }, { label: t('stockG8.edition.colBin') }, { label: t('stockG8.edition.colStock'), align: 'right' }, { label: t('stockG8.sheet.countCol'), blank: true }]
      : cols.map((c) => ({ label: c.label, align: (c.right ? 'right' : 'left') as 'right' | 'left' }));
    const sorted = sortEditionRows(rows, [level, ...levels.filter((l) => l !== level)]);
    const map = new Map<string, EditionRow[]>();
    for (const r of sorted) { const k = sortValue(r, level); map.set(k, [...(map.get(k) ?? []), r]); }
    let tq = 0; let tv = 0;
    const groups: SheetGroup[] = [...map.entries()].map(([k, rs]) => {
      const sq = rs.reduce((s, r) => s + (cols[qtyCol]?.qty?.(r) ?? 0), 0);
      const sv = rs.reduce((s, r) => s + (cols[valCol]?.value?.(r) ?? 0), 0);
      tq += sq; tv += sv;
      const body = rs.map((r) => (sheet ? [r.reference, r.designation, [r.bin_location, r.bin_location2].filter(Boolean).join(' / '), fmtNum(cols[qtyCol]?.qty?.(r) ?? r.real_qty), ''] : cols.map((c) => c.show(r))));
      const sub = sheet ? null : cols.map((c, i) => (i === 0 ? t('stockG8.edition.subtotal') : i === qtyCol ? fmtNum(sq) : i === valCol ? eur(sv) : ''));
      return { title: `${t(`stockG8.edition.sort_${level}`)} : ${k || '—'}`, rows: body, subtotal: sub ?? undefined };
    });
    const total = sheet ? [t('stockG8.edition.grandTotal'), '', '', fmtNum(tq), ''] : cols.map((c, i) => (i === 0 ? t('stockG8.edition.grandTotal') : i === qtyCol ? fmtNum(tq) : i === valCol ? eur(tv) : ''));
    return { columns, groups, total };
  };

  const doPrint = (sheet: boolean, level: SortKey = levels[0] ?? 'reference') => {
    if (!rows.length) return;
    const g = grouped(level, sheet);
    printSheet({ title: sheet ? `${t('stockG8.edition.printSheet')} — ${t(`stockG8.edition.sort_${level}`)}` : title(), printedOn: printedOn(), ...g });
  };

  const exportXls = () => {
    const aoa = [cols.map((c) => c.label), ...rows.map((r) => cols.map((c) => c.raw(r)))];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Stock');
    XLSX.writeFile(wb, `stock_${applied?.view ?? view}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const triSelect = (k: 'zero' | 'neg' | 'demo' | 'depot') => (
    <Field label={t(`stockG8.edition.${k}`)}>
      <Select value={f[k]} onValueChange={(v) => set(k, v as TriState)}>
        <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
        <SelectContent>{TRI.map((x) => <SelectItem key={x} value={x}>{t(`stockG8.edition.tri_${x}`)}</SelectItem>)}</SelectContent>
      </Select>
    </Field>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1">
        {EDITION_VIEWS.map((v) => (
          <Button key={v} size="sm" variant={v === view ? 'default' : 'outline'} onClick={() => { setView(v); set('snapshotId', ''); }}>{t(`stockG8.edition.view_${v}`)}</Button>
        ))}
      </div>

      <div className="space-y-3 rounded-md border border-border bg-card p-3">
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t('stockG8.edition.rayon')}>
            <Select value={rayon || NONE} onValueChange={(v) => { setRayon(v === NONE ? '' : v); setSous(''); setCat(''); }}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t('stockG8.edition.sortNone')}</SelectItem>
                {RAYONS_SORTED.map((r) => <SelectItem key={r.code} value={r.code}>{r.code} {r.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          {rayonNode && (
            <Field label={t('stockG8.edition.sort_sous_rayon')}>
              <Select value={sous || NONE} onValueChange={(v) => { setSous(v === NONE ? '' : v); setCat(''); }}>
                <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t('stockG8.edition.sortNone')}</SelectItem>
                  {rayonNode.sousRayons.map((s) => <SelectItem key={s.code} value={s.code}>{s.code} {s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          )}
          {sousNode && (
            <Field label={t('stockG8.edition.sort_categorie')}>
              <Select value={cat || NONE} onValueChange={(v) => setCat(v === NONE ? '' : v)}>
                <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t('stockG8.edition.sortNone')}</SelectItem>
                  {sousNode.categories.map((c) => <SelectItem key={c.code} value={c.code}>{c.code} {c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field label={t('stockG8.edition.supplier')}>
            <Select value={f.supplierId || NONE} onValueChange={(v) => set('supplierId', v === NONE ? '' : v)}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t('stockG8.edition.sortNone')}</SelectItem>
                {(suppliersQ.data ?? []).map((s) => <SelectItem key={s.id} value={s.id}>{supplierName(s)}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t('stockG8.edition.brand')}>
            <Select value={f.brand || NONE} onValueChange={(v) => set('brand', v === NONE ? '' : v)}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t('stockG8.edition.sortNone')}</SelectItem>
                {(brandsQ.data ?? []).map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t('stockG8.edition.bin')}><Input className="w-28 font-mono" value={f.bin} onChange={(e) => set('bin', e.target.value)} /></Field>
          <Field label={t('stockG8.edition.search')}><Input className="w-56" value={f.search} onChange={(e) => set('search', e.target.value)} /></Field>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <Field label={t('stockG8.edition.types')}>
            <div className="flex h-9 items-center gap-3">
              {TYPES.map((ty) => (
                <label key={ty} className="flex items-center gap-1 text-sm">
                  <Checkbox checked={f.types.includes(ty)} onCheckedChange={(v) => set('types', v === true ? [...f.types, ty] : f.types.filter((x) => x !== ty))} /> {ty}
                </label>
              ))}
            </div>
          </Field>
          {triSelect('zero')}{triSelect('neg')}{triSelect('demo')}{triSelect('depot')}
          <Field label={`${t('stockG8.edition.period')} — ${t('stockG8.edition.from')}`}><Input type="date" value={f.from} onChange={(e) => set('from', e.target.value)} /></Field>
          <Field label={t('stockG8.edition.to')}><Input type="date" value={f.to} onChange={(e) => set('to', e.target.value)} /></Field>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          {needSnap && (
            <Field label={t('stockG8.edition.snapshot')}>
              <Select value={f.snapshotId || NONE} onValueChange={(v) => set('snapshotId', v === NONE ? '' : v)}>
                <SelectTrigger className="w-96"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t('stockG8.edition.snapshotNone')}</SelectItem>
                  {snaps.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {new Date(s.created_at).toLocaleString('fr-BE')} — {t(`stockG8.edition.kind_${s.kind === 'cloture' ? 'cloture' : s.kind === 'arrete' ? 'arrete' : 'copie'}`)}
                      {s.origin === 'auto' ? ` (${t('stockG8.edition.origin_auto')})` : ''} — {s.label ?? ''}
                      {s.reintegrated ? ` · ${t('stockG8.edition.reintegrated')}` : ''}{s.status === 'annule' ? ` · ${t('stockG8.edition.cancelled')}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          {view === 'copie' && <Button variant="outline" onClick={newCopy}><Camera /> {t('stockG8.edition.newCopy')}</Button>}
          {view === 'date' && <Field label={t('stockG8.edition.at')}><Input type="date" value={f.at} onChange={(e) => set('at', e.target.value)} /></Field>}
          {view === 'invendus' && <Field label={t('stockG8.edition.since')}><Input type="date" value={f.since} onChange={(e) => set('since', e.target.value)} /></Field>}
          {[0, 1, 2, 3].map((i) => (
            <Field key={i} label={fillVars(t('stockG8.edition.sortLevel'), { n: i + 1 })}>
              <Select value={levels[i] ?? NONE} onValueChange={(v) => setLevels((p) => { const n = [...p]; if (v === NONE) n.splice(i); else n[i] = v as SortKey; return n.filter(Boolean); })}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t('stockG8.edition.sortNone')}</SelectItem>
                  {SORT_KEYS.map((k) => <SelectItem key={k} value={k}>{t(`stockG8.edition.sort_${k}`)}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={show} disabled={dataQ.isFetching}>{dataQ.isFetching ? <Loader2 className="animate-spin" /> : <Eye />} {t('stockG8.edition.show')}</Button>
          <Button variant="outline" onClick={exportXls} disabled={!rows.length}><Download /> {t('stockG8.edition.export')}</Button>
          <Button variant="outline" onClick={() => doPrint(false)} disabled={!rows.length}><Printer /> {t('stockG8.edition.print')}</Button>
          <span className="mx-1 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('stockG8.edition.quick')}</span>
          {(['rayon', 'supplier', 'bin', 'reference'] as SortKey[]).map((k) => (
            <Button key={k} size="sm" variant="outline" onClick={() => doPrint(true, k)} disabled={!rows.length}>{t(`stockG8.edition.quick_${k}`)}</Button>
          ))}
        </div>
      </div>

      {dataQ.error && (
        <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">
          {dataQ.error instanceof TooManyRowsError ? t('stockG8.edition.tooMany') : errMsg(dataQ.error)}
        </p>
      )}

      {applied && !dataQ.isFetching && !dataQ.error && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <StatusBadge tone="info" label={t(`stockG8.edition.view_${applied.view}`)} />
          <span className="tabular-nums">{fillVars(t('stockG8.edition.count'), { n: rows.length.toLocaleString('fr-BE') })}</span>
          <span className="ml-auto font-data tabular-nums">{t('stockG8.edition.totalValue')} : <b>{eur(totalValue)}</b></span>
        </div>
      )}
      {applied && ['arrete', 'copie', 'date'].includes(applied.view) && <p className="text-[12px] text-muted-foreground">{t('stockG8.edition.pampNote')}</p>}

      {applied && (
        <div className="max-h-[60vh] overflow-auto rounded-md border border-border">
          <table className="w-full border-collapse font-data text-[13px]">
            <thead className="sticky top-0 bg-muted">
              <tr>{cols.map((c) => <th key={c.key + c.label} className={`whitespace-nowrap px-3 py-2 font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${c.right ? 'text-right' : 'text-left'}`}>{c.label}</th>)}</tr>
            </thead>
            <tbody>
              {dataQ.isFetching && <tr><td colSpan={cols.length} className="px-3 py-6 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></td></tr>}
              {!dataQ.isFetching && rows.length === 0 && <tr><td colSpan={cols.length} className="px-3 py-6 text-center text-muted-foreground">{t('stockG8.edition.empty')}</td></tr>}
              {!dataQ.isFetching && rows.slice(0, 2000).map((r) => (
                <tr key={r.article_id} className="border-b border-border last:border-0">
                  {cols.map((c, i) => <td key={c.key + c.label} className={`whitespace-nowrap px-3 py-1.5 ${c.right ? 'text-right tabular-nums' : ''} ${i === 0 ? 'font-mono text-[12px]' : ''}`}>{c.show(r)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <span className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
