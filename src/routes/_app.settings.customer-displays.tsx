/**
 * Parametres -> Ecrans clients (PDV020, reserve aux administrateurs par la garde de _app.settings.tsx).
 * Tout le comportement est dans src/modules/sales/customer-displays-settings.tsx.
 */
import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '@/components/layout/page-header';
import { useAuth } from '@/lib/auth/auth-context';
import { CustomerDisplaysSettings } from '@/modules/sales/customer-displays-settings';
import { t, pageTitle } from '@/lib/i18n';

export const Route = createFileRoute('/_app/settings/customer-displays')({
  head: () => ({ meta: [{ title: pageTitle('customerDisplays') }] }),
  component: CustomerDisplaysPage,
});

function CustomerDisplaysPage() {
  const { activeCompanyId } = useAuth();
  return (
    <>
      <PageHeader title={t('customerScreen.settingsTitle')} description={t('customerScreen.settingsDesc')} />
      {activeCompanyId && <CustomerDisplaysSettings companyId={activeCompanyId} />}
    </>
  );
}
