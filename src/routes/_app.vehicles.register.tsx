import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '@/components/layout/page-header';
import { RegisterScreen } from '@/modules/vehicles/register-screen';
import { useAuth } from '@/lib/auth/auth-context';
import { t, pageTitle } from '@/lib/i18n';

/** M3, VEH010 : Vehicules → « Registre des vehicules a moteur » (AR n° 1 art. 28). */
export const Route = createFileRoute('/_app/vehicles/register')({
  head: () => ({ meta: [{ title: pageTitle('vehiclesRegister') }] }),
  component: RegisterPage,
});

function RegisterPage() {
  const { activeCompanyId } = useAuth();
  if (!activeCompanyId) return null;
  return (
    <>
      <PageHeader
        title={t('vehicleRegister.title')}
        description={t('vehicleRegister.subtitle')}
        breadcrumbs={[{ label: t('vehicles.title'), to: '/vehicles' }, { label: t('vehicleRegister.title') }]}
      />
      <RegisterScreen companyId={activeCompanyId} />
    </>
  );
}
