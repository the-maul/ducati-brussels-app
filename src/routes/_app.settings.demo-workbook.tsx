/**
 * Paramètres → Classeur Ducati de l'année (mission 09, carte 6). Revue UX/UI du 20/11/2026 : le
 * dépôt du fichier ne se fait plus dans la liste des Paramètres, il a sa page. Le dépôt
 * (administrateur seulement, GED privée de la société) est celui d'avant.
 */
import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '@/components/layout/page-header';
import { DemoTemplateCard } from '@/modules/orders/demo-template-card';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/settings/demo-workbook')({
  head: () => ({ meta: [{ title: `${t('designTransverse.demoWorkbookPage.title')} — ${t('app.name')}` }] }),
  component: DemoWorkbookSettingsPage,
});

function DemoWorkbookSettingsPage() {
  return (
    <>
      <PageHeader
        title={t('designTransverse.demoWorkbookPage.title')}
        description={t('designTransverse.demoWorkbookPage.subtitle')}
        breadcrumbs={[{ label: t('settings.title'), to: '/settings' }, { label: t('designTransverse.demoWorkbookPage.title') }]}
      />
      <div className="max-w-2xl">
        <DemoTemplateCard />
      </div>
    </>
  );
}
