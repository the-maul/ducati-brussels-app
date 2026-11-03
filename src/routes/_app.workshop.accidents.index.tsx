import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { AccidentFilesList } from '@/modules/workshop/accident/accident-files-list';
import { t, pageTitle } from '@/lib/i18n';

/** Dossiers accident (mission 09, carte 5, ACH005) : liste ; un dossier s'ouvre depuis un OR ou un devis. */
export const Route = createFileRoute('/_app/workshop/accidents/')({
  head: () => ({ meta: [{ title: pageTitle('workshopAccidents') }] }),
  component: AccidentsPage,
});

function AccidentsPage() {
  const navigate = useNavigate();
  const { activeCompanyId } = useAuth();
  return (
    <>
      <PageHeader
        title={t('accidentFile.title')}
        description={t('accidentFile.subtitle')}
        breadcrumbs={[{ label: t('nav.workshop'), to: '/workshop' }, { label: t('accidentFile.title') }]}
        actions={<Button variant="outline" onClick={() => navigate({ to: '/workshop' })}><ArrowLeft /> {t('workshop.back')}</Button>}
      />
      {activeCompanyId && <AccidentFilesList companyId={activeCompanyId} />}
    </>
  );
}
