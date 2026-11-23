import { createFileRoute, useNavigate, Link } from '@tanstack/react-router';
import { type ReactNode, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, FileDown, Tag, Users, Truck, Send, CircleSlash, ClipboardList, History, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { getPurchaseFull, listSuppliers, supplierName } from '@/modules/purchases/api';
import { downloadDcs } from '@/modules/purchases/dcs-export';
import { CustomerLabelDialog } from '@/modules/purchases/customer-label-dialog';
import { PurchaseDestinations } from '@/modules/purchases/purchase-destinations';
import { PurchaseEditor } from '@/modules/purchases/purchase-editor';
import { PartPathPanel } from '@/modules/purchases/part-path-ui';
import { DestinationLabelsButton } from '@/modules/purchases/destination-labels';
import { CustomerInfosDialog, useReceiptCustomerInfos } from '@/modules/purchases/customer-infos-dialog';
import { getOrderFollow, logOrderSend, closeOrderRemainder, proposalToOrder } from '@/modules/purchases/g8-api';
import { purchaseStatusTone, SEND_CHANNELS, type SendChannel } from '@/modules/purchases/g8-rules';
import { openPurchasePdf, PRINTABLE_PURCHASE_TYPES } from '@/modules/purchases/purchase-print-pdf';
import { useAuth } from '@/lib/auth/auth-context';
import { useCanWrite } from '@/lib/auth/use-access';
import { t, fillVars, pageTitle } from '@/lib/i18n';

export const Route = createFileRoute('/_app/purchases/$orderId')({
  head: () => ({ meta: [{ title: pageTitle('purchase') }] }),
  // `infos=1` : ouvrir « Infos commandes client » à l'arrivée (juste après la validation d'une réception, comme G8).
  validateSearch: (s: Record<string, unknown>): { infos?: number } => (s.infos ? { infos: 1 } : {}),
  component: PurchaseView,
});

const eur = (n: number) => `${(Math.round(Number(n) * 100) / 100).toFixed(2).replace('.', ',')} €`;
const qtyFmt = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',');

type LineExtra = { source_line_id?: string | null; landed_unit_cost?: number | null; contact_id?: string | null; origin_ref?: string | null };
type OrderExtra = { order_type?: string | null; merged_into_id?: string | null };

function PurchaseView() {
  const { orderId } = Route.useParams();
  const { infos } = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const canWrite = useCanWrite();
  const { activeCompanyId, activeCompany } = useAuth();
  const { data, isLoading } = useQuery({ queryKey: ['purchase-full', orderId], queryFn: () => getPurchaseFull(orderId) });
  const { data: suppliers } = useQuery({ queryKey: ['suppliers-map', activeCompanyId], queryFn: () => listSuppliers(activeCompanyId!, '', 500), enabled: !!activeCompanyId });
  const isOrderish = data?.order.doc_type === 'CMD' || data?.order.doc_type === 'PCF';
  const follow = useQuery({ queryKey: ['purchase-follow', orderId], queryFn: () => getOrderFollow(orderId), enabled: !!data && data.order.status !== 'brouillon' });
  const isRec = data?.order.doc_type === 'REC' && data.order.status === 'recue';
  const infosQ = useReceiptCustomerInfos(isRec ? orderId : null);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [infosOpen, setInfosOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState(false);

  // G8 : la fenêtre « Infos commandes client » s'ouvre seule après la réception s'il y a des clients en attente.
  useEffect(() => { if (infos && (infosQ.data?.length ?? 0) > 0) setInfosOpen(true); }, [infos, infosQ.data]);

  if (isLoading) return <div className="grid place-items-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  if (!data || !activeCompanyId) return <><PageHeader title={t('purchases.docTitle')} /><p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{t('purchases.notFound')}</p></>;

  const { order, lines, schedules } = data;
  const ox = order as typeof order & OrderExtra;
  const sup = order.supplier_id ? suppliers?.find((s) => s.id === order.supplier_id) : null;

  // Brouillon : on le reprend dans l'éditeur (G8 : un document en attente se rappelle et se valide plus tard).
  if (order.status === 'brouillon') {
    return (
      <>
        <PageHeader
          title={`${t(`purchases.type_${order.doc_type}`)} — ${t('purchases.status_brouillon')}`}
          actions={<Button variant="outline" onClick={() => navigate({ to: '/purchases' })}><ArrowLeft /> {t('purchases.backToList')}</Button>}
        />
        {canWrite
          ? <PurchaseEditor key={order.id} companyId={activeCompanyId} initial={data} />
          : <p className="rounded-md bg-info-bg px-3 py-2 text-[13px] text-info">{t('purchasesG8.draftReadOnly')}</p>}
      </>
    );
  }

  const followLine = (id: string) => follow.data?.lines.find((l) => l.line_id === id);
  const canReceive = order.doc_type === 'CMD' && ['validee', 'partielle'].includes(order.status);
  const canSend = isOrderish && ['validee', 'partielle'].includes(order.status);

  const toOrder = async () => {
    setBusy(true);
    try { const id = await proposalToOrder(order.id); navigate({ to: '/purchases/$orderId', params: { orderId: id }, search: {} }); }
    catch (e) { toast.error(e instanceof Error ? e.message : t('purchases.errSave')); }
    setBusy(false);
  };
  // Q65 (20/11/2026) : éditions G8 COMMANDE / RECEPTION — PDF A4 dans un nouvel onglet.
  const canPrint = (PRINTABLE_PURCHASE_TYPES as readonly string[]).includes(order.doc_type);
  const print = async () => {
    setPrinting(true);
    try { await openPurchasePdf(data); }
    catch (e) { toast.error(e instanceof Error && e.message ? e.message : t('purchasePrint.error')); }
    setPrinting(false);
  };
  const dcs = async (kind: 'STANDARD' | 'URGENTE') => {
    downloadDcs(order, lines, kind);
    // Branchement sur l'historique des envois (le fichier DCS existant reste inchangé)
    try { await logOrderSend(order.id, 'dcs', `Fichier DCS ${kind}`); qc.invalidateQueries({ queryKey: ['purchase-follow', orderId] }); } catch { /* lecture seule : sans effet */ }
  };

  return (
    <>
      <PageHeader
        title={`${t(`purchases.type_${order.doc_type}`)} ${order.number ?? ''}`}
        description={`${order.receipt_date && order.doc_type === 'REC' ? order.receipt_date : order.order_date ?? order.receipt_date ?? ''}${sup ? ` · ${supplierName(sup)}` : ''}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {canReceive && canWrite && <Button onClick={() => navigate({ to: '/purchases/new', search: { docType: 'REC', recall: order.id } })}><Truck /> {t('purchasesG8.receive')}</Button>}
            {canPrint && <Button variant="outline" onClick={print} disabled={printing} title={t('purchasePrint.printHint')}>{printing ? <Loader2 className="animate-spin" /> : <Printer />} {t('purchasePrint.print')}</Button>}
            {canSend && canWrite && <Button variant="outline" onClick={() => setSendOpen(true)}><Send /> {t('purchasesG8.markSent')}</Button>}
            {canReceive && canWrite && <Button variant="outline" onClick={() => setCloseOpen(true)}><CircleSlash /> {t('purchasesG8.closeRemainder')}</Button>}
            {order.doc_type === 'PCF' && order.status === 'validee' && canWrite && <Button onClick={toOrder} disabled={busy}><ClipboardList /> {t('purchasesG8.toOrder')}</Button>}
            {order.doc_type === 'CMD' && (
              <>
                {order.dcs_kind !== 'URGENTE' && <Button variant="outline" onClick={() => dcs('STANDARD')}><FileDown /> {t('purchases.dcsStandard')}</Button>}
                {order.dcs_kind !== 'STANDARD' && <Button variant="outline" onClick={() => dcs('URGENTE')}><FileDown /> {t('purchases.dcsUrgent')}</Button>}
              </>
            )}
            {isRec && <Button variant="outline" onClick={() => setInfosOpen(true)}><Users /> {fillVars(t('purchasesG8.infosBtn'), { n: infosQ.data?.length ?? 0 })}</Button>}
            {order.doc_type === 'REC' && lines.length > 0 && (
              <Button variant="outline" onClick={() => setLabelsOpen(true)}><Tag /> {t('labels.customerLabel')}</Button>
            )}
            {isRec && <DestinationLabelsButton companyId={activeCompanyId} kind="receipt" id={order.id} />}
            <Button variant="outline" onClick={() => navigate({ to: '/purchases' })}><ArrowLeft /> {t('purchases.backToList')}</Button>
          </div>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <StatusBadge tone={purchaseStatusTone(order.status)} label={t(`purchases.status_${order.status}`)} />
        <StatusBadge tone="info" label={t(`purchases.regime_${order.vat_regime}`)} />
        {ox.order_type && <StatusBadge tone="neutral" label={t(`purchasesG8.orderType_${ox.order_type}`)} />}
        {order.dcs_kind && <StatusBadge tone="info" icon={FileDown} label={t('purchases.dcsKindBadge').replace('{kind}', order.dcs_kind)} />}
        {order.supplier_invoice_no && <span className="font-data text-[13px] text-muted-foreground">{t('purchases.invoiceNo')} : {order.supplier_invoice_no}{order.invoice_date ? ` (${order.invoice_date})` : ''}</span>}
        {order.supplier_bl_no && <span className="font-data text-[13px] text-muted-foreground">{t('purchases.blNo')} : {order.supplier_bl_no}{order.bl_date ? ` (${order.bl_date})` : ''}</span>}
        {ox.merged_into_id && <Link to="/purchases/$orderId" params={{ orderId: ox.merged_into_id }} search={{}} className="text-[13px] text-info underline">{t('purchasesG8.mergedInto')}</Link>}
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted">
            <tr>
              <Th>{t('purchases.colArticle')}</Th><Th>{t('purchases.colSupplierRef')}</Th><Th className="text-right">{t('purchases.colQty')}</Th>
              {order.doc_type === 'CMD' && <><Th className="text-right">{t('purchasesG8.colReceivedShort')}</Th><Th className="text-right">{t('purchasesG8.colRemaining')}</Th></>}
              <Th className="text-right">{t('purchases.colPuHt')}</Th><Th className="text-right">{t('purchases.colDiscount')}</Th><Th>{t('purchases.colBin')}</Th>
              {order.doc_type === 'REC' && <Th className="text-right">{t('purchasesG8.colLanded')}</Th>}
              <Th className="text-right">{t('purchases.colLineHt')}</Th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const lx = l as typeof l & LineExtra;
              const f = followLine(l.id);
              return (
                <tr key={l.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">{l.designation}{lx.origin_ref ? <span className="block text-[11px] text-muted-foreground">{lx.origin_ref}</span> : null}</td>
                  <td className="px-3 py-2 font-mono text-[12px]">{l.supplier_ref ?? '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{qtyFmt(Number(l.quantity))}</td>
                  {order.doc_type === 'CMD' && (
                    <>
                      <td className="px-3 py-2 text-right tabular-nums">{f ? qtyFmt(f.received) : '—'}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${f && f.remaining > 0 ? 'font-bold' : 'text-muted-foreground'}`}>{f ? qtyFmt(f.remaining) : '—'}</td>
                    </>
                  )}
                  <td className="px-3 py-2 text-right tabular-nums">{eur(Number(l.unit_price_ht))}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{Number(l.discount_pct) ? `${Number(l.discount_pct)} %` : '—'}</td>
                  <td className="px-3 py-2 font-mono text-[12px]">{l.bin_location ?? '—'}</td>
                  {order.doc_type === 'REC' && <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{lx.landed_unit_cost != null ? eur(Number(lx.landed_unit_cost)) : '—'}</td>}
                  <td className="px-3 py-2 text-right tabular-nums">{eur(Number(l.line_ht))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-col items-end gap-1 font-data text-sm tabular-nums">
        {Number(order.global_discount_pct) > 0 && <span className="text-muted-foreground">{t('purchases.globalDiscount')} : {Number(order.global_discount_pct)} %</span>}
        {Number(order.shipping_ht) > 0.005 && <span className="text-muted-foreground">{t('purchases.shippingHt')} : {eur(Number(order.shipping_ht))}</span>}
        <span>{t('purchases.totalHt')} : <b>{eur(Number(order.total_ht))}</b></span>
        <span className="text-muted-foreground">{t('purchases.totalVat')} : {eur(Number(order.total_vat))}</span>
        <span className="text-base">{t('purchases.totalTtc')} : <b>{eur(Number(order.total_ttc))}</b></span>
      </div>

      {follow.data && (follow.data.receipts.length > 0 || follow.data.orders.length > 0 || follow.data.merged.length > 0) && (
        <div className="mt-6 flex flex-wrap gap-6 text-[13px]">
          {follow.data.receipts.length > 0 && (
            <div><p className="mb-1 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('purchasesG8.receiptsOfOrder')}</p>
              {follow.data.receipts.map((r) => <Link key={r.id} to="/purchases/$orderId" params={{ orderId: r.id }} search={{}} className="mr-3 font-mono text-info underline">{r.number}{r.date ? ` (${r.date})` : ''}</Link>)}</div>
          )}
          {follow.data.orders.length > 0 && (
            <div><p className="mb-1 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{order.doc_type === 'REC' ? t('purchasesG8.ordersOfReceipt') : t('purchasesG8.sourceDocs')}</p>
              {follow.data.orders.map((o) => <Link key={o.id} to="/purchases/$orderId" params={{ orderId: o.id }} search={{}} className="mr-3 font-mono text-info underline">{o.number} · {t(`purchases.status_${o.status}`)}</Link>)}</div>
          )}
          {follow.data.merged.length > 0 && (
            <div><p className="mb-1 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('purchasesG8.mergedFrom')}</p>
              {follow.data.merged.map((o) => <span key={o.id} className="mr-3 font-mono">{o.number ?? '—'}</span>)}</div>
          )}
        </div>
      )}

      {follow.data && follow.data.sends.length > 0 && (
        <div className="mt-6">
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground"><History className="size-3.5" /> {t('purchasesG8.sendsTitle')}</p>
          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full border-collapse font-data text-[13px]">
              <tbody>
                {follow.data.sends.map((s, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 font-mono text-[12px]">{new Date(s.sent_at).toLocaleString('fr-BE', { dateStyle: 'short', timeStyle: 'short' })}</td>
                    <td className="px-3 py-2">{t(`purchasesG8.send_${s.channel}`)}</td>
                    <td className="px-3 py-2 text-[12px]">{s.sent_by ?? '—'}</td>
                    <td className="px-3 py-2 text-[12px] text-muted-foreground">{s.note ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(order.doc_type === 'CMD' || order.doc_type === 'REC') && <PurchaseDestinations orderId={order.id} lines={lines} icon={Users} />}
      {(order.doc_type === 'CMD' || order.doc_type === 'REC') && <PartPathPanel companyId={activeCompanyId} scope="purchase" scopeId={order.id} />}

      {schedules.length > 0 && (
        <div className="mt-6">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('purchases.schedules')}</p>
          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full border-collapse font-data text-[13px]">
              <thead className="bg-muted"><tr><Th>{t('purchases.schedDue')}</Th><Th className="text-right">{t('purchases.schedAmount')}</Th></tr></thead>
              <tbody>
                {schedules.map((s) => (
                  <tr key={s.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 font-mono text-[12px]">{s.due_date ?? '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{eur(Number(s.amount))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {order.notes && <p className="mt-6 whitespace-pre-wrap rounded-md border border-border bg-card px-3 py-2 text-[13px]">{order.notes}</p>}

      {order.doc_type === 'REC' && (
        <CustomerLabelDialog open={labelsOpen} onOpenChange={setLabelsOpen} companyId={activeCompanyId} storeName={activeCompany?.name ?? ''} docNumber={order.number ?? ''} lines={lines} />
      )}
      {isRec && <CustomerInfosDialog receiptId={order.id} open={infosOpen} onOpenChange={setInfosOpen} />}
      {sendOpen && <SendDialog orderId={order.id} onClose={() => { setSendOpen(false); qc.invalidateQueries({ queryKey: ['purchase-follow', orderId] }); }} />}
      {closeOpen && <CloseRemainderDialog orderId={order.id} onClose={(done) => { setCloseOpen(false); if (done) { qc.invalidateQueries({ queryKey: ['purchase-full', orderId] }); qc.invalidateQueries({ queryKey: ['purchase-follow', orderId] }); } }} />}
    </>
  );
}

function SendDialog({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const [channel, setChannel] = useState<SendChannel>('mail');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { await logOrderSend(orderId, channel, note || null); toast.success(t('purchasesG8.sentLogged')); onClose(); }
    catch (e) { toast.error(e instanceof Error ? e.message : t('purchases.errSave')); setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{t('purchasesG8.markSent')}</DialogTitle></DialogHeader>
        <p className="text-[12px] text-muted-foreground">{t('purchasesG8.sendHint')}</p>
        <Select value={channel} onValueChange={(v) => setChannel(v as SendChannel)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{SEND_CHANNELS.map((c) => <SelectItem key={c} value={c}>{t(`purchasesG8.send_${c}`)}</SelectItem>)}</SelectContent>
        </Select>
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('purchasesG8.notes')} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button onClick={go} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <Send />} {t('action.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CloseRemainderDialog({ orderId, onClose }: { orderId: string; onClose: (done: boolean) => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { await closeOrderRemainder(orderId, note || null); toast.success(t('purchasesG8.closedOk')); onClose(true); }
    catch (e) { toast.error(e instanceof Error ? e.message : t('purchases.errSave')); setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(false); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{t('purchasesG8.closeRemainder')}</DialogTitle></DialogHeader>
        <p className="text-[13px]">{t('purchasesG8.closeHint')}</p>
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('purchasesG8.closeReason')} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onClose(false)}>{t('action.cancel')}</Button>
          <Button onClick={go} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <CircleSlash />} {t('purchasesG8.closeRemainder')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Th({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
