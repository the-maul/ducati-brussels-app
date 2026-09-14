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
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { GlobalSearch } from '@/components/global-search';
import { countLeadsDue } from '@/modules/crm/api';
import { useAuth } from '@/lib/auth/auth-context';
import { t } from '@/lib/i18n';

/**
 * Cloche — demandes CRM à traiter. Rouge dès qu'une échéance est dépassée,
 * orange s'il en reste à traiter aujourd'hui. Mène au pipeline CRM.
 * L'échéance est posée à la création d'une demande et repoussée à chaque
 * échange avec le client (migration 20260914190000).
 */
function NotificationsBell() {
  const { activeCompanyId } = useAuth();
  const { data } = useQuery({
    queryKey: ['leads-due', activeCompanyId],
    queryFn: () => countLeadsDue(activeCompanyId!),
    enabled: !!activeCompanyId,
    refetchInterval: 120_000,
  });
  const overdue = data?.overdue ?? 0;
  const today = data?.today ?? 0;
  const total = overdue + today;
  const label = total === 0
    ? t('crm.notifNone')
    : [
        overdue > 0 ? `${overdue} ${t('crm.notifOverdue')}` : '',
        today > 0 ? `${today} ${t('crm.notifDueToday')}` : '',
      ].filter(Boolean).join(' · ');

  return (
    <Link
      to="/crm"
      className="relative hidden size-9 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent sm:grid"
      aria-label={`${t('crm.notifTitle')} — ${label}`}
      title={label}
    >
      <Bell className="size-5" />
      {total > 0 && (
        <span
          className={`absolute right-0.5 top-0.5 grid min-w-4 place-items-center rounded-full px-1 text-[10px] font-semibold leading-4 text-white ${
            overdue > 0 ? 'bg-[var(--danger)]' : 'bg-[var(--warning)]'
          }`}
        >
          {total > 99 ? '99+' : total}
        </span>
      )}
    </Link>
  );
}

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

      <NotificationsBell />

      <UserMenu />
    </header>
  );
}
