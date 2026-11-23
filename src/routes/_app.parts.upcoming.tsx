import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ShoppingCart } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { useReadOnly } from '@/lib/auth/read-only-context';
import { t, pageTitle } from '@/lib/i18n';
import { UpcomingPartsScreen } from '@/modules/workshop/reservations/upcoming-parts-screen';
import { PartsFlowNav } from '@/modules/purchases/parts-flow-nav';
import { PartsInProgress } from '@/modules/purchases/parts-in-progress';

/**
 * M5 / M8 — « Pieces des RDV a venir » (lot B du parcours mecanicien, 19/11/2026) : l'ecran du
 * magasin. La logique est dans src/modules/workshop/reservations/ (upcoming-parts-screen.tsx).
 * C2 (23/11/2026) : la même adresse porte aussi la vue d'ensemble « Pièces en cours » (?view=encours).
 * Sans paramètre, l'écran des RDV reste affiché : les liens existants de l'atelier ne changent pas.
 */
export const Route = createFileRoute('/_app/parts/upcoming')({
  head: () => ({ meta: [{ title: pageTitle('partsUpcoming') }] }),
  validateSearch: (s: Record<string, unknown>): { view?: 'encours' } => (s.view === 'encours' ? { view: 'encours' } : {}),
  component: UpcomingPartsPage,
});

function UpcomingPartsPage() {
  const { activeCompanyId } = useAuth();
  const readOnly = useReadOnly();
  const navigate = useNavigate();
  const { view } = Route.useSearch();
  const inProgress = view === 'encours';
  const title = inProgress ? t('partPath.inProgressTitle') : t('upcomingParts.title');
  return (
    <>
      <PartsFlowNav current={inProgress ? 'inProgress' : 'rdv'} />
      <PageHeader
        title={title}
        description={inProgress ? t('partPath.inProgressSubtitle') : t('upcomingParts.subtitle')}
        breadcrumbs={[{ label: t('nav.parts'), to: '/parts' }, { label: title }]}
        actions={
          <Button variant="outline" onClick={() => navigate({ to: '/purchases/baskets' })}>
            <ShoppingCart /> {t('upcomingParts.baskets')}
          </Button>
        }
      />
      {activeCompanyId && (inProgress
        ? <PartsInProgress companyId={activeCompanyId} />
        : <UpcomingPartsScreen companyId={activeCompanyId} readOnly={readOnly} />)}
    </>
  );
}
