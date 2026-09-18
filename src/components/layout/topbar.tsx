/**
 * Topbar — barre supérieure 56px (charte §4.1).
 * Toggle sidebar · recherche globale (Ctrl+K) · bascule de société (COM005)
 * · notifications · menu utilisateur.
 * NB : la société active et l'utilisateur sont des placeholders ; ils seront
 * branchés sur l'auth Supabase + le contexte multi-société en M0.
 */
import { PanelLeft, Bell, Building2, ChevronDown, CircleUser, LogOut, KeyRound, UserPlus } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GlobalSearch } from '@/components/global-search';
import { listLeadsDue, dueState, listSignupNotifications, markSignupNotificationsRead } from '@/modules/crm/api';
import { useAuth } from '@/lib/auth/auth-context';
import { t } from '@/lib/i18n';

/**
 * Cloche — deux listes :
 *   1. demandes CRM à traiter. Rouge dès qu'une échéance est dépassée, orange
 *      s'il en reste à traiter aujourd'hui. Mène au pipeline CRM. L'échéance est
 *      posée à la création d'une demande et repoussée à chaque échange avec le
 *      client (migration 20260914190000) ;
 *   2. inscriptions de clients des 7 derniers jours (page en ligne ou borne),
 *      cliquables vers la fiche client ; « lu » propre à chaque utilisateur
 *      (migration 20260919170000). Aucun e-mail ni SMS.
 * Le badge compte les demandes à traiter + les inscriptions non lues.
 */
function NotificationsBell() {
  const { activeCompanyId, user } = useAuth();
  const queryClient = useQueryClient();
  // On charge la LISTE, pas seulement le compte : la cloche s'ouvre et chaque
  // demande est cliquable. Un simple badge ne disait pas de quoi il s'agissait.
  const { data } = useQuery({
    queryKey: ['leads-due', activeCompanyId],
    queryFn: () => listLeadsDue(activeCompanyId!),
    enabled: !!activeCompanyId,
    refetchInterval: 120_000,
  });
  const signupsKey = ['signup-notifications', activeCompanyId, user?.id];
  const { data: signupData } = useQuery({
    queryKey: signupsKey,
    queryFn: () => listSignupNotifications(activeCompanyId!, user!.id),
    enabled: !!activeCompanyId && !!user?.id,
    refetchInterval: 120_000,
  });
  const markRead = useMutation({
    mutationFn: (ids: string[]) => markSignupNotificationsRead(ids, user!.id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: signupsKey }),
  });

  const rows = data ?? [];
  const signups = signupData ?? [];
  const unreadSignups = signups.filter((n) => !n.read);
  const overdue = rows.filter((l) => dueState(l.due_at) === 'overdue').length;
  const total = rows.length + unreadSignups.length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="relative hidden size-9 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent sm:grid"
        aria-label={t('notif.bellLabel')}
      >
        <Bell className="size-5" />
        {total > 0 && (
          <span
            className={`absolute right-0.5 top-0.5 grid min-w-4 place-items-center rounded-full px-1 text-[10px] font-semibold leading-4 text-white ${
              overdue > 0 ? 'bg-[var(--danger)]' : rows.length > 0 ? 'bg-[var(--warning)]' : 'bg-[var(--info)]'
            }`}
          >
            {total > 99 ? '99+' : total}
          </span>
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="max-h-[80vh] w-80 overflow-y-auto">
        <DropdownMenuLabel>{t('crm.notifTitle')}</DropdownMenuLabel>
        <DropdownMenuSeparator />

        {rows.length === 0 && (
          <div className="px-2 py-3 text-[12px] text-muted-foreground">{t('crm.notifNone')}</div>
        )}

        {rows.slice(0, 8).map((l) => {
          const late = dueState(l.due_at) === 'overdue';
          return (
            <DropdownMenuItem key={l.id} asChild className="cursor-pointer">
              <Link to="/crm" className="flex flex-col items-start gap-0.5">
                <span className="w-full truncate text-[13px] font-medium">{l.name}</span>
                {l.vehicle_interest && (
                  <span className="w-full truncate text-[11px] text-muted-foreground">{l.vehicle_interest}</span>
                )}
                <span className={`text-[11px] font-medium ${late ? 'text-[var(--danger)]' : 'text-[var(--warning)]'}`}>
                  {late ? t('crm.dueOverdue') : t('crm.dueToday')}
                  {l.due_at && ` · ${new Date(l.due_at).toLocaleString('fr-BE', { dateStyle: 'short', timeStyle: 'short' })}`}
                </span>
              </Link>
            </DropdownMenuItem>
          );
        })}

        {rows.length > 0 && (
          <DropdownMenuItem asChild className="cursor-pointer">
            <Link to="/crm" className="text-[12px]">{t('crm.notifSeeAll')}</Link>
          </DropdownMenuItem>
        )}

        {signups.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t('notif.signupsTitle')}</DropdownMenuLabel>
            {signups.slice(0, 8).map((n) => {
              const label = `${t('notif.signupPrefix')}${n.title}${
                n.origin ? ` (${n.origin === 'comptoir' ? t('notif.originKiosk') : t('notif.originWeb')})` : ''
              }`;
              const when = new Date(n.created_at).toLocaleString('fr-BE', { dateStyle: 'short', timeStyle: 'short' });
              const body = (
                <>
                  <span className="flex w-full items-center gap-1.5">
                    <UserPlus className={`size-3.5 shrink-0 ${n.read ? 'text-muted-foreground' : 'text-[var(--info)]'}`} />
                    <span className={`truncate text-[13px] ${n.read ? 'text-muted-foreground' : 'font-medium'}`}>{label}</span>
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {!n.read && <span className="font-medium text-[var(--info)]">{t('notif.unread')} · </span>}
                    {when}
                  </span>
                </>
              );
              const onSelect = () => { if (!n.read) markRead.mutate([n.id]); };
              return (
                <DropdownMenuItem key={n.id} asChild className="cursor-pointer" onSelect={onSelect}>
                  {n.contact_id ? (
                    <Link to="/clients/$contactId" params={{ contactId: n.contact_id }} className="flex flex-col items-start gap-0.5">
                      {body}
                    </Link>
                  ) : (
                    <div className="flex flex-col items-start gap-0.5">{body}</div>
                  )}
                </DropdownMenuItem>
              );
            })}
            {unreadSignups.length > 0 && (
              <DropdownMenuItem
                className="cursor-pointer text-[12px]"
                onSelect={() => markRead.mutate(unreadSignups.map((n) => n.id))}
              >
                {t('notif.markAllRead')}
              </DropdownMenuItem>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
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
        <DropdownMenuItem asChild className="cursor-pointer">
          <Link to="/reset-password">
            <KeyRound className="size-4" />
            {t('pwd.menu')}
          </Link>
        </DropdownMenuItem>
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
