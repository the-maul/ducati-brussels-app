import { createFileRoute, Outlet } from '@tanstack/react-router';
import { ShieldAlert } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { useAuth } from '@/lib/auth/auth-context';
import { t } from '@/lib/i18n';

/** Layout Paramètres : garde admin commune à toutes les sous-pages. */
export const Route = createFileRoute('/_app/settings')({
  component: SettingsLayout,
});

function SettingsLayout() {
  const { isAdmin } = useAuth();
  if (!isAdmin()) {
    return (
      <>
        <PageHeader title={t('settings.title')} />
        <div className="flex items-center gap-3 rounded-md border border-border bg-card p-6 text-sm text-muted-foreground">
          <ShieldAlert className="size-5 text-warning" />
          {t('settings.notAdmin')}
        </div>
      </>
    );
  }
  return <Outlet />;
}
