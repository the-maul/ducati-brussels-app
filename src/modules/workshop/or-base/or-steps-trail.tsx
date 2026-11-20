/**
 * M8 — Frise « Où en est cet OR » : Réception (photos) → Travail → Opérations → Prêt → Facture.
 * Un seul composant pour la fiche OR et « Mon atelier » (lot UX atelier, 20/11/2026 : le mécanicien
 * voyait deux représentations du même dossier, badges sur la carte et frise sur l'OR).
 * Les étapes viennent des règles pures `progress-rules.ts` (`orProgress`), jamais recalculées ici.
 * Statut = couleur + icône + libellé (l'état de chaque étape est dit en toutes lettres ; en mode
 * compact il est porté par le titre et lu par les lecteurs d'écran).
 */
import { AlertTriangle, CheckCircle2, Circle, CircleDot, Clock, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { t, fillVars } from '@/lib/i18n';
import type { Step, StepState } from './progress-rules';

const STEP_ICON: Record<StepState, LucideIcon> = {
  done: CheckCircle2, current: CircleDot, todo: Circle, skipped: Clock, warning: AlertTriangle,
};
const STEP_TEXT: Record<StepState, string> = {
  done: 'text-success', current: 'text-info', todo: 'text-muted-foreground', skipped: 'text-warning', warning: 'text-warning',
};

/** Libellé de l'étape avec son compteur (« Opérations · 3/28 », « Réception (photos) · 6/6 photos »). */
function stepLabel(s: Step, short = false): string {
  const name = t(short ? `uxAtelier.stepShort_${s.key}` : `orLisible.step_${s.key}`);
  const detail = s.key === 'reception' && s.count && s.count.total > 0
    ? fillVars(t('orLisible.photosCount'), { taken: s.count.done, total: s.count.total })
    : s.key === 'operations' && s.count && s.count.total > 0 ? fillVars(t('orLisible.opsCount'), { done: s.count.done, total: s.count.total }) : null;
  return detail ? `${name} · ${detail}` : name;
}

/**
 * - `full` : grille de cartes (numéro, icône, libellé, état en dessous).
 * - `compact` : une ligne de pastilles (bandeau d'identité de l'OR, cartes de « Mon atelier »).
 */
export function OrStepsTrail({ steps, size = 'compact', className }: { steps: readonly Step[]; size?: 'full' | 'compact'; className?: string }) {
  if (size === 'full') {
    return (
      <ol className={cn('grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5', className)} aria-label={t('orLisible.title')}>
        {steps.map((s, idx) => {
          const Icon = STEP_ICON[s.state];
          return (
            <li
              key={s.key} aria-current={s.state === 'current' ? 'step' : undefined}
              className={cn('flex items-center gap-2 rounded-md border px-3 py-2', s.state === 'current' ? 'border-info bg-info-bg' : 'border-border bg-card')}
            >
              <span className="font-data text-[12px] font-bold tabular-nums text-muted-foreground">{idx + 1}</span>
              <Icon className={cn('size-5 shrink-0', STEP_TEXT[s.state])} aria-hidden />
              <div className="min-w-0">
                <p className={cn('truncate text-[14px] leading-tight', s.state === 'current' ? 'font-bold' : '')}>{stepLabel(s)}</p>
                <p className={cn('text-[12px] leading-tight', STEP_TEXT[s.state])}>{t(`orLisible.state_${s.state}`)}</p>
              </div>
            </li>
          );
        })}
      </ol>
    );
  }
  return (
    <ol className={cn('flex flex-wrap items-center gap-1', className)} aria-label={t('orLisible.title')}>
      {steps.map((s, idx) => {
        const Icon = STEP_ICON[s.state];
        const state = t(`orLisible.state_${s.state}`);
        return (
          <li key={s.key} className="flex items-center gap-1" aria-current={s.state === 'current' ? 'step' : undefined}>
            {idx > 0 && <span aria-hidden className="h-px w-2 bg-border sm:w-3" />}
            <span
              title={`${stepLabel(s)} : ${state}`}
              className={cn(
                'inline-flex min-h-8 items-center gap-1 rounded-[var(--radius-badge)] border px-2 py-0.5 font-data text-[13px] leading-tight tabular-nums',
                s.state === 'current' ? 'border-info bg-info-bg font-bold text-foreground' : 'border-border bg-card text-foreground',
              )}
            >
              <Icon className={cn('size-4 shrink-0', STEP_TEXT[s.state])} aria-hidden />
              {stepLabel(s, true)}
              <span className="sr-only"> : {state}</span>
              {s.state === 'current' && <span className="hidden text-info sm:inline"> · {state}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
