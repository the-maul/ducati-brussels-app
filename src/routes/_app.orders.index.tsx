import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Plus, Zap, CalendarDays, FileSpreadsheet, AlertTriangle } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { listPartOrders, countByKind, type OrderKind, type OrderDispatchStatus } from '@/modules/orders/api';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/orders/')({
  head: () => ({ meta: [{ title: 'Commandes de pièces — Ducati Bruxelles' }] }),
  component: OrdersList,
});

const eur = (n: number) => `${(Math.round(Number(n) * 100) / 100).toFixed(2).replace('.', ',')} €`;

const KINDS: { key: OrderKind; icon: typeof Zap }[] = [
  { key: 'urgente', icon: Zap },
  { key: 'standard', icon: CalendarDays },
  { key: 'excel', icon: FileSpreadsheet },
  { key: 'accident', icon: AlertTriangle },
];

const dispatchTone = (s: OrderDispatchStatus) =>
  s === 'envoyee' ? 'success'
  : s === 'a_envoyer' ? 'success'
  : s === 'payee' ? 'info'
  : s === 'annulee' ? 'neutral'
  : s === 'en_attente_paiement' ? 'warning'
  : 'info';

function OrdersList() {
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<OrderKind | 'all'>('all');

  const { data, isLoading } = useQuery({
    queryKey: ['part-orders', activeCompanyId, filter],
    queryFn: () => listPartOrders(activeCompanyId!, filter === 'all' ? undefined : filter),
    enabled: !!activeCompanyId,
  });
  const { data: counts } = useQuery({
    queryKey: ['part-orders-counts', activeCompanyId],
    queryFn: () => countByKind(activeCompanyId!),
    enabled: !!activeCompanyId,
  });

  const total = useMemo(() => (counts ? counts.urgente + counts.standard + counts.excel + counts.accident : 0), [counts]);

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

      {/* Filtres par type de commande */}
      <div className="mb-4 flex flex-wrap gap-2">
        <KindChip active={filter === 'all'} onClick={() => setFilter('all')} label={t('orders.filterAll')} count={total} />
        {KINDS.map(({ key, icon: Icon }) => (
          <KindChip
            key={key}
            active={filter === key}
            onClick={() => setFilter(key)}
            label={t(`orders.kind_${key}`)}
            count={counts?.[key] ?? 0}
            icon={<Icon className="size-3.5" />}
          />
        ))}
      </div>

      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted">
            <tr>
              <Th>{t('orders.colNumber')}</Th>
              <Th>{t('orders.colKind')}</Th>
              <Th>{t('orders.colChannel')}</Th>
              <Th>{t('orders.colStatus')}</Th>
              <Th className="text-right">{t('orders.colTtc')}</Th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={5} className="px-3 py-6 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></td></tr>}
            {data && data.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">{t('orders.empty')}</td></tr>}
            {data?.map((o) => (
              <tr key={o.id} onClick={() => navigate({ to: '/orders/$orderId', params: { orderId: o.id } })}
                className="cursor-pointer border-b border-border last:border-0 hover:bg-accent">
                <td className="px-3 py-2 font-mono text-[12px]">{o.number ?? '—'}</td>
                <td className="px-3 py-2">{t(`orders.kind_${o.order_kind}`)}</td>
                <td className="px-3 py-2">{t(`orders.channel_${o.channel}`)}</td>
                <td className="px-3 py-2"><StatusBadge tone={dispatchTone(o.dispatch_status)} label={t(`orders.dispatch_${o.dispatch_status}`)} /></td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(Number(o.total_ttc))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function KindChip({ active, onClick, label, count, icon }: { active: boolean; onClick: () => void; label: string; count: number; icon?: React.ReactNode }) {
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
