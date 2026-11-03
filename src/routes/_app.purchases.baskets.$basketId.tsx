/**
 * Achats → Commandes fournisseur → un panier (mission 09, cartes 1, 2, 4).
 * Panier ouvert : lignes (minimax, atelier, comptoir, site, manuel), quantités modifiables,
 * « Remplir depuis les minimums », « Enlever ce qui est déjà en stock », ajout d'une pièce,
 * règles du type en direct (minimum 250 € HTVA standard ; urgente une par jour, +12 %), « Commander ».
 * À la validation : date + opérateur, statut « Commandée », fichier ExportDucati.xls généré,
 * téléchargé et conservé en GED ; champ « Numéro de commande (DCS) » vide, à saisir ensuite.
 * Le stock ne bouge pas ici (B7) : il bougera à la réception (Achats & réceptions).
 */
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowLeft, Ban, CheckCircle2, FileDown, Info, Loader2, PackageCheck, Plus, RefreshCw, Save, Search, Trash2, Truck, Boxes,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth/auth-context';
import { useCanWrite } from '@/lib/auth/use-access';
import { t, fillVars, pageTitle } from '@/lib/i18n';
import { AttachmentsPanel } from '@/modules/documents/attachments-panel';
import { getOrderRules, type OrderArticleHit } from '@/modules/orders/api';
import {
  basketTotals, canEditLines, canSetDcsNumber, clientSalePriceHt, lineAmountHt, lineUnitCost, type BasketLine,
} from '@/modules/purchases/basket';
import {
  addBasketLinesTo, cancelBasket, checkBasketRules, fillMinimax, getBasket, getBasketLines, orderBasket, receiveBasket,
  removeBasketInStock, searchBasketArticles, setBasketDcsNumber, setBasketLineQty,
} from '@/modules/purchases/basket-api';
import { downloadExport, storedExportUrl, storeExport, BASKET_GED_ENTITY } from '@/modules/purchases/basket-export';
import {
  BasketKindBadge, BasketStatusBadge, basketRuleSentences, eur, fmtDateTime, fmtQty, originLabel,
} from '@/modules/purchases/basket-ui';

export const Route = createFileRoute('/_app/purchases/baskets/$basketId')({
  head: () => ({ meta: [{ title: pageTitle('purchasesBasket') }] }),
  component: BasketPage,
});

const toNum = (s: string) => {
  const v = Number(String(s).replace(',', '.').trim());
  return Number.isFinite(v) ? v : 0;
};

function BasketPage() {
  const { basketId } = Route.useParams();
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const canWrite = useCanWrite();
  const [confirmOrder, setConfirmOrder] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [dcs, setDcs] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const basketQ = useQuery({ queryKey: ['supplier-basket', basketId], queryFn: () => getBasket(basketId) });
  const linesQ = useQuery({ queryKey: ['supplier-basket-lines', basketId], queryFn: () => getBasketLines(basketId) });
  const checkQ = useQuery({ queryKey: ['supplier-basket-check', basketId, linesQ.dataUpdatedAt], queryFn: () => checkBasketRules(basketId), enabled: !!basketQ.data });
  const rulesQ = useQuery({ queryKey: ['order-rules', activeCompanyId], queryFn: () => getOrderRules(activeCompanyId!), enabled: !!activeCompanyId });

  const basket = basketQ.data;
  const lines = linesQ.data ?? [];
  const rules = rulesQ.data ?? [];
  const totals = useMemo(() => basketTotals(lines), [lines]);
  const editable = !!basket && canEditLines(basket.status) && canWrite;
  const surcharge = basket ? (basket.status === 'ouvert' ? (checkQ.data?.surcharge_pct ?? 0) : basket.surcharge_pct) : 0;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['supplier-basket', basketId] });
    qc.invalidateQueries({ queryKey: ['supplier-basket-lines', basketId] });
    qc.invalidateQueries({ queryKey: ['supplier-baskets', activeCompanyId] });
  };

  const minimax = useMutation({
    meta: { success: false },
    mutationFn: () => fillMinimax(activeCompanyId!, basketId),
    onSuccess: (r) => { refresh(); setFileError(null); setInfo(fillVars(t('basket.minimaxDone'), { added: r.added, merged: r.merged, removed: r.removed })); },
  });
  const removeStock = useMutation({
    meta: { success: false },
    mutationFn: () => removeBasketInStock(basketId),
    onSuccess: (r) => { refresh(); setInfo(fillVars(t('basket.removedInStock'), { n: r.removed })); },
  });
  const setQty = useMutation({
    meta: { success: false },
    mutationFn: ({ id, qty }: { id: string; qty: number }) => setBasketLineQty(id, qty),
    onSuccess: refresh,
  });
  const order = useMutation({
    meta: { success: false },
    mutationFn: async () => {
      const b = await orderBasket(basketId);
      const current = await getBasketLines(basketId);
      const at = b.ordered_at ? new Date(b.ordered_at) : new Date();
      downloadExport(b.kind, current, at);
      try {
        await storeExport({ companyId: activeCompanyId!, basketId, kind: b.kind, label: b.label, lines: current, orderedAt: at });
      } catch (e) {
        setFileError(e instanceof Error ? e.message : String(e));
      }
      return b;
    },
    onSuccess: () => { refresh(); setInfo(t('basket.ordered')); },
  });
  const regenerate = useMutation({
    meta: { success: t('basket.fileStored') },
    mutationFn: async () => {
      if (!basket) return;
      const at = basket.ordered_at ? new Date(basket.ordered_at) : new Date();
      await storeExport({ companyId: activeCompanyId!, basketId, kind: basket.kind, label: basket.label, lines, orderedAt: at });
    },
    onSuccess: () => { setFileError(null); refresh(); qc.invalidateQueries({ queryKey: ['attachments', BASKET_GED_ENTITY, basketId] }); },
  });
  const saveDcs = useMutation({
    meta: { success: t('basket.dcsSaved') },
    mutationFn: () => setBasketDcsNumber(basketId, dcs ?? ''),
    onSuccess: () => { setDcs(null); refresh(); },
  });
  const receive = useMutation({ meta: { success: t('basket.received') }, mutationFn: () => receiveBasket(basketId), onSuccess: refresh });
  const cancel = useMutation({
    meta: { success: t('basket.cancelled') },
    mutationFn: () => cancelBasket(basketId),
    onSuccess: () => { refresh(); navigate({ to: '/purchases/baskets' }); },
  });
  const openStored = useMutation({
    meta: { success: false },
    mutationFn: async (path: string) => { const url = await storedExportUrl(path); if (url) window.open(url, '_blank', 'noopener'); },
  });

  const [info, setInfo] = useState<string | null>(null);

  if (basketQ.isLoading || !basket) {
    return <div className="grid place-items-center py-16"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  }

  const chk = checkQ.data;
  const ordered = basket.status === 'commande' || basket.status === 'recu';
  const orderedAt = basket.ordered_at ? new Date(basket.ordered_at) : new Date();

  return (
    <>
      <PageHeader
        title={basket.label || t('basket.title')}
        breadcrumbs={[{ label: t('nav.purchases'), to: '/purchases' }, { label: t('basket.title'), to: '/purchases/baskets' }, { label: basket.label || '—' }]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => navigate({ to: '/purchases/baskets' })}><ArrowLeft /> {t('basket.back')}</Button>
            {editable && (
              <>
                <Button variant="outline" disabled={minimax.isPending} onClick={() => minimax.mutate()}>
                  {minimax.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />} {t('basket.fillMinimax')}
                </Button>
                <Button variant="outline" disabled={removeStock.isPending || lines.length === 0} onClick={() => removeStock.mutate()}>
                  {removeStock.isPending ? <Loader2 className="animate-spin" /> : <Boxes />} {t('basket.removeInStock')}
                </Button>
                <Button variant="outline" onClick={() => setAddOpen(true)}><Plus /> {t('basket.addLine')}</Button>
                <Button variant="outline" onClick={() => setConfirmCancel(true)}><Ban /> {t('basket.cancel')}</Button>
                <Button disabled={order.isPending || !chk?.ok} onClick={() => setConfirmOrder(true)}>
                  {order.isPending ? <Loader2 className="animate-spin" /> : <Truck />} {t('basket.order')}
                </Button>
              </>
            )}
            {ordered && (
              <>
                <Button variant="outline" disabled={lines.length === 0} onClick={() => downloadExport(basket.kind, lines, orderedAt)}>
                  <FileDown /> {t('basket.download')}
                </Button>
                {canWrite && (
                  <Button variant="outline" disabled={regenerate.isPending} onClick={() => regenerate.mutate()}>
                    {regenerate.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />} {t('basket.regenerate')}
                  </Button>
                )}
                {basket.status === 'commande' && canWrite && (
                  <Button variant="outline" disabled={receive.isPending} onClick={() => receive.mutate()}><PackageCheck /> {t('basket.receive')}</Button>
                )}
              </>
            )}
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <BasketKindBadge kind={basket.kind} />
        <BasketStatusBadge status={basket.status} />
        {ordered && (
          <span className="font-data text-[13px] text-muted-foreground">{fillVars(t('basket.orderedAt'), { date: fmtDateTime(basket.ordered_at) })}</span>
        )}
      </div>

      {info && <p className="mb-3 flex items-center gap-2 rounded-md bg-success-bg px-3 py-2 text-[13px] text-success"><CheckCircle2 className="size-4 shrink-0" /> {info}</p>}
      {fileError && (
        <p className="mb-3 flex items-center gap-2 rounded-md bg-warning-bg px-3 py-2 text-[13px] text-warning">
          <AlertTriangle className="size-4 shrink-0" /> {fillVars(t('basket.fileError'), { msg: fileError })}
        </p>
      )}

      <div className="mb-4 grid gap-3 md:grid-cols-2">
        {/* Règles du type (Paramètres) + contrôle serveur en direct */}
        <section className="rounded-md border border-border p-3 text-[13px]">
          <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('basket.rulesTitle')}</p>
          <ul className="mb-2 list-disc pl-5 text-muted-foreground">
            {basketRuleSentences(basket.kind, rules).map((s) => <li key={s}>{s}</li>)}
          </ul>
          {basket.status === 'ouvert' && chk && (
            <div className="space-y-1">
              {chk.ok
                ? <StatusBadge tone="success" icon={CheckCircle2} label={t('basket.ruleOk')} />
                : <StatusBadge tone="warning" icon={AlertTriangle} label={t('basket.ruleKo')} />}
              {chk.errors.map((e, i) => <p key={i} className="text-danger">{e.message}</p>)}
              {chk.notices.map((e, i) => <p key={i} className="flex items-start gap-1 text-info"><Info className="mt-0.5 size-3.5 shrink-0" /> {e.message}</p>)}
            </div>
          )}
          <p className="mt-2 text-[12px] text-muted-foreground">{t('basket.noStockMove')}</p>
        </section>

        {/* Numéro DCS + fichier conservé */}
        <section className="rounded-md border border-border p-3 text-[13px]">
          <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('basket.dcsNumber')}</p>
          {canSetDcsNumber(basket.status) ? (
            <div className="flex flex-wrap items-center gap-2">
              <Input className="h-9 w-56 font-mono" value={dcs ?? basket.dcs_order_number ?? ''} placeholder={t('basket.dcsPlaceholder')}
                onChange={(e) => setDcs(e.target.value)} disabled={!canWrite} />
              <Button size="sm" disabled={dcs === null || saveDcs.isPending || !canWrite} onClick={() => saveDcs.mutate()}>
                {saveDcs.isPending ? <Loader2 className="animate-spin" /> : <Save />} {t('basket.dcsSave')}
              </Button>
              {!basket.dcs_order_number && <StatusBadge tone="warning" icon={AlertTriangle} label={t('basket.dcsMissing')} />}
            </div>
          ) : (
            <p className="text-muted-foreground">{t('basket.dcsHint')}</p>
          )}
          <p className="mt-3 mb-1 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('basket.storedFile')}</p>
          {basket.file_path ? (
            <Button size="sm" variant="outline" disabled={openStored.isPending} onClick={() => openStored.mutate(basket.file_path!)}>
              <FileDown /> {basket.file_path.split('/').pop()?.replace(/^\d+_/, '')}
            </Button>
          ) : (
            <p className="text-muted-foreground">{ordered ? t('basket.noFile') : t('basket.fileAtOrder')}</p>
          )}
        </section>
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted">
            <tr>
              <Th>{t('basket.colRef')}</Th><Th>{t('basket.colDesignation')}</Th><Th>{t('basket.colOrigin')}</Th><Th>{t('basket.colClient')}</Th>
              <Th className="text-right">{t('basket.colQty')}</Th><Th className="text-right">{t('basket.colStock')}</Th>
              <Th className="text-right">{t('basket.colPa')}</Th><Th className="text-right">{t('basket.colPvClient')}</Th>
              <Th className="text-right">{t('basket.colAmount')}</Th>
              {editable && <Th className="w-10" />}
            </tr>
          </thead>
          <tbody>
            {linesQ.isLoading && <tr><td colSpan={10} className="px-3 py-6 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></td></tr>}
            {linesQ.data && lines.length === 0 && <tr><td colSpan={10} className="px-3 py-6 text-center text-muted-foreground">{t('basket.emptyLines')}</td></tr>}
            {lines.map((l) => {
              const unit = lineUnitCost(l);
              const pv = clientSalePriceHt(l, surcharge);
              return (
                <tr key={l.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 font-mono text-[12px]">
                    <Link to="/parts/$articleId" params={{ articleId: l.articleId }} className="text-info underline">{l.reference}</Link>
                  </td>
                  <td className="px-3 py-2">{l.designation}</td>
                  <td className="px-3 py-2">
                    {originLabel(l.origin)}
                    {l.originRef && <span className="ml-1 font-mono text-[12px] text-muted-foreground">{l.originRef}</span>}
                  </td>
                  <td className="px-3 py-2">
                    {l.contactId
                      ? <Link to="/clients/$contactId" params={{ contactId: l.contactId }} className="text-info underline">{l.contactLabel ?? '—'}</Link>
                      : <span className="text-muted-foreground">{t('basket.forStock')}</span>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {editable ? <QtyCell value={l.qty} onCommit={(q) => setQty.mutate({ id: l.id, qty: q })} /> : <span className="tabular-nums">{fmtQty(l.qty)}</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmtQty(l.realQtyNow)}
                    {l.realQtyNow >= l.qty && l.qty > 0 && <span className="ml-1 text-[11px] text-warning">{t('basket.covered')}</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {l.purchasePrice != null && l.purchasePrice > 0 ? eur(l.purchasePrice) : <span className="text-warning">{t('proposal.paUnknown')}</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {pv != null ? eur(pv) : '—'}
                    {l.contactId && surcharge > 0 && <span className="ml-1 text-[11px] text-muted-foreground">+{String(surcharge).replace('.', ',')} %</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {eur(lineAmountHt(l))}
                    {unit.fromSalePrice && <span className="ml-1 text-[11px] text-warning">{t('basket.atSalePrice')}</span>}
                  </td>
                  {editable && (
                    <td className="px-3 py-2 text-right">
                      <Button size="icon" variant="ghost" aria-label={t('action.delete')} onClick={() => setQty.mutate({ id: l.id, qty: 0 })}><Trash2 /></Button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 font-data text-[13px]">
        <span className="tabular-nums text-muted-foreground">{fillVars(t('basket.totals'), { n: totals.lineCount, qty: fmtQty(totals.qty), total: eur(ordered ? basket.total_ht : totals.totalHt) })}</span>
        {totals.noPa > 0 && <span className="flex items-center gap-1 text-warning"><AlertTriangle className="size-3.5" /> {fillVars(t('basket.noPa'), { n: totals.noPa })}</span>}
        {!editable && basket.status !== 'ouvert' && <span className="text-muted-foreground">{t('basket.linesLocked')}</span>}
      </div>

      <div className="mt-6">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('ged.title')}</p>
        <AttachmentsPanel companyId={activeCompanyId!} entityType={BASKET_GED_ENTITY} entityId={basketId} />
      </div>

      {addOpen && activeCompanyId && (
        <AddLineDialog companyId={activeCompanyId} onClose={() => setAddOpen(false)} onAdd={async (hit, qty) => {
          const res = await addBasketLinesTo(basketId, [{ article_id: hit.articleId, qty, origin: 'manuel' }]);
          for (const m of res.substituted ?? []) toast.warning(m);
          refresh();
        }} />
      )}

      <AlertDialog open={confirmOrder} onOpenChange={setConfirmOrder}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('basket.orderConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-[13px]">
                <p>{fillVars(t('basket.orderConfirmText'), { n: totals.lineCount, total: eur(chk?.total_ht ?? totals.totalHt) })}</p>
                {basket.kind === 'urgente' && <p>{fillVars(t('basket.orderConfirmUrgente'), { pct: String(chk?.surcharge_pct ?? 0).replace('.', ',') })}</p>}
                <p>{t('basket.orderConfirmFile')}</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('action.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmOrder(false); order.mutate(); }}>{t('basket.order')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('basket.cancelConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('basket.cancelConfirmText')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('action.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmCancel(false); cancel.mutate(); }}>{t('basket.cancel')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function QtyCell({ value, onCommit }: { value: number; onCommit: (q: number) => void }) {
  const [text, setText] = useState(String(value).replace('.', ','));
  useEffect(() => { setText(String(value).replace('.', ',')); }, [value]);
  const commit = () => { const q = toNum(text); if (q !== value) onCommit(q); };
  return (
    <Input className="ml-auto h-8 w-20 text-right tabular-nums" inputMode="decimal" value={text}
      onChange={(e) => setText(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }} />
  );
}

function AddLineDialog({ companyId, onClose, onAdd }: { companyId: string; onClose: () => void; onAdd: (hit: OrderArticleHit, qty: number) => Promise<void> }) {
  const [term, setTerm] = useState('');
  const [hit, setHit] = useState<OrderArticleHit | null>(null);
  const [qty, setQty] = useState('1');
  const searchQ = useQuery({ queryKey: ['basket-article-search', companyId, term], queryFn: () => searchBasketArticles(companyId, term), enabled: term.trim().length >= 2 });
  const add = useMutation({
    meta: { success: t('basket.lineAdded') },
    mutationFn: () => onAdd(hit!, toNum(qty)),
    onSuccess: onClose,
  });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('basket.manualTitle')}</DialogTitle>
          <DialogDescription>{t('basket.manualHint')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-2.5 size-4 text-muted-foreground" />
            <Input className="pl-8" autoFocus value={term} placeholder={t('basket.manualSearch')} onChange={(e) => { setTerm(e.target.value); setHit(null); }} />
          </div>
          {!hit && term.trim().length >= 2 && (
            <ul className="max-h-60 divide-y divide-border overflow-y-auto rounded-md border border-border font-data text-[13px]">
              {searchQ.isLoading && <li className="px-3 py-2 text-muted-foreground"><Loader2 className="size-4 animate-spin" /></li>}
              {searchQ.data?.length === 0 && <li className="px-3 py-2 text-muted-foreground">{t('basket.noResults')}</li>}
              {searchQ.data?.map((h) => (
                <li key={h.articleId}>
                  <button type="button" className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-accent" onClick={() => setHit(h)}>
                    <span><span className="mr-2 font-mono text-[12px] text-muted-foreground">{h.reference}</span>{h.designation}</span>
                    <span className="tabular-nums text-muted-foreground">{t('basket.colStock')} {fmtQty(h.realQty)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {hit && (
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-border px-3 py-2 text-[13px]">
              <span><span className="mr-2 font-mono text-[12px] text-muted-foreground">{hit.reference}</span>{hit.designation}</span>
              <label className="ml-auto flex items-center gap-2">
                <span className="text-muted-foreground">{t('basket.colQty')}</span>
                <Input className="h-8 w-20 text-right tabular-nums" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
              </label>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button disabled={!hit || toNum(qty) <= 0 || add.isPending} onClick={() => add.mutate()}>
            {add.isPending ? <Loader2 className="animate-spin" /> : <Plus />} {t('basket.manualAdd')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
