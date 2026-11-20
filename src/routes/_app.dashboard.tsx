import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Euro, Wrench, Bike, Boxes, FileText, CalendarRange, AlertCircle } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { KpiCard } from '@/components/kpi-card';
import { useAuth } from '@/lib/auth/auth-context';
import { getDashboardKpis } from '@/modules/reports/api';
import { t, pageTitle, fillVars } from '@/lib/i18n';
import type { DashboardRevenue } from '@/modules/reports/dashboard-revenue';

export const Route = createFileRoute('/_app/dashboard')({
  head: () => ({ meta: [{ title: pageTitle('dashboard') }] }),
  component: Dashboard,
});

const eur = (n: number) => `${Math.round(n).toLocaleString('fr-BE')} €`;

/** Carte CA (Q66) : CA HT hors dépôt-vente en grand, y compris dépôt-vente dessous ; ancien CA TTC sans la migration. */
const revenueCard = (rev: DashboardRevenue | undefined, htLabel: string, oldLabel: string) => ({
  label: rev && !rev.ht ? oldLabel : htLabel,
  value: rev ? eur(rev.main) : '—',
  detail: rev?.ht && rev.withConsignment !== null ? fillVars(t('dashboardCa.withConsignment'), { amount: eur(rev.withConsignment) }) : undefined,
  title: rev?.ht ? t('dashboardCa.hint') : undefined,
});

function Dashboard() {
  const { activeCompanyId } = useAuth();
  const { data } = useQuery({ queryKey: ['dashboard-kpis', activeCompanyId], queryFn: () => getDashboardKpis(activeCompanyId!), enabled: !!activeCompanyId });
  const k = data;

  return (
    <>
      <PageHeader title={t('nav.dashboard')} description={t('app.tagline')} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard {...revenueCard(k?.revenue.today, t('dashboardCa.todayHt'), t('dashboard.revenueToday'))} icon={Euro} />
        <KpiCard {...revenueCard(k?.revenue.month, t('dashboardCa.monthHt'), t('dashboard.revenueMonth'))} icon={CalendarRange} />
        <KpiCard label={t('dashboard.invoicesMonth')} value={k ? String(k.invoices_month) : '—'} icon={FileText} />
        <KpiCard label={t('dashboard.receivables')} value={k ? eur(k.receivables) : '—'} deltaTone={k && k.receivables > 0 ? 'danger' : undefined} icon={AlertCircle} />
        <KpiCard label={t('dashboard.orOpen')} value={k ? String(k.or_open) : '—'} icon={Wrench} />
        <KpiCard label={t('dashboard.stockValue')} value={k ? eur(k.stock_value) : '—'} icon={Boxes} />
        <KpiCard label={t('dashboard.vehiclesInStock')} value={k ? String(k.vehicles_in_stock) : '—'} icon={Bike} />
      </div>
    </>
  );
}
