import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Plus, Timer } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/lib/auth/auth-context';
import { listRepairOrders } from '@/modules/workshop/api';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/workshop/')({
  head: () => ({ meta: [{ title: 'Atelier & SAV — Ducati Bruxelles' }] }),
  component: WorkshopList,
});

const eur = (n: number) => `${(Math.round(Number(n) * 100) / 100).toFixed(2).replace('.', ',')} €`;
const tone = (s: string) => (s === 'facture' ? 'success' : s === 'annule' ? 'neutral' : s === 'pret' ? 'info' : 'warning');

function WorkshopList() {
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState('all');
  const { data, isLoading } = useQuery({
    queryKey: ['repair-orders', activeCompanyId, status],
    queryFn: () => listRepairOrders(activeCompanyId!, status === 'all' ? undefined : status),
    enabled: !!activeCompanyId,
  });

  return (
    <>
      <PageHeader
        title={t('workshop.title')}
        description={t('workshop.subtitle')}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate({ to: '/workshop/chrono' })}><Timer /> {t('workshop.chrono')}</Button>
            <Button onClick={() => navigate({ to: '/workshop/new' })}><Plus /> {t('workshop.newOr')}</Button>
          </div>
        }
      />
      <div className="mb-3">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('workshop.filterAll')}</SelectItem>
            {['a_faire', 'en_cours', 'pret', 'facture'].map((s) => <SelectItem key={s} value={s}>{t(`workshop.status_${s}`)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted"><tr><Th>{t('workshop.colNumber')}</Th><Th>{t('workshop.colStatus')}</Th><Th>{t('workshop.colWarranty')}</Th><Th className="text-right">{t('workshop.colTtc')}</Th></tr></thead>
          <tbody>
            {isLoading && <tr><td colSpan={4} className="px-3 py-6 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></td></tr>}
            {data && data.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">{t('workshop.empty')}</td></tr>}
            {data?.map((o) => (
              <tr key={o.id} onClick={() => navigate({ to: '/workshop/$orId', params: { orId: o.id } })} className="cursor-pointer border-b border-border last:border-0 hover:bg-accent">
                <td className="px-3 py-2 font-mono text-[12px]">{o.number ?? '—'}</td>
                <td className="px-3 py-2"><StatusBadge tone={tone(o.status)} label={t(`workshop.status_${o.status}`)} /></td>
                <td className="px-3 py-2">{o.warranty_status !== 'aucune' ? <StatusBadge tone={o.warranty_status === 'en_attente' ? 'warning' : 'info'} label={t(`workshop.warranty_${o.warranty_status}`)} /> : '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(Number(o.total_ttc))}</td>
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
