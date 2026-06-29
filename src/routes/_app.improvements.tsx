import { createFileRoute } from '@tanstack/react-router';
import { ShieldAlert } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { ImprovementsBoard } from '@/modules/improvements/board';
import { useAuth } from '@/lib/auth/auth-context';
import { t } from '@/lib/i18n';

/** Page Améliorations : board de tâches partagé entre admins (garde admin). */
export const Route = createFileRoute('/_app/improvements')({
  head: () => ({ meta: [{ title: 'Améliorations — Ducati Bruxelles' }] }),
  component: ImprovementsPage,
});

function ImprovementsPage() {
  const { isAdmin, activeCompanyId } = useAuth();
  if (!isAdmin() || !activeCompanyId) {
    return (
      <>
        <PageHeader title={t('improvements.title')} />
        <div className="flex items-center gap-3 rounded-md border border-border bg-card p-6 text-sm text-muted-foreground">
          <ShieldAlert className="size-5 text-warning" />
          {t('improvements.notAdmin')}
        </div>
      </>
    );
  }
  return (
    <>
      <PageHeader title={t('improvements.title')} description={t('improvements.subtitle')} />
      <ImprovementsBoard companyId={activeCompanyId} />
    </>
  );
}
