import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Plus, FileSpreadsheet } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import {
  listPartOrders, listKindStatus, getOrderRules, type OrderKind, type OrderDispatchStatus,
} from '@/modules/orders/api';
import { countOrders, DISPATCH_STATUSES } from '@/modules/orders/status-flow';
import { DispatchBadge, dispatchIcon, eur, kindIcon, kindLabel } from '@/modules/orders/order-ui';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/orders/')({
  head: () => ({ meta: [{ title: 'Commandes de pièces — Ducati Bruxelles' }] }),
  component: OrdersList,
});

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-BE') : '—');

function OrdersList() {
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  const [kind, setKind] = useState<OrderKind | 'all'>('all');
  const [status, setStatus] = useState<OrderDispatchStatus | 'all'>('all');
  const filters = { kind: kind === 'all' ? undefined : kind, status: status === 'all' ? undefined : status };

  const { data, isLoading } = useQuery({
    queryKey: ['part-orders', activeCompanyId, kind, status],
    queryFn: () => listPartOrders(activeCompanyId!, filters),
    enabled: !!activeCompanyId,
  });
  const { data: pairs } = useQuery({
    queryKey: ['part-orders-counts', activeCompanyId],
    queryFn: () => listKindStatus(activeCompanyId!),
    enabled: !!activeCompanyId,
  });
  const { data: rules } = useQuery({
    queryKey: ['part-order-rules', activeCompanyId],
    queryFn: () => getOrderRules(activeCompanyId!),
    enabled: !!activeCompanyId,
  });

  const counts = useMemo(() => countOrders(pairs ?? [], filters), [pairs, kind, status]); // eslint-disable-line react-hooks/exhaustive-deps
  // Types : ceux réglés dans Paramètres + ceux déjà utilisés par une commande (liste extensible)
  const kinds = useMemo(() => {
    const codes = (rules ?? []).filter((r) => r.isActive).map((r) => r.code);
    for (const k of Object.keys(counts.byKind)) if (!codes.includes(k)) codes.push(k);
    return codes;
  }, [rules, counts]);

  return (
    <>
      <PageHeader
        title={t('orders.title')}
        description={t('orders.subtitle')}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate({ to: '/orders/excel' })}>
              <FileSpreadsheet /> {t('orders.excelTitle')}
            </Button>
            <Button onClick={() => navigate({ to: '/orders/new' })}>
              <Plus /> {t('orders.new')}
            </Button>
          </div>
        }
      />

      {/* Filtre par type */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="w-12 font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('orders.filterKind')}</span>
        <Chip active={kind === 'all'} onClick={() => setKind('all')} label={t('orders.filterAll')} count={counts.totalKind} />
        {kinds.map((k) => {
          const Icon = kindIcon(k);
          return (
            <Chip key={k} active={kind === k} onClick={() => setKind(k)} label={kindLabel(k, rules)}
              count={counts.byKind[k] ?? 0} icon={<Icon className="size-3.5" />} />
          );
        })}
      </div>

      {/* Filtre par état */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="w-12 font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('orders.filterStatus')}</span>
        <Chip active={status === 'all'} onClick={() => setStatus('all')} label={t('orders.filterAll')} count={counts.totalStatus} />
        {DISPATCH_STATUSES.map((s) => {
          const Icon = dispatchIcon(s);
          return (
            <Chip key={s} active={status === s} onClick={() => setStatus(s)} label={t(`orders.dispatch_${s}`)}
              count={counts.byStatus[s] ?? 0} icon={<Icon className="size-3.5" />} />
          );
        })}
      </div>

      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted">
            <tr>
              <Th>{t('orders.colNumber')}</Th>
              <Th>{t('orders.colDate')}</Th>
              <Th>{t('orders.colKind')}</Th>
              <Th>{t('orders.colChannel')}</Th>
              <Th>{t('orders.colStatus')}</Th>
              <Th>{t('orders.colStatusSince')}</Th>
              <Th className="text-right">{t('orders.colTtc')}</Th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={7} className="px-3 py-6 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></td></tr>}
            {data && data.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">{t('orders.empty')}</td></tr>}
            {data?.map((o) => {
              const KIcon = kindIcon(o.order_kind);
              return (
                <tr key={o.id} onClick={() => navigate({ to: '/orders/$orderId', params: { orderId: o.id } })}
                  className="cursor-pointer border-b border-border last:border-0 hover:bg-accent">
                  <td className="px-3 py-2 font-mono text-[12px]">{o.number ?? '—'}</td>
                  <td className="px-3 py-2 tabular-nums">{fmtDate(o.created_at)}</td>
                  <td className="px-3 py-2"><span className="flex items-center gap-1.5"><KIcon className="size-3.5 text-muted-foreground" />{kindLabel(o.order_kind, rules)}</span></td>
                  <td className="px-3 py-2">{t(`orders.channel_${o.channel}`)}</td>
                  <td className="px-3 py-2"><DispatchBadge status={o.dispatch_status} /></td>
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">{fmtDate(o.status_changed_at ?? o.created_at)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{eur(Number(o.total_ttc))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Chip({ active, onClick, label, count, icon }: { active: boolean; onClick: () => void; label: string; count: number; icon?: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] font-ui transition-colors ${
        active ? 'border-ring bg-accent font-bold' : 'border-border hover:bg-accent'
      }`}
    >
      {icon}
      {label}
      <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[11px] tabular-nums text-muted-foreground">{count}</span>
    </button>
  );
}

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
