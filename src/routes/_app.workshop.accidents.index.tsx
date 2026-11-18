import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { InsurancePartiesList } from '@/modules/workshop/accident/insurance-parties';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { AccidentFilesList } from '@/modules/workshop/accident/accident-files-list';
import { t, pageTitle } from '@/lib/i18n';

/** Dossiers accident (mission 09, carte 5, ACH005) : liste ; un dossier s'ouvre depuis un OR ou un devis. */
export const Route = createFileRoute('/_app/workshop/accidents/')({
  head: () => ({ meta: [{ title: pageTitle('workshopAccidents') }] }),
  component: AccidentsPage,
});

function AccidentsPage() {
  const navigate = useNavigate();
  const { activeCompanyId } = useAuth();
  // Onglet « Cabinets et experts » : le fichier des assureurs (G8 : Fiche assurance), rattrapage G8.
  const [tab, setTab] = useState<'files' | 'parties'>('files');
  return (
    <>
      <PageHeader
        title={t('accidentFile.title')}
        description={t('accidentFile.subtitle')}
        breadcrumbs={[{ label: t('nav.workshop'), to: '/workshop' }, { label: t('accidentFile.title') }]}
        actions={<Button variant="outline" onClick={() => navigate({ to: '/workshop' })}><ArrowLeft /> {t('workshop.back')}</Button>}
      />
      {activeCompanyId && (
        <Tabs value={tab} onValueChange={(v) => setTab(v as 'files' | 'parties')}>
          <TabsList>
            <TabsTrigger value="files">{t('insurance.tabFiles')}</TabsTrigger>
            <TabsTrigger value="parties">{t('insurance.tabParties')}</TabsTrigger>
          </TabsList>
          <TabsContent value="files" className="mt-3"><AccidentFilesList companyId={activeCompanyId} /></TabsContent>
          <TabsContent value="parties" className="mt-3"><InsurancePartiesList companyId={activeCompanyId} /></TabsContent>
        </Tabs>
      )}
    </>
  );
}
