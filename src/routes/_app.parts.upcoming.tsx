import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ShoppingCart } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { useReadOnly } from '@/lib/auth/read-only-context';
import { t, pageTitle } from '@/lib/i18n';
import { UpcomingPartsScreen } from '@/modules/workshop/reservations/upcoming-parts-screen';

/**
 * M5 / M8 — « Pieces des RDV a venir » (lot B du parcours mecanicien, 19/11/2026) : l'ecran du
 * magasin. La logique est dans src/modules/workshop/reservations/ (upcoming-parts-screen.tsx).
 */
export const Route = createFileRoute('/_app/parts/upcoming')({
  head: () => ({ meta: [{ title: pageTitle('partsUpcoming') }] }),
  component: UpcomingPartsPage,
});

function UpcomingPartsPage() {
  const { activeCompanyId } = useAuth();
  const readOnly = useReadOnly();
  const navigate = useNavigate();
  return (
    <>
      <PageHeader
        title={t('upcomingParts.title')}
        description={t('upcomingParts.subtitle')}
        breadcrumbs={[{ label: t('nav.parts'), to: '/parts' }, { label: t('upcomingParts.title') }]}
        actions={
          <Button variant="outline" onClick={() => navigate({ to: '/purchases/baskets' })}>
            <ShoppingCart /> {t('upcomingParts.baskets')}
          </Button>
        }
      />
      {activeCompanyId && <UpcomingPartsScreen companyId={activeCompanyId} readOnly={readOnly} />}
    </>
  );
}
