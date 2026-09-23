import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, ClipboardList } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { KitsScreen } from '@/modules/workshop/kits/kits-screen';
import { t } from '@/lib/i18n';

/** Kits de pièces d'entretien par famille de moteur (mission 07, carte 2, M-20, ATE013). */
export const Route = createFileRoute('/_app/workshop/kits')({
  head: () => ({ meta: [{ title: 'Kits d’entretien — Ducati Bruxelles' }] }),
  component: KitsPage,
});

function KitsPage() {
  const navigate = useNavigate();
  const { activeCompanyId } = useAuth();
  return (
    <>
      <PageHeader
        title={t('kits.title')}
        description={t('kits.subtitle')}
        breadcrumbs={[{ label: t('nav.workshop'), to: '/workshop' }, { label: t('kits.title') }]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => navigate({ to: '/workshop/maintenance-plans' })}>
              <ClipboardList /> {t('maintenance.title')}
            </Button>
            <Button variant="outline" onClick={() => navigate({ to: '/workshop' })}><ArrowLeft /> {t('maintenance.back')}</Button>
          </div>
        }
      />
      {activeCompanyId ? <KitsScreen companyId={activeCompanyId} /> : null}
    </>
  );
}
