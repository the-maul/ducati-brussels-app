/**
 * AppSidebar — navigation principale (charte §4.1).
 * Fond noir Ducati, item actif = fond anthracite + barre rouge 3px à gauche.
 * Repliable (240px ↔ 64px, icônes seules).
 */
import { Link, useRouterState } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { mainNav } from '@/lib/navigation';
import { useAuth } from '@/lib/auth/auth-context';
import { countUnseenOffers } from '@/modules/tradein/partners-api';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

function isActivePath(pathname: string, to: string) {
  return pathname === to || pathname.startsWith(to + '/');
}

export function AppSidebar({
  collapsed = false,
  mobileOpen = false,
  onNavigate,
}: {
  collapsed?: boolean;
  /** ouvert en tiroir sur smartphone */
  mobileOpen?: boolean;
  /** appelé au clic d'un lien (ferme le tiroir mobile) */
  onNavigate?: () => void;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { rolesForActiveCompany, activeCompanyId } = useAuth();
  // Pastille : offres de reprise non vues (rafraîchi toutes les 60 s).
  const { data: unseenOffers = 0 } = useQuery({
    queryKey: ['tradein-unseen-offers', activeCompanyId],
    queryFn: () => countUnseenOffers(activeCompanyId!),
    enabled: !!activeCompanyId,
    refetchInterval: 60_000,
  });
  const badgeFor = (to: string): number => (to === '/tradein' ? unseenOffers : 0);
  // Filtre par rôle : une entrée sans `roles` est visible par tous ; sinon il faut
  // détenir l'un des rôles requis pour la société active.
  const items = mainNav.filter((item) => !item.roles || item.roles.some((r) => rolesForActiveCompany.includes(r as (typeof rolesForActiveCompany)[number])));

  return (
    <aside
      className={cn(
        'flex h-full shrink-0 flex-col bg-sidebar text-sidebar-foreground',
        // Desktop : panneau statique repliable (visuel PC inchangé)
        'md:static md:translate-x-0 md:transition-[width] md:duration-150',
        collapsed ? 'md:w-16' : 'md:w-60',
        // Smartphone : tiroir fixe qui glisse depuis la gauche
        'fixed inset-y-0 left-0 z-50 w-60 transition-transform duration-200',
        mobileOpen ? 'translate-x-0 shadow-xl' : '-translate-x-full md:translate-x-0',
      )}
    >
      {/* Identité */}
      <div className="flex h-14 items-center gap-2 px-4">
        <span className="grid size-8 shrink-0 place-items-center rounded-[var(--radius-badge)] bg-primary font-display text-sm font-bold text-primary-foreground">
          D
        </span>
        {!collapsed && (
          <span className="truncate font-display text-sm font-bold uppercase tracking-wide">
            {t('app.shortName')}
          </span>
        )}
      </div>

      {/* Modules */}
      <nav className="flex-1 overflow-y-auto py-2">
        {items.map((item) => {
          const active = isActivePath(pathname, item.to);
          const Icon = item.icon;
          const badge = badgeFor(item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              onClick={() => onNavigate?.()}
              title={collapsed ? t(item.labelKey) : undefined}
              className={cn(
                'relative flex h-10 items-center gap-3 border-l-[var(--sidebar-active-bar)] px-4 text-sm transition-colors',
                'hover:bg-sidebar-accent/60',
                active
                  ? 'border-sidebar-primary bg-sidebar-accent font-medium text-sidebar-foreground'
                  : 'border-transparent text-sidebar-foreground/80',
                collapsed && 'justify-center px-0',
              )}
            >
              <span className="relative shrink-0">
                <Icon className="size-5" aria-hidden />
                {badge > 0 && collapsed && (
                  <span className="absolute -right-1.5 -top-1.5 grid min-w-[16px] place-items-center rounded-full bg-[var(--ducati-red)] px-1 text-[10px] font-bold leading-4 text-white">{badge > 9 ? '9+' : badge}</span>
                )}
              </span>
              {!collapsed && <span className="truncate">{t(item.labelKey)}</span>}
              {!collapsed && badge > 0 && (
                <span className="ml-auto grid min-w-[18px] place-items-center rounded-full bg-[var(--ducati-red)] px-1.5 text-[11px] font-bold leading-5 text-white">{badge > 99 ? '99+' : badge}</span>
              )}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
