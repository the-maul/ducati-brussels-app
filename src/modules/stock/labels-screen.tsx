/**
 * M5 / M2 — Étiquetage G8 (« Reprise étiquetage » + « Étiquetage par groupe », B12) :
 * par référence, par groupe (familles / fournisseur), à la réception, par date de modification
 * de l'article ou du PV, par casier ; quantité par défaut = stock réel ou 1 (réception : quantité
 * reçue) ; avec / sans prix, avec / sans code-barres, double étiquette au prix tarif ;
 * impression immédiate par les périphériques du poste (Zebra ZPL, sinon navigateur) OU
 * édition différée cumulée par poste (« Étiquettes en attente »).
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Loader2, Printer, Search, Tags, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { t, fillVars } from '@/lib/i18n';
import { useDeviceSetup } from '@/lib/devices/use-devices';
import { effectiveSaleTtc, useRoundSalePrices } from '@/lib/pricing';
import { listSuppliers, supplierName } from '@/modules/purchases/api';
import { RAYONS_SORTED } from '@/modules/articles/product-families';
import { listTemplates } from '@/modules/articles/labels/templates-api';
import { printTemplateLabels } from '@/modules/articles/labels/device-print';
import type { LabelTemplate, LabelTemplateConfig } from '@/modules/articles/labels/template-types';
import type { TemplateLabelItem } from '@/modules/articles/labels/render';
import {
  listLabelCandidates, enqueueLabels, listPendingLabels, finishPendingLabels, listRecentReceptions, loadLabelArticles,
  type LabelSource, type LabelCandidate,
} from './g8-api';
import { defaultLabelQty, groupPendingByWorkstation, labelItemsFor, type DefaultQtyMode, type PendingGroup } from './labels-rules';

const SOURCES: LabelSource[] = ['reference', 'groupe', 'reception', 'modif_article', 'modif_pv', 'casier'];
const NONE = '__none__';
const eur = (n: number | null) => (n == null ? '' : `${n.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`);
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e));

/** Format choisi, avec les surcharges « avec prix / avec code-barres » (comme l'impression en masse). */
function effectiveConfig(tpl: LabelTemplate, withPrice: boolean, withBarcode: boolean): LabelTemplateConfig {
  return {
    ...tpl.config,
    elements: tpl.config.elements.map((e) =>
      (e.key === 'price_ttc' || e.key === 'price_ht' || e.key === 'price_promo') && !withPrice ? { ...e, visible: false } : e),
    barcode: { ...tpl.config.barcode, visible: tpl.config.barcode.visible && withBarcode },
  };
}

export function LabelsScreen({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const devices = useDeviceSetup(companyId);
  const roundUp = useRoundSalePrices(companyId);
  const [source, setSource] = useState<LabelSource>('reference');
  const [search, setSearch] = useState(''); const [bin, setBin] = useState('');
  const [rayon, setRayon] = useState(''); const [sous, setSous] = useState(''); const [supplierId, setSupplierId] = useState('');
  const [reception, setReception] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [eco, setEco] = useState(false); const [onlyStock, setOnlyStock] = useState(false);
  const [withPrice, setWithPrice] = useState(true); const [withBarcode, setWithBarcode] = useState(true); const [withTarif, setWithTarif] = useState(false);
  const [qtyMode, setQtyMode] = useState<DefaultQtyMode>('stock');
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [rows, setRows] = useState<LabelCandidate[] | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const suppliersQ = useQuery({ queryKey: ['suppliers-filter', companyId], queryFn: () => listSuppliers(companyId, '', 500), staleTime: 300_000 });
  const receptionsQ = useQuery({ queryKey: ['label-receptions', companyId], queryFn: () => listRecentReceptions(companyId), enabled: source === 'reception' });
  const templatesQ = useQuery({ queryKey: ['label-templates', companyId], queryFn: () => listTemplates(companyId) });
  const pendingQ = useQuery({ queryKey: ['label-pending', companyId], queryFn: () => listPendingLabels(companyId) });
  const templates = templatesQ.data ?? [];
  const template = templates.find((x) => x.id === templateId) ?? templates.find((x) => x.is_default) ?? templates[0] ?? null;
  const rayonNode = RAYONS_SORTED.find((r) => r.code === rayon);
  const groups = useMemo(() => groupPendingByWorkstation(pendingQ.data ?? []), [pendingQ.data]);

  const filters = () => ({
    search: search || undefined, bin: bin || undefined, category: [rayon, sous].filter(Boolean).join('-') || undefined,
    supplier_id: supplierId || undefined, reception_id: reception || undefined, from: from || undefined, to: to || undefined,
    eco, only_stock: onlyStock,
  });

  const load = async () => {
    const f = filters();
    const ok = source === 'reception' ? !!f.reception_id
      : source === 'modif_article' || source === 'modif_pv' ? true
      : source === 'casier' ? !!f.bin
      : source === 'groupe' ? !!(f.category || f.supplier_id)
      : !!(f.search || f.category || f.supplier_id || f.bin);
    if (!ok) { toast.error(t('stockG8.labels.needCriteria')); return; }
    setBusy(true);
    try {
      const r = await listLabelCandidates(companyId, source, f);
      setRows(r); setQty({}); setUnchecked(new Set());
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  const qtyOf = (r: LabelCandidate) => qty[r.article_id] ?? defaultLabelQty(qtyMode, r.real_qty, source === 'reception' ? r.default_qty : null);
  const selected = (rows ?? []).filter((r) => !unchecked.has(r.article_id));
  const totalLabels = selected.reduce((s, r) => s + qtyOf(r) * (withTarif && r.price_tarif ? 2 : 1), 0);

  const buildItems = (arts: { a: LabelCandidate; qty: number; price: boolean; barcode: boolean; tarif: boolean }[]): TemplateLabelItem[] =>
    arts.flatMap(({ a, qty: q, price, barcode, tarif }) => labelItemsFor(a, q, a.price_ttc == null ? null : effectiveSaleTtc(a.price_ttc, roundUp), {
      withPrice: price, withBarcode: barcode, withTarif: tarif, storeName: t('app.name'), tarifLabel: t('stockG8.labels.tarifMark'),
    }));

  const print = async (items: TemplateLabelItem[], price: boolean, barcode: boolean): Promise<boolean> => {
    if (!template) { toast.error(t('stockG8.labels.noTemplate')); return false; }
    const r = await printTemplateLabels(devices.ctx, effectiveConfig(template, price, barcode), items);
    if (!r.ok) { toast.error(`${t(`devices.result.${r.code}`)}${r.detail ? ` (${r.detail})` : ''}`); return false; }
    toast.success(r.code === 'sent' ? t('devices.result.sent') : t('stockG8.labels.printed'));
    return true;
  };

  const printNow = async () => {
    setBusy(true);
    try { await print(buildItems(selected.map((a) => ({ a, qty: qtyOf(a), price: withPrice, barcode: withBarcode, tarif: withTarif }))), withPrice, withBarcode); }
    catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  const queue = async () => {
    setBusy(true);
    try {
      const nq = await enqueueLabels(companyId, selected.map((a) => ({ article_id: a.article_id, qty: qtyOf(a) })), {
        workstationId: devices.workstation?.id ?? null, source, sourceRef: source === 'reception' ? reception : null,
        withBarcode, withPrice, withTarif,
      });
      toast.success(fillVars(t('stockG8.labels.queued'), { n: nq }));
      qc.invalidateQueries({ queryKey: ['label-pending', companyId] });
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  const printGroup = async (g: PendingGroup) => {
    setBusy(true);
    try {
      const arts = await loadLabelArticles([...new Set(g.rows.map((r) => r.article_id))]);
      // Un appel d'impression par combinaison d'options (prix / code-barres).
      const combos = new Map<string, typeof g.rows>();
      for (const r of g.rows) { const k = `${r.with_price}-${r.with_barcode}`; combos.set(k, [...(combos.get(k) ?? []), r]); }
      for (const rs of combos.values()) {
        const items = buildItems(rs.filter((r) => arts.has(r.article_id)).map((r) => ({ a: arts.get(r.article_id)!, qty: r.qty, price: r.with_price, barcode: r.with_barcode, tarif: r.with_tarif })));
        if (!(await print(items, rs[0].with_price, rs[0].with_barcode))) return;
        await finishPendingLabels(companyId, rs.flatMap((r) => r.ids), 'imprime');
      }
      toast.success(t('stockG8.labels.pendingPrinted'));
      qc.invalidateQueries({ queryKey: ['label-pending', companyId] });
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  const removePending = async (ids: number[]) => {
    try {
      await finishPendingLabels(companyId, ids, 'retire');
      toast.success(t('stockG8.labels.removed'));
      qc.invalidateQueries({ queryKey: ['label-pending', companyId] });
    } catch (e) { toast.error(errMsg(e)); }
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1">
          {SOURCES.map((s) => <Button key={s} size="sm" variant={s === source ? 'default' : 'outline'} onClick={() => { setSource(s); setRows(null); }}>{t(`stockG8.labels.source_${s}`)}</Button>)}
        </div>

        <div className="space-y-3 rounded-md border border-border bg-card p-3">
          <div className="flex flex-wrap items-end gap-3">
            {source === 'reception' && (
              <Field label={t('stockG8.labels.reception')}>
                <Select value={reception || NONE} onValueChange={(v) => setReception(v === NONE ? '' : v)}>
                  <SelectTrigger className="w-80"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>{t('stockG8.labels.receptionNone')}</SelectItem>
                    {(receptionsQ.data ?? []).map((r) => (
                      <SelectItem key={r.id} value={r.id}>{r.number ?? '—'} · {r.receipt_date ? new Date(r.receipt_date).toLocaleDateString('fr-BE') : ''} {r.supplier_invoice_no ? `· ${r.supplier_invoice_no}` : ''}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
            {(source === 'modif_article' || source === 'modif_pv') && (
              <>
                <Field label={t('stockG8.labels.from')}><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
                <Field label={t('stockG8.labels.to')}><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
              </>
            )}
            <Field label={t('stockG8.labels.search')}><Input className="w-56" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') load(); }} /></Field>
            <Field label={t('stockG8.labels.bin')}><Input className="w-28 font-mono" value={bin} onChange={(e) => setBin(e.target.value)} /></Field>
            <Field label={t('stockG8.edition.rayon')}>
              <Select value={rayon || NONE} onValueChange={(v) => { setRayon(v === NONE ? '' : v); setSous(''); }}>
                <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t('stockG8.edition.sortNone')}</SelectItem>
                  {RAYONS_SORTED.map((r) => <SelectItem key={r.code} value={r.code}>{r.code} {r.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            {rayonNode && (
              <Field label={t('stockG8.edition.sort_sous_rayon')}>
                <Select value={sous || NONE} onValueChange={(v) => setSous(v === NONE ? '' : v)}>
                  <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>{t('stockG8.edition.sortNone')}</SelectItem>
                    {rayonNode.sousRayons.map((s) => <SelectItem key={s.code} value={s.code}>{s.code} {s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            )}
            <Field label={t('stockG8.labels.supplier')}>
              <Select value={supplierId || NONE} onValueChange={(v) => setSupplierId(v === NONE ? '' : v)}>
                <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t('stockG8.edition.sortNone')}</SelectItem>
                  {(suppliersQ.data ?? []).map((s) => <SelectItem key={s.id} value={s.id}>{supplierName(s)}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Button onClick={load} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <Search />} {t('stockG8.labels.load')}</Button>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-2"><Checkbox checked={eco} onCheckedChange={(v) => setEco(v === true)} /> {t('stockG8.labels.eco')}</label>
            <label className="flex items-center gap-2"><Checkbox checked={onlyStock} onCheckedChange={(v) => setOnlyStock(v === true)} /> {t('stockG8.labels.onlyStock')}</label>
            <label className="flex items-center gap-2"><Checkbox checked={withPrice} onCheckedChange={(v) => setWithPrice(v === true)} /> {t('stockG8.labels.withPrice')}</label>
            <label className="flex items-center gap-2"><Checkbox checked={withBarcode} onCheckedChange={(v) => setWithBarcode(v === true)} /> {t('stockG8.labels.withBarcode')}</label>
            <label className="flex items-center gap-2"><Checkbox checked={withTarif} onCheckedChange={(v) => setWithTarif(v === true)} /> {t('stockG8.labels.withTarif')}</label>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <Field label={t('stockG8.labels.defaultQty')}>
              <Select value={qtyMode} onValueChange={(v) => { setQtyMode(v as DefaultQtyMode); setQty({}); }}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="stock">{t('stockG8.labels.defaultQty_stock')}</SelectItem>
                  <SelectItem value="one">{t('stockG8.labels.defaultQty_one')}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={t('stockG8.labels.format')}>
              <Select value={template?.id ?? undefined} onValueChange={setTemplateId}>
                <SelectTrigger className="w-56"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{templates.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          </div>
        </div>

        {rows && (
          <>
            <div className="max-h-[55vh] overflow-auto rounded-md border border-border">
              <table className="w-full border-collapse font-data text-[13px]">
                <thead className="sticky top-0 bg-muted">
                  <tr>
                    <Th><Checkbox checked={unchecked.size === 0} onCheckedChange={(v) => setUnchecked(v === true ? new Set() : new Set(rows.map((r) => r.article_id)))} /></Th>
                    <Th>{t('stockG8.labels.colRef')}</Th><Th>{t('stockG8.labels.colDesignation')}</Th><Th>{t('stockG8.labels.colBin')}</Th>
                    <Th right>{t('stockG8.labels.colTtc')}</Th><Th right>{t('stockG8.labels.colHt')}</Th><Th right>{t('stockG8.labels.colTarif')}</Th>
                    <Th right>{t('stockG8.labels.colStock')}</Th>
                    {(source === 'modif_article' || source === 'modif_pv') && <Th>{t('stockG8.labels.colChanged')}</Th>}
                    <Th right>{t('stockG8.labels.colQty')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && <tr><td colSpan={10} className="px-3 py-6 text-center text-muted-foreground">{t('stockG8.labels.empty')}</td></tr>}
                  {rows.map((r) => (
                    <tr key={r.article_id} className="border-b border-border last:border-0">
                      <td className="px-3 py-1.5"><Checkbox checked={!unchecked.has(r.article_id)} onCheckedChange={(v) => setUnchecked((p) => { const n = new Set(p); if (v === true) n.delete(r.article_id); else n.add(r.article_id); return n; })} /></td>
                      <td className="px-3 py-1.5 font-mono text-[12px]">{r.reference}</td>
                      <td className="px-3 py-1.5">{r.designation}</td>
                      <td className="px-3 py-1.5 font-mono text-[12px]">{[r.bin_location, r.bin_location2].filter(Boolean).join(' / ')}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{eur(r.price_ttc == null ? null : effectiveSaleTtc(r.price_ttc, roundUp))}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{eur(r.price_ht)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{eur(r.price_tarif)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{r.real_qty}</td>
                      {(source === 'modif_article' || source === 'modif_pv') && <td className="px-3 py-1.5 tabular-nums">{r.changed_at ? new Date(r.changed_at).toLocaleDateString('fr-BE') : ''}</td>}
                      <td className="px-2 py-1 text-right">
                        <Input type="number" min="0" step="1" className="ml-auto h-7 w-20 text-right tabular-nums" value={qtyOf(r)}
                          onChange={(e) => setQty((p) => ({ ...p, [r.article_id]: Math.max(0, Math.round(Number(e.target.value) || 0)) }))} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span className="mr-auto text-[13px] tabular-nums text-muted-foreground">{fillVars(t('stockG8.count.total'), { n: selected.length })}</span>
              <Button variant="outline" onClick={queue} disabled={busy || selected.length === 0}><Clock /> {fillVars(t('stockG8.labels.queue'), { n: totalLabels })}</Button>
              <Button onClick={printNow} disabled={busy || selected.length === 0 || !template}><Printer /> {fillVars(t('stockG8.labels.printNow'), { n: totalLabels })}</Button>
            </div>
          </>
        )}
      </div>

      <aside className="space-y-3">
        <div className="rounded-md border border-border bg-card p-3">
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground"><Tags className="size-4" /> {t('stockG8.labels.pendingTitle')}</p>
          <p className="mt-1 text-[12px] text-muted-foreground">{t('stockG8.labels.pendingHelp')}</p>
          <p className="mt-1 text-[12px]">
            {devices.workstation ? fillVars(t('stockG8.labels.thisWorkstation'), { name: devices.workstation.name }) : t('stockG8.labels.noLocalWorkstation')}
          </p>
        </div>
        {pendingQ.isLoading && <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />}
        {!pendingQ.isLoading && groups.length === 0 && <p className="text-sm text-muted-foreground">{t('stockG8.labels.pendingEmpty')}</p>}
        {groups.map((g) => (
          <div key={g.workstation_id ?? 'none'} className={`rounded-md border bg-card p-3 ${g.workstation_id && g.workstation_id === devices.workstation?.id ? 'border-primary' : 'border-border'}`}>
            <div className="mb-2 flex items-center gap-2">
              <b className="text-sm">{g.workstation_name ?? t('stockG8.labels.noWorkstation')}</b>
              <Button size="sm" className="ml-auto" onClick={() => printGroup(g)} disabled={busy || !template}>
                <Printer className="size-4" /> {fillVars(t('stockG8.labels.printGroup'), { n: g.total })}
              </Button>
            </div>
            <table className="w-full border-collapse font-data text-[12px]">
              <thead><tr><Th>{t('stockG8.labels.colRef')}</Th><Th right>{t('stockG8.labels.colQty')}</Th><Th>{t('stockG8.labels.colFirst')}</Th><Th /></tr></thead>
              <tbody>
                {g.rows.map((r) => (
                  <tr key={`${r.article_id}-${r.ids[0]}`} className="border-b border-border last:border-0">
                    <td className="px-2 py-1">
                      <span className="font-mono">{r.reference}</span>
                      <span className="block text-muted-foreground">
                        {[r.with_price ? t('stockG8.labels.optPrice') : null, r.with_barcode ? t('stockG8.labels.optBarcode') : null, r.with_tarif ? t('stockG8.labels.optTarif') : null].filter(Boolean).join(' · ')}
                        {r.operators ? ` — ${r.operators}` : ''}
                      </span>
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">{r.qty}{r.lines > 1 ? ` (${r.lines})` : ''}</td>
                    <td className="px-2 py-1 tabular-nums">{new Date(r.first_at).toLocaleDateString('fr-BE')}</td>
                    <td className="px-1 py-1 text-right"><Button size="sm" variant="ghost" title={t('stockG8.labels.remove')} onClick={() => removePending(r.ids)}><Trash2 className="size-4" /></Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </aside>
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
function Th({ children, right }: { children?: React.ReactNode; right?: boolean }) {
  return <th className={`px-2 py-1.5 font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${right ? 'text-right' : 'text-left'}`}>{children}</th>;
}
