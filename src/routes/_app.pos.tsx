import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '@/components/layout/page-header';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useAuth } from '@/lib/auth/auth-context';
import { PosSale } from '@/modules/sales/pos-sale';
import { CashScreen } from '@/modules/sales/cash-screen';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/pos')({
  head: () => ({ meta: [{ title: 'Caisse — Ducati Bruxelles' }] }),
  component: PosPage,
});

function PosPage() {
  const { activeCompanyId, companies } = useAuth();
  if (!activeCompanyId) return null;
  const companyName = companies.find((c) => c.id === activeCompanyId)?.name ?? '';
  return (
    <>
      <PageHeader title={t('cash.title')} description={t('cash.subtitle')} />
      <Tabs defaultValue="sale">
        <TabsList>
          <TabsTrigger value="sale">{t('pos.saleTab')}</TabsTrigger>
          <TabsTrigger value="session">{t('pos.sessionTab')}</TabsTrigger>
        </TabsList>
        <TabsContent value="sale" className="mt-4"><PosSale companyId={activeCompanyId} companyName={companyName} /></TabsContent>
        <TabsContent value="session" className="mt-4"><CashScreen companyId={activeCompanyId} /></TabsContent>
      </Tabs>
    </>
  );
}
