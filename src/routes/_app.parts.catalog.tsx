import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/lib/auth/auth-context';
import { CatalogBrowser } from '@/modules/catalog/catalog-browser';
import { CatalogImportStatus } from '@/modules/catalog/import-status';
import { t } from '@/lib/i18n';

/** Catalogue Ducati (mission 06, cartes 2 et 3) : consultation et état de l'import. */
export const Route = createFileRoute('/_app/parts/catalog')({
  head: () => ({ meta: [{ title: 'Catalogue Ducati — Ducati Bruxelles' }] }),
  component: CatalogPage,
});

function CatalogPage() {
  const navigate = useNavigate();
  const { activeCompanyId } = useAuth();
  return (
    <>
      <PageHeader
        title={t('catalog.title')}
        description={t('catalog.subtitle')}
        actions={<Button variant="outline" onClick={() => navigate({ to: '/parts' })}><ArrowLeft /> {t('catalog.backToParts')}</Button>}
      />
      <Tabs defaultValue="browse">
        <TabsList>
          <TabsTrigger value="browse">{t('catalog.tabBrowse')}</TabsTrigger>
          <TabsTrigger value="import">{t('catalog.tabImport')}</TabsTrigger>
        </TabsList>
        <TabsContent value="browse" className="mt-3"><CatalogBrowser companyId={activeCompanyId} /></TabsContent>
        <TabsContent value="import" className="mt-3"><CatalogImportStatus /></TabsContent>
      </Tabs>
    </>
  );
}
