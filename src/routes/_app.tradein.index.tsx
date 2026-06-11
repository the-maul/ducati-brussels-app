import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Plus } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { listOro } from '@/modules/tradein/api';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/tradein/')({
  head: () => ({ meta: [{ title: 'Reprises & ORO — Ducati Bruxelles' }] }),
  component: TradeinList,
});

const eur = (n: number) => `${(Math.round(Number(n) * 100) / 100).toFixed(2).replace('.', ',')} €`;

function TradeinList() {
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ['oro', activeCompanyId], queryFn: () => listOro(activeCompanyId!), enabled: !!activeCompanyId });

  return (
    <>
      <PageHeader
        title={t('tradein.title')}
        description={t('tradein.subtitle')}
        actions={<Button onClick={() => navigate({ to: '/tradein/new' })}><Plus /> {t('tradein.newReprise')}</Button>}
      />
      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted"><tr><Th>{t('tradein.colNumber')}</Th><Th>{t('tradein.colStatus')}</Th><Th className="text-right">{t('tradein.colCost')}</Th></tr></thead>
          <tbody>
            {isLoading && <tr><td colSpan={3} className="px-3 py-6 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></td></tr>}
            {data && data.length === 0 && <tr><td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">{t('tradein.empty')}</td></tr>}
            {data?.map((o) => (
              <tr key={o.id} onClick={() => navigate({ to: '/tradein/$oroId', params: { oroId: o.id } })} className="cursor-pointer border-b border-border last:border-0 hover:bg-accent">
                <td className="px-3 py-2 font-mono text-[12px]">{o.number ?? '—'}</td>
                <td className="px-3 py-2"><StatusBadge tone={o.status === 'cloture' ? 'success' : 'warning'} label={t(`tradein.status_${o.status}`)} /></td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(Number(o.total_cost))}</td>
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
