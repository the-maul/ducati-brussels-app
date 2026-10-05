import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, BookOpen } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { MaintenanceDueScreen } from '@/modules/workshop/maintenance-due-screen';
import { t } from '@/lib/i18n';

/** Entretiens à venir : l'entretien dû de chaque moto et les relances (mission 07, cartes 4 et 7). */
export const Route = createFileRoute('/_app/workshop/maintenance-due')({
  head: () => ({ meta: [{ title: 'Entretiens à venir — Ducati Bruxelles' }] }),
  component: MaintenanceDuePage,
});

function MaintenanceDuePage() {
  const navigate = useNavigate();
  return (
    <>
      <PageHeader
        title={t('maintenanceDue.title')}
        description={t('maintenanceDue.subtitle')}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => navigate({ to: '/workshop/maintenance-plans' })}>
              <BookOpen /> {t('maintenance.openBtn')}
            </Button>
            <Button variant="outline" onClick={() => navigate({ to: '/workshop' })}>
              <ArrowLeft /> {t('maintenanceDue.back')}
            </Button>
          </div>
        }
      />
      <MaintenanceDueScreen />
    </>
  );
}
