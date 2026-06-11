import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '@/components/layout/page-header';
import { useAuth } from '@/lib/auth/auth-context';
import { CashScreen } from '@/modules/sales/cash-screen';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/pos')({
  head: () => ({ meta: [{ title: 'Caisse — Ducati Bruxelles' }] }),
  component: PosPage,
});

function PosPage() {
  const { activeCompanyId } = useAuth();
  if (!activeCompanyId) return null;
  return (
    <>
      <PageHeader title={t('cash.title')} description={t('cash.subtitle')} />
      <CashScreen companyId={activeCompanyId} />
    </>
  );
}
