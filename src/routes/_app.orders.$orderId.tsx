import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, CheckCircle2, AlertTriangle, Info, Settings2, ShieldCheck } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import {
  getPartOrderFull, getOrderRules, checkPartOrderRules, validatePartOrder, type OrderDispatchStatus,
} from '@/modules/orders/api';
import { ruleFor } from '@/modules/orders/thresholds';
import { eur, kindIcon, kindLabel, ruleSentences } from '@/modules/orders/order-ui';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/orders/$orderId')({
  head: () => ({ meta: [{ title: 'Commande de pièces — Ducati Bruxelles' }] }),
  component: OrderDetail,
});

const dispatchTone = (s: OrderDispatchStatus) =>
  s === 'envoyee' || s === 'a_envoyer' ? 'success'
  : s === 'payee' ? 'info'
  : s === 'annulee' ? 'neutral'
  : s === 'en_attente_paiement' ? 'warning'
  : 'info';

function OrderDetail() {
  const { orderId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { activeCompanyId } = useAuth();
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ['part-order', orderId], queryFn: () => getPartOrderFull(orderId) });
  const { data: rules } = useQuery({
    queryKey: ['part-order-rules', activeCompanyId],
    queryFn: () => getOrderRules(activeCompanyId!),
    enabled: !!activeCompanyId,
  });
  const isDraft = data?.order.dispatch_status === 'brouillon';
  const { data: check } = useQuery({
    queryKey: ['part-order-check', orderId],
    queryFn: () => checkPartOrderRules(orderId),
    enabled: !!data && isDraft,
  });

  const validate = useMutation({
    mutationFn: () => validatePartOrder(orderId),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ['part-order', orderId] });
      qc.invalidateQueries({ queryKey: ['part-order-check', orderId] });
      qc.invalidateQueries({ queryKey: ['part-orders'] });
      qc.invalidateQueries({ queryKey: ['part-orders-counts'] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : t('orders.errGeneric')),
  });

  if (isLoading) return <div className="py-10 text-center"><Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" /></div>;
  if (!data) return <p className="py-10 text-center text-muted-foreground">{t('orders.notFound')}</p>;

  const { order, lines } = data;
  const rule = rules ? ruleFor(rules, order.order_kind) : undefined;
  const KindIcon = kindIcon(order.order_kind);
  const fallbackRule = rule?.fallback && rules ? ruleFor(rules, rule.fallback) : undefined;

  return (
    <>
      <PageHeader
        title={<span className="flex items-center gap-2">{order.number ?? t('orders.draft')} <StatusBadge tone={dispatchTone(order.dispatch_status)} label={t(`orders.dispatch_${order.dispatch_status}`)} /></span>}
        description={`${kindLabel(order.order_kind, rules)} · ${t(`orders.channel_${order.channel}`)}`}
        breadcrumbs={[{ label: t('orders.title'), to: '/orders' }, { label: order.number ?? t('orders.draft') }]}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate({ to: '/orders' })}>{t('orders.backToList')}</Button>
            {isDraft && (
              <Button onClick={() => validate.mutate()} disabled={validate.isPending || (check ? !check.ok : false)}>
                {validate.isPending ? <Loader2 className="animate-spin" /> : <ShieldCheck />} {t('orders.validate')}
              </Button>
            )}
          </div>
        }
      />

      {/* Rappel des règles du type (réglées dans Paramètres) */}
      <div className="mb-4 rounded-md border border-border bg-card p-4 text-[13px]">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-ui text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">
            <KindIcon className="size-4" /> {t('orders.rulesTitle').replace('{kind}', kindLabel(order.order_kind, rules))}
          </h2>
          <Link to="/settings/tables/$tableKey" params={{ tableKey: 'order_threshold' }} className="flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground">
            <Settings2 className="size-3.5" /> {t('orders.rulesEdit')}
          </Link>
        </div>
        {!rules ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        ) : (
          <ul className="list-disc space-y-0.5 pl-5">
            {ruleSentences(rule, rules).map((s) => <li key={s}>{s}</li>)}
            {fallbackRule && ruleSentences(fallbackRule, rules).map((s) => (
              <li key={`fb-${s}`} className="text-muted-foreground">{kindLabel(fallbackRule.code, rules)} : {s}</li>
            ))}
          </ul>
        )}
        {order.order_kind === 'excel' && (
          <Button variant="outline" size="sm" className="mt-3" onClick={() => navigate({ to: '/orders/excel' })}>{t('orders.openExcel')}</Button>
        )}
      </div>

      {/* Résultat du contrôle serveur (brouillon uniquement) */}
      {isDraft && check && (
        <div className="mb-4 space-y-2">
          {check.ok && (
            <p className="flex items-center gap-2 rounded-md bg-success-bg px-3 py-2 text-[13px] text-success">
              <CheckCircle2 className="size-4 shrink-0" /> {t('orders.checkOk')}
            </p>
          )}
          {check.errors.map((e, i) => (
            <p key={`e${i}`} className="flex items-center gap-2 rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">
              <AlertTriangle className="size-4 shrink-0" /> {e.message}
            </p>
          ))}
          {check.notices.map((n, i) => (
            <p key={`n${i}`} className="flex items-center gap-2 rounded-md bg-info-bg px-3 py-2 text-[13px] text-info">
              <Info className="size-4 shrink-0" /> {n.message}
            </p>
          ))}
        </div>
      )}

      {error && <p className="mb-4 rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}

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
              <td className="px-3 py-2 text-right tabular-nums">{eur(Number(isDraft && check ? check.total_ht : order.total_ht))}</td>
            </tr>
            {Number(order.surcharge_pct) > 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-1 text-right text-muted-foreground">{t('orders.surchargeApplied')}</td>
                <td className="px-3 py-1 text-right tabular-nums text-muted-foreground">+{String(Number(order.surcharge_pct)).replace('.', ',')} %</td>
              </tr>
            )}
            {!isDraft && (
              <tr>
                <td colSpan={4} className="px-3 py-1 text-right">{t('orders.totalTtcClient')}</td>
                <td className="px-3 py-1 text-right tabular-nums">{eur(Number(order.total_ttc))}</td>
              </tr>
            )}
          </tfoot>
        </table>
      </div>
    </>
  );
}

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
