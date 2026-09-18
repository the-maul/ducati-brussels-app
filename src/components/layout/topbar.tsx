/**
 * Topbar — barre supérieure 56px (charte §4.1).
 * Toggle sidebar · recherche globale (Ctrl+K) · bascule de société (COM005)
 * · notifications · menu utilisateur.
 * NB : la société active et l'utilisateur sont des placeholders ; ils seront
 * branchés sur l'auth Supabase + le contexte multi-société en M0.
 */
import { PanelLeft, Bell, Building2, ChevronDown, CircleUser, LogOut, KeyRound, UserPlus, CalendarClock } from 'lucide-react';
import { useState } from 'react';
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
import {
  dueState, listBellTasks, listCompanyMembers, listSignupNotifications, markSignupNotificationsRead,
  SIGNUP_NOTIF_ROLES, type BellScope,
} from '@/modules/crm/api';
import { listPortalAppointmentRequests, APPT_REQUEST_ROLES } from '@/modules/workshop/planning-api';
import { useAuth } from '@/lib/auth/auth-context';
import { t } from '@/lib/i18n';

/**
 * Cloche — chacun voit ce qui le concerne (décision N-1 du 19/09) :
 *   1. TÂCHES CRM ouvertes qui lui sont confiées, en retard ou pour aujourd'hui.
 *      Un administrateur voit aussi celles « sans responsable » (confiées à quelqu'un
 *      qui n'est plus membre actif) et peut basculer « Les miennes / Toute l'équipe »
 *      (mémorisé dans le navigateur). Mène au CRM.
 *   2. NOUVELLES INSCRIPTIONS de clients (7 derniers jours) : rôles vendeur,
 *      marketing, admin. Filtré aussi en base (migration 20260919190000) : un
 *      mécanicien ne peut pas les lire. « Lu » propre à chaque utilisateur.
 *   3. DEMANDES DE RENDEZ-VOUS ATELIER envoyées depuis le portail client (statut
 *      « demande ») : rôles mecanicien, chef_atelier, admin. Mène au planning.
 * Le badge compte uniquement ce que la personne voit : tâches + inscriptions non
 * lues + demandes de rendez-vous. Aucun e-mail ni SMS.
 */
const BELL_SCOPE_KEY = 'ducati.bell.scope';
function readScope(): BellScope {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(BELL_SCOPE_KEY) === 'team' ? 'team' : 'mine';
  } catch {
    return 'mine';
  }
}

function NotificationsBell() {
  const { activeCompanyId, user, rolesForActiveCompany } = useAuth();
  const queryClient = useQueryClient();
  const uid = user?.id;
  const has = (list: readonly string[]) => rolesForActiveCompany.some((r) => list.includes(r));
  const admin = rolesForActiveCompany.includes('admin');
  const seesSignups = has(SIGNUP_NOTIF_ROLES);
  const seesAppts = has(APPT_REQUEST_ROLES);

  const [scope, setScopeState] = useState<BellScope>(readScope);
  const setScope = (s: BellScope) => {
    setScopeState(s);
    try { localStorage.setItem(BELL_SCOPE_KEY, s); } catch { /* navigateur sans stockage : on garde en mémoire */ }
  };
  const effectiveScope: BellScope = admin ? scope : 'mine';

  // Membres actifs : seulement pour un administrateur (repérer les tâches sans responsable
  // et afficher le nom du responsable en mode « Toute l'équipe »).
  const { data: members, isFetched: membersReady } = useQuery({
    queryKey: ['company-members', activeCompanyId],
    queryFn: () => listCompanyMembers(activeCompanyId!),
    enabled: !!activeCompanyId && admin,
    staleTime: 300_000,
  });
  const memberIds = (members ?? []).map((m) => m.user_id);
  const memberName = (id: string) => members?.find((m) => m.user_id === id)?.name ?? '—';

  const { data: taskData } = useQuery({
    queryKey: ['bell-tasks', activeCompanyId, uid, admin, effectiveScope, memberIds.join(',')],
    queryFn: () => listBellTasks(activeCompanyId!, uid!, { isAdmin: admin, scope: effectiveScope, activeMemberIds: memberIds }),
    enabled: !!activeCompanyId && !!uid && (!admin || membersReady),
    refetchInterval: 120_000,
  });
  const signupsKey = ['signup-notifications', activeCompanyId, uid];
  const { data: signupData } = useQuery({
    queryKey: signupsKey,
    queryFn: () => listSignupNotifications(activeCompanyId!, uid!),
    enabled: !!activeCompanyId && !!uid && seesSignups,
    refetchInterval: 120_000,
  });
  const { data: apptData } = useQuery({
    queryKey: ['bell-appointment-requests', activeCompanyId],
    queryFn: () => listPortalAppointmentRequests(activeCompanyId!),
    enabled: !!activeCompanyId && seesAppts,
    refetchInterval: 120_000,
  });
  const markRead = useMutation({
    mutationFn: (ids: string[]) => markSignupNotificationsRead(ids, uid!),
    onSettled: () => queryClient.invalidateQueries({ queryKey: signupsKey }),
  });

  const tasks = taskData ?? [];
  const signups = seesSignups ? signupData ?? [] : [];
  const appts = seesAppts ? apptData ?? [] : [];
  const unreadSignups = signups.filter((n) => !n.read);
  const overdue = tasks.filter((l) => dueState(l.due_at) === 'overdue').length;
  const total = tasks.length + unreadSignups.length + appts.length;
  const fmt = (iso: string) => new Date(iso).toLocaleString('fr-BE', { dateStyle: 'short', timeStyle: 'short' });

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
              overdue > 0 ? 'bg-[var(--danger)]' : tasks.length > 0 || appts.length > 0 ? 'bg-[var(--warning)]' : 'bg-[var(--info)]'
            }`}
          >
            {total > 99 ? '99+' : total}
          </span>
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="max-h-[80vh] w-80 overflow-y-auto">
        {admin && (
          <div className="flex items-center gap-1 px-2 pb-1 pt-1.5" role="group" aria-label={t('notif.scopeLabel')}>
            {(['mine', 'team'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={(e) => { e.preventDefault(); setScope(s); }}
                aria-pressed={scope === s}
                className={`h-7 flex-1 rounded-md text-[12px] font-medium ${
                  scope === s ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent'
                }`}
              >
                {s === 'mine' ? t('notif.scopeMine') : t('notif.scopeTeam')}
              </button>
            ))}
          </div>
        )}

        <DropdownMenuLabel>{effectiveScope === 'team' ? t('notif.tasksTeam') : t('notif.tasksMine')}</DropdownMenuLabel>
        <DropdownMenuSeparator />

        {tasks.length === 0 && (
          <div className="px-2 py-3 text-[12px] text-muted-foreground">{t('notif.tasksNone')}</div>
        )}

        {tasks.slice(0, 8).map((task) => {
          const late = dueState(task.due_at) === 'overdue';
          const who = task.orphan
            ? t('notif.orphan')
            : admin && task.assigned_to !== uid ? `${t('notif.assignedTo')}${memberName(task.assigned_to)}` : null;
          return (
            <DropdownMenuItem key={task.id} asChild className="cursor-pointer">
              <Link to="/crm" className="flex flex-col items-start gap-0.5">
                <span className="w-full truncate text-[13px] font-medium">{task.lead_name}</span>
                <span className="w-full truncate text-[11px] text-muted-foreground">
                  {task.title}{task.vehicle_interest ? ` · ${task.vehicle_interest}` : ''}
                </span>
                <span className={`text-[11px] font-medium ${late ? 'text-[var(--danger)]' : 'text-[var(--warning)]'}`}>
                  {late ? t('crm.dueOverdue') : t('crm.dueToday')} · {fmt(task.due_at)}
                  {who && <span className="font-normal text-muted-foreground"> · {who}</span>}
                </span>
              </Link>
            </DropdownMenuItem>
          );
        })}

        {tasks.length > 0 && (
          <DropdownMenuItem asChild className="cursor-pointer">
            <Link to="/crm" className="text-[12px]">{t('notif.tasksSeeAll')}</Link>
          </DropdownMenuItem>
        )}

        {appts.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t('notif.apptTitle')}</DropdownMenuLabel>
            {appts.slice(0, 8).map((a) => {
              const day = new Date(a.starts_at).toLocaleDateString('fr-BE', { weekday: 'short', day: 'numeric', month: 'short' });
              const slot = a.requested_slot === 'matin' ? t('notif.apptSlotMorning') : a.requested_slot === 'apres_midi' ? t('notif.apptSlotAfternoon') : null;
              return (
                <DropdownMenuItem key={a.id} asChild className="cursor-pointer">
                  <Link to="/workshop/planning" search={{ week: undefined }} className="flex flex-col items-start gap-0.5">
                    <span className="flex w-full items-center gap-1.5">
                      <CalendarClock className="size-3.5 shrink-0 text-[var(--warning)]" />
                      <span className="truncate text-[13px] font-medium">{a.client_name}</span>
                    </span>
                    {a.work_description && (
                      <span className="w-full truncate text-[11px] text-muted-foreground">{a.work_description}</span>
                    )}
                    <span className="text-[11px] text-muted-foreground">{day}{slot ? ` · ${slot}` : ''}</span>
                  </Link>
                </DropdownMenuItem>
              );
            })}
            <DropdownMenuItem asChild className="cursor-pointer">
              <Link to="/workshop/planning" search={{ week: undefined }} className="text-[12px]">{t('notif.apptSeeAll')}</Link>
            </DropdownMenuItem>
          </>
        )}

        {signups.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t('notif.signupsTitle')}</DropdownMenuLabel>
            {signups.slice(0, 8).map((n) => {
              const label = `${t('notif.signupPrefix')}${n.title}${
                n.origin ? ` (${n.origin === 'comptoir' ? t('notif.originKiosk') : t('notif.originWeb')})` : ''
              }`;
              const body = (
                <>
                  <span className="flex w-full items-center gap-1.5">
                    <UserPlus className={`size-3.5 shrink-0 ${n.read ? 'text-muted-foreground' : 'text-[var(--info)]'}`} />
                    <span className={`truncate text-[13px] ${n.read ? 'text-muted-foreground' : 'font-medium'}`}>{label}</span>
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {!n.read && <span className="font-medium text-[var(--info)]">{t('notif.unread')} · </span>}
                    {fmt(n.created_at)}
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
