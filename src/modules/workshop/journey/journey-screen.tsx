/**
 * M8 — Parcours d'entretien pas à pas (mission 07) : écran technicien, pensé pour une tablette
 * à l'atelier (gros boutons, texte lisible, portrait ou paysage).
 *
 * Enchaînement : choisir l'entretien dû → liste des opérations → procédure pas à pas → récapitulatif.
 * L'avancement est enregistré à chaque geste et la reprise se fait là où le technicien s'est arrêté.
 * **Rien n'est facturé automatiquement** : le récapitulatif propose des lignes, l'OR reste maître.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowLeft, Camera, Check, CheckCircle2, ChevronRight, ClipboardCheck, FileText,
  Loader2, NotebookPen, Package, Play, RotateCcw, Square, Timer,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { StatusBadge } from '@/components/status-badge';
import { useConfirm } from '@/components/confirm-provider';
import { fill, fmtInt } from '@/modules/catalog/format';
import { appendJourneyLines, getJourneyContext } from './api';
import { getJourneySource, type JourneySource } from './source';
import { clearJourney, loadJourney, persistenceMode, saveJourney } from './store';
import { FigureZoom } from './figure-view';
import { FindingDialog, type NewFinding } from './finding-dialog';
import { ProcedureView } from './procedure-view';
import {
  buildOperations, dueServices, fmtMinutes, isOperationDone, journeyProgress,
  officialMinutes, operationMinutes, resumePoint, runningOperationId, spentMinutes, startChrono,
  stopChrono, summarize, billedMinutes,
} from './rules';
import type { Figure, Finding, FindingKind, JourneyState, MaintenanceProgram, Procedure } from './types';
import { t } from '@/lib/i18n';

const uid = () => `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const today = () => new Date().toISOString().slice(0, 10);

type View = 'choose' | 'ops' | 'procedure' | 'summary';

export function JourneyScreen({ orId, companyId, onBackToOr }: { orId: string; companyId: string; onBackToOr: () => void }) {
  const qc = useQueryClient();
  const confirm = useConfirm();

  const [state, setState] = useState<JourneyState | null>(null);
  const [view, setView] = useState<View>('ops');
  const [openOpId, setOpenOpId] = useState<string | null>(null);
  const [linkedId, setLinkedId] = useState<string | null>(null);
  const [figure, setFigure] = useState<{ f: Figure; alt: string } | null>(null);
  const [finding, setFinding] = useState<{ kind: FindingKind; stepNo: number | null } | null>(null);
  const [demoBikeId, setDemoBikeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const ctx = useQuery({ queryKey: ['journey-ctx', orId], queryFn: () => getJourneyContext(orId) });
  const source = useQuery<JourneySource>({ queryKey: ['journey-source'], queryFn: () => getJourneySource() });
  const persistence = useQuery({ queryKey: ['journey-persistence'], queryFn: () => persistenceMode() });
  const saved = useQuery({ queryKey: ['journey-saved', orId], queryFn: () => loadJourney(orId) });

  const modelYearId = demoBikeId ?? ctx.data?.vehicle?.modelYearId ?? saved.data?.modelYearId ?? null;

  const programs = useQuery({
    queryKey: ['journey-programs', source.data?.kind],
    queryFn: () => source.data!.listPrograms(),
    enabled: !!source.data,
  });
  const program = useQuery<MaintenanceProgram | null>({
    queryKey: ['journey-program', source.data?.kind, modelYearId],
    queryFn: () => source.data!.getProgram(modelYearId!),
    enabled: !!source.data && !!modelYearId,
  });

  // Reprise : l'avancement enregistré prime sur un nouveau départ.
  useEffect(() => {
    if (saved.data && !state) { setState(saved.data); setView('ops'); }
    else if (saved.isSuccess && !saved.data && !state) setView('choose');
  }, [saved.data, saved.isSuccess, state]);

  // Le chrono qui tourne doit avancer à l'écran.
  const running = state ? runningOperationId(state.operations) : null;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, [running]);

  // Procédures du parcours : nécessaires pour compter les étapes (avancement, reprise).
  const procedureIds = useMemo(
    () => [...new Set((state?.operations ?? []).map((o) => o.parcoursId).filter((x): x is string => !!x))],
    [state?.operations],
  );
  const procedures = useQuery<Record<string, Procedure>>({
    queryKey: ['journey-procedures', source.data?.kind, procedureIds.join(',')],
    enabled: !!source.data && procedureIds.length > 0,
    queryFn: async () => {
      const list = await Promise.all(procedureIds.map((id) => source.data!.getProcedure(id)));
      const out: Record<string, Procedure> = {};
      list.forEach((p, i) => { if (p) out[procedureIds[i]] = p; });
      return out;
    },
  });
  const linked = useQuery<Procedure | null>({
    queryKey: ['journey-procedure', source.data?.kind, linkedId],
    enabled: !!source.data && !!linkedId,
    queryFn: () => source.data!.getProcedure(linkedId!),
  });

  const stepCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [id, p] of Object.entries(procedures.data ?? {})) out[id] = p.etapes.length;
    return out;
  }, [procedures.data]);

  const persist = useCallback((next: JourneyState) => {
    setState(next);
    saveJourney(companyId, next);
    qc.setQueryData(['journey-saved', orId], next);
  }, [companyId, orId, qc]);

  const patch = useCallback((fn: (s: JourneyState) => JourneyState) => {
    setState((s) => {
      if (!s) return s;
      const next = fn(s);
      saveJourney(companyId, next);
      qc.setQueryData(['journey-saved', orId], next);
      return next;
    });
  }, [companyId, orId, qc]);

  // --- chargement ----------------------------------------------------------
  if (ctx.isLoading || source.isLoading || saved.isLoading) {
    return <div className="grid place-items-center py-24"><Loader2 className="size-7 animate-spin text-muted-foreground" /></div>;
  }

  const vehicle = ctx.data?.vehicle ?? null;
  const isDemo = source.data?.kind === 'demo';
  const isLocal = persistence.data === 'local';

  const banners = (
    <div className="mb-4 space-y-2">
      {isDemo && <p className="flex items-start gap-2 rounded-md bg-info-bg px-3 py-2 text-[13px] text-info"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />{t('journey.demoBanner')}</p>}
      {isLocal && <p className="flex items-start gap-2 rounded-md bg-warning-bg px-3 py-2 text-[13px] text-warning"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />{t('journey.localBanner')}</p>}
      {error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}
    </div>
  );

  // --- pas de moto / pas de modèle-année / pas de programme -----------------
  if (!modelYearId || (program.isSuccess && !program.data)) {
    const message = !vehicle ? t('journey.noVehicle')
      : !vehicle.modelYearId && !demoBikeId ? t('journey.noCatalog')
      : fill(t('journey.noProgram'), { id: String(modelYearId ?? '—') });
    return (
      <div>
        {banners}
        <div className="rounded-md border border-border bg-card p-4">
          <p className="text-[15px]">{message}</p>
          {!vehicle?.modelYearId && vehicle && <p className="mt-1 text-[13px] text-muted-foreground">{t('journey.noCatalogHint')}</p>}
          {isDemo && !!programs.data?.length && (
            <div className="mt-4">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('journey.pickDemoBike')}</p>
              <div className="flex flex-wrap gap-2">
                {programs.data.map((b) => (
                  <Button key={b.modelYearId} variant="outline" className="h-12 text-[15px]" onClick={() => { setDemoBikeId(b.modelYearId); setView('choose'); }}>
                    {b.modele} {b.annee}
                  </Button>
                ))}
              </div>
            </div>
          )}
          <Button variant="outline" className="mt-4 h-12 text-[15px]" onClick={onBackToOr}><ArrowLeft /> {t('journey.back')}</Button>
        </div>
      </div>
    );
  }

  if (program.isLoading || !program.data) {
    return <div className="grid place-items-center py-24"><Loader2 className="size-7 animate-spin text-muted-foreground" /><span className="sr-only">{t('journey.loading')}</span></div>;
  }

  const prog = program.data;
  const ro = ctx.data!.ro;
  const serviceDef = state ? prog.services.find((s) => s.service === state.serviceLabel) ?? null : null;
  const official = state ? officialMinutes(prog.temps, state.serviceLabel, serviceDef?.km ?? null) : null;
  const billed = billedMinutes(ro.lines.map((l) => ({ kind: l.kind, quantity: l.quantity })));
  const progress = state ? journeyProgress(state.operations, stepCounts) : null;
  const spent = state ? spentMinutes(state.operations) : 0;

  const bikeLabel = `${prog.modele} ${prog.annee}`;

  // --- choix de l'entretien ------------------------------------------------
  const startService = (label: string) => {
    const now = new Date().toISOString();
    persist({
      version: 1, orId, modelYearId: prog.modelYearId, serviceLabel: label,
      startedAt: now, finishedAt: null, reportedToOr: false,
      operations: buildOperations(prog, label), findings: [],
    });
    setView('ops');
  };

  if (view === 'choose' || !state) {
    const due = dueServices(
      prog,
      { km: ro.or.mileage ?? vehicle?.mileage ?? null, date: today() },
      null,
      { date: vehicle?.firstRegistrationDate ?? null },
    );
    return (
      <div>
        {banners}
        <div className="mb-3">
          <p className="font-data text-[13px] text-muted-foreground">{bikeLabel}{demoBikeId ? ` · ${t('journey.demoBike')}` : ''}</p>
          <h2 className="font-display text-[20px] font-bold uppercase">{t('journey.chooseService')}</h2>
          <p className="text-[13px] text-muted-foreground">{t('journey.chooseServiceHint')}</p>
        </div>
        <ul className="space-y-3">
          {due.map((d) => {
            const mins = officialMinutes(prog.temps, d.service.service, d.service.km ?? null);
            return (
              <li key={d.service.service}>
                <button
                  type="button"
                  onClick={() => startService(d.service.service)}
                  className="flex w-full items-center gap-3 rounded-md border border-border bg-card p-4 text-left transition-colors hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-display text-[17px] font-bold uppercase">{d.service.service}</span>
                      {d.reached && <StatusBadge tone="warning" label={t('journey.due')} />}
                    </div>
                    <p className="mt-1 text-[13px] text-muted-foreground">
                      {d.dueKm != null && <span className="mr-3 tabular-nums">{fill(t('journey.dueKm'), { km: `${fmtInt(d.dueKm)} km` })}</span>}
                      {d.dueDate && <span className="mr-3 tabular-nums">{fill(t('journey.dueDate'), { date: d.dueDate })}</span>}
                      {d.reachedBy && <span className="mr-3">{t(`journey.dueBy_${d.reachedBy}`)}</span>}
                    </p>
                    <p className="mt-0.5 text-[13px] text-muted-foreground">
                      {d.operations ? fill(t('journey.opsCount'), { n: d.operations }) : t('journey.noOps')}
                      {' · '}
                      {mins != null ? `${t('journey.officialTime')} ${fmtMinutes(mins)}` : t('journey.noOfficialTime')}
                    </p>
                  </div>
                  <ChevronRight className="size-6 shrink-0 text-muted-foreground" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
        <Button variant="outline" className="mt-4 h-12 text-[15px]" onClick={onBackToOr}><ArrowLeft /> {t('journey.back')}</Button>
      </div>
    );
  }

  // --- procédure pas à pas -------------------------------------------------
  const openOp = state.operations.find((o) => o.id === openOpId) ?? null;
  const openProc = linkedId ? linked.data ?? null : openOp?.parcoursId ? procedures.data?.[openOp.parcoursId] ?? null : null;

  const toggleStep = (n: number) => patch((s) => ({
    ...s,
    operations: s.operations.map((o) => {
      if (o.id !== openOpId) return o;
      const steps = { ...o.steps };
      if (steps[String(n)]) delete steps[String(n)]; else steps[String(n)] = new Date().toISOString();
      return { ...o, steps };
    }),
  }));

  const toggleOperation = (id: string) => patch((s) => ({
    ...s, operations: s.operations.map((o) => (o.id === id ? { ...o, done: !o.done } : o)),
  }));

  const toggleChrono = (id: string) => patch((s) => ({
    ...s,
    operations: runningOperationId(s.operations) === id ? stopChrono(s.operations) : startChrono(s.operations, id),
  }));

  const addFinding = (f: NewFinding) => patch((s) => ({
    ...s, findings: [...s.findings, { ...f, id: uid(), at: new Date().toISOString() }],
  }));

  const removeFinding = (id: string) => patch((s) => ({ ...s, findings: s.findings.filter((f) => f.id !== id) }));

  if (view === 'procedure' && openOp && openProc) {
    return (
      <>
        {banners}
        <ProcedureView
          key={openProc.id}
          procedure={openProc}
          operation={openOp}
          running={running === openOp.id}
          spentMin={operationMinutes(openOp) + tick * 0}
          onBack={() => { if (linkedId) setLinkedId(null); else { setOpenOpId(null); setView('ops'); } }}
          onToggleStep={linkedId ? () => undefined : toggleStep}
          onToggleOperation={() => toggleOperation(openOp.id)}
          onChrono={() => toggleChrono(openOp.id)}
          onFinding={(kind, stepNo) => setFinding({ kind, stepNo })}
          onOpenFigure={(f, alt) => setFigure({ f, alt })}
          onOpenLinked={(id) => setLinkedId(id)}
        />
        <FigureZoom figure={figure?.f ?? null} alt={figure?.alt ?? ''} onClose={() => setFigure(null)} />
        <FindingDialog
          kind={finding?.kind ?? null} operationId={openOp.id} stepNo={finding?.stepNo ?? null}
          onAdd={addFinding} onClose={() => setFinding(null)}
        />
      </>
    );
  }

  // --- récapitulatif -------------------------------------------------------
  if (view === 'summary') {
    const s = summarize(state, stepCounts, official, billed);
    return (
      <div className="pb-6">
        {banners}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-data text-[13px] text-muted-foreground">{bikeLabel} · {state.serviceLabel}</p>
            <h2 className="font-display text-[20px] font-bold uppercase">{t('journey.summary')}</h2>
          </div>
          <Button variant="outline" className="h-12 text-[15px]" onClick={() => setView('ops')}><ArrowLeft /> {t('journey.backToOps')}</Button>
        </div>
        <p className="mb-4 text-[13px] text-muted-foreground">{t('journey.summarySubtitle')}</p>

        <div className="grid gap-3 sm:grid-cols-2">
          <section className="rounded-md border border-border bg-card p-4">
            <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('journey.summaryDone')}</p>
            <p className="mt-1 font-data text-[24px] font-bold tabular-nums">{s.progress.opsDone} / {s.progress.opsTotal}</p>
            <Progress value={s.progress.percent} className="mt-2 h-2.5" />
            {s.pending.length ? (
              <>
                <p className="mt-3 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('journey.summaryPending')}</p>
                <ul className="mt-1 space-y-1">{s.pending.map((p) => <li key={p.id} className="text-[13px] text-muted-foreground">· {p.label}</li>)}</ul>
              </>
            ) : <p className="mt-3 flex items-center gap-2 text-[13px] text-success"><CheckCircle2 className="size-4" aria-hidden />{t('journey.summaryNothingPending')}</p>}
          </section>

          <section className="rounded-md border border-border bg-card p-4">
            <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('journey.summaryTimes')}</p>
            <dl className="mt-2 space-y-1.5 text-[14px]">
              <Row label={t('journey.spent')} value={fmtMinutes(s.spent)} strong />
              <Row label={t('journey.officialTime')} value={fmtMinutes(s.times.official)} />
              <Row label={t('journey.billed')} value={fmtMinutes(s.times.billed)} />
              <Row label={t('journey.vsOfficial')} value={fmtMinutes(s.times.vsOfficial)} tone={s.times.vsOfficial != null && s.times.vsOfficial > 0 ? 'warning' : 'success'} />
              <Row label={t('journey.vsBilled')} value={fmtMinutes(s.times.vsBilled)} tone={s.times.vsBilled != null && s.times.vsBilled > 0 ? 'warning' : 'success'} />
            </dl>
          </section>

          <section className="rounded-md border border-border bg-card p-4 sm:col-span-2">
            <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('journey.summaryParts')}</p>
            {s.parts.length ? (
              <ul className="mt-2 space-y-1">
                {s.parts.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 border-b border-border py-1.5 text-[14px] last:border-0">
                    <span><span className="font-mono">{p.reference ?? ''}</span> {p.texte}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">× {p.quantity ?? 1}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-2 text-[13px] text-muted-foreground">{t('journey.noParts')}</p>}

            {!!s.observations.length && (
              <>
                <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('journey.summaryNotes')}</p>
                <ul className="mt-1 space-y-1">{s.observations.map((o) => <li key={o.id} className="text-[14px]">· {o.texte}</li>)}</ul>
              </>
            )}
            {!!s.photos.length && (
              <>
                <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('journey.summaryPhotos')}</p>
                <div className="mt-1 flex flex-wrap gap-2">
                  {s.photos.map((p) => (
                    <img key={p.id} src={p.photoData ?? ''} alt={p.texte} className="size-24 rounded border border-border object-cover" />
                  ))}
                </div>
              </>
            )}
          </section>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            className="h-13 min-h-[52px] text-[15px]"
            disabled={state.reportedToOr || (!s.lines.length)}
            onClick={async () => {
              try {
                setError(null);
                await appendJourneyLines(companyId, ro, s.lines, `${state.serviceLabel} — ${fill(t('journey.progress'), { done: s.progress.opsDone, total: s.progress.opsTotal, percent: s.progress.percent })} · ${t('journey.spent')} ${fmtMinutes(s.spent)}`);
                patch((st) => ({ ...st, reportedToOr: true, finishedAt: st.finishedAt ?? new Date().toISOString() }));
                qc.invalidateQueries({ queryKey: ['journey-ctx', orId] });
                qc.invalidateQueries({ queryKey: ['ro-full', orId] });
              } catch (e) {
                setError(e instanceof Error ? e.message : t('journey.errSave'));
              }
            }}
          >
            <FileText /> {state.reportedToOr ? t('journey.reported') : t('journey.reportToOr')}
          </Button>
          <Button variant="outline" className="h-13 min-h-[52px] text-[15px]" onClick={onBackToOr}><ArrowLeft /> {t('journey.back')}</Button>
        </div>
        <p className="mt-2 text-[12px] text-muted-foreground">{t('journey.reportedHint')}</p>
      </div>
    );
  }

  // --- liste des opérations ------------------------------------------------
  const resume = resumePoint(state.operations, stepCounts);
  return (
    <div className="pb-6">
      {banners}
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-data text-[13px] text-muted-foreground">{bikeLabel}{demoBikeId ? ` · ${t('journey.demoBike')}` : ''}</p>
          <h2 className="font-display text-[20px] font-bold uppercase">{state.serviceLabel}</h2>
          <p className="font-data text-[13px] tabular-nums text-muted-foreground">
            {progress && fill(t('journey.progress'), { done: progress.opsDone, total: progress.opsTotal, percent: progress.percent })}
            {' · '}{t('journey.totalSpent')} {fmtMinutes(spent)}
            {official != null && <> · {t('journey.officialTime')} {fmtMinutes(official)}</>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="h-12 text-[15px]" onClick={onBackToOr}><ArrowLeft /> {t('journey.back')}</Button>
          <Button className="h-12 text-[15px]" onClick={() => setView('summary')}><ClipboardCheck /> {t('journey.finish')}</Button>
        </div>
      </div>
      <Progress value={progress?.percent ?? 0} className="mb-4 h-2.5" />

      <ul className="space-y-2">
        {state.operations.map((op, i) => {
          const n = op.parcoursId ? stepCounts[op.parcoursId] ?? 0 : 0;
          const done = isOperationDone(op, n);
          const isRunning = running === op.id;
          const isResume = resume?.operationId === op.id;
          const mins = operationMinutes(op) + tick * 0;
          return (
            <li key={op.id} className={`rounded-md border bg-card ${done ? 'border-success/40' : isResume ? 'border-ducati-red/50' : 'border-border'}`}>
              <div className="flex items-stretch gap-2 p-2 sm:p-3">
                <button
                  type="button"
                  onClick={() => toggleOperation(op.id)}
                  aria-label={t('journey.markDone')}
                  className={`grid size-12 shrink-0 place-items-center self-start rounded-md border font-data text-[15px] font-bold tabular-nums ${done ? 'border-success bg-success text-gray-0' : 'border-border bg-accent'}`}
                >
                  {done ? <Check className="size-6" aria-hidden /> : i + 1}
                </button>

                <button
                  type="button"
                  disabled={!op.parcoursId}
                  onClick={() => { setOpenOpId(op.id); setLinkedId(null); setView('procedure'); }}
                  className="min-w-0 flex-1 rounded-md px-1 py-1 text-left enabled:hover:bg-accent disabled:cursor-default"
                >
                  <p className="text-[15px] leading-snug sm:text-[16px]">{op.label}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
                    {op.parcoursId
                      ? <span className="inline-flex items-center gap-1"><ChevronRight className="size-3.5" aria-hidden />{n ? fill(t('journey.steps'), { n }) : t('journey.openProcedure')}</span>
                      : <span className="inline-flex items-center gap-1"><NotebookPen className="size-3.5" aria-hidden />{t('journey.noProcedure')}</span>}
                    {n > 0 && <span className="tabular-nums">{fill(t('journey.stepsProgress'), { done: Math.min(n, Object.keys(op.steps).length), total: n })}</span>}
                    {mins > 0 && <span className="inline-flex items-center gap-1 tabular-nums"><Timer className="size-3.5" aria-hidden />{fmtMinutes(mins)}</span>}
                    {isResume && <StatusBadge tone="info" label={t('journey.resumeHere')} />}
                  </p>
                </button>

                <Button
                  variant={isRunning ? 'destructive' : 'outline'}
                  className="h-12 w-12 shrink-0 self-start p-0"
                  onClick={() => toggleChrono(op.id)}
                  aria-label={isRunning ? t('journey.chronoStop') : t('journey.chronoStart')}
                >
                  {isRunning ? <Square /> : <Play />}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      {/* Observations, pièces et photos hors procédure */}
      <section className="mt-5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('journey.findings')}</p>
          <div className="flex gap-2">
            <Button variant="outline" className="h-11 text-[14px]" onClick={() => setFinding({ kind: 'observation', stepNo: null })}><NotebookPen /> {t('journey.addNote')}</Button>
            <Button variant="outline" className="h-11 text-[14px]" onClick={() => setFinding({ kind: 'piece', stepNo: null })}><Package /> {t('journey.addPart')}</Button>
            <Button variant="outline" className="h-11 text-[14px]" onClick={() => setFinding({ kind: 'photo', stepNo: null })}><Camera /> {t('journey.addPhoto')}</Button>
          </div>
        </div>
        {state.findings.length ? (
          <ul className="space-y-1">
            {state.findings.map((f) => <FindingRow key={f.id} f={f} onRemove={() => removeFinding(f.id)} />)}
          </ul>
        ) : <p className="text-[13px] text-muted-foreground">{t('journey.noFindings')}</p>}
      </section>

      <div className="mt-6">
        <Button
          variant="outline"
          className="h-12 text-[14px] text-danger"
          onClick={async () => {
            if (!(await confirm({ message: t('journey.restartConfirm'), variant: 'delete' }))) return;
            await clearJourney(orId);
            setState(null);
            qc.setQueryData(['journey-saved', orId], null);
            setView('choose');
          }}
        >
          <RotateCcw /> {t('journey.restart')}
        </Button>
      </div>

      <FigureZoom figure={figure?.f ?? null} alt={figure?.alt ?? ''} onClose={() => setFigure(null)} />
      <FindingDialog
        kind={finding?.kind ?? null}
        operationId={openOpId ?? state.operations[0]?.id ?? 'op1'}
        stepNo={finding?.stepNo ?? null}
        onAdd={addFinding}
        onClose={() => setFinding(null)}
      />
    </div>
  );
}

function Row({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: 'warning' | 'success' }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`tabular-nums ${strong ? 'font-data text-[17px] font-bold' : ''} ${tone === 'warning' ? 'text-warning' : tone === 'success' ? 'text-success' : ''}`}>{value}</dd>
    </div>
  );
}

function FindingRow({ f, onRemove }: { f: Finding; onRemove: () => void }) {
  const icon = f.kind === 'piece' ? <Package className="size-4" aria-hidden /> : f.kind === 'photo' ? <Camera className="size-4" aria-hidden /> : <NotebookPen className="size-4" aria-hidden />;
  return (
    <li className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-[14px]">
      <span className="text-muted-foreground">{icon}</span>
      {f.photoData && <img src={f.photoData} alt="" className="size-10 shrink-0 rounded object-cover" />}
      <span className="min-w-0 flex-1 truncate">
        {f.reference && <span className="mr-1 font-mono">{f.reference}</span>}
        {f.texte}
        {f.quantity && f.quantity > 1 ? <span className="ml-1 text-muted-foreground tabular-nums">× {f.quantity}</span> : null}
      </span>
      {f.stepNo != null && <span className="shrink-0 text-[12px] text-muted-foreground">{fill(t('journey.onStep'), { n: f.stepNo })}</span>}
      <Button variant="ghost" className="h-9 shrink-0 px-2 text-[12px] text-muted-foreground" onClick={onRemove}>{t('journey.remove')}</Button>
    </li>
  );
}
