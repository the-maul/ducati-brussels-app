import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/lib/auth/auth-context';
import { parseContactsCsv, applyContactsImport } from '@/modules/migration/contacts-import';
import { parseArticlesCsv, applyArticlesImport } from '@/modules/migration/articles-import';
import { parseVehiclesCsv, applyVehiclesImport } from '@/modules/migration/vehicles-import';
import { ImportPanel } from '@/modules/migration/import-panel';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/settings/migration')({
  head: () => ({ meta: [{ title: 'Migration & imports — Ducati Bruxelles' }] }),
  component: MigrationPage,
});

function MigrationPage() {
  const { activeCompanyId, isAdmin } = useAuth();
  const navigate = useNavigate();

  if (!isAdmin()) return <><PageHeader title={t('migration.title')} /><p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{t('settings.notAdmin')}</p></>;
  if (!activeCompanyId) return null;

  return (
    <>
      <PageHeader
        title={t('migration.title')}
        description={t('migration.subtitle')}
        actions={<Button variant="outline" onClick={() => navigate({ to: '/settings' })}><ArrowLeft /> {t('settings.title')}</Button>}
      />

      <Tabs defaultValue="contacts">
        <TabsList>
          <TabsTrigger value="contacts">{t('migration.tabContacts')}</TabsTrigger>
          <TabsTrigger value="articles">{t('migration.tabArticles')}</TabsTrigger>
          <TabsTrigger value="vehicles">{t('migration.tabVehicles')}</TabsTrigger>
        </TabsList>

        <TabsContent value="contacts" className="mt-4">
          <ImportPanel
            companyId={activeCompanyId}
            subtitle={t('migration.contactsSubtitle')}
            placeholder={'Nom;Prénom;Email;Ville;Type\nMoreau;Simon;simon@x.be;Bruxelles;particulier'}
            columns={[
              { key: 'name', label: t('migration.colName'), get: (p) => String(p.last_name ?? p.company_name ?? '') },
              { key: 'email', label: t('migration.colEmail'), get: (p) => String(p.email ?? '') },
              { key: 'city', label: t('migration.colCity'), get: (p) => String(p.city ?? '') },
              { key: 'type', label: t('migration.colType'), get: (p) => String(p.type ?? '') },
            ]}
            parse={parseContactsCsv}
            apply={applyContactsImport}
          />
        </TabsContent>

        <TabsContent value="articles" className="mt-4">
          <ImportPanel
            companyId={activeCompanyId}
            subtitle={t('migration.articlesHint')}
            placeholder={'Référence;Désignation;Prix TTC;Marque;Code-barres\n123-456;Plaquette de frein;89,90;Ducati;5410000000001'}
            columns={[
              { key: 'reference', label: t('migration.colReference'), get: (p) => String(p.reference ?? '') },
              { key: 'designation', label: t('migration.colDesignation'), get: (p) => String(p.designation ?? '') },
              { key: 'price', label: t('migration.colPrice'), get: (p) => (p.sale_price_ttc != null ? String(p.sale_price_ttc) : '') },
              { key: 'brand', label: t('migration.colBrand'), get: (p) => String(p.brand ?? '') },
            ]}
            parse={parseArticlesCsv}
            apply={applyArticlesImport}
          />
        </TabsContent>

        <TabsContent value="vehicles" className="mt-4">
          <ImportPanel
            companyId={activeCompanyId}
            subtitle={t('migration.vehiclesHint')}
            placeholder={'VIN;Modèle;Année;Immatriculation\nZDM1000AAAAA12345;Panigale V4;2024;1-ABC-123'}
            columns={[
              { key: 'vin', label: t('migration.colVin'), get: (p) => String(p.vin ?? '') },
              { key: 'model', label: t('migration.colModel'), get: (p) => String(p.model ?? '') },
              { key: 'year', label: t('migration.colYear'), get: (p) => (p.model_year != null ? String(p.model_year) : '') },
              { key: 'plate', label: t('migration.colPlate'), get: (p) => String(p.plate ?? '') },
            ]}
            parse={parseVehiclesCsv}
            apply={applyVehiclesImport}
          />
        </TabsContent>
      </Tabs>
    </>
  );
}
