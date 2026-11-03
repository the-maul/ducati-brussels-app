/**
 * Parametres → Postes et peripheriques (PDV030). La route ne fait que cabler l'ecran du module
 * (src/modules/settings/devices-screen.tsx) ; garde admin dans _app.settings.tsx.
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { DevicesScreen } from '@/modules/settings/devices-screen';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/settings/devices')({
  head: () => ({ meta: [{ title: t('devices.pageTitle') }] }),
  component: DevicesSettingsPage,
});

function DevicesSettingsPage() {
  const navigate = useNavigate();
  const { activeCompanyId } = useAuth();
  if (!activeCompanyId) return null;
  return (
    <>
      <PageHeader
        title={t('devices.title')}
        description={t('devices.subtitle')}
        actions={<Button variant="outline" onClick={() => navigate({ to: '/settings' })}><ArrowLeft /> {t('devices.back')}</Button>}
      />
      <DevicesScreen companyId={activeCompanyId} />
    </>
  );
}
