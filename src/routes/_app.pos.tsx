import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '@/components/layout/page-header';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useAuth } from '@/lib/auth/auth-context';
import { PosSale } from '@/modules/sales/pos-sale';
import { CashScreen } from '@/modules/sales/cash-screen';
import { ClosuresScreen } from '@/modules/sales/closures-screen';
import { pairingCodeFromSearch } from '@/modules/sales/customer-screen';
import { t, pageTitle } from '@/lib/i18n';

export const Route = createFileRoute('/_app/pos')({
  head: () => ({ meta: [{ title: pageTitle('pos') }] }),
  // ?ecran=XXXXXX : code d'appairage lu dans le QR de la tablette (écran client, PDV020).
  validateSearch: (s: Record<string, unknown>): { ecran?: string } => {
    const code = pairingCodeFromSearch(s.ecran);
    return code ? { ecran: code } : {};
  },
  component: PosPage,
});

function PosPage() {
  const { activeCompanyId, companies } = useAuth();
  const { ecran } = Route.useSearch();
  const [tab, setTab] = useState('sale');
  if (!activeCompanyId) return null;
  const companyName = companies.find((c) => c.id === activeCompanyId)?.name ?? '';
  return (
    <>
      <PageHeader title={t('cash.title')} description={t('cash.subtitle')} />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="sale">{t('pos.saleTab')}</TabsTrigger>
          <TabsTrigger value="session">{t('pos.sessionTab')}</TabsTrigger>
          <TabsTrigger value="closures">{t('pos.closuresTab')}</TabsTrigger>
        </TabsList>
        {/* Pas de vente caisse fermée (PDV010) : « Ouvrir la caisse » mène à l'onglet de la session. */}
        <TabsContent value="sale" className="mt-4"><PosSale companyId={activeCompanyId} companyName={companyName} onOpenCash={() => setTab('session')} screenCode={ecran ?? null} /></TabsContent>
        <TabsContent value="session" className="mt-4"><CashScreen companyId={activeCompanyId} /></TabsContent>
        <TabsContent value="closures" className="mt-4"><ClosuresScreen companyId={activeCompanyId} /></TabsContent>
      </Tabs>
    </>
  );
}
