import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Loader2, FileDown, Tag } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { getPurchaseFull, listSuppliers, supplierName } from '@/modules/purchases/api';
import { downloadDcs } from '@/modules/purchases/dcs-export';
import { CustomerLabelDialog } from '@/modules/purchases/customer-label-dialog';
import { useAuth } from '@/lib/auth/auth-context';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/purchases/$orderId')({
  head: () => ({ meta: [{ title: 'Document achat — Ducati Bruxelles' }] }),
  component: PurchaseView,
});

const eur = (n: number) => `${(Math.round(Number(n) * 100) / 100).toFixed(2).replace('.', ',')} €`;
const statusTone = (s: string) => (s === 'recue' ? 'success' : s === 'annulee' ? 'neutral' : s === 'brouillon' ? 'info' : 'warning');

function PurchaseView() {
  const { orderId } = Route.useParams();
  const navigate = useNavigate();
  const { activeCompanyId, activeCompany } = useAuth();
  const { data, isLoading } = useQuery({ queryKey: ['purchase-full', orderId], queryFn: () => getPurchaseFull(orderId) });
  const { data: suppliers } = useQuery({ queryKey: ['suppliers-map', activeCompanyId], queryFn: () => listSuppliers(activeCompanyId!), enabled: !!activeCompanyId });
  const [labelsOpen, setLabelsOpen] = useState(false);

  if (isLoading) return <div className="grid place-items-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  if (!data) return <><PageHeader title="Document" /><p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{t('purchases.notFound')}</p></>;

  const { order, lines, schedules } = data;
  const sup = order.supplier_id ? suppliers?.find((s) => s.id === order.supplier_id) : null;

  return (
    <>
      <PageHeader
        title={`${t(`purchases.type_${order.doc_type}`)} ${order.number ?? ''}`}
        description={`${order.receipt_date ?? order.order_date ?? ''}${sup ? ` · ${supplierName(sup)}` : ''}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {order.doc_type === 'CMD' && (
              <>
                <Button variant="outline" onClick={() => downloadDcs(order, lines, 'STANDARD')}><FileDown /> {t('purchases.dcsStandard')}</Button>
                <Button variant="outline" onClick={() => downloadDcs(order, lines, 'URGENTE')}><FileDown /> {t('purchases.dcsUrgent')}</Button>
              </>
            )}
            {order.doc_type === 'REC' && lines.length > 0 && (
              <Button variant="outline" onClick={() => setLabelsOpen(true)}><Tag /> {t('labels.customerLabel')}</Button>
            )}
            <Button variant="outline" onClick={() => navigate({ to: '/purchases' })}><ArrowLeft /> {t('purchases.backToList')}</Button>
          </div>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <StatusBadge tone={statusTone(order.status)} label={t(`purchases.status_${order.status}`)} />
        <StatusBadge tone="info" label={t(`purchases.regime_${order.vat_regime}`)} />
        {order.supplier_invoice_no && <span className="font-data text-[13px] text-muted-foreground">{t('purchases.invoiceNo')} : {order.supplier_invoice_no}</span>}
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted"><tr><Th>{t('purchases.colArticle')}</Th><Th>{t('purchases.colSupplierRef')}</Th><Th className="text-right">{t('purchases.colQty')}</Th><Th className="text-right">{t('purchases.colPuHt')}</Th><Th>{t('purchases.colBin')}</Th><Th className="text-right">{t('purchases.colLineHt')}</Th></tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-b border-border last:border-0">
                <td className="px-3 py-2">{l.designation}</td>
                <td className="px-3 py-2 font-mono text-[12px]">{l.supplier_ref ?? '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{Number(l.quantity)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(Number(l.unit_price_ht))}</td>
                <td className="px-3 py-2 font-mono text-[12px]">{l.bin_location ?? '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(Number(l.line_ht))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-col items-end gap-1 font-data text-sm tabular-nums">
        {Number(order.shipping_ht) > 0.005 && <span className="text-muted-foreground">{t('purchases.shippingHt')} : {eur(Number(order.shipping_ht))}</span>}
        <span>{t('purchases.totalHt')} : <b>{eur(Number(order.total_ht))}</b></span>
        <span className="text-muted-foreground">{t('purchases.totalVat')} : {eur(Number(order.total_vat))}</span>
        <span className="text-base">{t('purchases.totalTtc')} : <b>{eur(Number(order.total_ttc))}</b></span>
      </div>

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

      {order.doc_type === 'REC' && (
        <CustomerLabelDialog
          open={labelsOpen}
          onOpenChange={setLabelsOpen}
          companyId={activeCompanyId}
          storeName={activeCompany?.name ?? ''}
          docNumber={order.number ?? ''}
          lines={lines}
        />
      )}
    </>
  );
}

function Th({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
