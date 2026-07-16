import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { RepriseWizard } from '@/modules/tradein/reprise-wizard';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/tradein/new')({
  head: () => ({ meta: [{ title: 'Nouvelle reprise moto — Ducati Bruxelles' }] }),
  component: NewReprise,
});

function NewReprise() {
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  if (!activeCompanyId) return null;

  return (
    <>
      <PageHeader
        title={t('tradein.newMoto')}
        actions={<Button variant="outline" onClick={() => navigate({ to: '/tradein' })}><ArrowLeft /> {t('tradein.back')}</Button>}
      />
      <RepriseWizard companyId={activeCompanyId} />
    </>
  );
}
