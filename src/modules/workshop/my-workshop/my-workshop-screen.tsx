/**
 * M8 — Parcours mecanicien, lot F (19/11/2026) : ecran tablette « Mon atelier ».
 * Demande du client : un point d'entree par mecanicien, la tablette tenue a cote de la moto.
 *
 * Lot UX atelier (20/11/2026, maquette validee de la revue UX/UI) — « je ne comprends jamais ou
 * j'en suis » :
 *  - une ligne d'en-tete : ecran, date, « Atelier de » (admin / chef d'atelier), relire ;
 *  - un bandeau colle « Je travaille sur… » (moto, operation, Pause / Terminer / Continuer le
 *    parcours), present SEULEMENT si un pointage tourne ; sur une tablette partagee (Q60), le
 *    bandeau de la personne identifiee ;
 *  - « Aujourd'hui » : les motos dans l'ordre de l'ecran (meme tri `sortCards`), la moto d'abord,
 *    la MEME frise que la fiche OR (Reception → Travail → Operations → Pret → Facture) a la place
 *    des badges ; badges seulement pour les alertes (pieces manquantes, ancien OR, accord client) ;
 *  - un seul bouton rouge : la moto « a faire maintenant » (ou « Continuer le parcours ») ;
 *  - une seule confirmation au plus avant de travailler (ancien OR + moto d'un autre + autre
 *    travail en cours, en un message) ;
 *  - « A prendre » et « OR anciens » replies ; la page d'accueil se regle dans le menu du compte.
 * Aucune regle metier ne change : memes fonctions (`buildDayCards`, `sortCards`, `cardGesture`,
 * `startWorkWithConfirm`, photos de reception, parcours guide).
 *
 * Ergonomie tablette : cibles d'au moins 44 px (gestes 56 px), texte de 15 a 20 px, rien au survol,
 * une colonne en portrait, deux quand la zone de travail depasse 1100 px (container query). Charte : tokens, statut = couleur + icone + libelle.
 * Rafraichissement : relecture toutes les 45 s (et au retour sur l'onglet), sans recharger la page.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CalendarClock, ChevronDown, CircleHelp, ClipboardList, FileText, History, Inbox, ListChecks, Loader2,
  Package, PackageX, PenLine, Pause, Play, Link2, RefreshCw, RotateCcw, ShieldAlert, ShieldCheck, Square, Tag, Timer,
  TriangleAlert, User, UserX, Users, Wrench,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { StatusBadge } from '@/components/status-badge';
import { useConfirm } from '@/components/confirm-provider';
import { useAuth } from '@/lib/auth/auth-context';
import { useCanWrite } from '@/lib/auth/use-access';
import { fill } from '@/modules/catalog/format';
import { getLocale, t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { brusselsParts } from '../reservations/parts-flow';
import { OrStepsTrail } from '../or-base/or-steps-trail';
import { PauseDialog, startWorkWithConfirm } from '../pointage/work-controls';
import { listPauseReasons, pauseWork, stopWorkPointage } from '../pointage/api';
import { stopLabel, type PauseReason } from '../pointage/rules';
import { ReceptionSheet } from '../reception/reception-sheet';
import { createOrFromPlanningAppointment, type PlanningAppointment } from '../planning/api';
import type { PlanningMechanic } from '../planning/rules';
import { contactLabel } from '../planning/ui-bits';
import { loadMyDay, type MyDay } from './api';
import { useSharedTablet } from '../shared-tablet/shared-tablet-provider';
import { SharedNowPanel } from '../shared-tablet/shared-now-panel';
import {
  MY_WORKSHOP_REFRESH_MS, VIEW_ALL, afterStartTarget, ageLabel, canChooseWorkshop, cardGesture, cardMotive, cardOwner,
  cardWhen, chooserMechanics, myCurrentWork, needsReceptionFirst, notLinkedHint, orAgeDays,
  workshopViewParam,
  type DayCard, type Gesture, type MotiveKind, type MyEntry, type MyNow, type WorkshopView,
} from './rules';
import { cardAlerts, cardSteps, doNowKey, durationParts, startReasons, type CardAlert, type StartReason } from './card-view';

const ORIGIN = 'tablet';
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString(`${getLocale()}-BE`, { hour: '2-digit', minute: '2-digit' });
const todayBrussels = () => brusselsParts(new Date()).date;
/** Date courte : 03/11 (l'annee seulement si ce n'est pas l'annee en cours). */
const shortDate = (iso: string) => {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(`${getLocale()}-BE`, sameYear ? { day: '2-digit', month: '2-digit' } : { day: '2-digit', month: '2-digit', year: 'numeric' });
};
/** « 17:58 » aujourd'hui, sinon « 18/11 17:58 ». */
const whenShort = (iso: string, today: string) => (brusselsParts(new Date(iso)).date === today ? hhmm(iso) : `${shortDate(iso)} ${hhmm(iso)}`);
const durationText = (fromIso: string, nowMs: number) => {
  const d = durationParts(fromIso, nowMs);
  return d.h > 0 ? fill(t('uxAtelier.durationHours'), { h: d.h, min: String(d.min).padStart(2, '0') }) : fill(t('uxAtelier.durationMinutes'), { min: d.min });
};
/** Icone du motif (le libelle dit le motif exact). */
const MOTIVE_ICON: Record<MotiveKind, typeof Wrench> = {
  maintenance: CalendarClock, accident: ShieldAlert, warranty: ShieldCheck, repair: Wrench, other: Tag, unknown: CircleHelp,
};
const ALERT_ICON: Record<CardAlert, typeof Package> = { parts_missing: PackageX, old_or: History, approval_pending: PenLine };
const ME_VALUE = '__me__';

export function MyWorkshopScreen({ companyId, view = { kind: 'me' }, onView }: {
  companyId: string;
  /** Atelier demande par l'adresse (`?mechanic=`) ; ignore pour un mecanicien simple. */
  view?: WorkshopView;
  onView?: (v: WorkshopView) => void;
}) {
  const { user, profile, rolesForActiveCompany } = useAuth();
  // Q60 (20/11/2026) : tablette partagee → tout l'atelier, chaque geste sous « Qui etes-vous ? ».
  const tablet = useSharedTablet();
  const shared = tablet.shared;
  const canChoose = !shared && canChooseWorkshop(rolesForActiveCompany) && !!onView;
  const viewKey = shared ? 'shared' : canChoose ? workshopViewParam(view) ?? 'me' : 'me';
  const canWrite = useCanWrite();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const userId = user?.id ?? null;

  // Le jour suit l'horloge de Bruxelles (une tablette laissee allumee passe minuit) ; la duree du
  // pointage en cours avance avec la meme horloge.
  const [today, setToday] = useState(todayBrussels);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => { setToday(todayBrussels()); setNowMs(Date.now()); }, 30_000);
    return () => clearInterval(id);
  }, []);

  const day = useQuery({
    queryKey: ['my-workshop', companyId, userId, today, viewKey],
    queryFn: () => loadMyDay({
      companyId, userId: userId!, profileName: profile?.full_name ?? null, today,
      view: shared ? { kind: 'all' } : view, canChoose: shared || canChoose,
    }),
    enabled: !!userId,
    refetchInterval: MY_WORKSHOP_REFRESH_MS,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  });
  const reasons = useQuery({
    queryKey: ['pause-reasons', companyId], queryFn: () => listPauseReasons(companyId),
    enabled: day.data?.pointageReady === true, staleTime: 300_000,
  });
  const d = day.data;

  const [reception, setReception] = useState<{ orId: string; orNumber: string | null; go: () => void } | null>(null);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [staleOpen, setStaleOpen] = useState(false);
  const [freeOpen, setFreeOpen] = useState<boolean | null>(null);

  const refresh = () => {
    for (const k of [['my-workshop'], ['or-work-status'], ['plan-progress'], ['repair-orders'], ['chrono-work'], ['chrono-today']]) {
      void qc.invalidateQueries({ queryKey: k });
    }
  };
  const onErr = (e: unknown) => {
    const m = e instanceof Error ? e.message : '';
    toast.error(m === 'planned_time_required' ? t('planningG8.errPlannedTime') : m === 'mileage_required' ? t('planningG8.errMileageOr') : m || t('workshop.errSave'));
  };

  /** Apres le pointage : le parcours guide de l'OR (lot D), sinon la fiche OR. */
  const goToWork = (orId: string, card: DayCard | null, operation: string | null) => {
    const target = afterStartTarget({
      planTotal: d?.progress.get(orId)?.total ?? 0,
      serviceCode: card?.or?.service_code ?? card?.appointment?.service_code ?? null,
      operation,
    });
    if (target.to === 'journey') navigate({ to: '/workshop/journey/$orId', params: { orId }, search: target.op ? { op: target.op } : {} });
    else navigate({ to: '/workshop/$orId', params: { orId } });
  };

  /** Pointage (lot A, un seul pointage actif) puis le travail. `expectSwitch` : deja annonce dans la confirmation. */
  const pointThenGo = async (orId: string, card: DayCard | null, gesture: Gesture, expectSwitch: string | null = null) => {
    const res = await startWorkWithConfirm(orId, { origin: ORIGIN, expectSwitchEntry: expectSwitch }, confirm);
    if (!res || res.status === 'needs_confirm') { refresh(); return; }
    toast.success(res.status === 'resumed' ? t('pointage.resumed') : res.status === 'started' ? t('pointage.started') : t('myWorkshop.alreadyRunning'));
    refresh();
    goToWork(orId, card, gesture === 'start' ? null : res.operation ?? null);
  };

  /** Le geste de la moto : (ouvrir l'OR) → photos si besoin (lot C) → pointage (lot A) → parcours (lot D). */
  const gesture = useMutation({
    mutationFn: async ({ card, g, expectSwitch }: { card: DayCard; g: Gesture; expectSwitch: string | null }) => {
      if (!d) return;
      if (g === 'continue' && card.or) { goToWork(card.or.id, card, card.work?.mineOpen?.journey_operation ?? null); return; }
      let orId = card.or?.id ?? null;
      let orNumber = card.or?.number ?? null;
      let orStatus = card.or?.status ?? null;
      if (g === 'create_or' && card.appointment) {
        // Meme fonction que « Valider RDV et saisie OR » du planning (km, temps prevu, kit Q49).
        orId = await createOrFromPlanningAppointment(card.appointment as unknown as PlanningAppointment, d.mechanics as unknown as PlanningMechanic[]);
        orNumber = null; orStatus = 'a_faire';
        refresh();
      }
      if (!orId) return;
      const id = orId;
      const recStatus = d.reception.get(id)?.status ?? 'none';
      if (needsReceptionFirst(g, recStatus, orStatus, d.receptionReady)) {
        setReception({ orId: id, orNumber, go: () => { void pointThenGo(id, card, g, expectSwitch).catch(onErr).finally(() => setBusyKey(null)); } });
        return 'reception';
      }
      await pointThenGo(id, card, g, expectSwitch);
    },
    meta: { success: false },
    onMutate: ({ card }) => setBusyKey(card.key),
    onSettled: (r) => { if (r !== 'reception') setBusyKey(null); },
    onError: onErr,
  });

  // ------------------------------------------------------------------ mon pointage du moment
  const now: MyNow = useMemo(() => (d ? myCurrentWork(d.myEntries, userId, d.closedOrs) : { kind: 'idle' }), [d, userId]);
  const nowCard = now.kind !== 'idle' && now.entry.or_id ? d?.cards.find((c) => c.or?.id === now.entry.or_id) ?? null : null;

  /** Une seule confirmation (lot UX atelier) : ancien OR, moto d'un autre et autre travail, en un message. */
  const onCardGesture = async (card: DayCard, g: Gesture) => {
    if (!d) return;
    const grp = d.vehicleGroups.get(card.key);
    const reasonsToSay: StartReason[] = startReasons({
      gesture: g, shared,
      oldWithTodayRdv: grp?.role === 'old' && !!grp.primaryToday,
      owner: cardOwner(card, d.me, d.mechanics),
      meLinked: d.me.mechanicIds.length > 0,
      running: now.kind === 'running' ? { entryId: now.entry.id, orId: now.entry.or_id, kind: now.entry.kind } : null,
      cardOrId: card.or?.id ?? null,
    });
    let expectSwitch: string | null = null;
    if (reasonsToSay.length) {
      const meName = d.me.displayName || t('myWorkshop.meUnknown');
      const number = card.or?.number ?? '';
      const lines: string[] = [card.or ? fill(t('uxAtelier.confirmIntro'), { me: meName, number }) : fill(t('uxAtelier.confirmIntroNoOr'), { me: meName })];
      for (const r of reasonsToSay) {
        if (r.kind === 'old_or' && card.or) {
          const motive = t(`myWorkshop.motive_${cardMotive(card).label}`);
          const hint = grp?.primary?.kind === 'or' ? fill(t('myWorkshop.oldOrConfirmPrimary'), { number: grp.primary.number ?? '' })
            : grp?.primary?.kind === 'rdv' ? t('myWorkshop.oldOrConfirmRdv') : '';
          lines.push(`${fill(t('myWorkshop.oldOrConfirm'), { date: shortDate(card.or.created_at), motive })} ${hint}`.trim());
        }
        if (r.kind === 'foreign') {
          const name = r.name || t('myWorkshop.someone');
          lines.push(fill(t('uxAtelier.confirmForeign'), { name }) + (r.notLinked ? ` ${fill(t('myWorkshop.foreignNotLinked'), { name })}` : ''));
        }
        if (r.kind === 'switch' && now.kind === 'running') {
          const current = r.orId ? d.orNumbers.get(r.orId) ?? '' : '';
          lines.push(r.task ? fill(t('uxAtelier.confirmSwitchTask'), { since: hhmm(now.entry.started_at) })
            : fill(t('uxAtelier.confirmSwitch'), { current, since: hhmm(now.entry.started_at) }));
          expectSwitch = r.entryId;
        }
      }
      const ok = await confirm({
        title: card.or ? fill(t(g === 'resume' ? 'uxAtelier.confirmTitleResume' : 'uxAtelier.confirmTitle'), { number }) : t('uxAtelier.confirmTitleNoOr'),
        message: lines.join('\n'),
        confirmLabel: g === 'resume' ? t('pointage.resume') : t('pointage.start'),
      });
      if (!ok) return;
    }
    gesture.mutate({ card, g, expectSwitch });
  };

  const pause = useMutation({
    mutationFn: (v: { reason: string; orStatus: string | null }) => {
      if (now.kind !== 'running') throw new Error(t('myWorkshop.nothingRunning'));
      return pauseWork({ reason: v.reason, entryId: now.entry.id, orId: now.entry.or_id, orStatus: v.orStatus, origin: ORIGIN, companyId });
    },
    meta: { success: false },
    onSuccess: (r) => { setPauseOpen(false); toast.success(r.or_status_changed ? t('pointage.pausedStatus') : t('pointage.paused')); refresh(); },
    onError: onErr,
  });
  const finish = useMutation({
    mutationFn: () => {
      if (now.kind !== 'running') throw new Error(t('myWorkshop.nothingRunning'));
      return stopWorkPointage({ entryId: now.entry.id, orId: now.entry.or_id, origin: ORIGIN, companyId });
    },
    meta: { success: false },
    onSuccess: () => { toast.success(t('pointage.finished')); refresh(); },
    onError: onErr,
  });
  const resume = useMutation({
    mutationFn: async () => {
      if (now.kind !== 'paused' || !now.entry.or_id) return;
      await pointThenGo(now.entry.or_id, nowCard, 'resume');
    },
    meta: { success: false },
    onError: onErr,
  });
  const topBusy = pause.isPending || finish.isPending || resume.isPending;

  if (!userId) return null;
  if (day.isLoading && !d) {
    return <div className="grid place-items-center py-24"><Loader2 className="size-8 animate-spin text-muted-foreground" /></div>;
  }
  if (day.isError && !d) {
    return (
      <div className="rounded-md border border-border bg-card p-6 text-[16px]">
        <p>{t('myWorkshop.loadError')}</p>
        <Button variant="outline" className="mt-3 h-12 text-[16px]" onClick={() => day.refetch()}><RefreshCw /> {t('myWorkshop.reload')}</Button>
      </div>
    );
  }
  if (!d) return null;

  const mine = d.cards.filter((c) => c.section === 'mine' && !c.stale);
  const stale = d.cards.filter((c) => c.stale);
  const others = d.view.kind !== 'me';
  const choices = chooserMechanics(d.mechanics, d.me);
  const showNotLinked = notLinkedHint(d.view, d.me, d.cards.filter((c) => c.section === 'mine').length);
  const chooseValue = d.view.kind === 'all' ? VIEW_ALL : d.view.kind === 'mechanic' ? d.view.mechanicId : ME_VALUE;
  const pickView = (v: string) => onView?.(v === VIEW_ALL ? { kind: 'all' } : v === ME_VALUE ? { kind: 'me' } : { kind: 'mechanic', mechanicId: v });
  const free = d.cards.filter((c) => c.section === 'unassigned' && !c.stale);
  const nowReasons = reasons.data ?? [];
  const nowOrNumber = now.kind !== 'idle' && now.entry.or_id ? d.orNumbers.get(now.entry.or_id) ?? null : null;
  const canAct = canWrite && d.pointageReady;
  const gestureOf = (c: DayCard) => cardGesture(c, canAct);
  const isOld = (c: DayCard) => d.vehicleGroups.get(c.key)?.role === 'old';
  const doNow = doNowKey(mine.map((c) => ({ key: c.key, gesture: gestureOf(c), old: isOld(c) })), { running: now.kind === 'running', shared });
  const todayTitle = d.view.kind === 'all' ? t('uxAtelier.todayAll')
    : d.view.kind === 'mechanic' ? fill(t('uxAtelier.todayMechanic'), { name: d.viewLabel }) : t('uxAtelier.today');
  // Mon OR en pause qui n'est pas dans la liste regardee (atelier d'un autre) : on garde « Reprendre ».
  const pausedElsewhere = !shared && now.kind === 'paused' && !!now.entry.or_id && !mine.some((c) => c.or?.id === now.entry.or_id);
  const freeIsOpen = freeOpen ?? (mine.length === 0 && free.length > 0);
  const dateText = new Date().toLocaleDateString(`${getLocale()}-BE`, { weekday: 'long', day: '2-digit', month: '2-digit' });

  const card = (c: DayCard, opts: { showOwner: boolean }) => (
    <BikeCard key={c.key} card={c} day={d} today={today} gesture={gestureOf(c)} busy={busyKey === c.key}
      showOwner={opts.showOwner} doNow={doNow === c.key} reasons={nowReasons}
      onGesture={(g) => { void onCardGesture(c, g); }}
      onOpenOr={(orId) => navigate({ to: '/workshop/$orId', params: { orId } })}
    />
  );

  return (
    <div className="touch-44 @container mx-auto w-full max-w-[1400px] space-y-4 pb-10 text-[16px]">
      {/* ------------------------------------------------------------ en-tete sur une ligne */}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="font-display text-[22px] font-bold uppercase leading-tight">{t('myWorkshop.title')}</h1>
        <p className="min-w-0 text-[16px] text-muted-foreground first-letter:uppercase">
          {dateText}
          {!shared && !d.me.mechanicIds.length && <> · {t('myWorkshop.notLinked')}</>}
        </p>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {canChoose && (
            <div className="flex items-center gap-2">
              <label htmlFor="mw-view" className="flex items-center gap-1.5 text-[15px] font-bold"><Users className="size-5" aria-hidden /> {t('myWorkshop.viewLabel')}</label>
              <Select value={chooseValue} onValueChange={pickView} open={chooserOpen} onOpenChange={setChooserOpen}>
                <SelectTrigger id="mw-view" className="h-11 w-[170px] text-[16px] lg:w-[220px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ME_VALUE} className="h-11 text-[16px]">{fill(t('myWorkshop.viewMe'), { name: d.me.displayName || t('myWorkshop.meUnknown') })}</SelectItem>
                  {choices.map((m) => <SelectItem key={m.id} value={m.id} className="h-11 text-[16px]">{m.name}</SelectItem>)}
                  <SelectItem value={VIEW_ALL} className="h-11 text-[16px]">{t('myWorkshop.viewAll')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <Button variant="outline" className="h-11 w-11 p-0" onClick={() => day.refetch()} disabled={day.isFetching} aria-label={t('myWorkshop.reload')} title={t('myWorkshop.reload')}>
            {day.isFetching ? <Loader2 className="size-5 animate-spin" /> : <RefreshCw className="size-5" />}
          </Button>
        </div>
      </header>

      {/* ------------------------------------------------------------ je travaille sur… */}
      {shared ? (
        <section className="rounded-md border border-border bg-card p-4 shadow-[var(--shadow-card)]" aria-label={t('myWorkshop.nowTitle')}>
          <SharedNowPanel
            reasons={nowReasons} orNumbers={d.orNumbers} canWrite={canAct}
            onResume={(orId) => pointThenGo(orId, d.cards.find((c) => c.or?.id === orId) ?? null, 'resume')}
            onChanged={refresh}
          />
        </section>
      ) : now.kind === 'running' && (
        <WorkingOnBanner
          entry={now.entry} orNumber={nowOrNumber} card={nowCard} day={d} nowMs={nowMs} canAct={canAct} busy={topBusy}
          finishPending={finish.isPending}
          onPause={() => setPauseOpen(true)}
          onFinish={() => finish.mutate()}
          onContinue={() => { if (now.entry.or_id) goToWork(now.entry.or_id, nowCard, now.entry.journey_operation ?? null); }}
        />
      )}
      {pausedElsewhere && now.kind === 'paused' && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-warning bg-card px-4 py-2">
          <StatusBadge tone="warning" icon={Pause} className="px-2.5 py-1 text-[14px]"
            label={fill(t('pointage.pausedReason'), { reason: stopLabel(now.entry.stop_kind, now.entry.stop_reason, nowReasons, t) })} />
          <span className="min-w-0 flex-1 text-[16px]">{fill(t('myWorkshop.pausedOn'), { number: nowOrNumber ?? '', at: now.entry.ended_at ? whenShort(now.entry.ended_at, today) : '' })}</span>
          {canAct && (
            <Button variant="outline" className="h-12 text-[16px]" disabled={topBusy} onClick={() => resume.mutate()}>
              {resume.isPending ? <Loader2 className="animate-spin" /> : <RotateCcw />} {t('pointage.resume')}
            </Button>
          )}
        </div>
      )}
      {!d.pointageReady && <p className="text-[15px] text-warning">{t('myWorkshop.pointageMissing')}</p>}

      {/* ------------------------------------------------------------ aujourd'hui */}
      <section aria-labelledby="mw-today">
        <h2 id="mw-today" className="mb-3 flex flex-wrap items-baseline gap-x-2 text-[19px] font-bold uppercase tracking-[0.02em]">
          {todayTitle}
          <span className="font-data text-[16px] font-normal normal-case tabular-nums text-muted-foreground">
            {mine.length === 1 ? t('uxAtelier.motosOne') : fill(t('uxAtelier.motos'), { n: mine.length })}
          </span>
        </h2>
        {mine.length ? (
          <div className="grid gap-3 @min-[1100px]:grid-cols-2">{mine.map((c) => card(c, { showOwner: others }))}</div>
        ) : showNotLinked ? (
          <div className="flex flex-wrap items-start gap-4 rounded-md border border-warning bg-card p-5" role="status">
            <UserX className="size-8 shrink-0 text-warning" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-[18px] font-bold">{t('myWorkshop.notLinkedTitle')}</p>
              <p className="mt-1 text-[16px] text-muted-foreground">{canChoose ? t('myWorkshop.notLinkedAdmin') : t('myWorkshop.notLinkedMechanic')}</p>
              {canChoose && (
                <div className="mt-3 flex flex-wrap gap-3">
                  <Button variant="outline" className="h-12 text-[16px]" onClick={() => setChooserOpen(true)}><Users className="size-5" /> {t('myWorkshop.chooseWorkshop')}</Button>
                  <Button asChild variant="outline" className="h-12 text-[16px]">
                    <Link to="/workshop/planning" search={{ view: 'reglages' }}><Link2 className="size-5" /> {t('myWorkshop.linkAccount')}</Link>
                  </Button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-md border border-dashed border-border bg-card p-5 text-[17px] text-muted-foreground">
            <Inbox className="size-7 shrink-0" aria-hidden />
            {d.view.kind === 'all' ? t('myWorkshop.mineEmptyAll')
              : d.view.kind === 'mechanic' ? fill(t('myWorkshop.mineEmptyMechanic'), { name: d.viewLabel }) : t('myWorkshop.mineEmpty')}
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------ a prendre (replie) */}
      <FoldSection
        id="mw-free" icon={ClipboardList} tone="neutral" open={freeIsOpen} onOpenChange={setFreeOpen}
        title={t('uxAtelier.freeTitle')} count={free.length}
        hint={free.length === 1 ? t('uxAtelier.freeHintOne') : free.length ? fill(t('uxAtelier.freeHint'), { n: free.length }) : t('myWorkshop.freeEmpty')}
      >
        {free.length > 0 && <div className="grid gap-3 @min-[1100px]:grid-cols-2">{free.map((c) => card(c, { showOwner: false }))}</div>}
      </FoldSection>

      {/* ------------------------------------------------------------ OR anciens a verifier (replies) */}
      {stale.length > 0 && (
        <FoldSection
          id="mw-stale" icon={History} tone="warning" open={staleOpen} onOpenChange={setStaleOpen}
          title={t('myWorkshop.staleTitle')} count={stale.length} hint={fill(t('myWorkshop.staleHint'), { n: d.staleDays })}
        >
          <div className="grid gap-3 @min-[1100px]:grid-cols-2">{stale.map((c) => card(c, { showOwner: others }))}</div>
        </FoldSection>
      )}

      <PauseDialog
        open={pauseOpen} reasons={nowReasons} orStatus={nowCard?.or?.status ?? null} busy={pause.isPending}
        onCancel={() => setPauseOpen(false)} onConfirm={(v) => pause.mutate(v)}
      />
      {reception && (
        <ReceptionSheet
          open orId={reception.orId} orNumber={reception.orNumber} companyId={companyId} startMode
          onClose={() => { setReception(null); setBusyKey(null); refresh(); }}
          onDone={() => { const go = reception.go; setReception(null); go(); }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Bandeau « Je travaille sur… » (colle en haut, seulement quand un pointage tourne)
// ---------------------------------------------------------------------------------------------
function WorkingOnBanner({ entry, orNumber, card, day, nowMs, canAct, busy, finishPending, onPause, onFinish, onContinue }: {
  entry: MyEntry;
  orNumber: string | null; card: DayCard | null; day: MyDay; nowMs: number; canAct: boolean; busy: boolean; finishPending: boolean;
  onPause: () => void; onFinish: () => void; onContinue: () => void;
}) {
  const task = entry.kind !== 'travail';
  const v = card?.or?.vehicles ?? card?.appointment?.vehicles ?? null;
  const moto = v ? [v.brand, v.model].filter(Boolean).join(' ') : '';
  const progress = entry.or_id ? day.progress.get(entry.or_id) : undefined;
  const motive = card ? t(`myWorkshop.motive_${cardMotive(card).label}`) : '';
  const target = entry.or_id ? afterStartTarget({
    planTotal: progress?.total ?? 0, serviceCode: card?.or?.service_code ?? card?.appointment?.service_code ?? null,
  }) : null;
  const opText = entry.journey_operation
    ? (progress && progress.total > 0
      ? fill(t('uxAtelier.operationOf'), { done: progress.done + progress.not_done, total: progress.total, op: entry.journey_operation })
      : fill(t('myWorkshop.onOperation'), { op: entry.journey_operation }))
    : progress && progress.total > 0 ? fill(t('uxAtelier.operationsDone'), { done: progress.done + progress.not_done, total: progress.total }) : '';
  return (
    <section
      aria-label={t('uxAtelier.workingOn')}
      className="sticky -top-4 z-20 rounded-md border-2 border-info bg-card p-3 md:-top-6 shadow-[var(--shadow-card)] sm:p-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[min(100%,22rem)] flex-1">
          <p className="flex items-center gap-1.5 text-[13px] font-bold uppercase tracking-[0.04em] text-info">
            <Play className="size-4" aria-hidden /> {task ? t('uxAtelier.workingOnTask') : t('uxAtelier.workingOn')}
            <span className="font-data normal-case tabular-nums text-muted-foreground">· {durationText(entry.started_at, nowMs)}</span>
          </p>
          {!task && (
            <p className="mt-0.5 text-[19px] font-bold leading-tight">
              <span className="font-mono">{orNumber ?? ''}</span>
              {moto && <> · {moto}</>}
              {v?.plate && <> · <span className="font-mono">{v.plate}</span></>}
            </p>
          )}
          {task && <p className="mt-0.5 text-[19px] font-bold leading-tight">{t('myWorkshop.runningTask')}</p>}
          {(motive || opText) && (
            <p className="mt-0.5 line-clamp-2 text-[15px] text-muted-foreground">{[motive, opText].filter(Boolean).join(' · ')}</p>
          )}
        </div>
        {canAct && (
          <div className="flex flex-1 flex-wrap justify-end gap-2">
            {!task && (
              <Button variant="outline" className="h-14 min-w-[130px] flex-1 text-[17px] sm:flex-none" disabled={busy} onClick={onPause}>
                <Pause className="size-5" /> {t('pointage.pause')}
              </Button>
            )}
            <Button variant="outline" className="h-14 min-w-[130px] flex-1 text-[17px] sm:flex-none" disabled={busy} onClick={onFinish}>
              {finishPending ? <Loader2 className="size-5 animate-spin" /> : <Square className="size-5" />} {t('pointage.finish')}
            </Button>
            {!task && target && (
              <Button className="h-14 min-w-[220px] flex-1 text-[17px] sm:flex-none" disabled={busy} onClick={onContinue}>
                {target.to === 'journey' ? <ListChecks className="size-5" /> : <FileText className="size-5" />}
                {target.to === 'journey' ? t('uxAtelier.continueJourney') : t('uxAtelier.openOrSheet')}
              </Button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Section repliee (« A prendre », « OR anciens a verifier »)
// ---------------------------------------------------------------------------------------------
function FoldSection({ id, icon: Icon, tone, open, onOpenChange, title, count, hint, children }: {
  id: string; icon: typeof Wrench; tone: 'neutral' | 'warning'; open: boolean; onOpenChange: (v: boolean) => void;
  title: string; count: number; hint: string; children: ReactNode;
}) {
  return (
    <section aria-labelledby={id}>
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className={cn('flex min-h-14 w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-md border bg-card px-4 py-2 text-left',
              tone === 'warning' ? 'border-warning' : 'border-border')}
          >
            <Icon className={cn('size-6 shrink-0', tone === 'warning' ? 'text-warning' : 'text-muted-foreground')} aria-hidden />
            <span id={id} className="text-[18px] font-bold uppercase tracking-[0.02em]">{title}</span>
            <span className="font-data tabular-nums text-muted-foreground">({count})</span>
            <span className="min-w-0 flex-1 truncate text-[15px] text-muted-foreground">{hint}</span>
            <span className="ml-auto flex items-center gap-1 text-[15px] text-muted-foreground">
              {open ? t('myWorkshop.staleHide') : t('myWorkshop.staleShow')}
              <ChevronDown className={cn('size-5 transition-transform', open ? 'rotate-180' : '')} aria-hidden />
            </span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-3">{children}</CollapsibleContent>
      </Collapsible>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Une moto
// ---------------------------------------------------------------------------------------------
const GESTURE_LABEL: Record<Exclude<Gesture, 'none' | 'blocked'>, string> = {
  start: 'pointage.start', resume: 'pointage.resume', continue: 'myWorkshop.continue', create_or: 'pointage.start',
};
const GESTURE_ICON = { start: Play, resume: RotateCcw, continue: ListChecks, create_or: Play } as const;

function BikeCard({ card, day, today, gesture: g, busy, showOwner, doNow, reasons, onGesture, onOpenOr }: {
  card: DayCard; day: MyDay; today: string; gesture: Gesture; busy: boolean;
  /** Atelier d'un autre ou de tous : a qui est la moto. */
  showOwner: boolean;
  /** LA moto a faire maintenant : son geste est le seul bouton rouge de l'ecran. */
  doNow: boolean;
  reasons: PauseReason[];
  onGesture: (g: Gesture) => void; onOpenOr: (orId: string) => void;
}) {
  const owner = cardOwner(card, day.me, day.mechanics);
  const or = card.or;
  const a = card.appointment;
  const vehicle = or?.vehicles ?? a?.vehicles ?? null;
  const contact = or?.contacts ?? a?.contacts ?? null;
  const work = or?.work_description || a?.work_description || '';
  const moto = vehicle ? [vehicle.brand, vehicle.model].filter(Boolean).join(' ') : '';
  const when = cardWhen(card, today);
  const motive = cardMotive(card);
  const MotiveIcon = MOTIVE_ICON[motive.kind];
  const age = or ? ageLabel(orAgeDays(or.created_at, today)) : null;
  const group = day.vehicleGroups.get(card.key);
  const old = group?.role === 'old';
  const todayRdv = when.kind === 'appointment' && when.today;
  const whenText = when.kind === 'appointment'
    ? (when.today ? '' : fill(t('myWorkshop.rdvOn'), { date: shortDate(when.at), time: hhmm(when.at) }))
    : when.kind === 'received' ? fill(t('myWorkshop.receivedOn'), { date: shortDate(when.at) }) : '';
  const ageText = age && age.key !== 'age_today' ? fill(t(`myWorkshop.${age.key}`), { n: age.n }) : '';
  const ageWarn = old || (!!age && age.n > day.staleDays);
  const steps = cardSteps(card, {
    receptionReady: day.receptionReady, reception: or ? day.reception.get(or.id) : null,
    pointageReady: day.pointageReady, workStatus: or ? day.workStatus.get(or.id) : null,
    progress: or ? day.progress.get(or.id) : null,
  });
  const alerts = cardAlerts(card, { parts: day.parts.get(card.key), old });
  const parts = day.parts.get(card.key);

  // Etat du pointage sur la moto, en une ligne (couleur + icone + libelle).
  const mineOpen = card.work?.mineOpen ?? null;
  const minePaused = !mineOpen ? card.work?.mineLastPaused ?? null : null;
  const ws = or ? day.workStatus.get(or.id) : undefined;
  const live: { tone: 'info' | 'warning'; icon: typeof Play; text: string } | null = mineOpen
    ? { tone: 'info', icon: Play, text: fill(t('uxAtelier.mineRunning'), { at: whenShort(mineOpen.started_at, today) }) }
    : minePaused
      ? { tone: 'warning', icon: Pause, text: fill(t('uxAtelier.pausedSince'), { at: minePaused.ended_at ? whenShort(minePaused.ended_at, today) : '', reason: stopLabel(minePaused.stop_kind, minePaused.stop_reason, reasons, t) }) }
      : ws?.work_state === 'running'
        ? { tone: 'info', icon: Play, text: fill(t('uxAtelier.otherRunning'), { who: ws.running_by ?? '?', at: ws.running_since ? whenShort(ws.running_since, today) : '' }) }
        : ws?.work_state === 'paused'
          ? { tone: 'warning', icon: Pause, text: fill(t('pointage.pausedReason'), { reason: stopLabel(ws.last_stop_kind, ws.last_stop_reason, reasons, t) }) }
          : null;

  const showGesture = g !== 'none' && g !== 'blocked';
  const GIcon = showGesture ? GESTURE_ICON[g] : Play;

  return (
    <article className={cn('flex flex-col rounded-md border bg-card p-4 shadow-[var(--shadow-card)]',
      doNow ? 'border-2 border-foreground' : mineOpen ? 'border-2 border-info' : old || minePaused ? 'border-warning' : 'border-border')}>
      <header className="flex items-start gap-3">
        <div className="w-[60px] shrink-0 text-center">
          {todayRdv
            ? <p className="font-data text-[22px] font-bold leading-none tabular-nums">{hhmm(when.at)}</p>
            : old ? <History className="mx-auto size-6 text-warning" aria-hidden /> : <Wrench className="mx-auto size-6 text-muted-foreground" aria-hidden />}
          {a?.planned_minutes && todayRdv ? <p className="mt-1 font-data text-[13px] tabular-nums text-muted-foreground">{fill(t('myWorkshop.planned'), { min: a.planned_minutes })}</p> : null}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <p className="min-w-0 text-[20px] font-bold uppercase leading-tight">
              {moto || t('myWorkshop.noVehicle')}
              {vehicle?.plate && <span className="font-mono text-[17px] font-normal normal-case"> · {vehicle.plate}</span>}
            </p>
            <p className="truncate text-[16px]">{contactLabel(contact) || t('myWorkshop.noClient')}</p>
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[15px] text-muted-foreground">
            <span className={cn('font-mono', or ? 'text-foreground' : '')}>{or ? or.number || '—' : t('uxAtelier.noOrYet')}</span>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1"><MotiveIcon className="size-4" aria-hidden /> {t(`myWorkshop.motive_${motive.label}`)}</span>
            {whenText && <><span aria-hidden>·</span><span>{whenText}</span></>}
            {ageText && <><span aria-hidden>·</span><span className={ageWarn ? 'font-bold text-warning' : undefined}>{ageText}</span></>}
            {showOwner && owner.name && <><span aria-hidden>·</span><span className="inline-flex items-center gap-1"><User className="size-4" aria-hidden /> {owner.name}</span></>}
          </p>
          {work && <p className="mt-1 line-clamp-1 text-[15px]">{work}</p>}
        </div>
        {doNow && (
          <StatusBadge tone="info" icon={Play} className="hidden shrink-0 px-2.5 py-1 text-[13px] sm:inline-flex" label={t('uxAtelier.doNow')} />
        )}
      </header>

      {doNow && <StatusBadge tone="info" icon={Play} className="mt-2 self-start px-2.5 py-1 text-[13px] sm:hidden" label={t('uxAtelier.doNow')} />}

      {live && (
        <p className={cn('mt-2 flex items-center gap-1.5 text-[15px] font-bold', live.tone === 'info' ? 'text-info' : 'text-warning')}>
          <live.icon className="size-4 shrink-0" aria-hidden /> {live.text}
        </p>
      )}

      <OrStepsTrail steps={steps} className="mt-3" />

      {(alerts.length > 0 || group) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {alerts.map((al) => (
            <StatusBadge key={al} tone="warning" icon={ALERT_ICON[al]} className="px-2.5 py-1 text-[14px]"
              label={al === 'parts_missing'
                ? (parts?.missing === 1 ? t('myWorkshop.parts_missing_one') : fill(t('myWorkshop.parts_missing'), { n: parts?.missing ?? 0 }))
                : al === 'old_or' ? t('myWorkshop.oldOr') : t('uxAtelier.alertApproval')} />
          ))}
          {group && (
            <span className="inline-flex min-w-0 items-start gap-1.5 text-[14px] text-foreground">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              <span>
                <span className="font-bold">{fill(t(or ? 'myWorkshop.vehicleOpenOrs' : 'myWorkshop.vehicleOpenOrsRdv'), { n: group.openOrs })}</span>
                {group.others.length > 0 && <> · {fill(t('myWorkshop.otherOrs'), {
                  list: group.others.map((o) => `${o.number || '—'} (${shortDate(o.created_at)})`).join(', '),
                })}</>}
              </span>
            </span>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {showGesture && (
          <Button variant={doNow ? 'default' : 'outline'} className="h-14 min-w-[180px] flex-1 text-[18px]" disabled={busy} onClick={() => onGesture(g)}>
            {busy ? <Loader2 className="size-6 animate-spin" /> : <GIcon className="size-6" />} {t(GESTURE_LABEL[g])}
          </Button>
        )}
        {g === 'blocked' && <p className="flex-1 self-center text-[15px] text-warning">{t('checkup.workBlocked')}</p>}
        {or && (
          <Button variant="outline" className="h-14 min-w-[140px] text-[17px]" onClick={() => onOpenOr(or.id)}>
            <FileText className="size-5" /> {t('myWorkshop.openOr')}
          </Button>
        )}
      </div>
    </article>
  );
}
