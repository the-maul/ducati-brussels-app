import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '@/components/layout/page-header';
import { useAuth } from '@/lib/auth/auth-context';
import { MobileFixList } from '@/modules/contacts/mobile-fix';
import { t } from '@/lib/i18n';

// Mission 04, carte 3 : fiches G8 dont le GSM est dans « téléphone » et le mobile vide.
export const Route = createFileRoute('/_app/clients/mobiles')({
  head: () => ({ meta: [{ title: 'Mobiles à compléter — Ducati Bruxelles' }] }),
  component: MobilesToFix,
});

function MobilesToFix() {
  const { activeCompanyId } = useAuth();
  if (!activeCompanyId) return null;
  return (
    <>
      <PageHeader
        title={t('contacts.mobileFix.title')}
        description={t('contacts.mobileFix.subtitle')}
        breadcrumbs={[{ label: t('contacts.title'), to: '/clients' }, { label: t('contacts.mobileFix.title') }]}
      />
      <MobileFixList companyId={activeCompanyId} />
    </>
  );
}
