/**
 * Topbar — barre supérieure 56px (charte §4.1).
 * Toggle sidebar · recherche globale (Ctrl+K) · bascule de société (COM005)
 * · notifications · menu utilisateur.
 * NB : la société active et l'utilisateur sont des placeholders ; ils seront
 * branchés sur l'auth Supabase + le contexte multi-société en M0.
 */
import { PanelLeft, Bell, Building2, ChevronDown, CircleUser, LogOut } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { GlobalSearch } from '@/components/global-search';
import { useAuth } from '@/lib/auth/auth-context';
import { t } from '@/lib/i18n';

function CompanySwitcher() {
  const { companies, activeCompany, setActiveCompany } = useAuth();
  if (companies.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex h-9 items-center gap-2 rounded-md border border-input bg-card px-3 text-sm font-medium hover:bg-accent">
        <Building2 className="size-4 shrink-0 text-muted-foreground" />
        <span className="hidden max-w-40 truncate sm:inline">{activeCompany?.name ?? '—'}</span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t('company.switch')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {companies.map((c) => (
          <DropdownMenuItem key={c.id} onSelect={() => setActiveCompany(c.id)}>
            <Building2 className="size-4" />
            {c.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu() {
  const { profile, user, signOut, rolesForActiveCompany } = useAuth();
  const name = profile?.full_name || profile?.email || user?.email || '—';
  const topRole = rolesForActiveCompany[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="grid size-9 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent"
        aria-label={name}
      >
        <CircleUser className="size-6" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuLabel className="flex flex-col">
          <span className="truncate">{name}</span>
          {topRole && (
            <span className="text-[11px] font-normal text-muted-foreground">{t(`role.${topRole}`)}</span>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOut className="size-4" />
          {t('auth.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Topbar({ onMenu }: { onMenu: () => void }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-card px-3 sm:gap-3 sm:px-4">
      <button
        type="button"
        onClick={onMenu}
        className="grid size-9 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent"
        aria-label="Menu"
      >
        <PanelLeft className="size-5" />
      </button>

      <div className="flex min-w-0 flex-1 justify-start">
        <GlobalSearch />
      </div>

      <CompanySwitcher />

      <button
        type="button"
        className="hidden size-9 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent sm:grid"
        aria-label="Notifications"
      >
        <Bell className="size-5" />
      </button>

      <UserMenu />
    </header>
  );
}
