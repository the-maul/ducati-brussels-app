import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { ReadjustScreen } from '@/modules/stock/readjust-screen';
import { t, pageTitle } from '@/lib/i18n';

export const Route = createFileRoute('/_app/stock/readjust')({
  head: () => ({ meta: [{ title: pageTitle('stockReadjust') }] }),
  component: StockReadjustPage,
});

function StockReadjustPage() {
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  if (!activeCompanyId) return null;
  return (
    <>
      <PageHeader
        title={t('stockG8.readjust.title')}
        description={t('stockG8.readjust.subtitle')}
        actions={<Button variant="outline" onClick={() => navigate({ to: '/stock' })}><ArrowLeft /> {t('stock.title')}</Button>}
      />
      <ReadjustScreen companyId={activeCompanyId} />
    </>
  );
}
