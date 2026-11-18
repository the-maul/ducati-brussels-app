import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { EditionScreen } from '@/modules/stock/edition-screen';
import { t, pageTitle } from '@/lib/i18n';

export const Route = createFileRoute('/_app/stock/edition')({
  head: () => ({ meta: [{ title: pageTitle('stockEdition') }] }),
  component: StockEditionPage,
});

function StockEditionPage() {
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  if (!activeCompanyId) return null;
  return (
    <>
      <PageHeader
        title={t('stockG8.edition.title')}
        description={t('stockG8.edition.subtitle')}
        actions={<Button variant="outline" onClick={() => navigate({ to: '/stock' })}><ArrowLeft /> {t('stock.title')}</Button>}
      />
      <EditionScreen companyId={activeCompanyId} />
    </>
  );
}
