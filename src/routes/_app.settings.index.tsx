/**
 * M0 — Paramètres. Revue UX/UI du 20/11/2026 (propositions validées par Simon) :
 * - 4 groupes titrés : Société et utilisateurs · Documents et numérotation · Atelier et stock ·
 *   Envois et connexions ;
 * - une phrase d'aide sans jargon par carte (« dry-run », « PPC », « Rapprochements »… traduits) ;
 * - plus aucun réglage modifiable dans la liste : chaque carte mène à sa page (le réassort minimax
 *   et le classeur Ducati ont maintenant la leur), la mise en production ouvre sa fenêtre ;
 * - plus aucun bouton rouge sur cette page : la carte entière est le lien.
 */
import type { ReactNode } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import {
  Users, Hash, Table2, Database, Building2, Puzzle, TabletSmartphone, Smartphone, MessageSquareText, GitMerge,
  Percent, MonitorSmartphone, CreditCard, Printer, RefreshCcw, FileSpreadsheet, Mail, MessageCircle, ShoppingBag,
  Loader2, type LucideIcon,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { ModeBadge, useFollowupSettings } from '@/modules/crm/followup-mode-banner';
import { MinimaxModeBadge, useMinimaxMode } from '@/modules/purchases/minimax-mode-card';
import { ProductionCard } from '@/modules/settings/production-dialog';
import { SETTINGS_CARD_CLASS } from '@/modules/settings/settings-card';
import { useAuth } from '@/lib/auth/auth-context';
import { t, pageTitle } from '@/lib/i18n';

export const Route = createFileRoute('/_app/settings/')({
  head: () => ({ meta: [{ title: pageTitle('settings') }] }),
  component: SettingsIndex,
});

function CardBody({ icon: Icon, title, help, extra }: { icon: LucideIcon; title: string; help: string; extra?: ReactNode }) {
  return (
    <>
      <span className="flex items-center gap-2">
        <Icon className="size-5 shrink-0 text-primary" aria-hidden />
        <span className="font-ui text-[15px] font-bold">{title}</span>
      </span>
      <span className="text-sm text-muted-foreground">{help}</span>
      {extra}
    </>
  );
}

function SettingsLink({ to, icon, title, help, extra }: { to: string; icon: LucideIcon; title: string; help: string; extra?: ReactNode }) {
  return (
    <Link to={to} className={SETTINGS_CARD_CLASS}>
      <CardBody icon={icon} title={title} help={help} extra={extra} />
    </Link>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3" aria-label={title}>
      <h2 className="font-ui text-[17px] font-bold leading-6">{title}</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">{children}</div>
    </section>
  );
}

const h = (key: string) => t(`designTransverse.settings.${key}`);

function MinimaxLinkCard({ companyId }: { companyId: string | null }) {
  const q = useMinimaxMode(companyId);
  return (
    <SettingsLink
      to="/settings/minimax" icon={RefreshCcw} title={h('minimaxTitle')} help={h('minimax')}
      extra={q.isLoading ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : <MinimaxModeBadge mode={q.data ?? 'auto'} />}
    />
  );
}

function FollowupLinkCard({ companyId }: { companyId: string | null }) {
  const q = useFollowupSettings(companyId);
  return (
    <SettingsLink
      to="/crm/relances" icon={Mail} title={t('settings.followupModeTitle')} help={h('followups')}
      extra={q.isLoading || !q.data ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : <ModeBadge mode={q.data.mode} email={q.data.testRecipient} />}
    />
  );
}

function SettingsIndex() {
  const { activeCompanyId } = useAuth();
  return (
    <>
      <PageHeader title={t('settings.title')} />
      <div className="space-y-8">
        <Group title={h('group_company')}>
          <SettingsLink to="/settings/companies" icon={Building2} title={t('settings.companies')} help={h('companies')} />
          <SettingsLink to="/settings/users" icon={Users} title={t('settings.users')} help={h('users')} />
          {/* PDV030 : postes et peripheriques (aucun materiel impose, un appareil par role et par poste). */}
          <SettingsLink to="/settings/devices" icon={Printer} title={t('devices.cardTitle')} help={h('devices')} />
          <SettingsLink to="/settings/kiosk" icon={TabletSmartphone} title={t('settings.kioskTitle')} help={h('kiosk')} />
          {/* PDV020 : tablettes appairees face au client (ecran client de la caisse). */}
          <SettingsLink to="/settings/customer-displays" icon={MonitorSmartphone} title={t('customerScreen.settingsTitle')} help={h('customerDisplays')} />
        </Group>

        <Group title={h('group_documents')}>
          <SettingsLink to="/settings/numbering" icon={Hash} title={t('settings.numbering')} help={h('numbering')} />
          <SettingsLink to="/settings/comments" icon={MessageSquareText} title={t('settings.commentsTitle')} help={h('comments')} />
          <SettingsLink to="/settings/tables" icon={Table2} title={h('tablesTitle')} help={h('tables')} />
          <SettingsLink to="/settings/migration" icon={Database} title={h('importTitle')} help={h('import')} />
        </Group>

        <Group title={h('group_workshop')}>
          {/* Rapprochements : sorti du menu principal le 28/10/2026 ; il porte aussi les liens Shopify
              et la creation des articles manquants (nouveaux cas a chaque import de tarif). */}
          <SettingsLink to="/parts/links" icon={GitMerge} title={h('linksTitle')} help={h('links')} />
          {/* Regles de prix : elles vivent sur l'ecran Import tarif (PPC, plancher, classes de remise). */}
          <SettingsLink to="/parts/import" icon={Percent} title={t('settings.priceRules')} help={h('priceRules')} />
          {/* Reassort minimax (18/11/2026) : automatique (defaut) ou proposition manuelle, par societe. */}
          <MinimaxLinkCard companyId={activeCompanyId} />
          {/* Mission 09 carte 6 : le classeur Ducati vierge (prix concession), depose une fois par an. */}
          <SettingsLink to="/settings/demo-workbook" icon={FileSpreadsheet} title={t('demoOrder.settingsCard')} help={h('demoWorkbook')} />
        </Group>

        <Group title={h('group_connections')}>
          {/* Mise en production (19/11/2026) : tout ce qui sort, Arrete / Test / Actif, administrateurs. */}
          <ProductionCard />
          {/* CRM011 : interrupteur des relances (Arrete / Test / Actif), reglage dans CRM → Relances. */}
          <FollowupLinkCard companyId={activeCompanyId} />
          {/* T14 / T15 : SMS par Brevo (fin de travaux, rappels de RDV, SMS programmes, SMS de test). */}
          <SettingsLink to="/settings/sms" icon={MessageCircle} title={t('sms.settingsTitle')} help={h('sms')} />
          {/* PDV040 : QR de paiement Stripe (Bancontact / carte), sans supplement. */}
          <SettingsLink to="/settings/stripe" icon={CreditCard} title={t('stripePay.settingsTitle')} help={h('stripe')} />
          <SettingsLink to="/parts/shopify" icon={ShoppingBag} title={h('shopifyTitle')} help={h('shopify')} />
          <SettingsLink to="/settings/app-client" icon={Smartphone} title={t('appClient.settings.cardTitle')} help={h('appClient')} />
          <SettingsLink to="/settings/extension" icon={Puzzle} title={t('settings.extTitle')} help={h('extension')} />
        </Group>
      </div>
    </>
  );
}
