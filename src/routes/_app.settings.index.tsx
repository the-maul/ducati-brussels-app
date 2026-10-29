import { createFileRoute, Link } from '@tanstack/react-router';
import { Users, Hash, Table2, Database, Building2, Puzzle, TabletSmartphone, Smartphone, MessageSquareText, GitMerge, Percent } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { t, pageTitle } from '@/lib/i18n';

export const Route = createFileRoute('/_app/settings/')({
  head: () => ({ meta: [{ title: pageTitle('settings') }] }),
  component: SettingsIndex,
});

function SettingsIndex() {
  return (
    <>
      <PageHeader title={t('settings.title')} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {/* Rapprochements : sorti du menu principal le 28/10/2026, la file est tombee a 8 cas.
            Il reste ici parce qu'il porte aussi les liens Shopify et la creation des articles
            manquants, et que de nouveaux cas apparaissent a chaque import de tarif. */}
        <Link
          to="/parts/links"
          className="flex flex-col gap-2 rounded-md border border-border bg-card p-5 shadow-[var(--shadow-card)] transition-colors hover:border-ring/40"
        >
          <GitMerge className="size-6 text-primary" />
          <span className="font-ui text-[15px] font-bold">{t('settings.links')}</span>
          <span className="text-sm text-muted-foreground">{t('settings.linksDesc')}</span>
        </Link>

        {/* Regles de prix : elles vivent sur l'ecran Import tarif (regles PPC, plancher,
            classes de remise pour le prix d'achat) ; cette carte y mene depuis Parametres. */}
        <Link
          to="/parts/import"
          className="flex flex-col gap-2 rounded-md border border-border bg-card p-5 shadow-[var(--shadow-card)] transition-colors hover:border-ring/40"
        >
          <Percent className="size-6 text-primary" />
          <span className="font-ui text-[15px] font-bold">{t('settings.priceRules')}</span>
          <span className="text-sm text-muted-foreground">{t('settings.priceRulesDesc')}</span>
        </Link>

        <Link
          to="/settings/companies"
          className="flex flex-col gap-2 rounded-md border border-border bg-card p-5 shadow-[var(--shadow-card)] transition-colors hover:border-ring/40"
        >
          <Building2 className="size-6 text-primary" />
          <span className="font-ui text-[15px] font-bold">{t('settings.companies')}</span>
          <span className="text-sm text-muted-foreground">{t('settings.companiesDesc')}</span>
        </Link>

        <Link
          to="/settings/users"
          className="flex flex-col gap-2 rounded-md border border-border bg-card p-5 shadow-[var(--shadow-card)] transition-colors hover:border-ring/40"
        >
          <Users className="size-6 text-primary" />
          <span className="font-ui text-[15px] font-bold">{t('settings.users')}</span>
          <span className="text-sm text-muted-foreground">{t('settings.usersDesc')}</span>
        </Link>

        <Link
          to="/settings/tables"
          className="flex flex-col gap-2 rounded-md border border-border bg-card p-5 shadow-[var(--shadow-card)] transition-colors hover:border-ring/40"
        >
          <Table2 className="size-6 text-primary" />
          <span className="font-ui text-[15px] font-bold">{t('settings.tablesTitle')}</span>
          <span className="text-sm text-muted-foreground">{t('settings.tablesDesc')}</span>
        </Link>

        <Link
          to="/settings/numbering"
          className="flex flex-col gap-2 rounded-md border border-border bg-card p-5 shadow-[var(--shadow-card)] transition-colors hover:border-ring/40"
        >
          <Hash className="size-6 text-primary" />
          <span className="font-ui text-[15px] font-bold">{t('settings.numbering')}</span>
          <span className="text-sm text-muted-foreground">{t('settings.numberingDesc')}</span>
        </Link>

        <Link
          to="/settings/comments"
          className="flex flex-col gap-2 rounded-md border border-border bg-card p-5 shadow-[var(--shadow-card)] transition-colors hover:border-ring/40"
        >
          <MessageSquareText className="size-6 text-primary" />
          <span className="font-ui text-[15px] font-bold">{t('settings.commentsTitle')}</span>
          <span className="text-sm text-muted-foreground">{t('settings.commentsDesc')}</span>
        </Link>

        <Link
          to="/settings/migration"
          className="flex flex-col gap-2 rounded-md border border-border bg-card p-5 shadow-[var(--shadow-card)] transition-colors hover:border-ring/40"
        >
          <Database className="size-6 text-primary" />
          <span className="font-ui text-[15px] font-bold">{t('migration.title')}</span>
          <span className="text-sm text-muted-foreground">{t('migration.subtitle')}</span>
        </Link>

        <Link
          to="/settings/kiosk"
          className="flex flex-col gap-2 rounded-md border border-border bg-card p-5 shadow-[var(--shadow-card)] transition-colors hover:border-ring/40"
        >
          <TabletSmartphone className="size-6 text-primary" />
          <span className="font-ui text-[15px] font-bold">{t('settings.kioskTitle')}</span>
          <span className="text-sm text-muted-foreground">{t('settings.kioskDesc')}</span>
        </Link>

        <Link
          to="/settings/app-client"
          className="flex flex-col gap-2 rounded-md border border-border bg-card p-5 shadow-[var(--shadow-card)] transition-colors hover:border-ring/40"
        >
          <Smartphone className="size-6 text-primary" />
          <span className="font-ui text-[15px] font-bold">{t('appClient.settings.cardTitle')}</span>
          <span className="text-sm text-muted-foreground">{t('appClient.settings.cardDesc')}</span>
        </Link>

        <Link
          to="/settings/extension"
          className="flex flex-col gap-2 rounded-md border border-border bg-card p-5 shadow-[var(--shadow-card)] transition-colors hover:border-ring/40"
        >
          <Puzzle className="size-6 text-primary" />
          <span className="font-ui text-[15px] font-bold">{t('settings.extTitle')}</span>
          <span className="text-sm text-muted-foreground">{t('settings.extDesc')}</span>
        </Link>
      </div>
    </>
  );
}
