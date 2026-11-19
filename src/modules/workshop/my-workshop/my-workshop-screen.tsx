/**
 * M8 — Parcours mecanicien, lot F (19/11/2026) : ecran tablette « Mon atelier ».
 * Demande du client : un point d'entree par mecanicien, la tablette tenue a cote de la moto.
 *
 *  - En haut : le mecanicien connecte, son pointage en cours ou en pause (lot A) et de tres gros
 *    boutons Pause / Reprendre / Terminer.
 *  - « Mes motos du jour » : RDV du jour et OR qui lui sont attribues, puis les OR « a faire » non
 *    attribues. Par moto : moto, client, travaux, statut, avancement x / y (lot D), photos de
 *    reception (lot C), pieces (lot B).
 *  - Un geste par moto : Demarrer / Reprendre enchaine la serie de photos si elle n'est pas
 *    faite (lot C), le pointage (lot A) puis le parcours guide de l'OR (lot D), ou la vue
 *    eclatee de chaque operation (lot E) est branchee. Tout est reutilise, rien n'est refait.
 *
 * Ergonomie tablette : cibles d'au moins 48 px (gestes 64 px), texte de 16 a 22 px, rien au
 * survol, une colonne en portrait et deux en paysage, peu d'informations par carte.
 * Charte : tokens uniquement, statut = couleur + icone + libelle, le rouge Ducati (bouton
 * principal) reserve au geste de la moto et a « Reprendre ».
 * Rafraichissement : relecture toutes les 45 s (et au retour sur l'onglet), sans recharger la page.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Bike, Camera, ClipboardList, FileText, Inbox, ListChecks, Loader2, Package, PackageCheck, PackageX, Pause, Play,
  RefreshCw, RotateCcw, Square, Timer, User, Wrench,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusBadge } from '@/components/status-badge';
import { useConfirm } from '@/components/confirm-provider';
import { useAuth } from '@/lib/auth/auth-context';
import { useCanWrite } from '@/lib/auth/use-access';
import { fill } from '@/modules/catalog/format';
import { getLocale, t } from '@/lib/i18n';
import { brusselsParts } from '../reservations/parts-flow';
import { OrStatusBadge } from '../or-base/or-status-badge';
import { PlanProgressBadge } from '../plan-ops/plan-ops-panel';
import { OrWorkBadge, PauseDialog, startWorkWithConfirm } from '../pointage/work-controls';
import { listPauseReasons, pauseWork, stopWorkPointage } from '../pointage/api';
import { reasonLabel } from '../pointage/rules';
import { ReceptionSheet } from '../reception/reception-sheet';
import { createOrFromPlanningAppointment, type PlanningAppointment } from '../planning/api';
import type { PlanningMechanic } from '../planning/rules';
import { StatusIcon } from '../planning/status-icon';
import { statusTone } from '../planning/rules';
import { contactLabel, motoLabel } from '../planning/ui-bits';
import { getHomePref, loadMyDay, saveHomePref, type MyDay } from './api';
import {
  HOME_PREFS, MY_WORKSHOP_REFRESH_MS, afterStartTarget, cardGesture, myCurrentWork, needsReceptionFirst, partsTone,
  photosState, photosTone, type DayCard, type Gesture, type HomePref, type MyNow, type PartsState,
} from './rules';

const ORIGIN = 'tablet';
/** Badges agrandis (lisibles a bout de bras) : memes couleurs, icones et libelles que partout. */
const BIG = 'px-2.5 py-1 text-[14px]';
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString(`${getLocale()}-BE`, { hour: '2-digit', minute: '2-digit' });
const todayBrussels = () => brusselsParts(new Date()).date;

const PARTS_ICON: Record<PartsState, typeof Package> = { none: Package, missing: PackageX, reserved: Package, prepared: PackageCheck };

export function MyWorkshopScreen({ companyId }: { companyId: string }) {
  const { user, profile } = useAuth();
  const canWrite = useCanWrite();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const userId = user?.id ?? null;

  // Le jour suit l'horloge de Bruxelles (une tablette laissee allumee passe minuit).
  const [today, setToday] = useState(todayBrussels);
  useEffect(() => {
    const id = setInterval(() => setToday(todayBrussels()), 60_000);
    return () => clearInterval(id);
  }, []);

  const day = useQuery({
    queryKey: ['my-workshop', companyId, userId, today],
    queryFn: () => loadMyDay({ companyId, userId: userId!, profileName: profile?.full_name ?? null, today }),
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

  /** Pointage (lot A, un seul pointage actif, confirmation) puis le travail. */
  const pointThenGo = async (orId: string, card: DayCard | null, gesture: Gesture) => {
    const res = await startWorkWithConfirm(orId, { origin: ORIGIN }, confirm);
    if (!res || res.status === 'needs_confirm') { refresh(); return; }
    toast.success(res.status === 'resumed' ? t('pointage.resumed') : res.status === 'started' ? t('pointage.started') : t('myWorkshop.alreadyRunning'));
    refresh();
    goToWork(orId, card, gesture === 'start' ? null : res.operation ?? null);
  };

  /** Le geste de la moto : (ouvrir l'OR) → photos si besoin (lot C) → pointage (lot A) → parcours (lot D). */
  const gesture = useMutation({
    mutationFn: async ({ card, g }: { card: DayCard; g: Gesture }) => {
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
        setReception({ orId: id, orNumber, go: () => { void pointThenGo(id, card, g).catch(onErr).finally(() => setBusyKey(null)); } });
        return 'reception';
      }
      await pointThenGo(id, card, g);
    },
    meta: { success: false },
    onMutate: ({ card }) => setBusyKey(card.key),
    onSettled: (r) => { if (r !== 'reception') setBusyKey(null); },
    onError: onErr,
  });

  // ------------------------------------------------------------------ bandeau du haut
  const now: MyNow = useMemo(() => (d ? myCurrentWork(d.myEntries, userId, d.closedOrs) : { kind: 'idle' }), [d, userId]);
  const nowCard = now.kind !== 'idle' && now.entry.or_id ? d?.cards.find((c) => c.or?.id === now.entry.or_id) ?? null : null;

  const pause = useMutation({
    mutationFn: (v: { reason: string; orStatus: string | null }) => {
      if (now.kind !== 'running') throw new Error(t('myWorkshop.nothingRunning'));
      return pauseWork({ reason: v.reason, entryId: now.entry.id, orId: now.entry.or_id, orStatus: v.orStatus, origin: ORIGIN });
    },
    meta: { success: false },
    onSuccess: (r) => { setPauseOpen(false); toast.success(r.or_status_changed ? t('pointage.pausedStatus') : t('pointage.paused')); refresh(); },
    onError: onErr,
  });
  const finish = useMutation({
    mutationFn: () => {
      if (now.kind !== 'running') throw new Error(t('myWorkshop.nothingRunning'));
      return stopWorkPointage({ entryId: now.entry.id, orId: now.entry.or_id, origin: ORIGIN });
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

  const mine = d.cards.filter((c) => c.section === 'mine');
  const free = d.cards.filter((c) => c.section === 'unassigned');
  const nowReasons = reasons.data ?? [];
  const nowOrNumber = now.kind !== 'idle' && now.entry.or_id ? d.orNumbers.get(now.entry.or_id) ?? null : null;

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-5 pb-10 text-[16px]">
      {/* ------------------------------------------------------------ moi + mon pointage */}
      <section className="rounded-md border border-border bg-card p-4 shadow-[var(--shadow-card)] sm:p-5" aria-label={t('myWorkshop.nowTitle')}>
        <div className="flex flex-wrap items-center gap-4">
          <div className="grid size-14 shrink-0 place-items-center rounded-md bg-accent text-muted-foreground"><User className="size-7" aria-hidden /></div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-[22px] font-bold leading-tight">{d.me.displayName || t('myWorkshop.meUnknown')}</p>
            <p className="text-[15px] text-muted-foreground">
              {new Date().toLocaleDateString(`${getLocale()}-BE`, { weekday: 'long', day: 'numeric', month: 'long' })}
              {!d.me.mechanicIds.length && <> · {t('myWorkshop.notLinked')}</>}
            </p>
          </div>
          <Button variant="ghost" className="h-12 text-[15px]" onClick={() => day.refetch()} disabled={day.isFetching} aria-label={t('myWorkshop.reload')}>
            {day.isFetching ? <Loader2 className="animate-spin" /> : <RefreshCw />} <span className="hidden sm:inline">{t('myWorkshop.reload')}</span>
          </Button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-md border border-border bg-background p-3">
          <div className="min-w-0 flex-1">
            {now.kind === 'running' && (
              <>
                <StatusBadge tone="info" icon={Play} className={BIG}
                  label={now.entry.kind === 'improductif' ? t('myWorkshop.runningTask') : fill(t('myWorkshop.runningOr'), { number: nowOrNumber ?? '' })} />
                <p className="mt-2 text-[17px]">
                  {fill(t('myWorkshop.since'), { at: hhmm(now.entry.started_at) })}
                  {now.entry.journey_operation && <> · {fill(t('myWorkshop.onOperation'), { op: now.entry.journey_operation })}</>}
                  {nowCard?.or && <> · {motoLabel(nowCard.or.vehicles ?? null)}</>}
                </p>
              </>
            )}
            {now.kind === 'paused' && (
              <>
                <StatusBadge tone="warning" icon={Pause} className={BIG}
                  label={fill(t('pointage.pausedReason'), { reason: now.entry.stop_kind === 'auto_stop' ? t('pointage.stop_auto_stop') : reasonLabel(now.entry.stop_reason, nowReasons, t) || t('pointage.stop_pause') })} />
                <p className="mt-2 text-[17px]">
                  {fill(t('myWorkshop.pausedOn'), { number: nowOrNumber ?? '', at: now.entry.ended_at ? hhmm(now.entry.ended_at) : '' })}
                  {nowCard?.or && <> · {motoLabel(nowCard.or.vehicles ?? null)}</>}
                </p>
              </>
            )}
            {now.kind === 'idle' && (
              <>
                <StatusBadge tone="neutral" icon={Timer} className={BIG} label={t('myWorkshop.idle')} />
                <p className="mt-2 text-[17px] text-muted-foreground">{t('myWorkshop.idleHint')}</p>
              </>
            )}
          </div>
          {canWrite && d.pointageReady && (
            <div className="flex w-full flex-wrap gap-3 sm:w-auto">
              {now.kind === 'running' && now.entry.kind === 'travail' && (
                <Button variant="outline" className="h-16 min-w-[160px] flex-1 text-[18px] sm:flex-none" disabled={topBusy} onClick={() => setPauseOpen(true)}>
                  <Pause className="size-6" /> {t('pointage.pause')}
                </Button>
              )}
              {now.kind === 'paused' && (
                <Button className="h-16 min-w-[160px] flex-1 text-[18px] sm:flex-none" disabled={topBusy} onClick={() => resume.mutate()}>
                  {resume.isPending ? <Loader2 className="size-6 animate-spin" /> : <RotateCcw className="size-6" />} {t('pointage.resume')}
                </Button>
              )}
              {now.kind === 'running' && (
                <Button variant="outline" className="h-16 min-w-[160px] flex-1 text-[18px] sm:flex-none" disabled={topBusy} onClick={() => finish.mutate()}>
                  {finish.isPending ? <Loader2 className="size-6 animate-spin" /> : <Square className="size-6" />} {t('pointage.finish')}
                </Button>
              )}
              <Button variant="ghost" className="h-16 text-[16px]" onClick={() => navigate({ to: '/workshop/chrono' })}>
                <Timer className="size-5" /> {t('myWorkshop.chrono')}
              </Button>
            </div>
          )}
        </div>
        {!d.pointageReady && <p className="mt-3 text-[15px] text-warning">{t('myWorkshop.pointageMissing')}</p>}
      </section>

      {/* ------------------------------------------------------------ mes motos du jour */}
      <section aria-labelledby="mw-mine">
        <h2 id="mw-mine" className="mb-3 flex items-center gap-2 font-display text-[20px] font-bold">
          <Bike className="size-6" aria-hidden /> {t('myWorkshop.mineTitle')} <span className="font-data tabular-nums text-muted-foreground">({mine.length})</span>
        </h2>
        {mine.length ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {mine.map((c) => (
              <BikeCard key={c.key} card={c} day={d} canWrite={canWrite} busy={busyKey === c.key}
                onGesture={(g) => gesture.mutate({ card: c, g })}
                onOpenOr={(orId) => navigate({ to: '/workshop/$orId', params: { orId } })}
              />
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-md border border-dashed border-border bg-card p-6 text-[17px] text-muted-foreground">
            <Inbox className="size-7 shrink-0" aria-hidden /> {t('myWorkshop.mineEmpty')}
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------ OR a faire non attribues */}
      <section aria-labelledby="mw-free">
        <h2 id="mw-free" className="mb-3 flex items-center gap-2 font-display text-[20px] font-bold">
          <ClipboardList className="size-6" aria-hidden /> {t('myWorkshop.freeTitle')} <span className="font-data tabular-nums text-muted-foreground">({free.length})</span>
        </h2>
        {free.length ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {free.map((c) => (
              <BikeCard key={c.key} card={c} day={d} canWrite={canWrite} busy={busyKey === c.key}
                onGesture={(g) => gesture.mutate({ card: c, g })}
                onOpenOr={(orId) => navigate({ to: '/workshop/$orId', params: { orId } })}
              />
            ))}
          </div>
        ) : <p className="text-[16px] text-muted-foreground">{t('myWorkshop.freeEmpty')}</p>}
      </section>

      <HomePrefSetting userId={userId} />

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
// Une moto
// ---------------------------------------------------------------------------------------------
const GESTURE_LABEL: Record<Exclude<Gesture, 'none' | 'blocked'>, string> = {
  start: 'pointage.start', resume: 'pointage.resume', continue: 'myWorkshop.continue', create_or: 'myWorkshop.createOr',
};
const GESTURE_ICON = { start: Play, resume: RotateCcw, continue: ListChecks, create_or: FileText } as const;

function BikeCard({ card, day, canWrite, busy, onGesture, onOpenOr }: {
  card: DayCard; day: MyDay; canWrite: boolean; busy: boolean;
  onGesture: (g: Gesture) => void; onOpenOr: (orId: string) => void;
}) {
  const or = card.or;
  const a = card.appointment;
  const vehicle = or?.vehicles ?? a?.vehicles ?? null;
  const contact = or?.contacts ?? a?.contacts ?? null;
  const work = or?.work_description || a?.work_description || '';
  const g = cardGesture(card, canWrite && day.pointageReady);
  const progress = or ? day.progress.get(or.id) : undefined;
  const rec = or ? day.reception.get(or.id) : undefined;
  const ps = photosState(rec?.status, rec?.missing ?? 0);
  const parts = day.parts.get(card.key);
  const PartsIcon = parts ? PARTS_ICON[parts.state] : Package;
  const running = !!card.work?.mineOpen;
  const paused = !running && !!card.work?.mineLastPaused;

  return (
    <article className={`flex flex-col rounded-md border bg-card p-4 shadow-[var(--shadow-card)] ${running ? 'border-info' : paused ? 'border-warning' : 'border-border'}`}>
      <header className="flex items-start gap-3">
        <div className="min-w-[64px] shrink-0 text-center">
          {a ? <p className="font-data text-[22px] font-bold leading-none tabular-nums">{hhmm(a.starts_at)}</p> : <Wrench className="mx-auto size-6 text-muted-foreground" aria-hidden />}
          {a?.planned_minutes ? <p className="mt-1 font-data text-[13px] tabular-nums text-muted-foreground">{fill(t('myWorkshop.planned'), { min: a.planned_minutes })}</p> : null}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[19px] font-bold leading-snug">{motoLabel(vehicle) || t('myWorkshop.noVehicle')}</p>
          <p className="truncate text-[16px] text-muted-foreground">
            {contactLabel(contact) || t('myWorkshop.noClient')}
            {or?.number && <> · OR {or.number}</>}
          </p>
        </div>
      </header>

      {work && <p className="mt-2 line-clamp-2 text-[16px] leading-snug">{work}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {or ? <OrStatusBadge status={or.status} className={BIG} /> : a && (
          <StatusBadge tone={statusTone(a.status)} icon={StatusIcon(a.status)} label={t(`planningG8.status_${a.status}`)} className={BIG} />
        )}
        {or && <OrWorkBadge row={day.workStatus.get(or.id)} className={BIG} />}
        {progress && progress.total > 0 && (
          <PlanProgressBadge done={progress.done} resolved={progress.done + progress.not_done} total={progress.total} className={BIG} />
        )}
        {or && day.receptionReady && <StatusBadge tone={photosTone(ps)} icon={Camera} label={t(`myWorkshop.photos_${ps}`)} className={BIG} />}
        {parts && parts.state !== 'none' && (
          <StatusBadge tone={partsTone(parts.state)} icon={PartsIcon} className={BIG}
            label={parts.state === 'missing' ? fill(t('myWorkshop.parts_missing'), { n: parts.missing }) : t(`myWorkshop.parts_${parts.state}`)} />
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        {g !== 'none' && g !== 'blocked' && (() => {
          const Icon = GESTURE_ICON[g];
          return (
            <Button className="h-16 min-w-[200px] flex-1 text-[18px]" disabled={busy} onClick={() => onGesture(g)}>
              {busy ? <Loader2 className="size-6 animate-spin" /> : <Icon className="size-6" />} {t(GESTURE_LABEL[g])}
            </Button>
          );
        })()}
        {g === 'blocked' && <p className="flex-1 self-center text-[15px] text-warning">{t('checkup.workBlocked')}</p>}
        {or && (
          <Button variant="outline" className="h-16 min-w-[140px] text-[17px]" onClick={() => onOpenOr(or.id)}>
            <FileText className="size-5" /> {t('myWorkshop.openOr')}
          </Button>
        )}
      </div>
      {g === 'start' && day.receptionReady && rec?.status !== 'complete' && rec?.status !== 'plus_tard' && (
        <p className="mt-2 flex items-center gap-2 text-[14px] text-muted-foreground"><Camera className="size-4" aria-hidden /> {t('myWorkshop.photosFirst')}</p>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------------------------
// Page d'accueil apres connexion
// ---------------------------------------------------------------------------------------------
function HomePrefSetting({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const pref = useQuery({ queryKey: ['home-pref', userId], queryFn: () => getHomePref(userId), staleTime: 300_000 });
  const save = useMutation({
    mutationFn: (v: HomePref) => saveHomePref(userId, v),
    meta: { success: false },
    onSuccess: () => { toast.success(t('myWorkshop.homeSaved')); void qc.invalidateQueries({ queryKey: ['home-pref', userId] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : t('workshop.errSave')),
  });
  if (pref.data == null) return null; // colonne absente (migration 20261119290000 non appliquee)
  return (
    <section className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card p-4">
      <div className="min-w-0 flex-1">
        <p className="text-[16px] font-bold">{t('myWorkshop.homeTitle')}</p>
        <p className="text-[14px] text-muted-foreground">{t('myWorkshop.homeHint')}</p>
      </div>
      <Select value={pref.data} onValueChange={(v) => save.mutate(v as HomePref)} disabled={save.isPending}>
        <SelectTrigger className="h-12 w-full text-[16px] sm:w-[280px]" aria-label={t('myWorkshop.homeTitle')}><SelectValue /></SelectTrigger>
        <SelectContent>
          {HOME_PREFS.map((p) => <SelectItem key={p} value={p} className="h-12 text-[16px]">{t(`myWorkshop.home_${p}`)}</SelectItem>)}
        </SelectContent>
      </Select>
    </section>
  );
}
