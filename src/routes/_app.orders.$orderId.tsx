import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { getPartOrderFull, type OrderDispatchStatus } from '@/modules/orders/api';
import { DEFAULT_THRESHOLDS, surchargeForKind, resolveKind } from '@/modules/orders/thresholds';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/orders/$orderId')({
  head: () => ({ meta: [{ title: 'Commande de pièces — Ducati Bruxelles' }] }),
  component: OrderDetail,
});

const eur = (n: number) => `${(Math.round(Number(n) * 100) / 100).toFixed(2).replace('.', ',')} €`;
const dispatchTone = (s: OrderDispatchStatus) =>
  s === 'envoyee' || s === 'a_envoyer' ? 'success'
  : s === 'payee' ? 'info'
  : s === 'annulee' ? 'neutral'
  : s === 'en_attente_paiement' ? 'warning'
  : 'info';

function OrderDetail() {
  const { orderId } = Route.useParams();
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ['part-order', orderId], queryFn: () => getPartOrderFull(orderId) });

  if (isLoading) return <div className="py-10 text-center"><Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" /></div>;
  if (!data) return <p className="py-10 text-center text-muted-foreground">{t('orders.notFound')}</p>;

  const { order, lines } = data;
  const surcharge = surchargeForKind(order.order_kind);
  const resolved = resolveKind(order.order_kind, Number(order.total_ht));
  const th = DEFAULT_THRESHOLDS;

  return (
    <>
      <PageHeader
        title={<span className="flex items-center gap-2">{order.number ?? t('orders.draft')} <StatusBadge tone={dispatchTone(order.dispatch_status)} label={t(`orders.dispatch_${order.dispatch_status}`)} /></span>}
        description={`${t(`orders.kind_${order.order_kind}`)} · ${t(`orders.channel_${order.channel}`)}`}
        breadcrumbs={[{ label: t('orders.title'), to: '/orders' }, { label: order.number ?? t('orders.draft') }]}
        actions={<Button variant="outline" onClick={() => navigate({ to: '/orders' })}>{t('orders.backToList')}</Button>}
      />

      {/* Bandeau règle métier du type */}
      <div className="mb-4 rounded-md border border-border bg-card p-4 text-[13px]">
        {order.order_kind === 'standard' && (
          <p>{t('orders.ruleStandard')} — <b className="tabular-nums">{eur(th.standard.minHt)}</b>. {resolved.thresholdMet ? t('orders.thresholdMet') : t('orders.thresholdPending')}</p>
        )}
        {order.order_kind === 'urgente' && (
          <p>{t('orders.ruleUrgente')} — <b className="tabular-nums">+{surcharge} %</b>.</p>
        )}
        {order.order_kind === 'accident' && (
          <p>{t('orders.ruleAccident')} — <b className="tabular-nums">{eur(th.accident.minHt)}</b>. {resolved.effectiveKind === 'accident' ? t('orders.thresholdMet') : t('orders.accidentFallback')}</p>
        )}
        {order.order_kind === 'excel' && (
          <p>{t('orders.ruleExcel')} — <b className="tabular-nums">{eur(th.excel.minHtPerTab)}</b>/{t('orders.perTab')}. <Button variant="outline" size="sm" className="ml-2" onClick={() => navigate({ to: '/orders/excel' })}>{t('orders.openExcel')}</Button></p>
        )}
      </div>

      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted">
            <tr>
              <Th>{t('orders.lineRef')}</Th>
              <Th>{t('orders.lineDesignation')}</Th>
              <Th className="text-right">{t('orders.lineQtyClient')}</Th>
              <Th className="text-right">{t('orders.lineQtyShop')}</Th>
              <Th className="text-right">{t('orders.lineHt')}</Th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">{t('orders.noLines')}</td></tr>}
            {lines.map((l) => (
              <tr key={l.id} className="border-b border-border last:border-0">
                <td className="px-3 py-2 font-mono text-[12px]">{l.reference ?? '—'}</td>
                <td className="px-3 py-2">{l.designation}</td>
                <td className="px-3 py-2 text-right tabular-nums">{Number(l.qty_client)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{Number(l.qty_shop)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(Number(l.line_ht))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border font-bold">
              <td colSpan={4} className="px-3 py-2 text-right">{t('orders.totalHt')}</td>
              <td className="px-3 py-2 text-right tabular-nums">{eur(Number(order.total_ht))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
