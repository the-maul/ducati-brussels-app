import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { LabelsScreen } from '@/modules/stock/labels-screen';
import { t, pageTitle } from '@/lib/i18n';

export const Route = createFileRoute('/_app/stock/labels')({
  head: () => ({ meta: [{ title: pageTitle('stockLabels') }] }),
  component: StockLabelsPage,
});

function StockLabelsPage() {
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  if (!activeCompanyId) return null;
  return (
    <>
      <PageHeader
        title={t('stockG8.labels.title')}
        description={t('stockG8.labels.subtitle')}
        actions={<Button variant="outline" onClick={() => navigate({ to: '/stock' })}><ArrowLeft /> {t('stock.title')}</Button>}
      />
      <LabelsScreen companyId={activeCompanyId} />
    </>
  );
}
