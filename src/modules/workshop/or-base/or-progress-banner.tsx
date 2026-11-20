/**
 * M8 — Lot « OR lisible » (19/11/2026) : bandeau « Où en est cet OR / prochaine étape », en tête
 * de la fiche OR. Une seule lecture de l'OR (règles pures `progress-rules.ts`) :
 *  - le titre de l'état (couleur + icône + libellé), cohérent avec le pointage ;
 *  - la frise Réception (photos) → Travail (pointage) → Opérations x / y → Prêt → Facture ;
 *  - UN gros bouton rouge pour l'étape suivante, 2 ou 3 actions secondaires.
 * Il remplace le bloc « Travail sur l'OR (pointeuse) » : mêmes gestes (Démarrer, Pause, Reprendre,
 * Terminer du lot A ; « Terminer » des opérations du lot D), mêmes fonctions en base.
 */
import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import {
  AlertTriangle, Ban, BellRing, Camera, CheckCircle2, Circle, ClipboardCheck, Clock, FileText, ListChecks, Loader2,
  Pause, PenLine, Play, Receipt, RotateCcw, Square, XCircle, type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/confirm-provider';
import { cn } from '@/lib/utils';
import { t, fillVars } from '@/lib/i18n';
import { ReadySmsLine } from '@/modules/crm/sms-queue';
import { WarrantyStatusBadge } from '../warranty/warranty-views';
import { PauseDialog, fmtWorkMinutes, usePointage, workStateLabel } from '../pointage/work-controls';
import { stopWorkPointage } from '../pointage/api';
import { useReception } from '../reception/reception-sheet';
import { finishPlanOps, getPlanProgress } from '../plan-ops/api';
import { FinishDialog } from '../plan-ops/plan-ops-panel';
import { setRepairOrderStatus, startRepairOrder } from '../write-api';
import { orProgress, type Headline, type NextAction, type SideAction, type Tone } from './progress-rules';
import { OrStepsTrail } from './or-steps-trail';

const HEAD_ICON: Record<Headline, LucideIcon> = {
  cancelled: XCircle, invoiced: Receipt, ready: CheckCircle2, informed: BellRing, blocked_approval: Ban, blocked_warranty: Clock,
  running: Play, paused: Pause, in_progress_nobody: AlertTriangle, waiting_parts: Clock, waiting_quote: Clock,
  todo_photos: Camera, todo: Circle,
};
const NEXT_ICON: Record<NextAction, LucideIcon> = {
  photos: Camera, start: Play, resume: RotateCcw, journey: ListChecks, finish: ClipboardCheck, ready: CheckCircle2,
  invoice: FileText, view_invoice: Receipt, none: Circle,
};
const SIDE_ICON: Record<SideAction, LucideIcon> = {
  pause: Pause, stop: Square, photos: Camera, journey: ListChecks, notify_ready: BellRing, approval: PenLine,
};
const TONE_BOX: Record<Tone, string> = {
  success: 'border-success bg-success-bg text-success', warning: 'border-warning bg-warning-bg text-warning',
  danger: 'border-danger bg-danger-bg text-danger', info: 'border-info bg-info-bg text-info', neutral: 'border-border bg-muted text-foreground',
};

export function OrProgressBanner(p: {
  orId: string;
  companyId: string | null;
  orStatus: string;
  warrantyStatus: string | null | undefined;
  workAllowed: boolean;
  warrantyPending: boolean;
  hasService: boolean;
  invoiceBusy?: boolean;
  /** Temps deja pointe par l'ancienne pointeuse (sans le lot A), en minutes. */
  fallbackWorkedMinutes?: number;
  onPhotos: () => void;
  onInvoice: () => void;
  onViewInvoice?: () => void;
  onNotifyReady?: () => void;
  onApproval?: () => void;
  onChanged: () => void;
  /**
   * Lot UX atelier (20/11) : ligne d'identite de l'OR (n°, client, moto + plaque, km) et actions
   * (Imprimer, « Plus d'actions »). Fournies : le bandeau devient la barre d'identite collee en haut
   * de la fiche (toujours visible), avec la frise compacte et le gros bouton de l'etape suivante.
   */
  identity?: ReactNode;
  actions?: ReactNode;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const pt = usePointage({ orId: p.orId, companyId: p.companyId, onChanged: p.onChanged });
  const rec = useReception(p.orId, p.companyId);
  const plan = useQuery({ queryKey: ['plan-progress', p.orId], queryFn: () => getPlanProgress([p.orId]) });
  const row = plan.data?.get(p.orId) ?? null;
  const [finishOpen, setFinishOpen] = useState(false);

  const refresh = () => {
    for (const k of [['plan-progress'], ['plan-ops', p.orId], ['or-work', p.orId], ['or-work-status'], ['reception', p.orId], ['sms-ready', p.orId]]) {
      void qc.invalidateQueries({ queryKey: k });
    }
    p.onChanged();
  };
  const onErr = (e: unknown) => toast.error(e instanceof Error ? e.message : t('workshop.errSave'));

  // Sans pointage en base (lot A absent) : « Démarrer » passe seulement l'OR en cours (Q43).
  const startOr = useMutation({ mutationFn: () => startRepairOrder(p.orId), meta: { success: false }, onSuccess: () => { toast.success(t('orBase.started')); refresh(); }, onError: onErr });
  const finish = useMutation({
    mutationFn: () => finishPlanOps(p.orId),
    meta: { success: false },
    onSuccess: (r) => {
      setFinishOpen(false);
      toast.success(r.sms?.status === 'pending' || r.sms?.status === 'queued' || r.sms?.status === 'sent' ? t('planOps.finishedSms') : t('planOps.finished'));
      refresh();
    },
    onError: onErr,
  });
  // OR sans liste d'opérations : « Passer prêt » = mon chrono s'arrête, puis statut « Prêt » (SMS existant).
  const ready = useMutation({
    mutationFn: async () => {
      if (pt.ready && pt.state.mineOpen) await stopWorkPointage({ orId: p.orId });
      await setRepairOrderStatus(p.orId, 'pret');
    },
    meta: { success: false },
    onSuccess: () => { toast.success(t('orLisible.readyDone')); refresh(); },
    onError: onErr,
  });

  const pr = orProgress({
    orStatus: p.orStatus,
    receptionOn: rec.loaded,
    receptionStatus: rec.status,
    photosTaken: rec.summary.taken,
    photosTotal: rec.summary.total,
    photosMissing: rec.summary.missing.length,
    pointageOn: pt.ready,
    workState: pt.state.state,
    mineRunning: !!pt.state.mineOpen,
    minePaused: !!pt.state.mineLastPaused,
    runningBy: pt.state.running.map((r) => r.name).join(', ') || null,
    planTotal: row?.total ?? 0,
    planResolved: (row?.done ?? 0) + (row?.not_done ?? 0),
    planMandatoryOpen: row?.mandatory_open ?? 0,
    hasService: p.hasService,
    workAllowed: p.workAllowed,
    warrantyPending: p.warrantyPending,
    planExpected: p.hasService,
  });

  const busy = pt.busy || startOr.isPending || finish.isPending || ready.isPending || !!p.invoiceBusy;
  const doNext = async (a: NextAction) => {
    switch (a) {
      case 'photos': return p.onPhotos();
      case 'start': return pt.ready ? pt.start.mutate(null) : startOr.mutate();
      case 'resume': return pt.start.mutate(null);
      case 'journey': return navigate({ to: '/workshop/journey/$orId', params: { orId: p.orId } });
      case 'finish': return setFinishOpen(true);
      case 'ready': {
        const ok = await confirm({ title: t('orLisible.readyTitle'), message: t('orLisible.readyMessage'), confirmLabel: t('orLisible.readyOk') });
        if (ok) ready.mutate();
        return;
      }
      case 'invoice': return p.onInvoice();
      case 'view_invoice': return p.onViewInvoice?.();
      default: return undefined;
    }
  };
  const doSide = (a: SideAction) => {
    switch (a) {
      case 'pause': return pt.setPauseOpen(true);
      case 'stop': return pt.finish.mutate();
      case 'photos': return p.onPhotos();
      case 'journey': return navigate({ to: '/workshop/journey/$orId', params: { orId: p.orId } });
      case 'notify_ready': return p.onNotifyReady?.();
      case 'approval': return p.onApproval?.();
      default: return undefined;
    }
  };
  const sideShown = pr.side.filter((a) => (a !== 'notify_ready' || !!p.onNotifyReady) && (a !== 'approval' || !!p.onApproval));

  const HeadIcon = HEAD_ICON[pr.headline];
  const headText = pr.headline === 'running'
    ? (pt.state.running.length ? fillVars(t('orLisible.head_running'), { who: pt.state.running.map((r) => r.name).join(', ') }) : t('orLisible.head_running_anon'))
    : t(`orLisible.head_${pr.headline}`);
  const hint = (pr.headline === 'paused' || pr.headline === 'running') && pt.ready ? workStateLabel(pt.state, pt.reasons) : t(`orLisible.hint_${pr.headline}`);
  const NextIcon = NEXT_ICON[pr.next];
  const pending = (pr.next === 'start' || pr.next === 'resume') ? (pt.start.isPending || startOr.isPending)
    : pr.next === 'ready' ? ready.isPending : pr.next === 'finish' ? finish.isPending : pr.next === 'invoice' ? !!p.invoiceBusy : false;

  const sideButtons = sideShown.map((a) => {
    const Icon = SIDE_ICON[a];
    return (
      <Button key={a} variant="outline" className="h-12 text-[15px]" disabled={busy} onClick={() => doSide(a)}>
        {a === 'stop' && pt.finish.isPending ? <Loader2 className="animate-spin" /> : <Icon />} {t(`orLisible.side_${a}`)}
      </Button>
    );
  });
  const nextButton = pr.next !== 'none' && (
    <Button
      variant={pr.next === 'view_invoice' ? 'outline' : 'default'} title={t('orLisible.nextLabel')}
      className="h-12 min-w-[200px] text-[17px]" disabled={busy} onClick={() => void doNext(pr.next)}
    >
      {pending ? <Loader2 className="animate-spin" /> : <NextIcon className="size-5" />} {t(`orLisible.next_${pr.next}`)}
    </Button>
  );
  const headChip = (
    <div className={cn('inline-flex max-w-full items-center gap-2 rounded-[var(--radius-badge)] border px-2.5 py-1', TONE_BOX[pr.tone])} title={hint}>
      <HeadIcon className="size-5 shrink-0" aria-hidden />
      <span className="truncate text-[15px] font-bold leading-tight">{headText}</span>
    </div>
  );
  const extras = (
    <>
      {p.warrantyStatus && p.warrantyStatus !== 'aucune' && <WarrantyStatusBadge status={p.warrantyStatus} />}
      <ReadySmsLine orId={p.orId} status={p.orStatus} />
      {(pt.total || p.fallbackWorkedMinutes || 0) > 0 && <span className="font-data text-[13px] tabular-nums text-muted-foreground">{fillVars(t('orLisible.workedTime'), { time: fmtWorkMinutes(pt.total || p.fallbackWorkedMinutes || 0) })}</span>}
    </>
  );

  const dialogs = (
    <>
      <PauseDialog
        open={pt.pauseOpen} reasons={pt.reasons} orStatus={p.orStatus} busy={pt.pause.isPending}
        onCancel={() => pt.setPauseOpen(false)} onConfirm={(v) => pt.pause.mutate(v)}
      />
      <FinishDialog
        open={finishOpen} done={row?.done ?? 0} notDone={row?.not_done ?? 0} busy={finish.isPending}
        onCancel={() => setFinishOpen(false)} onConfirm={() => finish.mutate()}
      />
    </>
  );

  // Lot UX atelier (20/11) : barre d'identite collee en haut de la fiche OR, toujours visible
  // (n°, client, moto + plaque, km, etat + frise compacte, gros bouton de l'etape suivante).
  if (p.identity) {
    return (
      <section
        aria-label={t('orLisible.title')}
        className="sticky -top-4 z-20 mb-3 rounded-md md:-top-6 border border-border bg-card px-3 py-2.5 shadow-[var(--shadow-card)]"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="min-w-0 flex-1">{p.identity}</div>
          {p.actions && <div className="flex flex-wrap items-center gap-2">{p.actions}</div>}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
          {headChip}
          <OrStepsTrail steps={pr.steps} className="min-w-[min(100%,27rem)] flex-1" />
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {sideButtons}
            {nextButton}
          </div>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">{hint}</p>
          {extras}
        </div>
        {dialogs}
      </section>
    );
  }

  return (
    <section aria-label={t('orLisible.title')} className="mb-4 rounded-md border border-border bg-card p-4 shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('orLisible.title')}</p>
          <div className="mt-1">{headChip}</div>
          <p className="mt-1.5 text-[13px] text-muted-foreground">{hint}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">{extras}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sideButtons}
          {nextButton}
        </div>
      </div>
      <OrStepsTrail steps={pr.steps} size="full" className="mt-4" />
      {dialogs}
    </section>
  );
}
