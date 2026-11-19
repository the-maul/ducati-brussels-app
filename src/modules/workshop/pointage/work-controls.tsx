/**
 * M8 — Parcours mecanicien, lot A (19/11/2026) : Demarrer / Pause / Reprendre / Terminer.
 *
 * Un seul chrono : la pointeuse. Ces composants sont poses sur l'OR, le parcours technicien et la
 * pointeuse ; gros boutons (tablette, gants). Statut = couleur + icone + libelle (charte).
 *  - `usePointage` : etat de travail de l'OR pour le mecanicien connecte (ou un code mecano) et
 *    les gestes, avec confirmation quand un autre travail est en cours (un seul pointage actif).
 *  - `OrWorkControls` : bloc d'etat + boutons (fiche OR).
 *  - `PauseDialog` : motif (liste parametrable) + statut d'OR propose.
 *  - `OrWorkBadge` : etat compact (planning, pointeuse) depuis la vue `workshop_or_work_status`.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, Loader2, Pause, Play, RotateCcw, Square, Timer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { StatusBadge } from '@/components/status-badge';
import { orStatusLabel } from '../or-base/or-status-badge';
import { useConfirm } from '@/components/confirm-provider';
import { useAuth } from '@/lib/auth/auth-context';
import { fill } from '@/modules/catalog/format';
import { t } from '@/lib/i18n';
import {
  getOrWorkStatuses, listOrWorkEntries, listPauseReasons, pauseWork, pointageSchemaReady, startWorkOnOr, stopWorkPointage,
  type OrWorkStatusRow, type Who,
} from './api';
import {
  orWorkState, proposedOrStatus, reasonLabel, totalWorkMinutes, workActions, workStateTone,
  type Me, type OrWorkState, type PauseReason, type StartResult,
} from './rules';

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
export const fmtWorkMinutes = (m: number) => {
  const total = Math.max(0, Math.round(m));
  const h = Math.floor(total / 60);
  return h ? `${h} h ${String(total % 60).padStart(2, '0')}` : `${total} min`;
};

/** Icone de l'etat de travail (avec la couleur et le libelle, jamais seule). */
export function workStateIcon(state: OrWorkState['state']) {
  return state === 'running' ? Play : state === 'paused' ? Pause : state === 'stopped' ? CheckCircle2 : Timer;
}

/** Libelle « en cours (par qui, depuis quand) » / « en pause (motif) » / « termine ». */
export function workStateLabel(s: OrWorkState, reasons: PauseReason[]): string {
  if (s.state === 'running') {
    const first = s.running[0];
    return fill(t('pointage.runningBy'), { who: s.running.map((r) => r.name).join(', '), since: first ? hhmm(first.since) : '' });
  }
  if (s.state === 'paused' && s.last) {
    const why = s.last.kind === 'auto_stop' ? t('pointage.stop_auto_stop') : reasonLabel(s.last.reason, reasons, t);
    return fill(t('pointage.pausedReason'), { reason: why || t('pointage.stop_pause') });
  }
  if (s.state === 'stopped') return t('pointage.stateStopped');
  return t('pointage.stateNone');
}

type ConfirmFn = ReturnType<typeof useConfirm>;

/**
 * « Demarrer » / « Reprendre » avec la regle du pointage unique : si un autre travail est en cours,
 * on demande confirmation avant de le mettre en pause. `null` = le mecanicien a renonce.
 * Partage par la fiche OR, le parcours et l'ecran tablette « Mon atelier » (lot F).
 */
export async function startWorkWithConfirm(
  orId: string, opts: { operation?: string | null; who?: Who | null; origin?: string }, confirm: ConfirmFn,
): Promise<StartResult | null> {
  let res = await startWorkOnOr(orId, { operation: opts.operation ?? null, who: opts.who, origin: opts.origin });
  if (res.status === 'needs_confirm') {
    const c = res.current;
    const what = c.kind === 'improductif' ? t('pointage.currentTask') : fill(t('pointage.currentOr'), { number: c.or_number ?? '' });
    const ok = await confirm({
      title: t('pointage.switchTitle'),
      message: fill(t('pointage.switchConfirm'), { current: what, since: hhmm(c.started_at) }),
      confirmLabel: t('pointage.switchOk'),
    });
    if (!ok) return null;
    res = await startWorkOnOr(orId, { operation: opts.operation ?? null, who: opts.who, origin: opts.origin, confirmSwitch: true });
  }
  return res;
}

export function usePointage(p: { orId: string; companyId: string | null; who?: Who | null; onChanged?: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const me: Me = useMemo(() => ({ userId: user?.id ?? null, code: p.who?.code ?? null }), [user?.id, p.who?.code]);
  const schema = useQuery({ queryKey: ['pointage-schema'], queryFn: pointageSchemaReady, staleTime: Infinity });
  const ready = schema.data === true;
  const entries = useQuery({ queryKey: ['or-work', p.orId], queryFn: () => listOrWorkEntries(p.orId), enabled: ready, refetchInterval: 60_000 });
  const reasons = useQuery({ queryKey: ['pause-reasons', p.companyId], queryFn: () => listPauseReasons(p.companyId!), enabled: ready && !!p.companyId, staleTime: 300_000 });
  const state = useMemo(() => orWorkState(entries.data ?? [], p.orId, me), [entries.data, p.orId, me]);
  const [pauseOpen, setPauseOpen] = useState(false);

  // Le temps affiche avance tant qu'un pointage est ouvert (le temps compte = le pointage reel).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (state.state !== 'running') return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [state.state]);
  const total = totalWorkMinutes(entries.data ?? [], p.orId, now);

  const refresh = () => {
    for (const k of [['or-work', p.orId], ['ro-full', p.orId], ['ro-worked', p.orId], ['repair-orders'], ['or-work-status'], ['chrono-work'], ['chrono-today'], ['journey-ctx', p.orId]]) {
      void qc.invalidateQueries({ queryKey: k });
    }
    p.onChanged?.();
  };
  const onErr = (e: unknown) => toast.error(e instanceof Error ? e.message : t('workshop.errSave'));

  /** Demarrer (ou Reprendre) ; demande confirmation si un autre travail est en cours. */
  const start = useMutation({
    mutationFn: (operation: string | null | undefined): Promise<StartResult | null> =>
      startWorkWithConfirm(p.orId, { operation, who: p.who }, confirm),
    meta: { success: false },
    onSuccess: (res) => {
      if (!res) return;
      if (res.status === 'resumed') toast.success(t('pointage.resumed'));
      else if (res.status === 'started') toast.success(t('pointage.started'));
      refresh();
    },
    onError: onErr,
  });

  const pause = useMutation({
    mutationFn: (v: { reason: string; orStatus: string | null }) => pauseWork({ reason: v.reason, orId: p.orId, orStatus: v.orStatus, who: p.who }),
    meta: { success: false },
    onSuccess: (r) => {
      setPauseOpen(false);
      toast.success(r.or_status_changed ? t('pointage.pausedStatus') : t('pointage.paused'));
      refresh();
    },
    onError: onErr,
  });

  const finish = useMutation({
    mutationFn: () => stopWorkPointage({ orId: p.orId, who: p.who }),
    meta: { success: false },
    onSuccess: () => { toast.success(t('pointage.finished')); refresh(); },
    onError: onErr,
  });

  return {
    ready, schemaKnown: schema.isSuccess, loading: entries.isLoading, entries: entries.data ?? [], state, total, reasons: reasons.data ?? [],
    start, pause, finish, pauseOpen, setPauseOpen,
    busy: start.isPending || pause.isPending || finish.isPending,
  };
}

/** Choix du motif de pause : gros boutons, statut d'OR propose (attente piece / accord client). */
export function PauseDialog({ open, reasons, orStatus, busy, onCancel, onConfirm }: {
  open: boolean;
  reasons: PauseReason[];
  orStatus: string | null | undefined;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (v: { reason: string; orStatus: string | null }) => void;
}) {
  const [code, setCode] = useState<string | null>(null);
  const [applyStatus, setApplyStatus] = useState(true);
  useEffect(() => { if (open) { setCode(null); setApplyStatus(true); } }, [open]);
  const chosen = reasons.find((r) => r.code === code) ?? null;
  const proposed = proposedOrStatus(chosen, orStatus);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('pointage.pauseTitle')}</DialogTitle>
          <DialogDescription>{t('pointage.pauseHint')}</DialogDescription>
        </DialogHeader>
        {reasons.length ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {reasons.map((r) => (
              <Button
                key={r.code} type="button" variant={code === r.code ? 'default' : 'outline'}
                className="h-14 justify-start whitespace-normal text-left text-[15px]"
                aria-pressed={code === r.code}
                onClick={() => setCode(r.code)}
              >
                <Pause className="shrink-0" /> {r.label}
              </Button>
            ))}
          </div>
        ) : <p className="text-[13px] text-muted-foreground">{t('pointage.noReasons')}</p>}
        {proposed && (
          <label className="flex items-start gap-3 rounded-md border border-border bg-warning-bg p-3 text-[14px] text-warning">
            <input type="checkbox" checked={applyStatus} onChange={(e) => setApplyStatus(e.target.checked)} className="mt-0.5 size-5 accent-[var(--ducati-red)]" />
            <span>{fill(t('pointage.proposeStatus'), { status: orStatusLabel(proposed) })}</span>
          </label>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" className="h-12 text-[15px]" onClick={onCancel}>{t('action.cancel')}</Button>
          <Button className="h-12 text-[15px]" disabled={!code || busy} onClick={() => code && onConfirm({ reason: code, orStatus: proposed && applyStatus ? proposed : null })}>
            {busy ? <Loader2 className="animate-spin" /> : <Pause />} {t('pointage.pauseConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Bloc d'etat + gros boutons Demarrer / Pause / Reprendre / Terminer (fiche OR). */
export function OrWorkControls({ orId, companyId, orStatus, workAllowed, onChanged, fallback, extra, gateStart }: {
  orId: string;
  companyId: string | null;
  orStatus: string | null | undefined;
  workAllowed: boolean;
  onChanged?: () => void;
  /** Affiche tant que la migration du lot A n'est pas appliquee (ancien bouton « Demarrer »). */
  fallback?: ReactNode;
  /** Boutons de plus a droite (ex. « Reprendre le parcours »). */
  extra?: ReactNode;
  /**
   * Lot C (19/11) : avant le premier « Demarrer », la fiche OR propose la serie de photos de
   * reception ; `go` lance le pointage (apres « Terminer » ou « Plus tard »). Jamais bloquant.
   */
  gateStart?: (go: () => void) => void;
}) {
  const pt = usePointage({ orId, companyId, onChanged });
  if (pt.schemaKnown && !pt.ready) return <>{fallback ?? null}</>;
  if (!pt.ready) return null;
  const a = workActions(pt.state, { orStatus, workAllowed });
  const Icon = workStateIcon(pt.state.state);
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-border bg-card p-3 shadow-[var(--shadow-card)]">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('pointage.blockTitle')}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <StatusBadge tone={workStateTone(pt.state.state)} icon={Icon} label={workStateLabel(pt.state, pt.reasons)} />
          {pt.total > 0 && <span className="font-data text-[13px] tabular-nums text-muted-foreground">{t('pointage.total')} {fmtWorkMinutes(pt.total)}</span>}
          {pt.state.state === 'paused' && pt.state.last && (
            <span className="text-[12px] text-muted-foreground">{fill(t('pointage.pausedBy'), { who: pt.state.last.name, at: hhmm(pt.state.last.at) })}</span>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {a.start && (
          <Button className="h-12 min-w-[132px] text-[15px]" disabled={pt.busy} onClick={() => (gateStart ? gateStart(() => pt.start.mutate(null)) : pt.start.mutate(null))}>
            {pt.start.isPending ? <Loader2 className="animate-spin" /> : <Play />} {t('pointage.start')}
          </Button>
        )}
        {a.resume && (
          <Button className="h-12 min-w-[132px] text-[15px]" disabled={pt.busy} onClick={() => pt.start.mutate(null)}>
            {pt.start.isPending ? <Loader2 className="animate-spin" /> : <RotateCcw />} {t('pointage.resume')}
          </Button>
        )}
        {a.pause && (
          <Button variant="outline" className="h-12 min-w-[132px] text-[15px]" disabled={pt.busy} onClick={() => pt.setPauseOpen(true)}>
            <Pause /> {t('pointage.pause')}
          </Button>
        )}
        {a.finish && (
          <Button variant="outline" className="h-12 min-w-[132px] text-[15px]" disabled={pt.busy} onClick={() => pt.finish.mutate()}>
            {pt.finish.isPending ? <Loader2 className="animate-spin" /> : <Square />} {t('pointage.finish')}
          </Button>
        )}
        {!workAllowed && !a.pause && <p className="self-center text-[12px] text-warning">{t('checkup.workBlocked')}</p>}
        {extra}
      </div>
      <PauseDialog
        open={pt.pauseOpen} reasons={pt.reasons} orStatus={orStatus} busy={pt.pause.isPending}
        onCancel={() => pt.setPauseOpen(false)} onConfirm={(v) => pt.pause.mutate(v)}
      />
    </div>
  );
}

/** Etat compact d'un OR (planning, pointeuse) depuis la vue `workshop_or_work_status`. */
export function OrWorkBadge({ row, reasons = [], compact, className }: { row: OrWorkStatusRow | null | undefined; reasons?: PauseReason[]; compact?: boolean; className?: string }) {
  if (!row || row.work_state === 'stopped') return null;
  const state = row.work_state;
  const label = state === 'running'
    ? (compact ? fill(t('pointage.runningShort'), { since: row.running_since ? hhmm(row.running_since) : '' })
      : fill(t('pointage.runningBy'), { who: row.running_by ?? '?', since: row.running_since ? hhmm(row.running_since) : '' }))
    : fill(t('pointage.pausedReason'), {
      reason: row.last_stop_kind === 'auto_stop' ? t('pointage.stop_auto_stop') : reasonLabel(row.last_stop_reason, reasons, t) || t('pointage.stop_pause'),
    });
  return (
    <StatusBadge
      tone={workStateTone(state)} icon={workStateIcon(state)} label={label}
      className={compact ? 'max-w-full truncate px-1 py-px text-[10px]' : className}
    />
  );
}

/** Etat de travail de plusieurs OR (planning) : vue `workshop_or_work_status`, rafraichie chaque minute. */
export function useOrWorkStatusMap(orIds: (string | null | undefined)[]) {
  const { activeCompanyId } = useAuth();
  const key = useMemo(() => [...new Set(orIds.filter((x): x is string => !!x))].sort().join(','), [orIds]);
  const statuses = useQuery({
    queryKey: ['or-work-status', key],
    queryFn: () => getOrWorkStatuses(key ? key.split(',') : []),
    enabled: !!key,
    refetchInterval: 60_000,
  });
  const reasons = useQuery({
    queryKey: ['pause-reasons', activeCompanyId],
    queryFn: () => listPauseReasons(activeCompanyId!),
    enabled: !!key && !!activeCompanyId && (statuses.data?.size ?? 0) > 0,
    staleTime: 300_000,
  });
  return { map: statuses.data ?? new Map<string, OrWorkStatusRow>(), reasons: reasons.data ?? [] };
}
