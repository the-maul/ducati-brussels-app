/**
 * M8 — Parcours d'entretien : une procédure du manuel, pas à pas, sur tablette.
 *
 * Étapes numérotées, figures larges et zoomables, couples de serrage mis en avant (Nm + repère),
 * Attention / Important / Remarque bien distingués, outils spéciaux et produits.
 * Chaque étape se coche ; l'avancement est enregistré par l'écran appelant à chaque geste.
 */
import { useEffect, useRef } from 'react';
import { ArrowLeft, Camera, Check, CircleDot, Gauge, Link2, NotebookPen, Package, Play, Square, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { StatusBadge } from '@/components/status-badge';
import { fill } from '@/modules/catalog/format';
import { FigureGrid } from './figure-view';
import { figureUrl } from './source';
import { torqueLabel, torquesForStep, warningTone, fmtMinutes } from './rules';
import type { Figure, OperationProgress, Procedure, Torque, Warning } from './types';
import { t } from '@/lib/i18n';

const TONE_CLASS = {
  danger: 'border-l-danger bg-danger-bg text-danger',
  warning: 'border-l-warning bg-warning-bg text-warning',
  info: 'border-l-info bg-info-bg text-info',
} as const;

function WarningBlock({ w }: { w: Warning }) {
  const tone = warningTone(w.type);
  return (
    <div className={`rounded-md border-l-4 px-3 py-2 ${TONE_CLASS[tone]}`}>
      <p className="font-data text-[12px] font-bold uppercase tracking-[0.04em]">{w.titre || w.type}</p>
      <p className="mt-0.5 whitespace-pre-line text-[14px] leading-relaxed text-foreground">{w.texte}</p>
    </div>
  );
}

/** Le couple de serrage : la valeur en Nm domine, le repère de la figure est à côté. */
function TorqueBlock({ c, showStep }: { c: Torque; showStep?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-warning/40 bg-warning-bg px-3 py-2">
      <Gauge className="size-5 shrink-0 text-warning" aria-hidden />
      <span className="font-data text-[20px] font-bold tabular-nums text-warning">{torqueLabel(c)}</span>
      {(c.reperes ?? []).map((r) => (
        <span key={r} className="inline-flex items-center gap-1 rounded-[var(--radius-badge)] bg-background px-2 py-0.5 font-data text-[12px] font-bold uppercase tracking-[0.04em] text-foreground">
          <CircleDot className="size-3" aria-hidden />{fill(t('journey.torqueMark'), { n: r })}
        </span>
      ))}
      {showStep && c.etape != null && <span className="text-[12px] text-muted-foreground">{fill(t('journey.torqueAtStep'), { n: c.etape })}</span>}
      {c.texte && <p className="w-full text-[13px] leading-relaxed text-foreground">{c.texte}</p>}
    </div>
  );
}

function Chip({ icon: Icon, children }: { icon: typeof Wrench; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-[var(--radius-badge)] border border-border bg-accent px-2 py-1 text-[13px]">
      <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />{children}
    </span>
  );
}

export function ProcedureView({
  procedure, operation, running, spentMin, onBack, onToggleStep, onToggleOperation,
  onChrono, onFinding, onOpenFigure, onOpenLinked,
}: {
  procedure: Procedure;
  operation: OperationProgress;
  running: boolean;
  spentMin: number;
  onBack: () => void;
  onToggleStep: (n: number) => void;
  onToggleOperation: () => void;
  onChrono: () => void;
  onFinding: (kind: 'observation' | 'piece' | 'photo', stepNo: number | null) => void;
  onOpenFigure: (f: Figure, alt: string) => void;
  onOpenLinked: (parcoursId: string) => void;
}) {
  const total = procedure.etapes.length;
  const done = procedure.etapes.filter((e) => operation.steps[String(e.n)]).length;
  const firstTodo = procedure.etapes.find((e) => !operation.steps[String(e.n)])?.n ?? null;
  const anchorRef = useRef<HTMLLIElement | null>(null);

  // Reprise : on se place sur la première étape non cochée à l'ouverture.
  useEffect(() => {
    if (done > 0 && anchorRef.current) anchorRef.current.scrollIntoView({ block: 'center' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [procedure.id]);

  const src = procedure.source;
  const generalTorques = (procedure.couples ?? []).filter((c) => c.etape == null);

  return (
    <div className="pb-28">
      {/* En-tête collant */}
      <div className="sticky top-0 z-20 -mx-4 mb-4 border-b border-border bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex items-start gap-3">
          <Button variant="outline" className="h-12 shrink-0 px-3" onClick={onBack} aria-label={t('journey.backToOps')}><ArrowLeft /></Button>
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-display text-[17px] font-bold uppercase leading-tight sm:text-[20px]">{procedure.titre}</h2>
            <p className="truncate text-[12px] text-muted-foreground">{operation.label}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="font-data text-[13px] font-bold tabular-nums">{fill(t('journey.stepsProgress'), { done, total })}</p>
            <p className="font-data text-[12px] tabular-nums text-muted-foreground">{fmtMinutes(spentMin)}</p>
          </div>
        </div>
        <Progress value={total ? Math.round((done / total) * 100) : 0} className="mt-2 h-2.5" />
      </div>

      {/* Ce qu'il faut savoir avant de commencer */}
      <div className="space-y-3">
        {src && (src.code || src.updateDate) && (
          <p className="font-mono text-[11px] text-muted-foreground">
            {fill(t('journey.source'), { code: src.code ?? '—', version: src.version ?? '—', date: src.updateDate ?? '—' })}
          </p>
        )}

        {!!(procedure.avertissements ?? []).length && (
          <section className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('journey.warnings')}</p>
            {procedure.avertissements!.map((w, i) => <WarningBlock key={i} w={w} />)}
          </section>
        )}

        {!!(procedure.outils ?? []).length && (
          <section>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('journey.tools')}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {procedure.outils!.map((o, i) => (
                <div key={i} className="flex items-center gap-3 rounded-md border border-border bg-card p-2">
                  {o.image ? (
                    <button type="button" onClick={() => onOpenFigure(o.image!, o.description ?? o.reference ?? '')} className="size-16 shrink-0 overflow-hidden rounded bg-gray-0">
                      <img src={figureUrl(o.image.src) ?? ''} alt="" className="size-full object-contain" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
                    </button>
                  ) : <Wrench className="size-6 shrink-0 text-muted-foreground" aria-hidden />}
                  <div className="min-w-0">
                    {o.reference && <p className="font-mono text-[13px] font-bold">{o.reference}</p>}
                    <p className="text-[13px] leading-snug text-muted-foreground">{o.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {!!(procedure.produits ?? []).length && (
          <section>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('journey.products')}</p>
            <div className="flex flex-wrap gap-2">{procedure.produits!.map((p) => <Chip key={p} icon={Package}>{p}</Chip>)}</div>
          </section>
        )}

        {!!generalTorques.length && (
          <section className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('journey.torques')}</p>
            {generalTorques.map((c, i) => <TorqueBlock key={i} c={c} showStep />)}
          </section>
        )}

        {!!(procedure.figuresIntro ?? []).length && (
          <FigureGrid figures={procedure.figuresIntro!} alt={procedure.titre} onOpen={(f) => onOpenFigure(f, procedure.titre)} />
        )}
      </div>

      {/* Les étapes */}
      <ol className="mt-5 space-y-3">
        {procedure.etapes.map((e) => {
          const checked = !!operation.steps[String(e.n)];
          const torques = torquesForStep(procedure, e.n);
          const isResume = e.n === firstTodo;
          return (
            <li key={e.n} ref={isResume ? anchorRef : undefined}>
              <div className={`rounded-md border bg-card p-3 sm:p-4 ${checked ? 'border-success/40 bg-success-bg/30' : isResume ? 'border-ducati-red/50' : 'border-border'}`}>
                {(e.phase || e.sousPhase) && (
                  <p className="mb-2 font-data text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{[e.phase, e.sousPhase].filter(Boolean).join(' · ')}</p>
                )}
                <div className="flex items-start gap-3">
                  <span className={`grid size-11 shrink-0 place-items-center rounded-full font-data text-[17px] font-bold tabular-nums ${checked ? 'bg-success text-gray-0' : 'bg-accent text-foreground'}`}>
                    {checked ? <Check className="size-5" aria-hidden /> : e.n}
                  </span>
                  <div className="min-w-0 flex-1 space-y-3">
                    <p className="whitespace-pre-line text-[15px] leading-relaxed sm:text-[16px]">{e.texte}</p>

                    {!!(e.sousEtapes ?? []).length && (
                      <ul className="ml-1 space-y-1 border-l-2 border-border pl-3">
                        {e.sousEtapes!.map((s) => <li key={s.n} className="text-[14px] leading-relaxed text-muted-foreground">{s.texte}</li>)}
                      </ul>
                    )}

                    {(e.avertissements ?? []).map((w, i) => <WarningBlock key={i} w={w} />)}
                    {torques.map((c, i) => <TorqueBlock key={i} c={c} />)}

                    {(!!(e.outils ?? []).length || !!(e.produits ?? []).length || !!(e.reperes ?? []).length) && (
                      <div className="flex flex-wrap gap-2">
                        {(e.outils ?? []).map((o) => <Chip key={`o${o}`} icon={Wrench}>{o}</Chip>)}
                        {(e.produits ?? []).map((p) => <Chip key={`p${p}`} icon={Package}>{p}</Chip>)}
                        {(e.reperes ?? []).map((r) => <Chip key={`r${r}`} icon={CircleDot}>{fill(t('journey.torqueMark'), { n: r })}</Chip>)}
                      </div>
                    )}

                    {!!(e.figures ?? []).length && (
                      <FigureGrid figures={e.figures!} alt={fill(t('journey.step'), { n: e.n })} onOpen={(f) => onOpenFigure(f, `${procedure.titre} — ${fill(t('journey.step'), { n: e.n })}`)} />
                    )}

                    {!!(e.liens ?? []).length && (
                      <div className="space-y-1">
                        <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('journey.seeAlso')}</p>
                        <div className="flex flex-wrap gap-2">
                          {e.liens!.map((l) => (
                            <Button key={l.parcoursId} variant="outline" className="h-11 max-w-full justify-start text-[13px]" onClick={() => onOpenLinked(l.parcoursId)}>
                              <Link2 /> <span className="truncate">{l.titre}</span>
                            </Button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        variant={checked ? 'secondary' : 'default'}
                        className="h-12 min-w-[132px] text-[15px]"
                        onClick={() => onToggleStep(e.n)}
                      >
                        <Check /> {checked ? t('journey.undo') : t('journey.done')}
                      </Button>
                      <Button variant="outline" className="h-12 px-3" onClick={() => onFinding('observation', e.n)} aria-label={t('journey.addNote')}><NotebookPen /></Button>
                      <Button variant="outline" className="h-12 px-3" onClick={() => onFinding('piece', e.n)} aria-label={t('journey.addPart')}><Package /></Button>
                      <Button variant="outline" className="h-12 px-3" onClick={() => onFinding('photo', e.n)} aria-label={t('journey.addPhoto')}><Camera /></Button>
                    </div>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {/* Barre d'action collante en bas : chrono et fin d'opération, toujours atteignables au pouce */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 px-4 py-2.5 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-5xl items-center gap-2">
          <Button variant={running ? 'destructive' : 'outline'} className="h-13 min-h-[52px] flex-1 text-[15px]" onClick={onChrono}>
            {running ? <><Square /> {t('journey.chronoStop')}</> : <><Play /> {t('journey.chronoStart')}</>}
          </Button>
          <Button className="h-13 min-h-[52px] flex-1 text-[15px]" onClick={onToggleOperation}>
            <Check /> {operation.done ? t('journey.undo') : t('journey.markDone')}
          </Button>
          {running && <StatusBadge tone="warning" label={t('journey.chronoRunning')} className="hidden sm:inline-flex" />}
        </div>
      </div>
    </div>
  );
}
