/**
 * M8 — Chantier C1 (23/11/2026) : dossier moto en 4 étapes. `$id` = un OR ou un RDV.
 * `?etape=` garde l'étape regardée dans l'adresse ; absente, le dossier s'ouvre à l'étape en cours.
 */
import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '@/components/layout/page-header';
import { useAuth } from '@/lib/auth/auth-context';
import { DossierScreen } from '@/modules/workshop/dossier/dossier-screen';
import { isDossierStep, type DossierStepKey } from '@/modules/workshop/dossier/rules';
import { isOrRouteId } from '@/modules/workshop/or-base/route-id';
import { pageTitle, t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/workshop/dossier/$id')({
  validateSearch: (s: Record<string, unknown>): { etape?: DossierStepKey } => (isDossierStep(s.etape) ? { etape: s.etape } : {}),
  head: () => ({ meta: [{ title: pageTitle('workshopDossier') }] }),
  component: DossierRoute,
});

function DossierRoute() {
  const { id } = Route.useParams();
  const { etape } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { activeCompanyId } = useAuth();
  return (
    <>
      <PageHeader
        title={t('dossier.title')}
        breadcrumbs={[
          { label: t('nav.workshop'), to: '/workshop' },
          { label: t('pageTitles.workshopMine'), to: '/workshop/my-workshop' },
          { label: t('dossier.title') },
        ]}
      />
      {!isOrRouteId(id)
        ? <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{t('dossier.notFound')}</p>
        : activeCompanyId && (
          <DossierScreen
            key={id} id={id} companyId={activeCompanyId} wanted={etape ?? null}
            onStep={(s) => navigate({ search: s ? { etape: s } : {}, replace: true })}
          />
        )}
    </>
  );
}
