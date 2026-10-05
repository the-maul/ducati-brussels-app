import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/lib/auth/auth-context';
import { CatalogBrowser } from '@/modules/catalog/catalog-browser';
import { CatalogImportStatus } from '@/modules/catalog/import-status';
import { CatalogUpdatePanel } from '@/modules/catalog/update-panel';
import { t } from '@/lib/i18n';

/** Catalogue Ducati (mission 06, cartes 2, 3 et 6) : consultation, état de l'import, mise à jour. */
/** Lien direct : ?my=<modèle-année>&drawing=<vue éclatée>&ref=<référence à surligner>, ou ?ref= seul (fiche référence). */
export type CatalogSearch = { my?: string; drawing?: string; ref?: string; tab?: 'import' | 'update' };

const str = (v: unknown) => (typeof v === 'string' && v ? v.slice(0, 80) : typeof v === 'number' ? String(v) : undefined);

export const Route = createFileRoute('/_app/parts/catalog')({
  validateSearch: (s: Record<string, unknown>): CatalogSearch => ({
    my: str(s.my), drawing: str(s.drawing), ref: str(s.ref),
    tab: s.tab === 'import' ? 'import' : s.tab === 'update' ? 'update' : undefined,
  }),
  head: () => ({ meta: [{ title: 'Catalogue Ducati — Ducati Bruxelles' }] }),
  component: CatalogPage,
});

function CatalogPage() {
  const navigate = useNavigate();
  const { activeCompanyId } = useAuth();
  const search = Route.useSearch();
  const setSearch = (next: CatalogSearch) => navigate({ to: '/parts/catalog', search: next });
  return (
    <>
      <PageHeader
        title={t('catalog.title')}
        description={t('catalog.subtitle')}
        actions={<Button variant="outline" onClick={() => navigate({ to: '/parts' })}><ArrowLeft /> {t('catalog.backToParts')}</Button>}
      />
      <Tabs value={search.tab ?? 'browse'}
        onValueChange={(v) => setSearch(v === 'import' || v === 'update' ? { tab: v } : {})}>
        <TabsList>
          <TabsTrigger value="browse">{t('catalog.tabBrowse')}</TabsTrigger>
          <TabsTrigger value="import">{t('catalog.tabImport')}</TabsTrigger>
          <TabsTrigger value="update">{t('catalog.tabUpdate')}</TabsTrigger>
        </TabsList>
        <TabsContent value="browse" className="mt-3"><CatalogBrowser companyId={activeCompanyId} search={search} onSearch={setSearch} /></TabsContent>
        <TabsContent value="import" className="mt-3"><CatalogImportStatus companyId={activeCompanyId} /></TabsContent>
        <TabsContent value="update" className="mt-3"><CatalogUpdatePanel companyId={activeCompanyId} /></TabsContent>
      </Tabs>
    </>
  );
}
