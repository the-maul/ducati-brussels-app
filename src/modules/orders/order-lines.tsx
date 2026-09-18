/**
 * Pièces d'une commande de pièces — carte « Ajouter et modifier les pièces d'une commande » (mission 02).
 *
 * Recherche d'article (réf., désignation, réf. fournisseur, code-barres) avec casier et disponible (B4),
 * ajout / modification / suppression de ligne tant que la commande est en brouillon, totaux HTVA,
 * rappel en direct du seuil du type (règles de Paramètres). Toutes les écritures passent par les
 * fonctions SQL part_order_line_save / part_order_line_delete (contrôle serveur + trace events).
 * Le stock n'est jamais modifié ici.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Search, Loader2, Pencil, Trash2, Plus, Save, X, CheckCircle2, AlertTriangle, Info, ArrowRightLeft, Ban,
  PackageCheck, PackageX, Barcode, Lock, type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusBadge, type StatusTone } from '@/components/status-badge';
import { useConfirm } from '@/components/confirm-provider';
import { t } from '@/lib/i18n';
import { listSuppliers, supplierName } from '@/modules/purchases/api';
import {
  searchOrderArticles, getPartOrderLinesDetail, saveOrderLine, deleteOrderLine,
  type OrderArticleHit, type PartOrder, type PartOrderLineDetail,
} from './api';
import { eur, kindLabel } from './order-ui';
import { orderTotals, thresholdProgress, validateLine, withDraftLine, lineHt, type ThresholdProgress } from './lines';
import type { OrderRule } from './thresholds';

const NONE = '__none';

const fmtQty = (n: number) => Number(n).toLocaleString('fr-BE', { maximumFractionDigits: 3 });
const toNum = (s: string) => {
  const v = Number(String(s).replace(',', '.').trim());
  return Number.isFinite(v) ? v : NaN;
};

type Draft = {
  id: string | null;
  articleId: string | null;
  reference: string | null;
  designation: string;
  supplierId: string | null;
  supplierName: string | null;
  qtyClient: string;
  qtyShop: string;
  unitPriceHt: string;
  vatRate: number;
  bin: string | null;
  availableQty: number | null;
};

export function OrderLinesEditor({
  order, rules, companyId, onChanged,
}: {
  order: PartOrder;
  rules: OrderRule[] | undefined;
  companyId: string;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const editable = order.dispatch_status === 'brouillon';
  const [draft, setDraft] = useState<Draft | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const linesQ = useQuery({ queryKey: ['part-order-lines', order.id], queryFn: () => getPartOrderLinesDetail(order.id) });
  const suppliersQ = useQuery({
    queryKey: ['order-suppliers', companyId],
    queryFn: () => listSuppliers(companyId, '', 300),
    enabled: editable,
    staleTime: 5 * 60_000,
  });
  const lines = linesQ.data ?? [];

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['part-order-lines', order.id] });
    onChanged();
  };

  const save = useMutation({
    mutationFn: (d: Draft) => saveOrderLine({
      orderId: order.id,
      lineId: d.id,
      articleId: d.id ? null : d.articleId,
      designation: d.designation.trim(),
      supplierId: d.supplierId,
      qtyClient: toNum(d.qtyClient),
      qtyShop: toNum(d.qtyShop),
      unitPriceHt: toNum(d.unitPriceHt),
      vatRate: d.vatRate,
    }),
    onSuccess: () => { setDraft(null); setFormError(null); refresh(); },
    onError: (e) => setFormError(e instanceof Error ? e.message : t('orders.errGeneric')),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteOrderLine(id),
    onSuccess: (_v, id) => { if (draft?.id === id) setDraft(null); refresh(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : t('orders.errGeneric')),
  });

  const pick = (a: OrderArticleHit) => {
    setFormError(null);
    setDraft({
      id: null, articleId: a.articleId, reference: a.reference, designation: a.designation,
      supplierId: a.supplierId, supplierName: a.supplierName,
      qtyClient: '1', qtyShop: '0', unitPriceHt: String(a.salePriceHt), vatRate: a.vatRate,
      bin: a.bin, availableQty: a.availableQty,
    });
  };

  const edit = (l: PartOrderLineDetail) => {
    setFormError(null);
    setDraft({
      id: l.id, articleId: l.articleId, reference: l.reference, designation: l.designation,
      supplierId: l.supplierId, supplierName: l.supplierName,
      qtyClient: String(l.qtyClient), qtyShop: String(l.qtyShop), unitPriceHt: String(l.unitPriceHt), vatRate: l.vatRate,
      bin: l.bin, availableQty: l.availableQty,
    });
  };

  const askDelete = async (l: PartOrderLineDetail) => {
    const ok = await confirm({
      variant: 'delete',
      title: t('orders.lineDeleteTitle'),
      message: t('orders.lineDeleteMsg').replace('{ref}', l.reference ?? l.designation),
    });
    if (ok) remove.mutate(l.id);
  };

  const submit = () => {
    if (!draft) return;
    const err = validateLine({
      qtyClient: toNum(draft.qtyClient), qtyShop: toNum(draft.qtyShop),
      unitPriceHt: toNum(draft.unitPriceHt), vatRate: draft.vatRate, designation: draft.designation,
    });
    if (err) { setFormError(t(`orders.lineErr_${err}`)); return; }
    save.mutate(draft);
  };

  // Totaux enregistrés et aperçu en direct (pièce en cours de saisie comprise)
  const saved = useMemo(() => lines.map((l) => ({ id: l.id, qtyClient: l.qtyClient, qtyShop: l.qtyShop, unitPriceHt: l.unitPriceHt, vatRate: l.vatRate })), [lines]);
  const totals = orderTotals(saved);
  const draftAmounts = draft
    ? { id: draft.id, qtyClient: toNum(draft.qtyClient) || 0, qtyShop: toNum(draft.qtyShop) || 0, unitPriceHt: toNum(draft.unitPriceHt) || 0, vatRate: draft.vatRate }
    : null;
  const live = orderTotals(withDraftLine(saved, draftAmounts));
  const progress = rules ? thresholdProgress(order.order_kind, live.totalHt, rules) : undefined;

  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="font-ui text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('orders.linesTitle')}</h2>
        {!editable && (
          <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground"><Lock className="size-3.5" /> {t('orders.linesLocked')}</span>
        )}
      </div>

      {editable && progress && (
        <ThresholdPanel progress={progress} total={live.totalHt} rules={rules ?? []} drafting={!!draft} />
      )}

      {editable && !draft && <ArticleSearch companyId={companyId} onPick={pick} />}

      {editable && draft && (
        <LineForm
          draft={draft}
          setDraft={(d) => { setFormError(null); setDraft(d); }}
          suppliers={(suppliersQ.data ?? []).map((s) => ({ id: s.id, name: supplierName(s) }))}
          error={formError}
          saving={save.isPending}
          onCancel={() => { setDraft(null); setFormError(null); }}
          onSubmit={submit}
        />
      )}

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted">
            <tr>
              <Th>{t('orders.lineRef')}</Th>
              <Th>{t('orders.lineDesignation')}</Th>
              <Th>{t('orders.colSupplier')}</Th>
              <Th>{t('orders.colBin')}</Th>
              <Th>{t('orders.colAvailable')}</Th>
              <Th className="text-right">{t('orders.lineQtyClient')}</Th>
              <Th className="text-right">{t('orders.lineQtyShop')}</Th>
              <Th className="text-right">{t('orders.colUnitHt')}</Th>
              <Th className="text-right">{t('orders.lineHt')}</Th>
              {editable && <Th className="text-right"><span className="sr-only">{t('orders.colActions')}</span></Th>}
            </tr>
          </thead>
          <tbody>
            {linesQ.isLoading && (
              <tr><td colSpan={editable ? 10 : 9} className="px-3 py-6 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></td></tr>
            )}
            {!linesQ.isLoading && lines.length === 0 && (
              <tr><td colSpan={editable ? 10 : 9} className="px-3 py-6 text-center text-muted-foreground">{t('orders.noLines')}</td></tr>
            )}
            {lines.map((l) => (
              <tr key={l.id} className={`border-b border-border last:border-0 ${draft?.id === l.id ? 'bg-accent' : ''}`}>
                <td className="px-3 py-2 font-mono text-[12px]">{l.reference ?? '—'}</td>
                <td className="px-3 py-2">{l.designation}</td>
                <td className="px-3 py-2">{l.supplierName ?? <span className="text-muted-foreground">—</span>}</td>
                <td className="px-3 py-2 font-mono text-[12px]">{[l.bin, l.bin2].filter(Boolean).join(' · ') || '—'}</td>
                <td className="px-3 py-2">
                  <StockBadge available={l.availableQty} real={l.realQty} reserved={l.reservedQty} onOrder={l.onOrderQty} />
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtQty(l.qtyClient)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtQty(l.qtyShop)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(l.unitPriceHt)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(l.lineHt)}</td>
                {editable && (
                  <td className="px-2 py-1 text-right whitespace-nowrap">
                    <Button variant="ghost" size="icon" aria-label={t('orders.lineEdit')} title={t('orders.lineEdit')} onClick={() => edit(l)} disabled={save.isPending || remove.isPending}>
                      <Pencil />
                    </Button>
                    <Button variant="ghost" size="icon" aria-label={t('orders.lineDelete')} title={t('orders.lineDelete')} onClick={() => askDelete(l)} disabled={save.isPending || remove.isPending}>
                      {remove.isPending && remove.variables === l.id ? <Loader2 className="animate-spin" /> : <Trash2 />}
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          {lines.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-border font-bold">
                <td colSpan={8} className="px-3 py-2 text-right">{t('orders.totalHt')}</td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(totals.totalHt)}</td>
                {editable && <td />}
              </tr>
              <tr>
                <td colSpan={8} className="px-3 py-1 text-right text-muted-foreground">{t('orders.totalVat')}</td>
                <td className="px-3 py-1 text-right tabular-nums text-muted-foreground">{eur(totals.totalVat)}</td>
                {editable && <td />}
              </tr>
              <tr>
                <td colSpan={8} className="px-3 py-1 text-right">{t('orders.totalTtc')}</td>
                <td className="px-3 py-1 text-right tabular-nums">{eur(totals.totalTtc)}</td>
                {editable && <td />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="mt-2 text-[12px] text-muted-foreground">
        {editable ? `${t('orders.totalsNote')} ${t('orders.linesHint')}` : t('orders.totalsNote')}
      </p>
    </section>
  );
}

/** Disponible (B4) : couleur + icône + libellé ; le détail réel / réservé / en commande en infobulle. */
function StockBadge({ available, real, reserved, onOrder }: { available: number | null; real: number | null; reserved: number | null; onOrder: number | null }) {
  if (available == null) return <span className="text-muted-foreground">—</span>;
  const ok = available > 0;
  const tip = t('orders.availableTip')
    .replace('{real}', fmtQty(real ?? 0)).replace('{reserved}', fmtQty(reserved ?? 0)).replace('{onOrder}', fmtQty(onOrder ?? 0));
  return (
    <span title={tip}>
      <StatusBadge
        tone={ok ? 'success' : 'danger'}
        icon={ok ? PackageCheck : PackageX}
        label={(ok ? t('orders.stockAvailable') : t('orders.stockOut')).replace('{n}', fmtQty(available))}
      />
    </span>
  );
}

/** Recherche d'article ; Entrée avec un seul résultat (scan de code-barres) l'ajoute directement. */
function ArticleSearch({ companyId, onPick }: { companyId: string; onPick: (a: OrderArticleHit) => void }) {
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { const h = setTimeout(() => setDebounced(term.trim()), 250); return () => clearTimeout(h); }, [term]);
  useEffect(() => { inputRef.current?.focus(); }, []);
  const q = useQuery({
    queryKey: ['order-article-search', companyId, debounced],
    queryFn: () => searchOrderArticles(companyId, debounced, 12),
    enabled: debounced.length >= 2,
  });
  const choose = (a: OrderArticleHit) => { onPick(a); setTerm(''); setDebounced(''); };

  const onKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const s = term.trim();
    if (s.length < 2) return;
    const hits = s === debounced && q.data ? q.data : await searchOrderArticles(companyId, s, 12).catch(() => []);
    const exact = hits.filter((h) => h.matchedBarcode || h.reference.toUpperCase() === s.toUpperCase());
    if (exact.length === 1) choose(exact[0]);
    else if (hits.length === 1) choose(hits[0]);
  };

  return (
    <div className="mb-3 rounded-md border border-border bg-card p-2">
      <label className="flex items-center gap-2 rounded border border-border bg-background px-2">
        <Search className="size-4 text-muted-foreground" />
        <input
          ref={inputRef}
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t('orders.articleSearch')}
          aria-label={t('orders.articleSearch')}
          className="w-full bg-transparent py-1.5 text-[13px] outline-none"
        />
        {q.isFetching && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      </label>
      {debounced.length < 2 ? (
        <p className="mt-1 px-1 text-[12px] text-muted-foreground">{t('orders.articleSearchHint')}</p>
      ) : (
        <ul className="mt-2 max-h-72 overflow-y-auto text-[13px]">
          {q.data?.length === 0 && <li className="px-2 py-1 text-muted-foreground">{t('orders.articleSearchNone')}</li>}
          {q.data?.map((a) => (
            <li key={a.articleId}>
              <button type="button" onClick={() => choose(a)} className="flex w-full items-center gap-3 rounded px-2 py-1.5 text-left hover:bg-accent">
                <Plus className="size-4 shrink-0 text-muted-foreground" />
                <span className="w-32 shrink-0 truncate font-mono text-[12px]">{a.reference}</span>
                <span className="min-w-0 flex-1 truncate">
                  {a.designation}
                  {a.matchedBarcode && (
                    <span className="ml-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Barcode className="size-3" /> {t('orders.barcodeMatch').replace('{code}', a.matchedBarcode)}
                    </span>
                  )}
                  {a.isLibrary && <span className="ml-2 text-[11px] text-muted-foreground">{t('orders.articleLibrary')}</span>}
                </span>
                <span className="hidden w-24 shrink-0 truncate font-mono text-[12px] text-muted-foreground sm:block">{a.bin ?? '—'}</span>
                <span className="shrink-0"><StockBadge available={a.availableQty} real={a.realQty} reserved={a.reservedQty} onOrder={a.onOrderQty} /></span>
                <span className="w-24 shrink-0 text-right tabular-nums">{eur(a.salePriceHt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Saisie d'une ligne : quantités client / magasin, fournisseur, prix HTVA. */
function LineForm({
  draft, setDraft, suppliers, error, saving, onCancel, onSubmit,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  suppliers: { id: string; name: string }[];
  error: string | null;
  saving: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  // Le fournisseur de la ligne peut ne pas figurer dans la liste (contact non typé fournisseur)
  const options = draft.supplierId && !suppliers.some((s) => s.id === draft.supplierId)
    ? [{ id: draft.supplierId, name: draft.supplierName ?? draft.supplierId }, ...suppliers]
    : suppliers;
  const total = lineHt({ qtyClient: toNum(draft.qtyClient) || 0, qtyShop: toNum(draft.qtyShop) || 0, unitPriceHt: toNum(draft.unitPriceHt) || 0 });
  const onEnter = (e: React.KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); onSubmit(); } };

  return (
    <div className="mb-3 rounded-md border border-border bg-card p-3 text-[13px]">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('orders.lineEditing')}</span>
        <span className="font-mono text-[12px]">{draft.reference ?? '—'}</span>
        {draft.bin && <span className="font-mono text-[12px] text-muted-foreground">{t('orders.colBin')} {draft.bin}</span>}
        {draft.availableQty != null && (
          <StatusBadge
            tone={draft.availableQty > 0 ? 'success' : 'danger'}
            icon={draft.availableQty > 0 ? PackageCheck : PackageX}
            label={(draft.availableQty > 0 ? t('orders.stockAvailable') : t('orders.stockOut')).replace('{n}', fmtQty(draft.availableQty))}
          />
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <Field label={t('orders.lineDesignation')} className="lg:col-span-2">
          <Input value={draft.designation} onChange={(e) => setDraft({ ...draft, designation: e.target.value })} onKeyDown={onEnter} className="h-9" />
        </Field>
        <Field label={t('orders.lineQtyClient')}>
          <Input inputMode="decimal" value={draft.qtyClient} onChange={(e) => setDraft({ ...draft, qtyClient: e.target.value })} onKeyDown={onEnter} className="h-9 text-right tabular-nums" autoFocus />
        </Field>
        <Field label={t('orders.lineQtyShop')}>
          <Input inputMode="decimal" value={draft.qtyShop} onChange={(e) => setDraft({ ...draft, qtyShop: e.target.value })} onKeyDown={onEnter} className="h-9 text-right tabular-nums" />
        </Field>
        <Field label={t('orders.colUnitHt')}>
          <Input inputMode="decimal" value={draft.unitPriceHt} onChange={(e) => setDraft({ ...draft, unitPriceHt: e.target.value })} onKeyDown={onEnter} className="h-9 text-right tabular-nums" />
        </Field>
        <Field label={t('orders.lineHt')}>
          <div className="flex h-9 items-center justify-end rounded-md border border-border bg-muted px-3 font-bold tabular-nums">{eur(total)}</div>
        </Field>
        <Field label={t('orders.colSupplier')} className="lg:col-span-2">
          <Select
            value={draft.supplierId ?? NONE}
            onValueChange={(v) => {
              const s = options.find((o) => o.id === v);
              setDraft({ ...draft, supplierId: v === NONE ? null : v, supplierName: s?.name ?? null });
            }}
          >
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t('orders.noSupplier')}</SelectItem>
              {options.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
      </div>
      {error && (
        <p className="mt-3 flex items-center gap-2 rounded-md bg-danger-bg px-3 py-2 text-danger">
          <AlertTriangle className="size-4 shrink-0" /> {error}
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <Button variant="outline" onClick={onCancel} disabled={saving}><X /> {t('orders.lineCancel')}</Button>
        <Button onClick={onSubmit} disabled={saving}>
          {saving ? <Loader2 className="animate-spin" /> : draft.id ? <Save /> : <Plus />} {draft.id ? t('orders.lineSave') : t('orders.lineAdd')}
        </Button>
      </div>
    </div>
  );
}

const THRESHOLD_META: Record<string, { tone: StatusTone; icon: LucideIcon }> = {
  met: { tone: 'success', icon: CheckCircle2 },
  missing: { tone: 'danger', icon: AlertTriangle },
  fallback: { tone: 'warning', icon: ArrowRightLeft },
  none: { tone: 'info', icon: Info },
  disabled: { tone: 'danger', icon: Ban },
  unset: { tone: 'info', icon: Info },
};

const BAR_CLASS: Record<string, string> = {
  met: 'bg-success', missing: 'bg-danger', fallback: 'bg-warning', none: 'bg-info', disabled: 'bg-danger', unset: 'bg-info',
};

/** Rappel en direct du seuil du type : minimum, reste à commander, bascule vers le type de repli. */
function ThresholdPanel({ progress: p, total, rules, drafting }: { progress: ThresholdProgress; total: number; rules: OrderRule[]; drafting: boolean }) {
  const state = !p.configured ? 'unset'
    : p.disabled ? 'disabled'
    : !p.met ? 'missing'
    : p.fellBack ? 'fallback'
    : p.kindMin == null ? 'none'
    : 'met';
  const meta = THRESHOLD_META[state];
  const kind = kindLabel(p.kind, rules);
  const to = kindLabel(p.effectiveKind, rules);
  const label = state === 'fallback' ? t('orders.thrStatus_fallback').replace('{kind}', to) : t(`orders.thrStatus_${state}`);

  const sentences: string[] = [];
  if (state === 'unset') sentences.push(t('orders.ruleNotConfigured'));
  else if (state === 'disabled') sentences.push(t('orders.ruleDisabled'));
  else {
    if (p.fellBack && p.kindMin != null) {
      sentences.push(t('orders.thrFallback')
        .replace('{min}', eur(p.kindMin)).replace(/\{kind\}/g, kind).replace('{to}', to).replace('{rest}', eur(p.kindRemaining)));
    }
    if (p.min == null) sentences.push(t('orders.thrNoMin').replace('{total}', eur(total)));
    else if (p.met) sentences.push(t('orders.thrMet').replace('{min}', eur(p.min)).replace('{total}', eur(total)));
    else sentences.push(t('orders.thrMissing').replace('{rest}', eur(p.remaining)).replace('{min}', eur(p.min)).replace('{total}', eur(total)));
    if (p.surchargePct > 0) sentences.push(t('orders.thrSurcharge').replace('{pct}', String(p.surchargePct).replace('.', ',')));
  }
  // Barre : avancement vers le minimum qui s'applique (type de repli compris)
  const barMin = p.min ?? p.kindMin;
  const percent = barMin ? Math.max(0, Math.min(100, Math.floor((total / barMin) * 100))) : 100;

  return (
    <div className="mb-3 rounded-md border border-border bg-card p-3 text-[13px]">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('orders.thresholdTitle')}</span>
        <StatusBadge tone={meta.tone} icon={meta.icon} label={label} />
      </div>
      {barMin != null && (
        <div className="mb-2 h-2 w-full overflow-hidden rounded-sm bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
          <div className={`h-full ${BAR_CLASS[state]}`} style={{ width: `${percent}%` }} />
        </div>
      )}
      <ul className="space-y-0.5">
        {sentences.map((s) => <li key={s} className="tabular-nums">{s}</li>)}
      </ul>
      {drafting && <p className="mt-1 text-[12px] text-muted-foreground">{t('orders.thresholdLive')}</p>}
    </div>
  );
}

function Field({ label, className = '', children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`space-y-1 ${className}`}>
      <span className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
