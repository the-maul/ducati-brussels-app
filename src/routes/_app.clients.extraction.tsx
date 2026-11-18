import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '@/components/layout/page-header';
import { useAuth } from '@/lib/auth/auth-context';
import { ExtractionScreen } from '@/modules/contacts/g8/extraction-screen';
import { t, pageTitle } from '@/lib/i18n';

// Rattrapage G8 du 18/11/2026 (lot-g8-clients) : écran repris de « Fichiers > Clients ».
export const Route = createFileRoute('/_app/clients/extraction')({
  head: () => ({ meta: [{ title: pageTitle('clientsExtraction') }] }),
  component: Page,
});

function Page() {
  const { activeCompanyId } = useAuth();
  if (!activeCompanyId) return null;
  return (
    <>
      <PageHeader
        title={t('g8c.extract.title')}
        description={t('g8c.extract.subtitle')}
        breadcrumbs={[{ label: t('contacts.title'), to: '/clients' }, { label: t('g8c.extract.title') }]}
      />
      <ExtractionScreen companyId={activeCompanyId} />
    </>
  );
}
