import { createFileRoute } from '@tanstack/react-router';
import { Euro, Wrench, Gauge, Bike } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { KpiCard } from '@/components/kpi-card';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/dashboard')({
  head: () => ({ meta: [{ title: 'Tableau de bord — Ducati Bruxelles' }] }),
  component: Dashboard,
});

function Dashboard() {
  return (
    <>
      <PageHeader title={t('nav.dashboard')} description={t('app.tagline')} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label={t('demo.kpiRevenueDay')} value="4 280 €" delta="+12 %" deltaTone="success" icon={Euro} />
        <KpiCard label={t('demo.kpiOrOpen')} value="7" delta="-2" deltaTone="danger" icon={Wrench} />
        <KpiCard label={t('demo.kpiOccupancy')} value="82 %" delta="+5 %" deltaTone="success" icon={Gauge} />
        <KpiCard label={t('demo.kpiStockVehicles')} value="23" icon={Bike} />
      </div>
      <p className="mt-6 text-sm text-muted-foreground">
        Données de démonstration — le tableau de bord sera alimenté par les modules (M13).
      </p>
    </>
  );
}
