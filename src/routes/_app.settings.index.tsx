import { createFileRoute, Link } from '@tanstack/react-router';
import { Users, Hash } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/settings/')({
  head: () => ({ meta: [{ title: 'Paramètres — Ducati Bruxelles' }] }),
  component: SettingsIndex,
});

function SettingsIndex() {
  return (
    <>
      <PageHeader title={t('settings.title')} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Link
          to="/settings/users"
          className="flex flex-col gap-2 rounded-md border border-border bg-card p-5 shadow-[var(--shadow-card)] transition-colors hover:border-ring/40"
        >
          <Users className="size-6 text-primary" />
          <span className="font-ui text-[15px] font-bold">{t('settings.users')}</span>
          <span className="text-sm text-muted-foreground">{t('settings.usersDesc')}</span>
        </Link>

        <div className="flex flex-col gap-2 rounded-md border border-dashed border-border bg-card p-5 opacity-70">
          <Hash className="size-6 text-muted-foreground" />
          <span className="font-ui text-[15px] font-bold">{t('settings.numbering')}</span>
          <span className="text-sm text-muted-foreground">{t('settings.numberingDesc')}</span>
        </div>
      </div>
    </>
  );
}
