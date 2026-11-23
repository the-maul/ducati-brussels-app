/**
 * M8 — Parcours d'entretien pas à pas d'un OR (mission 07).
 * Écran plein cadre pensé pour la tablette de l'atelier : l'en-tête reste court, tout le reste
 * est donné au manuel.
 */
import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '@/components/layout/page-header';
import { useAuth } from '@/lib/auth/auth-context';
import { JourneyScreen } from '@/modules/workshop/journey/journey-screen';
import { OperationExplodedButton } from '@/modules/workshop/exploded/operation-exploded-button';
import { t, pageTitle } from '@/lib/i18n';

export const Route = createFileRoute('/_app/workshop/journey/$orId')({
  head: () => ({ meta: [{ title: pageTitle('workshopJourney') }] }),
  // Lot D (19/11) : `?op=op3` ouvre directement le mode operatoire de l'operation (fiche OR).
  validateSearch: (s: Record<string, unknown>): { op?: string } => (typeof s.op === 'string' && s.op ? { op: s.op } : {}),
  component: JourneyRoute,
});

function JourneyRoute() {
  const { orId } = Route.useParams();
  const { op } = Route.useSearch();
  const { activeCompanyId } = useAuth();

  return (
    <>
      <PageHeader
        title={t('journey.title')}
        description={t('journey.subtitle')}
        // Revue UX/UI (20/11/2026) : un seul « Retour » par ecran, celui de l'ossature. La fiche OR
        // reste accessible depuis le dossier moto (Atelier › Dossier moto › Parcours guide).
        breadcrumbs={[
          { label: t('nav.workshop'), to: '/workshop' },
          { label: t('dossier.title'), to: `/workshop/dossier/${orId}` },
          { label: t('journey.title') },
        ]}
      />
      {activeCompanyId && (
        <JourneyScreen
          orId={orId}
          companyId={activeCompanyId}
          initialOp={op ?? null}
          // Lot E integre au parcours (lot F, 19/11) : « Voir sur la vue eclatee » par operation.
          operationExtra={(info) => <OperationExplodedButton info={info} companyId={activeCompanyId} />}
        />
      )}
    </>
  );
}
