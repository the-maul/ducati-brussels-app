import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { MaintenancePlansScreen } from '@/modules/workshop/maintenance-plans-screen';
import { t } from '@/lib/i18n';

/** Plans d'entretien Ducati par modèle et par année (mission 07, carte 1, ATE014). */
export const Route = createFileRoute('/_app/workshop/maintenance-plans')({
  head: () => ({ meta: [{ title: 'Plans d’entretien — Ducati Bruxelles' }] }),
  component: MaintenancePlansPage,
});

function MaintenancePlansPage() {
  const navigate = useNavigate();
  return (
    <>
      <PageHeader
        title={t('maintenance.title')}
        description={t('maintenance.subtitle')}
        actions={<Button variant="outline" onClick={() => navigate({ to: '/workshop' })}><ArrowLeft /> {t('maintenance.back')}</Button>}
      />
      <MaintenancePlansScreen />
    </>
  );
}
