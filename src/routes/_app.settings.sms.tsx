/**
 * Parametres -> SMS (lot SMS Brevo, 18/11/2026, T14 / T15) : connexion Brevo, envoi arrete / test /
 * actif, modeles, SMS de test, SMS programmes. Reserve aux administrateurs par la garde de
 * _app.settings.tsx. Tout est dans src/modules/crm/sms-settings-panel.tsx.
 */
import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '@/components/layout/page-header';
import { SmsSettingsPanel } from '@/modules/crm/sms-settings-panel';
import { useAuth } from '@/lib/auth/auth-context';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/settings/sms')({
  head: () => ({ meta: [{ title: `${t('sms.pageTitle')} — ${t('app.name')}` }] }),
  component: SmsSettingsPage,
});

function SmsSettingsPage() {
  const { activeCompanyId } = useAuth();
  return (
    <>
      <PageHeader
        title={t('sms.settingsTitle')}
        breadcrumbs={[{ label: t('settings.title'), to: '/settings' }, { label: t('sms.settingsTitle') }]}
      />
      {activeCompanyId && <SmsSettingsPanel companyId={activeCompanyId} />}
    </>
  );
}
