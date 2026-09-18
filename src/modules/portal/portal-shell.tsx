/**
 * Habillage du portail client, distinct de l'interface du personnel (pas de barre
 * latérale du DMS). Téléphone d'abord : en-tête compact + barre d'onglets en bas,
 * au pouce. Sur grand écran : même contenu centré, onglets en haut.
 */
import type { ReactNode } from 'react';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { Bike, CalendarClock, FileText, Home, LogOut, UserRound, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Avatar } from './ui';
import type { PortalWhoami } from './api';

type Tab = { to: string; labelKey: string; icon: LucideIcon; exact?: boolean };
const TABS: Tab[] = [
  { to: '/mon-espace', labelKey: 'portal.nav.home', icon: Home, exact: true },
  { to: '/mon-espace/motos', labelKey: 'portal.nav.vehicles', icon: Bike },
  { to: '/mon-espace/factures', labelKey: 'portal.nav.invoices', icon: FileText },
  { to: '/mon-espace/rendez-vous', labelKey: 'portal.nav.appointments', icon: CalendarClock },
  { to: '/mon-espace/profil', labelKey: 'portal.nav.profile', icon: UserRound },
];

function isActive(pathname: string, tab: Tab) {
  const p = pathname.replace(/\/$/, '');
  return tab.exact ? p === tab.to : p === tab.to || p.startsWith(tab.to + '/');
}

export function PortalShell({ me, children }: { me: PortalWhoami; children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const name = [me.first_name, me.last_name].filter(Boolean).join(' ');

  const logout = async () => {
    await signOut();
    navigate({ to: '/login' });
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-card print:hidden">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4">
          <Link to="/mon-espace" className="flex min-w-0 items-center gap-2">
            <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary font-display text-[15px] font-bold text-primary-foreground">D</span>
            <span className="truncate font-display text-[13px] font-bold uppercase tracking-[0.02em] text-foreground">
              {me.dealer ?? t('app.name')}
            </span>
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <Link to="/mon-espace/profil" aria-label={t('portal.nav.profile')} className="flex items-center gap-2">
              <span className="hidden max-w-[180px] truncate text-[13px] text-muted-foreground sm:inline">{name}</span>
              <Avatar path={me.avatar_path} name={name} size="sm" />
            </Link>
            <Button variant="ghost" size="icon" onClick={logout} aria-label={t('portal.nav.logout')} title={t('portal.nav.logout')}>
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
        {/* Onglets du haut : grand écran uniquement */}
        <nav className="mx-auto hidden max-w-3xl gap-1 px-4 md:flex" aria-label={t('portal.nav.label')}>
          {TABS.map((tab) => {
            const active = isActive(pathname, tab);
            const Icon = tab.icon;
            return (
              <Link key={tab.to} to={tab.to}
                className={cn('flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium',
                  active ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>
                <Icon className="size-4" aria-hidden /> {t(tab.labelKey)}
              </Link>
            );
          })}
        </nav>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-28 pt-4 md:pb-10">{children}</main>

      {/* Barre d'onglets du bas : téléphone */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex h-16 items-stretch border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden print:hidden"
        aria-label={t('portal.nav.label')}>
        {TABS.map((tab) => {
          const active = isActive(pathname, tab);
          const Icon = tab.icon;
          return (
            <Link key={tab.to} to={tab.to}
              className={cn('flex flex-1 flex-col items-center justify-center gap-1 text-[10px] font-medium',
                active ? 'text-primary' : 'text-muted-foreground')}>
              <Icon className="size-5 shrink-0" aria-hidden />
              <span className="max-w-full truncate px-1">{t(tab.labelKey)}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
