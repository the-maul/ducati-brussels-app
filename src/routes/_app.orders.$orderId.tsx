import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, CheckCircle2, AlertTriangle, Info, Settings2, ShieldCheck, Ban, ArrowRight, History } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/lib/auth/auth-context';
import {
  getPartOrderFull, getOrderRules, checkPartOrderRules, transitionPartOrder, getPartOrderHistory,
  type OrderDispatchStatus,
} from '@/modules/orders/api';
import { NEXT_STATUSES } from '@/modules/orders/status-flow';
import { ruleFor } from '@/modules/orders/thresholds';
import { DispatchBadge, dispatchIcon, eur, kindIcon, kindLabel, ruleSentences } from '@/modules/orders/order-ui';
import { listRef } from '@/modules/settings/reference-api';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/orders/$orderId')({
  head: () => ({ meta: [{ title: 'Commande de pièces — Ducati Bruxelles' }] }),
  component: OrderDetail,
});

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Libellé du bouton qui mène à un état. */
const ACTION_KEY: Record<OrderDispatchStatus, string> = {
  brouillon: 'orders.validate',
  en_attente_paiement: 'orders.validate',
  payee: 'orders.actPay',
  a_envoyer: 'orders.actToSend',
  envoyee: 'orders.actSend',
  annulee: 'orders.actCancel',
};

function OrderDetail() {
  const { orderId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { activeCompanyId } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<OrderDispatchStatus | null>(null);
  const [paymentMethod, setPaymentMethod] = useState('');
  const [note, setNote] = useState('');

  const { data, isLoading } = useQuery({ queryKey: ['part-order', orderId], queryFn: () => getPartOrderFull(orderId) });
  const { data: rules } = useQuery({
    queryKey: ['part-order-rules', activeCompanyId],
    queryFn: () => getOrderRules(activeCompanyId!),
    enabled: !!activeCompanyId,
  });
  const status = data?.order.dispatch_status;
  const isDraft = status === 'brouillon';
  // Contrôle serveur en direct : en brouillon (validation) et « à envoyer » (envoi)
  const { data: check } = useQuery({
    queryKey: ['part-order-check', orderId, status],
    queryFn: () => checkPartOrderRules(orderId),
    enabled: !!data && (status === 'brouillon' || status === 'a_envoyer'),
  });
  const { data: history } = useQuery({
    queryKey: ['part-order-history', orderId],
    queryFn: () => getPartOrderHistory(orderId),
    enabled: !!data,
  });
  // Moyens de paiement réglés dans Paramètres → Tables → Modes de règlement
  const { data: paymentMethods } = useQuery({
    queryKey: ['ref', activeCompanyId, 'payment_method'],
    queryFn: () => listRef(activeCompanyId!, 'payment_method'),
    enabled: !!activeCompanyId && pending === 'payee',
  });

  const transition = useMutation({
    mutationFn: (to: OrderDispatchStatus) =>
      transitionPartOrder(orderId, to, { paymentMethod: to === 'payee' ? paymentMethod : null, note }),
    onSuccess: () => {
      setError(null);
      setPending(null);
      setNote('');
      setPaymentMethod('');
      for (const k of ['part-order', 'part-order-check', 'part-order-history']) qc.invalidateQueries({ queryKey: [k, orderId] });
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
  const next = NEXT_STATUSES[order.dispatch_status] ?? [];
  const forward = next.filter((s) => s !== 'annulee');
  const blockedByRules = (to: OrderDispatchStatus) =>
    (to === 'en_attente_paiement' || to === 'envoyee') && !!check && !check.ok;

  const startAction = (to: OrderDispatchStatus) => {
    setError(null);
    // La validation et le passage « à envoyer » ne demandent rien : exécution directe
    if (to === 'en_attente_paiement' || to === 'a_envoyer') transition.mutate(to);
    else setPending(to);
  };

  return (
    <>
      <PageHeader
        title={<span className="flex items-center gap-2">{order.number ?? t('orders.draft')} <DispatchBadge status={order.dispatch_status} /></span>}
        description={`${kindLabel(order.order_kind, rules)} · ${t(`orders.channel_${order.channel}`)}`}
        breadcrumbs={[{ label: t('orders.title'), to: '/orders' }, { label: order.number ?? t('orders.draft') }]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => navigate({ to: '/orders' })}>{t('orders.backToList')}</Button>
            {next.includes('annulee') && (
              <Button variant="outline" onClick={() => startAction('annulee')} disabled={transition.isPending}>
                <Ban /> {t('orders.actCancel')}
              </Button>
            )}
            {forward.map((to) => {
              const Icon = to === 'en_attente_paiement' ? ShieldCheck : dispatchIcon(to);
              return (
                <Button key={to} onClick={() => startAction(to)} disabled={transition.isPending || blockedByRules(to)}>
                  {transition.isPending && transition.variables === to ? <Loader2 className="animate-spin" /> : <Icon />} {t(ACTION_KEY[to])}
                </Button>
              );
            })}
          </div>
        }
      />

      {/* Confirmation d'un passage d'état (paiement, envoi, annulation) */}
      {pending && (
        <div className="mb-4 rounded-md border border-border bg-card p-4 text-[13px]">
          <p className="mb-3 flex items-center gap-2 font-ui font-bold">
            <DispatchBadge status={order.dispatch_status} /> <ArrowRight className="size-4 text-muted-foreground" /> <DispatchBadge status={pending} />
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {pending === 'payee' && (
              <label className="space-y-1">
                <span className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('orders.paymentMethod')}</span>
                {paymentMethods && paymentMethods.filter((m) => m.is_active).length > 0 ? (
                  <Select value={paymentMethod || undefined} onValueChange={setPaymentMethod}>
                    <SelectTrigger className="h-9"><SelectValue placeholder={t('orders.paymentPlaceholder')} /></SelectTrigger>
                    <SelectContent>
                      {paymentMethods.filter((m) => m.is_active).map((m) => <SelectItem key={m.id} value={m.label}>{m.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} placeholder={t('orders.paymentPlaceholder')} className="h-9" />
                )}
              </label>
            )}
            <label className="space-y-1">
              <span className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">
                {pending === 'annulee' ? t('orders.cancelReason') : t('orders.note')}
              </span>
              <Input value={note} onChange={(e) => setNote(e.target.value)} className="h-9" />
            </label>
          </div>
          <div className="mt-3 flex gap-2">
            <Button variant="outline" onClick={() => { setPending(null); setError(null); }}>{t('orders.back')}</Button>
            <Button
              onClick={() => transition.mutate(pending)}
              disabled={transition.isPending || (pending === 'payee' && !paymentMethod.trim()) || blockedByRules(pending)}
            >
              {transition.isPending ? <Loader2 className="animate-spin" /> : null} {t('action.confirm')}
            </Button>
          </div>
        </div>
      )}

      {error && <p className="mb-4 rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}

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

      {/* Résultat du contrôle serveur (avant validation et avant envoi) */}
      {check && (status === 'brouillon' || status === 'a_envoyer') && (
        <div className="mb-4 space-y-2">
          {check.ok && (
            <p className="flex items-center gap-2 rounded-md bg-success-bg px-3 py-2 text-[13px] text-success">
              <CheckCircle2 className="size-4 shrink-0" /> {isDraft ? t('orders.checkOk') : t('orders.checkOkSend')}
            </p>
          )}
          {check.errors.map((e, i) => (
            <p key={`e${i}`} className="flex items-center gap-2 rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">
              <AlertTriangle className="size-4 shrink-0" /> {e.message}
            </p>
          ))}
          {isDraft && check.notices.map((n, i) => (
            <p key={`n${i}`} className="flex items-center gap-2 rounded-md bg-info-bg px-3 py-2 text-[13px] text-info">
              <Info className="size-4 shrink-0" /> {n.message}
            </p>
          ))}
        </div>
      )}

      <div className="mb-6 overflow-hidden rounded-md border border-border">
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

      {/* Historique des états : qui, quand, ancien → nouveau */}
      <h2 className="mb-2 flex items-center gap-2 font-ui text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">
        <History className="size-4" /> {t('orders.historyTitle')}
      </h2>
      <p className="mb-2 text-[12px] text-muted-foreground">{t('orders.flowHint')}</p>
      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted">
            <tr>
              <Th>{t('orders.historyWhen')}</Th>
              <Th>{t('orders.historyChange')}</Th>
              <Th>{t('orders.historyWho')}</Th>
              <Th>{t('orders.historyNote')}</Th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border">
              <td className="px-3 py-2 tabular-nums">{fmtDateTime(order.created_at)}</td>
              <td className="px-3 py-2"><DispatchBadge status="brouillon" /></td>
              <td className="px-3 py-2 text-muted-foreground">—</td>
              <td className="px-3 py-2 text-muted-foreground">{t('orders.historyCreated')}</td>
            </tr>
            {(history ?? []).map((h, i) => (
              <tr key={i} className="border-b border-border last:border-0">
                <td className="px-3 py-2 tabular-nums">{fmtDateTime(h.changed_at)}</td>
                <td className="px-3 py-2">
                  <span className="flex items-center gap-1.5">
                    {h.from_status && <DispatchBadge status={h.from_status} />}
                    <ArrowRight className="size-3.5 text-muted-foreground" />
                    <DispatchBadge status={h.to_status} />
                  </span>
                </td>
                <td className="px-3 py-2">{h.changed_by_name ?? t('orders.unknownUser')}</td>
                <td className="px-3 py-2">{h.note ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
