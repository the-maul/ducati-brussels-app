/**
 * M8 — Parcours mecanicien, lot D (19/11/2026) : la reparation guidee par le plan d'entretien,
 * reliee a l'OR. Une case par operation du plan de la moto (manuel d'atelier Ducati, sinon plan
 * d'entretien Ducati), tracee (qui, quand, pointage en cours). Pour chaque operation : le mode
 * operatoire (parcours technicien, meme ecran) ou « mode operatoire non disponible pour ce
 * modele », les lignes de l'OR qu'elle consomme (kit), « non faite » avec motif. Quand toutes les
 * operations obligatoires sont reglees : « Terminer » (arret du pointage, OR « Pret », SMS
 * existant) APRES confirmation.
 *
 *  - `usePlanOps` : liste, construction unique, gestes ; partage par la fiche OR et le parcours.
 *  - `PlanOpsPanel` : le bloc de la fiche OR.
 *  - `NotDoneDialog`, `FinishDialog` : motif « non faite », confirmation de « Terminer ».
 *  - `PlanProgressBadge` / `usePlanProgressMap` : avancement x / y au planning.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import {
  Ban, BookOpen, Check, CheckCircle2, ChevronDown, ChevronUp, Circle, ClipboardCheck, ListChecks, Loader2, Package, RotateCcw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { StatusBadge } from '@/components/status-badge';
import { fill } from '@/modules/catalog/format';
import { t } from '@/lib/i18n';
import {
  finishPlanOps, getPlanProgress, initPlanOps, listNotDoneReasons, listPlanOpLines, listPlanOps, planOpsSchemaReady, setPlanOp,
  type InitResult, type PlanProgressRow,
} from './api';
import {
  DEFAULT_NOT_DONE_REASONS, canEditOps, canFinish, linesByOperation, opTone, planProgress, progressTone, reasonText,
  type NotDoneReason, type PlanOp, type PlanOpSlotInfo, type PlanOpStatus,
} from './rules';

const dayHhmm = (iso: string) => new Date(iso).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export function opStatusIcon(s: PlanOpStatus) {
  return s === 'fait' ? CheckCircle2 : s === 'non_fait' ? Ban : Circle;
}

export function usePlanOps(p: { orId: string; companyId: string | null; orStatus: string | null | undefined; autoInit?: boolean; onChanged?: () => void }) {
  const qc = useQueryClient();
  const schema = useQuery({ queryKey: ['plan-ops-schema'], queryFn: planOpsSchemaReady, staleTime: Infinity });
  const ready = schema.data === true;
  const ops = useQuery({ queryKey: ['plan-ops', p.orId], queryFn: () => listPlanOps(p.orId), enabled: ready });
  const lines = useQuery({ queryKey: ['plan-op-lines', p.orId], queryFn: () => listPlanOpLines(p.orId), enabled: ready && (ops.data?.length ?? 0) > 0 });
  const reasonsQ = useQuery({ queryKey: ['not-done-reasons', p.companyId], queryFn: () => listNotDoneReasons(p.companyId!), enabled: ready && !!p.companyId, staleTime: 300_000 });
  const reasons = reasonsQ.data?.length ? reasonsQ.data : DEFAULT_NOT_DONE_REASONS;
  const [initResult, setInitResult] = useState<InitResult | null>(null);
  const tried = useRef(false);

  const refresh = () => {
    for (const k of [['plan-ops', p.orId], ['plan-op-lines', p.orId], ['plan-progress'], ['ro-full', p.orId], ['repair-orders'],
      ['or-work', p.orId], ['or-work-status'], ['ro-worked', p.orId], ['journey-ctx', p.orId], ['sms-ready', p.orId]]) {
      void qc.invalidateQueries({ queryKey: k });
    }
    p.onChanged?.();
  };
  const onErr = (e: unknown) => toast.error(e instanceof Error ? e.message : t('workshop.errSave'));

  const init = useMutation({
    mutationFn: (rebuild: boolean) => initPlanOps(p.orId, rebuild),
    meta: { success: false },
    onSuccess: (r) => { setInitResult(r); refresh(); },
    onError: onErr,
  });

  // Construction une seule fois, a la premiere ouverture d'un OR d'entretien encore ouvert.
  useEffect(() => {
    if (!p.autoInit || tried.current || !ready || !ops.isSuccess || ops.data.length || !canEditOps(p.orStatus)) return;
    tried.current = true;
    init.mutate(false);
  }, [p.autoInit, ready, ops.isSuccess, ops.data, p.orStatus, init]);

  const set = useMutation({
    mutationFn: (v: { op: PlanOp; status: PlanOpStatus; reason?: string | null; note?: string | null }) =>
      setPlanOp(v.op.id, v.status, { reason: v.reason ?? null, note: v.note ?? null }),
    meta: { success: false },
    onSuccess: refresh,
    onError: onErr,
  });

  const finish = useMutation({
    mutationFn: () => finishPlanOps(p.orId),
    meta: { success: false },
    onSuccess: (r) => {
      toast.success(r.sms?.status === 'pending' || r.sms?.status === 'queued' || r.sms?.status === 'sent'
        ? t('planOps.finishedSms') : t('planOps.finished'));
      refresh();
    },
    onError: onErr,
  });

  const list = ops.data ?? [];
  const progress = useMemo(() => planProgress(list), [list]);
  const byOp = useMemo(() => linesByOperation(lines.data ?? []), [lines.data]);
  // La liste est connue (ou il n'y en aura pas) : le parcours technicien peut choisir son mode.
  const settled = schema.isSuccess && (!ready || (ops.isSuccess && !init.isPending
    && !(list.length === 0 && (initResult?.count ?? 0) > 0)
    && (list.length > 0 || !p.autoInit || tried.current || !canEditOps(p.orStatus))));
  return {
    ready, settled, loading: ops.isLoading || init.isPending, ops: list, progress, byOp, reasons, initResult,
    init, set, finish, canFinish: canFinish(list, p.orStatus), editable: canEditOps(p.orStatus),
  };
}

/** « Non faite » : motif (liste parametrable, gros boutons) + note facultative. */
export function NotDoneDialog({ op, reasons, busy, onCancel, onConfirm }: {
  op: PlanOp | null;
  reasons: NotDoneReason[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: (v: { reason: string; note: string | null }) => void;
}) {
  const [code, setCode] = useState<string | null>(null);
  const [note, setNote] = useState('');
  useEffect(() => { if (op) { setCode(op.not_done_reason); setNote(op.not_done_note ?? ''); } }, [op]);
  const chosen = reasons.find((r) => r.code === code) ?? null;
  return (
    <Dialog open={!!op} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('planOps.notDoneTitle')}</DialogTitle>
          <DialogDescription>{op?.label}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 sm:grid-cols-2">
          {reasons.map((r) => (
            <Button
              key={r.code} type="button" variant={code === r.code ? 'default' : 'outline'} aria-pressed={code === r.code}
              className="h-14 justify-start whitespace-normal text-left text-[15px]" onClick={() => setCode(r.code)}
            >
              <Ban className="shrink-0" /> {r.label}
            </Button>
          ))}
        </div>
        {chosen?.defer && <p className="rounded-md bg-info-bg px-3 py-2 text-[13px] text-info">{t('planOps.deferHint')}</p>}
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('planOps.notDoneNote')} className="text-[15px]" />
        <DialogFooter className="gap-2">
          <Button variant="outline" className="h-12 text-[15px]" onClick={onCancel}>{t('action.cancel')}</Button>
          <Button className="h-12 text-[15px]" disabled={!code || busy} onClick={() => code && onConfirm({ reason: code, note: note.trim() || null })}>
            {busy ? <Loader2 className="animate-spin" /> : <Ban />} {t('planOps.notDoneConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Confirmation de « Terminer » : jamais de passage « Pret » silencieux. */
export function FinishDialog({ open, done, notDone, busy, onCancel, onConfirm }: {
  open: boolean; done: number; notDone: number; busy: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('planOps.finishTitle')}</DialogTitle>
          <DialogDescription>{t('planOps.finishHint')}</DialogDescription>
        </DialogHeader>
        <ul className="space-y-1 text-[14px]">
          <li className="flex items-center gap-2"><CheckCircle2 className="size-4 text-success" aria-hidden />{fill(t('planOps.finishDone'), { n: done })}</li>
          {notDone > 0 && <li className="flex items-center gap-2"><Ban className="size-4 text-warning" aria-hidden />{fill(t('planOps.finishNotDone'), { n: notDone })}</li>}
        </ul>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="h-12 text-[15px]" onClick={onCancel}>{t('action.cancel')}</Button>
          <Button className="h-12 text-[15px]" disabled={busy} onClick={onConfirm}>
            {busy ? <Loader2 className="animate-spin" /> : <ClipboardCheck />} {t('planOps.finishConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Avancement x / y (couleur + icone + libelle). */
export function PlanProgressBadge({ done, resolved, total, compact, className }: { done: number; resolved: number; total: number; compact?: boolean; className?: string }) {
  if (!total) return null;
  const tone = progressTone({ total, resolved });
  return (
    <StatusBadge
      tone={tone} icon={tone === 'success' ? CheckCircle2 : ListChecks}
      label={fill(t(compact ? 'planOps.progressShort' : 'planOps.progress'), { done, total })}
      className={compact ? 'max-w-full truncate px-1 py-px text-[10px]' : className}
    />
  );
}

/** Avancement de plusieurs OR (planning), rafraichi chaque minute. */
export function usePlanProgressMap(orIds: (string | null | undefined)[]) {
  const key = useMemo(() => [...new Set(orIds.filter((x): x is string => !!x))].sort().join(','), [orIds]);
  const q = useQuery({
    queryKey: ['plan-progress', key],
    queryFn: () => getPlanProgress(key ? key.split(',') : []),
    enabled: !!key,
    refetchInterval: 60_000,
  });
  return q.data ?? new Map<string, PlanProgressRow>();
}

export function PlanOpsPanel({ orId, companyId, orStatus, autoInit = true, onChanged, operationExtra }: {
  orId: string; companyId: string; orStatus: string;
  /** Construire la liste a la premiere ouverture (OR avec un entretien choisi). */
  autoInit?: boolean;
  onChanged?: () => void;
  /** Emplacement par operation pour un autre lot (ex. lot E « Voir sur la vue eclatee »). */
  operationExtra?: (op: PlanOpSlotInfo) => ReactNode;
}) {
  const navigate = useNavigate();
  const po = usePlanOps({ orId, companyId, orStatus, autoInit, onChanged });
  const [open, setOpen] = useState(true);
  const [notDone, setNotDone] = useState<PlanOp | null>(null);
  const [finishOpen, setFinishOpen] = useState(false);
  if (!po.ready) return null;
  if (!po.ops.length) {
    const st = po.initResult?.status;
    if (po.loading) return <div className="mb-4 flex items-center gap-2 text-[13px] text-muted-foreground"><Loader2 className="size-4 animate-spin" /> {t('planOps.loading')}</div>;
    if (!st || st === 'no_service') return null;
    return (
      <p className="mb-3 flex flex-wrap items-center gap-x-2 rounded-md border border-border bg-card px-3 py-2 text-[13px] text-muted-foreground">
        <ListChecks className="size-4 shrink-0" aria-hidden />
        <span className="font-bold text-foreground">{t('planOps.title')}</span>
        <span>{t(`planOps.empty_${st}`)} {t('orLisible.planNoneHint')}</span>
      </p>
    );
  }
  const first = po.ops[0];
  const pr = po.progress;
  const openProcedure = (op: PlanOp) => navigate({ to: '/workshop/journey/$orId', params: { orId }, search: { op: op.op_key } });
  return (
    <section className="mb-4 rounded-md border border-border bg-card p-3 shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('planOps.title')}</p>
          <p className="mt-0.5 text-[14px]">
            <span className="font-bold">{first.service_label ?? ''}</span>
            <span className="ml-2 text-[12px] text-muted-foreground">{t(`planOps.source_${first.source}`)}</span>
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <PlanProgressBadge done={pr.done} resolved={pr.resolved} total={pr.total} />
            {pr.notDone > 0 && <StatusBadge tone="warning" icon={Ban} label={fill(t('planOps.notDoneCount'), { n: pr.notDone })} />}
            {pr.mandatoryOpen > 0 && <span className="text-[12px] text-muted-foreground">{fill(t('planOps.mandatoryOpen'), { n: pr.mandatoryOpen })}</span>}
          </div>
          <Progress value={pr.percent} className="mt-2 h-2" />
        </div>
        <div className="flex flex-wrap gap-2">
          {po.canFinish && (
            <Button variant="outline" className="h-12 min-w-[150px] text-[15px]" disabled={po.finish.isPending} onClick={() => setFinishOpen(true)}>
              <ClipboardCheck /> {t('planOps.finish')}
            </Button>
          )}
          <Button variant="outline" className="h-12 text-[15px]" onClick={() => openProcedure(po.ops.find((o) => o.status === 'a_faire') ?? first)}>
            <BookOpen /> {t('planOps.openJourney')}
          </Button>
          <Button variant="ghost" className="h-12" onClick={() => setOpen((x) => !x)} aria-expanded={open}>
            {open ? <ChevronUp /> : <ChevronDown />} {open ? t('planOps.hide') : t('planOps.show')}
          </Button>
        </div>
      </div>

      {open && (
        <ul className="mt-3 space-y-1.5">
          {po.ops.map((op, i) => {
            const linked = po.byOp.get(op.id) ?? [];
            const Icon = opStatusIcon(op.status);
            const label = op.status === 'fait' ? t('planOps.status_fait') : op.status === 'non_fait' ? t('planOps.status_non_fait') : t('planOps.status_a_faire');
            return (
              <li key={op.id} className={`rounded-md border bg-card ${op.status === 'fait' ? 'border-success/40' : op.status === 'non_fait' ? 'border-warning/40' : 'border-border'}`}>
                <div className="flex items-stretch gap-2 p-2">
                  <button
                    type="button" disabled={!po.editable || po.set.isPending}
                    onClick={() => po.set.mutate({ op, status: op.status === 'fait' ? 'a_faire' : 'fait' })}
                    aria-label={op.status === 'fait' ? t('planOps.uncheck') : t('planOps.check')}
                    aria-pressed={op.status === 'fait'}
                    className={`grid size-12 shrink-0 place-items-center self-start rounded-md border font-data text-[15px] font-bold tabular-nums ${op.status === 'fait' ? 'border-success bg-success text-gray-0' : 'border-border bg-accent'}`}
                  >
                    {op.status === 'fait' ? <Check className="size-6" aria-hidden /> : i + 1}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] leading-snug">{op.label}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
                      <StatusBadge tone={opTone(op.status)} icon={Icon} label={label} />
                      {!op.mandatory && <span>{t('planOps.optional')}</span>}
                      {op.status !== 'a_faire' && op.done_at && (
                        <span className="tabular-nums">{fill(t('planOps.doneBy'), { who: op.done_by_name ?? '?', at: dayHhmm(op.done_at) })}{op.time_entry_operation ? ` · ${fill(t('planOps.onPointage'), { op: op.time_entry_operation })}` : ''}</span>
                      )}
                      {op.status === 'non_fait' && (
                        <span className="text-warning">{reasonText(op.not_done_reason, po.reasons, t)}{op.not_done_note ? ` : ${op.not_done_note}` : ''}{op.deferred_intervention_id ? ` · ${t('planOps.deferred')}` : ''}</span>
                      )}
                      {op.procedure_id
                        ? <button type="button" className="inline-flex items-center gap-1 underline-offset-2 hover:underline" onClick={() => openProcedure(op)}><BookOpen className="size-3.5" aria-hidden />{t('planOps.procedure')}</button>
                        : <span className="inline-flex items-center gap-1"><BookOpen className="size-3.5" aria-hidden />{t('planOps.noProcedure')}</span>}
                    </div>
                    {linked.length > 0 && (
                      <ul className="mt-1 flex flex-wrap gap-1.5">
                        {linked.map((l) => (
                          <li key={l.line_id} className="inline-flex items-center gap-1 rounded-[var(--radius-badge)] border border-border px-1.5 py-0.5 text-[12px]" title={t('planOps.lineHint')}>
                            <Package className="size-3.5 text-muted-foreground" aria-hidden />
                            <span>{l.designation}</span>
                            <span className="font-data tabular-nums text-muted-foreground">× {String(l.quantity).replace('.', ',')}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {operationExtra?.({ orId, opKey: op.op_key, label: op.label, procedureId: op.procedure_id, familyCodes: op.family_codes, lines: linked })}
                  {po.editable && op.status === 'a_faire' && (
                    <Button variant="outline" className="h-12 shrink-0 self-start text-[14px]" onClick={() => setNotDone(op)}><Ban /> {t('planOps.notDone')}</Button>
                  )}
                  {po.editable && op.status === 'non_fait' && (
                    <Button variant="outline" className="h-12 shrink-0 self-start text-[14px]" disabled={po.set.isPending} onClick={() => po.set.mutate({ op, status: 'a_faire' })}><RotateCcw /> {t('planOps.reset')}</Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {!po.canFinish && pr.mandatoryOpen === 0 && pr.total > 0 && po.editable && (
        <p className="mt-2 text-[12px] text-muted-foreground">{t('planOps.finishUnavailable')}</p>
      )}

      <NotDoneDialog
        op={notDone} reasons={po.reasons} busy={po.set.isPending}
        onCancel={() => setNotDone(null)}
        onConfirm={(v) => { if (notDone) po.set.mutate({ op: notDone, status: 'non_fait', reason: v.reason, note: v.note }, { onSuccess: () => setNotDone(null) }); }}
      />
      <FinishDialog
        open={finishOpen} done={pr.done} notDone={pr.notDone} busy={po.finish.isPending}
        onCancel={() => setFinishOpen(false)}
        onConfirm={() => po.finish.mutate(undefined, { onSuccess: () => setFinishOpen(false) })}
      />
    </section>
  );
}
