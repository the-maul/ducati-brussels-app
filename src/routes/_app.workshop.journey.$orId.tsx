/**
 * M8 — Parcours d'entretien pas à pas d'un OR (mission 07).
 * Écran plein cadre pensé pour la tablette de l'atelier : l'en-tête reste court, tout le reste
 * est donné au manuel.
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { PageHeader } from '@/components/layout/page-header';
import { useAuth } from '@/lib/auth/auth-context';
import { JourneyScreen } from '@/modules/workshop/journey/journey-screen';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/workshop/journey/$orId')({
  head: () => ({ meta: [{ title: 'Parcours d’entretien — Ducati Bruxelles' }] }),
  component: JourneyRoute,
});

function JourneyRoute() {
  const { orId } = Route.useParams();
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();

  return (
    <>
      <PageHeader
        title={t('journey.title')}
        description={t('journey.subtitle')}
        breadcrumbs={[{ label: t('nav.workshop'), to: '/workshop' }, { label: t('journey.title') }]}
      />
      {activeCompanyId && (
        <JourneyScreen
          orId={orId}
          companyId={activeCompanyId}
          onBackToOr={() => navigate({ to: '/workshop/$orId', params: { orId } })}
        />
      )}
    </>
  );
}
