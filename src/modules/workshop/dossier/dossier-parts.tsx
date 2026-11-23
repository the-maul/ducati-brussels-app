/**
 * M8 — Chantier C1 (23/11/2026) : briques d'affichage du dossier moto : fil d'Ariane cliquable,
 * liste de ce qu'il y a à faire, barre du bouton principal, commentaires et photos.
 * Statut = couleur + icône + libellé. Cibles tactiles de 44 px minimum.
 */
import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle, ArrowLeft, Ban, Camera, CheckCircle2, ChevronRight, Circle, CircleDot, Clock, Loader2, MinusCircle,
  NotebookPen, PauseCircle, SkipForward, type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/status-badge';
import { cn } from '@/lib/utils';
import { fillVars, t } from '@/lib/i18n';
import { FindingDialog, type NewFinding } from '../journey/finding-dialog';
import { addDossierNote, flushDossierPhotos } from '../journey/finding-photos';
import { loadJourney } from '../journey/store';
import type { Finding, FindingKind } from '../journey/types';
import { PhotoThumb } from '../reception/reception-sheet';
import type {
  DossierAction, DossierFlow, DossierPrimary, DossierSkip, DossierStepKey, DossierStepState, DossierTask, DossierTaskState,
} from './rules';

const STEP_ICON: Record<DossierStepState, LucideIcon> = { done: CheckCircle2, current: CircleDot, todo: Circle, na: MinusCircle };
const STEP_TEXT: Record<DossierStepState, string> = {
  done: 'text-success', current: 'text-info', todo: 'text-muted-foreground', na: 'text-muted-foreground',
};

/** Fil d'Ariane : 4 étapes cliquables (revenir, regarder) ; une étape sans objet est grisée. */
export function DossierTrail({ flow, viewed, onPick }: { flow: DossierFlow; viewed: DossierStepKey; onPick: (s: DossierStepKey) => void }) {
  return (
    <nav aria-label={t('dossier.trail')}>
      <ol className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {flow.steps.map((s, i) => {
          const Icon = STEP_ICON[s.state];
          const on = s.key === viewed;
          return (
            <li key={s.key}>
              <button
                type="button" disabled={s.state === 'na'} onClick={() => onPick(s.key)}
                aria-current={s.state === 'current' ? 'step' : undefined} aria-pressed={on}
                className={cn(
                  'flex min-h-14 w-full items-center gap-2 rounded-md border px-3 py-2 text-left transition-colors',
                  s.state === 'na' ? 'cursor-not-allowed border-border bg-muted opacity-60'
                    : on ? 'border-info bg-info-bg' : 'border-border bg-card hover:bg-accent',
                )}
              >
                <span className="font-data text-[13px] font-bold tabular-nums text-muted-foreground">{i + 1}</span>
                <Icon className={cn('size-5 shrink-0', STEP_TEXT[s.state])} aria-hidden />
                <span className="min-w-0">
                  <span className={cn('block truncate text-[15px] leading-tight', on && 'font-bold')}>{t(`dossier.step_${s.key}`)}</span>
                  <span className={cn('block text-[12px] leading-tight', STEP_TEXT[s.state])}>{t(`dossier.state_${s.state}`)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

const TASK_ICON: Record<DossierTaskState, LucideIcon> = {
  done: CheckCircle2, todo: Circle, doing: CircleDot, paused: PauseCircle, warning: AlertTriangle, blocked: Ban, skipped: Clock, na: MinusCircle,
};
const TASK_TONE: Record<DossierTaskState, 'success' | 'neutral' | 'info' | 'warning' | 'danger'> = {
  done: 'success', todo: 'neutral', doing: 'info', paused: 'warning', warning: 'warning', blocked: 'danger', skipped: 'warning', na: 'neutral',
};

/** Ce qu'il y a à faire à cette étape, avec l'état de chaque point. */
export function DossierTasks({ tasks }: { tasks: readonly DossierTask[] }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {tasks.map((x) => (
        <li key={x.key} className={cn('flex min-h-11 items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-1.5', x.state === 'na' && 'opacity-60')}>
          <span className="min-w-0 truncate text-[15px]">{t(`dossier.task_${x.key}`)}</span>
          <StatusBadge tone={TASK_TONE[x.state]} icon={TASK_ICON[x.state]} label={t(`dossier.taskState_${x.state}`)} />
        </li>
      ))}
    </ul>
  );
}

/** Barre du bas : revenir, passer (si non bloquant), et UN seul bouton principal. */
export function DossierActionBar({ primary, busy, canWrite, onAction, onSkip, onBack, icon }: {
  primary: DossierPrimary;
  busy: boolean;
  canWrite: boolean;
  onAction: (a: DossierAction) => void;
  onSkip: (s: DossierSkip) => void;
  onBack?: () => void;
  icon?: ReactNode;
}) {
  const navOnly = primary.action === 'go_current' || primary.action === 'next_step';
  const showPrimary = primary.action !== 'none' && (canWrite || navOnly);
  return (
    <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-2 border-t border-border bg-background px-1 py-2">
      {onBack && <Button variant="outline" className="h-12 text-[15px]" onClick={onBack}><ArrowLeft /> {t('dossier.back')}</Button>}
      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
        {primary.skip && canWrite && (
          <Button variant="outline" className="h-12 text-[15px]" disabled={busy} onClick={() => onSkip(primary.skip!)}>
            <SkipForward /> {t(`dossier.skip_${primary.skip}`)}
          </Button>
        )}
        {showPrimary && (
          <Button className="h-12 min-w-[220px] text-[17px]" disabled={busy} onClick={() => onAction(primary.action)}>
            {busy ? <Loader2 className="animate-spin" /> : icon ?? <ChevronRight className="size-5" />} {t(`dossier.action_${primary.action}`)}
          </Button>
        )}
      </div>
    </div>
  );
}

/** Une photo de constat : dans les documents de l'OR, ou encore sur la tablette (réseau coupé). */
export function FindingPhoto({ f, className }: { f: Pick<Finding, 'photoPath' | 'photoData' | 'texte'>; className?: string }) {
  if (f.photoPath) return <PhotoThumb path={f.photoPath} alt={f.texte} className={cn('rounded border border-border', className)} />;
  if (f.photoData) return <img src={f.photoData} alt={f.texte} className={cn('rounded border border-border object-cover', className)} />;
  return null;
}

/** Commentaire ou photo sur une opération (ou sur le travail en général). */
export function NoteButtons({ orId, companyId, operationId, compact }: { orId: string; companyId: string; operationId: string; compact?: boolean }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<FindingKind | null>(null);
  const add = useMutation({
    mutationFn: (f: NewFinding) => addDossierNote(companyId, orId, f),
    meta: { success: false },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['journey-saved', orId] });
      void qc.invalidateQueries({ queryKey: ['attachments', 'repair_order', orId] });
      if (r.pending) toast.warning(t('dossier.notePending'));
      else toast.success(t(r.photo ? 'dossier.noteSavedPhoto' : 'dossier.noteSaved'));
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t('workshop.errSave')),
  });
  const size = compact ? 'h-12 shrink-0 self-start px-3 text-[14px]' : 'h-11 text-[14px]';
  return (
    <>
      <Button type="button" variant="outline" className={size} aria-label={t('dossier.addComment')} onClick={() => setKind('observation')}>
        <NotebookPen /> <span className={compact ? 'hidden xl:inline' : ''}>{t('dossier.addComment')}</span>
      </Button>
      <Button type="button" variant="outline" className={size} aria-label={t('dossier.addPhoto')} onClick={() => setKind('photo')}>
        <Camera /> <span className={compact ? 'hidden xl:inline' : ''}>{t('dossier.addPhoto')}</span>
      </Button>
      <FindingDialog kind={kind} operationId={operationId} stepNo={null} onAdd={(f) => add.mutate(f)} onClose={() => setKind(null)} />
    </>
  );
}

/** Tout ce qui a été noté dans le dossier (parcours guidé compris). */
export function DossierNotes({ orId, companyId }: { orId: string; companyId: string }) {
  const q = useQuery({
    queryKey: ['journey-saved', orId],
    // Une photo restée sur la tablette (réseau coupé) repart vers les documents de l'OR à l'ouverture.
    queryFn: async () => (await flushDossierPhotos(companyId, orId)) ?? loadJourney(orId),
  });
  const labels = new Map((q.data?.operations ?? []).map((o) => [o.id, o.label]));
  const notes = (q.data?.findings ?? []).filter((f) => f.kind !== 'piece');
  return (
    <section className="rounded-md border border-border bg-card p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[15px] font-bold">{t('dossier.notesTitle')}</h3>
        <div className="flex gap-2"><NoteButtons orId={orId} companyId={companyId} operationId="dossier" /></div>
      </div>
      {notes.length ? (
        <ul className="space-y-1.5">
          {notes.map((f) => (
            <li key={f.id} className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-[14px]">
              {f.kind === 'photo' ? <FindingPhoto f={f} className="size-14 shrink-0" /> : <NotebookPen className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
              <span className="min-w-0 flex-1">
                {f.texte}
                {labels.get(f.operationId) && <span className="block truncate text-[12px] text-muted-foreground">{labels.get(f.operationId)}</span>}
              </span>
              {f.kind === 'photo' && !f.photoPath && <StatusBadge tone="warning" icon={Clock} label={t('dossier.taskState_doing')} />}
            </li>
          ))}
        </ul>
      ) : <p className="text-[13px] text-muted-foreground">{t('dossier.notesEmpty')}</p>}
    </section>
  );
}

export const fmtMinutes = (m: number) => {
  const h = Math.floor(m / 60);
  return h ? `${h} h ${String(m % 60).padStart(2, '0')}` : `${m} min`;
};

/** Une information courte de l'étape (libellé au-dessus de la valeur). */
export function InfoCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</p>
      <div className="text-[15px]">{children}</div>
    </div>
  );
}

export const plannedText = (m: number | null | undefined) => (m ? fillVars(t('dossier.planned'), { time: fmtMinutes(m) }) : null);
