import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '@/components/layout/page-header';
import { DeclaredVehiclesView } from '@/modules/vehicles/declarations-view';
import { useAuth } from '@/lib/auth/auth-context';
import { t } from '@/lib/i18n';

/** Mission 04, carte 8 : Véhicules → « Motos déclarées à valider ». */
export const Route = createFileRoute('/_app/vehicles/declarations')({
  head: () => ({ meta: [{ title: 'Motos déclarées à valider — Ducati Bruxelles' }] }),
  component: DeclarationsPage,
});

function DeclarationsPage() {
  const { activeCompanyId } = useAuth();
  if (!activeCompanyId) return null;
  return (
    <>
      <PageHeader
        title={t('motoClient.declTitle')}
        description={t('motoClient.declSubtitle')}
        breadcrumbs={[{ label: t('vehicles.title'), to: '/vehicles' }, { label: t('motoClient.declTitle') }]}
      />
      <DeclaredVehiclesView companyId={activeCompanyId} />
    </>
  );
}
