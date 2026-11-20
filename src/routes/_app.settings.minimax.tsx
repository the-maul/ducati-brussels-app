/**
 * Paramètres → Réassort automatique (minimax, décision de Simon du 18/11/2026). Revue UX/UI du
 * 20/11/2026 : le réglage ne se modifie plus dans la liste des Paramètres, il a sa page. Le
 * formulaire (automatique / proposition manuelle, administrateur seulement) est celui d'avant.
 */
import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '@/components/layout/page-header';
import { MinimaxModeCard } from '@/modules/purchases/minimax-mode-card';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/settings/minimax')({
  head: () => ({ meta: [{ title: `${t('designTransverse.minimaxPage.title')} — ${t('app.name')}` }] }),
  component: MinimaxSettingsPage,
});

function MinimaxSettingsPage() {
  return (
    <>
      <PageHeader
        title={t('designTransverse.minimaxPage.title')}
        description={t('designTransverse.minimaxPage.subtitle')}
        breadcrumbs={[{ label: t('settings.title'), to: '/settings' }, { label: t('designTransverse.minimaxPage.title') }]}
      />
      <div className="max-w-2xl">
        <MinimaxModeCard />
      </div>
    </>
  );
}
