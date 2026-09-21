/**
 * Topbar — barre supérieure 56px (charte §4.1).
 * Toggle sidebar · recherche globale (Ctrl+K) · bascule de société (COM005)
 * · alerte verte Commande Excel (seuil atteint) · notifications · menu utilisateur.
 * NB : la société active et l'utilisateur sont des placeholders ; ils seront
 * branchés sur l'auth Supabase + le contexte multi-société en M0.
 */
import { PanelLeft, Bell, Bike, Globe, Building2, ChevronDown, CircleUser, LogOut, KeyRound, Signature, UserPlus, CalendarClock, Landmark, ShoppingCart, Wallet } from 'lucide-react';
import { useState, type ReactNode } from 'react';
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
  dueState, listBellTasks, listCompanyMembers, listSignupNotifications, listTeamNotifications, markSignupNotificationsRead,
  SIGNUP_NOTIF_ROLES, IBAN_NOTIF_ROLES, type BellScope,
} from '@/modules/crm/api';
import { listPortalAppointmentRequests, APPT_REQUEST_ROLES } from '@/modules/workshop/planning-api';
import { VEHICLE_DECL_NOTIF_ROLES } from '@/modules/vehicles/declarations-api';
import { useAuth } from '@/lib/auth/auth-context';
import { ExcelThresholdAlert } from '@/modules/orders/excel-alert';
import { listDocumentAlerts, type DocumentAlert } from '@/modules/sales/deposit-alerts';
import { eur } from '@/modules/sales/balance-panel';
import { listWebOrderAlerts, WEB_ORDER_ROLES } from '@/modules/sales/web-orders-api';
import { UserSignatureDialog } from '@/modules/settings/user-signature-dialog';
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
 *   4. IBAN MODIFIÉ PAR UN CLIENT dans son espace (mission 04, carte 5, 7 derniers
 *      jours) : rôles admin, comptable, vendeur (filtré aussi en base). Mène à la fiche.
 *      « Lu » propre à chaque utilisateur, comme les inscriptions.
 *   5. MOTOS DÉCLARÉES PAR DES CLIENTS (mission 04, carte 8, 7 derniers jours : espace
 *      client, inscription, borne) : rôles admin, vendeur (filtré aussi en base). Mène à
 *      Véhicules → « Motos déclarées à valider ». « Lu » propre à chaque utilisateur.
 *   6. (mission 05, carte 10) PIÈCES À COMMANDER APRÈS ACOMPTE : acompte encaissé sur un devis /
 *      proforma, bon de commande ou réservation, pièces manquantes pas encore commandées ; rappel
 *      quotidien tant que ce n'est pas fait (une ligne par document, la plus récente).
 *   7. (mission 05, carte 10) SOLDES IMPAYÉS : facture échue avec un reste à payer (une seule alerte
 *      par document et par échéance). Pour 6 et 7 : le vendeur du document et les administrateurs
 *      (filtré en base) ; une alerte réglée (pièces commandées, solde payé) disparaît. Mènent au document.
 *   8. (mission 03) NOUVELLE COMMANDE WEB : commande du site Shopify importée (facture créée), 7 derniers
 *      jours ; rôles vendeur et admin (filtré aussi en base) ; mène à la facture. « Lu » propre à chacun.
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
  const seesIban = has(IBAN_NOTIF_ROLES);
  const seesVehicleDecl = has(VEHICLE_DECL_NOTIF_ROLES);
  const seesWebOrders = has(WEB_ORDER_ROLES);

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
  const ibanKey = ['iban-notifications', activeCompanyId, uid];
  const { data: ibanData } = useQuery({
    queryKey: ibanKey,
    queryFn: () => listTeamNotifications(activeCompanyId!, uid!, 'client_iban_changed'),
    enabled: !!activeCompanyId && !!uid && seesIban,
    refetchInterval: 120_000,
  });
  const vehicleDeclKey = ['vehicle-declared-notifications', activeCompanyId, uid];
  const { data: vehicleDeclData } = useQuery({
    queryKey: vehicleDeclKey,
    queryFn: () => listTeamNotifications(activeCompanyId!, uid!, 'vehicle_declared'),
    enabled: !!activeCompanyId && !!uid && seesVehicleDecl,
    refetchInterval: 120_000,
  });
  // Mission 05, carte 10 : pas de filtre de rôle à l'écran, la base ne renvoie que ce que la
  // personne peut voir (vendeur du document + administrateurs).
  const depositKey = ['deposit-order-alerts', activeCompanyId, uid];
  const { data: depositData } = useQuery({
    queryKey: depositKey,
    queryFn: () => listDocumentAlerts(activeCompanyId!, uid!, 'order_after_deposit'),
    enabled: !!activeCompanyId && !!uid,
    refetchInterval: 120_000,
  });
  const unpaidKey = ['unpaid-balance-alerts', activeCompanyId, uid];
  const { data: unpaidData } = useQuery({
    queryKey: unpaidKey,
    queryFn: () => listDocumentAlerts(activeCompanyId!, uid!, 'unpaid_balance'),
    enabled: !!activeCompanyId && !!uid,
    refetchInterval: 120_000,
  });
  const webOrderKey = ['web-order-alerts', activeCompanyId, uid];
  const { data: webOrderData } = useQuery({
    queryKey: webOrderKey,
    queryFn: () => listWebOrderAlerts(activeCompanyId!, uid!),
    enabled: !!activeCompanyId && !!uid && seesWebOrders,
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
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: signupsKey });
      queryClient.invalidateQueries({ queryKey: ibanKey });
      queryClient.invalidateQueries({ queryKey: vehicleDeclKey });
      queryClient.invalidateQueries({ queryKey: depositKey });
      queryClient.invalidateQueries({ queryKey: unpaidKey });
      queryClient.invalidateQueries({ queryKey: webOrderKey });
    },
  });

  const tasks = taskData ?? [];
  const signups = seesSignups ? signupData ?? [] : [];
  const appts = seesAppts ? apptData ?? [] : [];
  const unreadSignups = signups.filter((n) => !n.read);
  const ibans = seesIban ? ibanData ?? [] : [];
  const unreadIbans = ibans.filter((n) => !n.read);
  const vehicleDecls = seesVehicleDecl ? vehicleDeclData ?? [] : [];
  const unreadVehicleDecls = vehicleDecls.filter((n) => !n.read);
  const depositAlerts = depositData ?? [];
  const unreadDeposit = depositAlerts.filter((n) => !n.read);
  const unpaidAlerts = unpaidData ?? [];
  const unreadUnpaid = unpaidAlerts.filter((n) => !n.read);
  const webOrders = seesWebOrders ? webOrderData ?? [] : [];
  const unreadWebOrders = webOrders.filter((n) => !n.read);
  const overdue = tasks.filter((l) => dueState(l.due_at) === 'overdue').length + unreadUnpaid.length;
  const total = tasks.length + unreadSignups.length + appts.length + unreadIbans.length + unreadVehicleDecls.length
    + unreadDeposit.length + unreadUnpaid.length + unreadWebOrders.length;
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
              overdue > 0 ? 'bg-[var(--danger)]' : tasks.length > 0 || appts.length > 0 || unreadIbans.length > 0 || unreadVehicleDecls.length > 0 || unreadDeposit.length > 0 ? 'bg-[var(--warning)]' : 'bg-[var(--info)]'
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

        {webOrders.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t('notif.webOrderTitle')}</DropdownMenuLabel>
            {webOrders.slice(0, 8).map((n) => {
              const body = (
                <>
                  <span className="flex w-full items-center gap-1.5">
                    <Globe className={`size-3.5 shrink-0 ${n.read ? 'text-muted-foreground' : 'text-[var(--info)]'}`} />
                    <span className={`truncate text-[13px] ${n.read ? 'text-muted-foreground' : 'font-medium'}`}>{n.title}</span>
                  </span>
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {t('notif.webOrderLine').replace('{amount}', eur(n.totalTtc))}
                    {n.unlinked > 0 && (
                      <span className="font-medium text-[var(--warning)]"> · {t('notif.webOrderUnlinked').replace('{n}', String(n.unlinked))}</span>
                    )}
                    {' · '}{fmt(n.createdAt)}
                  </span>
                </>
              );
              return (
                <DropdownMenuItem key={n.id} asChild className="cursor-pointer" onSelect={() => { if (!n.read) markRead.mutate([n.id]); }}>
                  {n.documentId ? (
                    <Link to="/sales/$documentId" params={{ documentId: n.documentId }} className="flex flex-col items-start gap-0.5">{body}</Link>
                  ) : (
                    <div className="flex flex-col items-start gap-0.5">{body}</div>
                  )}
                </DropdownMenuItem>
              );
            })}
            <DropdownMenuItem asChild className="cursor-pointer">
              <Link to="/sales/web-orders" className="text-[12px]">{t('notif.webOrderSeeAll')}</Link>
            </DropdownMenuItem>
          </>
        )}

        {depositAlerts.length > 0 && (
          <DocumentAlertSection
            title={t('notif.depositTitle')} alerts={depositAlerts} icon={ShoppingCart} tone="warning"
            line={(n) => t('notif.depositLine').replace('{n}', String(n.payload.missing_lines ?? 0))}
            onRead={(id) => markRead.mutate([id])} fmt={fmt}
          />
        )}

        {unpaidAlerts.length > 0 && (
          <DocumentAlertSection
            title={t('notif.unpaidTitle')} alerts={unpaidAlerts} icon={Wallet} tone="danger"
            line={(n) => t('notif.unpaidLine')
              .replace('{amount}', eur(Number(n.payload.client_due ?? 0)))
              .replace('{date}', n.payload.due_date ? new Date(`${n.payload.due_date}T00:00:00`).toLocaleDateString('fr-BE') : '—')}
            onRead={(id) => markRead.mutate([id])} fmt={fmt}
            footer={<Link to="/sales/balances" className="text-[12px]">{t('notif.unpaidSeeAll')}</Link>}
          />
        )}

        {ibans.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t('notif.ibanTitle')}</DropdownMenuLabel>
            {ibans.slice(0, 8).map((n) => {
              const body = (
                <>
                  <span className="flex w-full items-center gap-1.5">
                    <Landmark className={`size-3.5 shrink-0 ${n.read ? 'text-muted-foreground' : 'text-[var(--warning)]'}`} />
                    <span className={`truncate text-[13px] ${n.read ? 'text-muted-foreground' : 'font-medium'}`}>
                      {t('notif.ibanPrefix')}{n.title}
                    </span>
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {!n.read && <span className="font-medium text-[var(--warning)]">{t('notif.ibanToCheck')} · </span>}
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
          </>
        )}

        {vehicleDecls.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t('notif.vehicleDeclTitle')}</DropdownMenuLabel>
            {vehicleDecls.slice(0, 8).map((n) => {
              const origin = n.origin === 'comptoir' ? t('notif.originKiosk') : n.origin === 'web' ? t('notif.originWeb') : t('notif.originPortal');
              return (
                <DropdownMenuItem key={n.id} asChild className="cursor-pointer" onSelect={() => { if (!n.read) markRead.mutate([n.id]); }}>
                  <Link to="/vehicles/declarations" className="flex flex-col items-start gap-0.5">
                    <span className="flex w-full items-center gap-1.5">
                      <Bike className={`size-3.5 shrink-0 ${n.read ? 'text-muted-foreground' : 'text-[var(--warning)]'}`} />
                      <span className={`truncate text-[13px] ${n.read ? 'text-muted-foreground' : 'font-medium'}`}>
                        {t('notif.vehicleDeclPrefix')}{n.title} ({origin})
                      </span>
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {!n.read && <span className="font-medium text-[var(--warning)]">{t('notif.vehicleDeclToValidate')} · </span>}
                      {fmt(n.created_at)}
                    </span>
                  </Link>
                </DropdownMenuItem>
              );
            })}
            <DropdownMenuItem asChild className="cursor-pointer">
              <Link to="/vehicles/declarations" className="text-[12px]">{t('notif.vehicleDeclSeeAll')}</Link>
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

/** Section de la cloche pour les alertes liées à un document de vente (mission 05, carte 10). */
function DocumentAlertSection({ title, alerts, icon: Icon, tone, line, onRead, fmt, footer }: {
  title: string;
  alerts: DocumentAlert[];
  icon: typeof Bell;
  tone: 'warning' | 'danger';
  line: (n: DocumentAlert) => string;
  onRead: (id: string) => void;
  fmt: (iso: string) => string;
  footer?: ReactNode;
}) {
  const color = tone === 'danger' ? 'text-[var(--danger)]' : 'text-[var(--warning)]';
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuLabel>{title}</DropdownMenuLabel>
      {alerts.slice(0, 8).map((n) => {
        const body = (
          <>
            <span className="flex w-full items-center gap-1.5">
              <Icon className={`size-3.5 shrink-0 ${n.read ? 'text-muted-foreground' : color}`} />
              <span className={`truncate text-[13px] ${n.read ? 'text-muted-foreground' : 'font-medium'}`}>{n.title}</span>
            </span>
            <span className="text-[11px] text-muted-foreground tabular-nums">
              <span className={n.read ? '' : `font-medium ${color}`}>{line(n)}</span> · {fmt(n.createdAt)}
            </span>
          </>
        );
        return (
          <DropdownMenuItem key={n.id} asChild className="cursor-pointer" onSelect={() => { if (!n.read) onRead(n.id); }}>
            {n.documentId ? (
              <Link to="/sales/$documentId" params={{ documentId: n.documentId }} className="flex flex-col items-start gap-0.5">{body}</Link>
            ) : (
              <div className="flex flex-col items-start gap-0.5">{body}</div>
            )}
          </DropdownMenuItem>
        );
      })}
      {footer && <DropdownMenuItem asChild className="cursor-pointer">{footer}</DropdownMenuItem>}
    </>
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
  // Signature des e-mails envoyés depuis son adresse personnelle (21/09) : équipe seulement.
  const [sigOpen, setSigOpen] = useState(false);
  const isStaff = rolesForActiveCompany.length > 0;

  return (
    <>
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
        {isStaff && user && (
          <DropdownMenuItem onSelect={() => setSigOpen(true)}>
            <Signature className="size-4" />
            {t('mailSignature.menu')}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOut className="size-4" />
          {t('auth.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    {sigOpen && user && <UserSignatureDialog userId={user.id} displayName={name} onClose={() => setSigOpen(false)} />}
    </>
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

      <ExcelThresholdAlert />

      <CompanySwitcher />

      <NotificationsBell />

      <UserMenu />
    </header>
  );
}
