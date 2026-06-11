import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Euro, Wrench, Bike, Boxes, FileText, CalendarRange, AlertCircle } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { KpiCard } from '@/components/kpi-card';
import { useAuth } from '@/lib/auth/auth-context';
import { getDashboardKpis } from '@/modules/reports/api';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/dashboard')({
  head: () => ({ meta: [{ title: 'Tableau de bord — Ducati Bruxelles' }] }),
  component: Dashboard,
});

const eur = (n: number) => `${Math.round(n).toLocaleString('fr-BE')} €`;

function Dashboard() {
  const { activeCompanyId } = useAuth();
  const { data } = useQuery({ queryKey: ['dashboard-kpis', activeCompanyId], queryFn: () => getDashboardKpis(activeCompanyId!), enabled: !!activeCompanyId });
  const k = data;

  return (
    <>
      <PageHeader title={t('nav.dashboard')} description={t('app.tagline')} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label={t('dashboard.revenueToday')} value={k ? eur(k.revenue_today) : '—'} icon={Euro} />
        <KpiCard label={t('dashboard.revenueMonth')} value={k ? eur(k.revenue_month) : '—'} icon={CalendarRange} />
        <KpiCard label={t('dashboard.invoicesMonth')} value={k ? String(k.invoices_month) : '—'} icon={FileText} />
        <KpiCard label={t('dashboard.receivables')} value={k ? eur(k.receivables) : '—'} deltaTone={k && k.receivables > 0 ? 'danger' : undefined} icon={AlertCircle} />
        <KpiCard label={t('dashboard.orOpen')} value={k ? String(k.or_open) : '—'} icon={Wrench} />
        <KpiCard label={t('dashboard.stockValue')} value={k ? eur(k.stock_value) : '—'} icon={Boxes} />
        <KpiCard label={t('dashboard.vehiclesInStock')} value={k ? String(k.vehicles_in_stock) : '—'} icon={Bike} />
      </div>
    </>
  );
}
