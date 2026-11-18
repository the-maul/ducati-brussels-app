import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Landmark } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/lib/auth/auth-context';
import { useAccessTo, usePageAccess } from '@/lib/auth/use-access';
import { loadPdfCompany } from '@/modules/receivables/helpers';
import { DeferredTab } from '@/modules/receivables/deferred-tab';
import { DunningTab } from '@/modules/receivables/dunning-tab';
import { DebtorsTab } from '@/modules/receivables/debtors-tab';
import { VouchersTab } from '@/modules/receivables/vouchers-tab';
import { TemplatesTab } from '@/modules/receivables/templates-tab';
import { t, pageTitle } from '@/lib/i18n';

/**
 * Encaissements (rattrapage G8, 18/11/2026) — G8 Facturation > Encaissements : chèques et
 * échéances à venir, relances d'impayés (envoi en TEST uniquement), clients débiteurs /
 * créditeurs, bons d'achat, modèles de lettres et réglages. Prélèvements SEPA : Comptabilité.
 * Droits : ceux de « Soldes à encaisser » (alias dans `permissions.ts`).
 */
export const Route = createFileRoute('/_app/sales/receivables')({
  head: () => ({ meta: [{ title: pageTitle('salesReceivables') }] }),
  component: ReceivablesPage,
});

function ReceivablesPage() {
  const { activeCompanyId, isAdmin } = useAuth();
  const { canWrite } = usePageAccess();
  const sepaAccess = useAccessTo('/accounting-sepa');
  const companyQ = useQuery({ queryKey: ['pdf-company', activeCompanyId], queryFn: () => loadPdfCompany(activeCompanyId!), enabled: !!activeCompanyId, staleTime: 300_000 });
  if (!activeCompanyId) return null;
  const companyName = companyQ.data?.name ?? '';
  return (
    <>
      <PageHeader
        title={t('receivables.title')}
        description={t('receivables.subtitle')}
        breadcrumbs={[{ label: t('nav.sales'), to: '/sales' }, { label: t('openBalances.title'), to: '/sales/balances' }, { label: t('receivables.title') }]}
        actions={sepaAccess !== 'none' ? <Button variant="outline" asChild><Link to="/accounting-sepa"><Landmark /> {t('receivables.sepaLink')}</Link></Button> : undefined}
      />
      <Tabs defaultValue="echeances">
        <TabsList>
          <TabsTrigger value="echeances">{t('receivables.tabDeferred')}</TabsTrigger>
          <TabsTrigger value="relances">{t('receivables.tabDunning')}</TabsTrigger>
          <TabsTrigger value="debiteurs">{t('receivables.tabDebtors')}</TabsTrigger>
          <TabsTrigger value="bons">{t('receivables.tabVouchers')}</TabsTrigger>
          <TabsTrigger value="modeles">{t('receivables.tabTemplates')}</TabsTrigger>
        </TabsList>
        <TabsContent value="echeances" className="mt-4"><DeferredTab companyId={activeCompanyId} companyName={companyName} canWrite={canWrite} /></TabsContent>
        <TabsContent value="relances" className="mt-4"><DunningTab companyId={activeCompanyId} canWrite={canWrite} /></TabsContent>
        <TabsContent value="debiteurs" className="mt-4"><DebtorsTab companyId={activeCompanyId} companyName={companyName} canWrite={canWrite} /></TabsContent>
        <TabsContent value="bons" className="mt-4"><VouchersTab companyId={activeCompanyId} canWrite={canWrite} /></TabsContent>
        <TabsContent value="modeles" className="mt-4"><TemplatesTab companyId={activeCompanyId} canWrite={canWrite} isAdmin={isAdmin(activeCompanyId)} /></TabsContent>
      </Tabs>
    </>
  );
}
