/**
 * Parametres -> Paiement Stripe (mission 12, carte P3, PDV040) : QR Bancontact / carte sans supplement.
 * Reserve aux administrateurs par la garde de _app.settings.tsx. Tout est dans
 * src/modules/sales/stripe-settings.tsx.
 */
import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '@/components/layout/page-header';
import { StripeSettingsPanel } from '@/modules/sales/stripe-settings';
import { useAuth } from '@/lib/auth/auth-context';
import { t, pageTitle } from '@/lib/i18n';

export const Route = createFileRoute('/_app/settings/stripe')({
  head: () => ({ meta: [{ title: pageTitle('stripeSettings') }] }),
  component: StripeSettingsPage,
});

function StripeSettingsPage() {
  const { activeCompanyId } = useAuth();
  return (
    <>
      <PageHeader
        title={t('stripePay.settingsTitle')}
        breadcrumbs={[{ label: t('settings.title'), to: '/settings' }, { label: t('stripePay.settingsTitle') }]}
      />
      {activeCompanyId && <StripeSettingsPanel companyId={activeCompanyId} />}
    </>
  );
}
