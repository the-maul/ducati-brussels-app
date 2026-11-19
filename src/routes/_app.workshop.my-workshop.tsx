/**
 * M8 — Ecran tablette « Mon atelier » (lot F du parcours mecanicien, 19/11/2026).
 * La route ne fait que cabler le module : src/modules/workshop/my-workshop/.
 * Memes droits que l'atelier (grille des droits, alias /workshop).
 */
import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '@/components/layout/page-header';
import { useAuth } from '@/lib/auth/auth-context';
import { MyWorkshopScreen } from '@/modules/workshop/my-workshop/my-workshop-screen';
import { t, pageTitle } from '@/lib/i18n';

export const Route = createFileRoute('/_app/workshop/my-workshop')({
  head: () => ({ meta: [{ title: pageTitle('workshopMine') }] }),
  component: MyWorkshopRoute,
});

function MyWorkshopRoute() {
  const { activeCompanyId } = useAuth();
  return (
    <>
      <PageHeader
        title={t('myWorkshop.title')}
        description={t('myWorkshop.subtitle')}
        breadcrumbs={[{ label: t('nav.workshop'), to: '/workshop' }, { label: t('myWorkshop.title') }]}
      />
      {activeCompanyId && <MyWorkshopScreen companyId={activeCompanyId} />}
    </>
  );
}
