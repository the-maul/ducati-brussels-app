/**
 * MobileBottomNav — barre de navigation basse (smartphone uniquement, < md).
 * 4 accès rapides au pouce + bouton « Menu » qui ouvre le tiroir complet.
 * Invisible sur desktop (md:hidden) — le visuel PC n'est pas touché.
 */
import { Link, useRouterState } from '@tanstack/react-router';
import { LayoutDashboard, Wrench, CreditCard, Users, Menu, type LucideIcon } from 'lucide-react';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

type Item = { to: string; labelKey: string; icon: LucideIcon };

const items: Item[] = [
  { to: '/dashboard', labelKey: 'nav.dashboard', icon: LayoutDashboard },
  { to: '/workshop', labelKey: 'nav.workshop', icon: Wrench },
  { to: '/pos', labelKey: 'nav.pos', icon: CreditCard },
  { to: '/clients', labelKey: 'nav.clients', icon: Users },
];

function isActivePath(pathname: string, to: string) {
  return pathname === to || pathname.startsWith(to + '/');
}

export function MobileBottomNav({ onMore }: { onMore: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 flex h-16 items-stretch border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
      aria-label={t('nav.more')}
    >
      {items.map((it) => {
        const active = isActivePath(pathname, it.to);
        const Icon = it.icon;
        return (
          <Link
            key={it.to}
            to={it.to}
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-1 text-[10px] font-medium',
              active ? 'text-primary' : 'text-muted-foreground',
            )}
          >
            <Icon className="size-5 shrink-0" aria-hidden />
            <span className="max-w-full truncate px-1">{t(it.labelKey)}</span>
          </Link>
        );
      })}
      <button
        type="button"
        onClick={onMore}
        className="flex flex-1 flex-col items-center justify-center gap-1 text-[10px] font-medium text-muted-foreground"
      >
        <Menu className="size-5 shrink-0" aria-hidden />
        <span className="max-w-full truncate px-1">{t('nav.more')}</span>
      </button>
    </nav>
  );
}
