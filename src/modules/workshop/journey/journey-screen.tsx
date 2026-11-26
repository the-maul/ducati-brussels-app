/**
 * M8 — Parcours d'entretien pas à pas (mission 07) : écran technicien, pensé pour une tablette
 * à l'atelier (gros boutons, texte lisible, portrait ou paysage).
 *
 * Enchaînement : choisir l'entretien dû → liste des opérations → procédure pas à pas → récapitulatif.
 *
 * Lot A du parcours mecanicien (19/11/2026) : plus de chrono a part. Le temps est celui de la
 * pointeuse (un pointage de travail par operation, `journey_operation`) : Demarrer / Pause /
 * Reprendre / Terminer. Quitter l'ecran n'arrete rien et ne fait tourner aucun chrono fantome :
 * le temps compte = le pointage reel (pause, arret automatique en fin de journee).
 * L'avancement est enregistré à chaque geste et la reprise se fait là où le technicien s'est arrêté.
 * **Rien n'est facturé automatiquement** : le récapitulatif propose des lignes, l'OR reste maître.
 *
 * Lot D du parcours mecanicien (19/11/2026) : le parcours est RELIE A L'OR. Quand l'OR a sa liste
 * d'operations du plan d'entretien (`repair_order_plan_operations`, migration 20261119271000), le
 * parcours affiche CETTE liste (manuel d'atelier ou plan Ducati, plus besoin de choisir
 * l'entretien) : cocher est enregistre en base (qui, quand, pointage en cours), « non faite » avec
 * motif, et « Terminer » arrete le pointage et passe l'OR « Pret » apres confirmation. Sans manuel
 * pour ce modele, l'operation garde sa case et l'ecran dit « mode operatoire non disponible ».
 * Sans la migration : comportement d'avant (liste du manuel, avancement dans le navigateur).
 *
 * ATE014 (26/11/2026) : seulement les operations a echeance (usePlanOps, due-rules.ts : « Pas a
 * echeance (n) » sous la liste, « Faire quand meme ») ; et quand Ducati n'a pas de mode operatoire,
 * celui ecrit par l'atelier s'affiche a sa place dans le meme pas a pas (« Mode operatoire de
 * l'atelier », auteur, date), ou l'atelier l'ecrit (workshop-procedure-view.tsx).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  AlertTriangle, ArrowLeft, Ban, Camera, Check, CheckCircle2, ChevronRight, ClipboardCheck, FileText,
  Info, Loader2, NotebookPen, Package, Pause, Play, RotateCcw, ShoppingCart, Timer,
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
import { openPickingForRepairOrder } from '../kits/api';
import { OrderFromWorkshopDialog } from '../kits/order-from-workshop-dialog';
import {
  buildOperations, dueServices, fmtMinutes, isOperationDone, journeyProgress,
  officialMinutes, serviceOfficialMinutes, operationMinutes, resumePoint, runningOperationId, spentMinutes, startChrono,
  stopChrono, summarize, billedMinutes,
} from './rules';
import { OrWorkControls, PauseDialog, usePointage } from '../pointage/work-controls';
import { minutesByOperation } from '../pointage/rules';
import { canStartWork } from '../checkup/rules';
import type { Figure, Finding, FindingKind, JourneyState, MaintenanceProgram, OperationProgress, Procedure } from './types';
import { t } from '@/lib/i18n';
import { supabase } from '@/integrations/supabase/client';
import { isServiceCode, serviceCodeForReason, serviceKindOf } from '../service-code';
import { DueTag, FinishDialog, NotDoneDialog, NotDueBlock, usePlanOps } from '../plan-ops/plan-ops-panel';
import { useOrWorkshopProcedures } from './workshop-procedure-api';
import { toProcedure } from './workshop-procedure-rules';
import { WorkshopProcedureEditor, WorkshopProcedureEmpty, WorkshopProcedureHeader } from './workshop-procedure-view';
import { reasonText, type PlanOp, type PlanOpSlotInfo } from '../plan-ops/rules';
import { serviceLabelDisplay } from '../service-label-fr';
import { toast } from 'sonner';
import { storeFindingPhoto, flushPendingPhotos, journeyStarted } from './finding-photos';
import { FindingPhoto } from '../dossier/dossier-parts';
import { OR_WORKABLE_STATUSES } from '../or-base/rules';

/** Demarre une fois l'entretien de l'OR, puis laisse l'ecran des operations prendre la main. */
function AutoStart({ onStart }: { onStart: () => void }) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    onStart();
  }, [onStart]);
  return <div className="grid place-items-center py-24"><Loader2 className="size-7 animate-spin text-muted-foreground" /></div>;
}

const uid =() => `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const today = () => new Date().toISOString().slice(0, 10);

type View = 'choose' | 'ops' | 'procedure' | 'summary';

export function JourneyScreen({ orId, companyId, initialOp = null, operationExtra }: {
  orId: string; companyId: string;
  /** Lot D : operation a ouvrir directement (lien « Mode operatoire » de la fiche OR). */
  initialOp?: string | null;
  /**
   * Lot D : emplacement par operation pour un autre lot (ex. lot E « Voir sur la vue eclatee »),
   * dans la liste des operations du parcours (avec ou sans la liste de l'OR en base).
   */
  operationExtra?: (op: PlanOpSlotInfo) => ReactNode;
}) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const navigate = useNavigate();

  // Mission 07 carte 2 : préparation et commande des pièces depuis le parcours.
  const [picking, setPicking] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
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
    queryKey: ['journey-program', source.data?.kind, modelYearId, !demoBikeId && !!ctx.data?.vehicle?.modelYearId],
    queryFn: () => (!demoBikeId && ctx.data?.vehicle?.modelYearId
      ? source.data!.getProgram(modelYearId!)
      : source.data!.getManualProgram(modelYearId!)),
    enabled: !!source.data && !!modelYearId,
  });

  // Lot A : la pointeuse est la seule source de temps (meme OR, meme mecanicien, tout poste).
  const pt = usePointage({ orId, companyId });
  const pointage = pt.ready;

  // Lot D : la liste des operations de l'OR (en base), si la migration est la.
  const po = usePlanOps({ orId, companyId, orStatus: ctx.data?.ro.or.status, autoInit: true });
  const dbOps = po.ops;
  const dbMode = po.ready && dbOps.length > 0;
  const dbByKey = useMemo(() => new Map(dbOps.map((o) => [o.op_key, o])), [dbOps]);
  // ATE014 : mode operatoire ecrit par l'atelier, par operation de l'OR (motos sans manuel Ducati).
  const own = useOrWorkshopProcedures(orId, dbMode);
  const atelierOf = (opKey: string | null | undefined) => (opKey ? own.data?.byOpKey.get(opKey) ?? null : null);
  const [editor, setEditor] = useState<{ opKey: string; label: string } | null>(null);
  // Lot parcours-fix (20/11) : la MO d'entretien est un forfait (decision client). Temps du forfait G8
  // du profil moteur (workshop_service_labour, migration 20261120361000) pour le recapitulatif quand
  // le manuel ne donne pas de temps Ducati.
  const orServiceCode = (() => {
    const o = ctx.data?.ro.or as unknown as { service_code?: string | null; reason_code?: string | null } | undefined;
    if (!o) return null;
    return isServiceCode(o.service_code) ? o.service_code : serviceCodeForReason(o.reason_code ?? null);
  })();
  const forfait = useQuery<number | null>({
    queryKey: ['journey-forfait', ctx.data?.vehicle?.id, orServiceCode],
    enabled: !!ctx.data?.vehicle?.id && !!orServiceCode,
    queryFn: async () => {
      const rpc = supabase.rpc.bind(supabase) as unknown as (fn: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
      const { data, error } = await rpc('workshop_service_labour', { _vehicle: ctx.data!.vehicle!.id, _service: orServiceCode });
      if (error) return null;
      const h = Number(((data ?? []) as { hours?: number | string | null }[])[0]?.hours);
      return h > 0 ? Math.round(h * 60) : null;
    },
  });
  const [notDoneOp, setNotDoneOp] = useState<PlanOp | null>(null);
  const [finishOpen, setFinishOpen] = useState(false);
  const openedInitial = useRef(false);

  // Lot D : l'etat du parcours suit la liste de l'OR (cases en base) ; les etapes cochees, notes et
  // constats restent ceux du parcours enregistre.
  useEffect(() => {
    if (!dbMode || !saved.isSuccess) return;
    setState((cur) => {
      const base = cur ?? saved.data ?? null;
      return {
        version: 1, orId,
        // `||` et non `??` : un '' posé avant l'arrivée de la moto ne doit pas rester (constat 20/11).
        modelYearId: base?.modelYearId || ctx.data?.vehicle?.modelYearId || '',
        serviceLabel: dbOps[0].service_label ?? base?.serviceLabel ?? '',
        startedAt: base?.startedAt ?? new Date().toISOString(),
        finishedAt: base?.finishedAt ?? null,
        reportedToOr: base?.reportedToOr ?? false,
        findings: base?.findings ?? [],
        operations: dbOps.map((o) => {
          const prev = base?.operations.find((x) => x.id === o.op_key);
          return { id: o.op_key, label: o.label, parcoursId: o.procedure_id, done: o.status === 'fait', steps: prev?.steps ?? {}, note: prev?.note ?? '', chrono: [] };
        }),
      };
    });
    setView((v) => (v === 'choose' ? 'ops' : v));
  }, [dbMode, dbOps, saved.isSuccess, saved.data, orId, ctx.data?.vehicle?.modelYearId]);

  // Reprise : l'avancement enregistré prime sur un nouveau départ. Avec la pointeuse, un ancien
  // chrono du parcours resté ouvert est arrêté à l'ouverture : il ne compte plus.
  useEffect(() => {
    if (!ctx.isSuccess || !po.settled || dbMode) return;
    if (journeyStarted(saved.data) && !state) {
      const legacyRunning = pointage && runningOperationId(saved.data.operations);
      setState(legacyRunning ? { ...saved.data, operations: stopChrono(saved.data.operations) } : saved.data);
      setView('ops');
    }
    else if (saved.isSuccess && !journeyStarted(saved.data) && !state) setView('choose');
  }, [saved.data, saved.isSuccess, state, pointage, ctx.isSuccess, po.settled, dbMode]);

  // Lot D : lien « Mode operatoire » de la fiche OR → l'operation s'ouvre directement.
  useEffect(() => {
    if (openedInitial.current || !initialOp || !state) return;
    const op = state.operations.find((o) => o.id === initialOp);
    if (!op) return;
    openedInitial.current = true;
    if (op.parcoursId || dbMode) { setOpenOpId(op.id); setLinkedId(null); setView('procedure'); }
  }, [initialOp, state, dbMode]);

  // Opération en cours : mon pointage ouvert sur cet OR (pointeuse), sinon l'ancien chrono local.
  const running = pointage
    ? (pt.state.mineOpen?.journey_operation ?? null)
    : state ? runningOperationId(state.operations) : null;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, [running]);
  const pointedByOp = useMemo(
    () => (pointage ? minutesByOperation(pt.entries, orId, Date.now() + tick * 0) : {}),
    [pointage, pt.entries, orId, tick],
  );
  const opMinutes = (op: OperationProgress) => (pointage ? Math.floor(pointedByOp[op.id] ?? 0) : operationMinutes(op));

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

  // Chantier C1 : une photo restée sur la tablette (réseau coupé) repart vers les documents de l'OR.
  const flushed = useRef(false);
  useEffect(() => {
    if (flushed.current || !state?.findings.some((f) => f.photoData && !f.photoPath)) return;
    flushed.current = true;
    void flushPendingPhotos(companyId, state).then((next) => {
      if (next === state) return;
      const paths = new Map(next.findings.filter((f) => f.photoPath).map((f) => [f.id, f.photoPath]));
      patch((s) => ({ ...s, findings: s.findings.map((f) => (paths.has(f.id) ? { ...f, photoPath: paths.get(f.id), photoData: null } : f)) }));
    });
  }, [state, companyId, patch]);

  // --- chargement ----------------------------------------------------------
  if (ctx.isLoading || source.isLoading || saved.isLoading || !po.settled || (dbMode && !state)) {
    return <div className="grid place-items-center py-24"><Loader2 className="size-7 animate-spin text-muted-foreground" /></div>;
  }

  // ATE-04 (chantier C1) : l'adresse du parcours respecte le blocage de l'accord client.
  const orNow = ctx.data?.ro.or as { status?: string; customer_approval?: string | null } | undefined;
  if (orNow && (OR_WORKABLE_STATUSES as readonly string[]).includes(orNow.status ?? '') && !canStartWork(orNow)) {
    return (
      <div className="rounded-md border border-warning bg-warning-bg p-4">
        <p className="flex items-center gap-2 text-[17px] font-bold text-warning"><AlertTriangle className="size-5 shrink-0" aria-hidden /> {t('dossier.journeyBlockedTitle')}</p>
        <p className="mt-1 text-[15px]">{t('dossier.journeyBlockedBody')}</p>
        <Button className="mt-3 h-12 text-[15px]" onClick={() => navigate({ to: '/workshop/dossier/$id', params: { id: orId } })}>{t('dossier.journeyBackDossier')}</Button>
      </div>
    );
  }

  const vehicle = ctx.data?.vehicle ?? null;
  const isDemo = source.data?.kind === 'demo';
  const isLocal = persistence.data === 'local';

  const banners = (
    <div className="mb-4 space-y-2">
      {isDemo && <p className="flex items-start gap-2 rounded-md bg-info-bg px-3 py-2 text-[13px] text-info"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />{t('journey.demoBanner')}</p>}
      {isLocal && <p className="flex items-start gap-2 rounded-md bg-warning-bg px-3 py-2 text-[13px] text-warning"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />{t('journey.localBanner')}</p>}
      {dbMode && <p className="flex items-start gap-2 rounded-md bg-info-bg px-3 py-2 text-[13px] text-info"><Info className="mt-0.5 size-4 shrink-0" aria-hidden />{t('planOps.journeyBanner')}</p>}
      {error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}
    </div>
  );

  // --- pas de moto / pas de modèle-année / pas de programme -----------------
  if (!dbMode && (!modelYearId || (program.isSuccess && !program.data))) {
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
        </div>
      </div>
    );
  }

  if (!dbMode && (program.isLoading || !program.data)) {
    return <div className="grid place-items-center py-24"><Loader2 className="size-7 animate-spin text-muted-foreground" /><span className="sr-only">{t('journey.loading')}</span></div>;
  }

  const prog = program.data ?? null;
  const ro = ctx.data!.ro;
  const serviceDef = state && prog ? prog.services.find((s) => s.service === state.serviceLabel) ?? null : null;
  const official = state && prog ? officialMinutes(prog.temps, state.serviceLabel, serviceDef?.km ?? null) : null;
  // Temps de reference : Ducati (manuel), sinon le forfait G8 de l'entretien (decision client 20/11).
  const ducatiRef = official ?? serviceOfficialMinutes(prog, orServiceCode, serviceKindOf);
  const referenceMinutes = ducatiRef ?? forfait.data ?? null;
  const billed = billedMinutes(ro.lines.map((l) => ({ kind: l.kind, quantity: l.quantity })));
  const progress = state ? journeyProgress(state.operations, stepCounts) : null;
  const spent = pointage ? Math.floor(pt.total) : state ? spentMinutes(state.operations) : 0;
  const workAllowed = canStartWork(ro.or as { customer_approval?: string | null });

  const bikeLabel = prog ? `${prog.modele} ${prog.annee}` : [vehicle?.brand, vehicle?.model].filter(Boolean).join(' ');

  // --- choix de l'entretien ------------------------------------------------
  const startService = (label: string) => {
    if (!prog) return;
    const now = new Date().toISOString();
    persist({
      version: 1, orId, modelYearId: prog.modelYearId, serviceLabel: label,
      startedAt: now, finishedAt: null, reportedToOr: false,
      // Chantier C1 : les commentaires et photos déjà notés dans le dossier sont gardés.
      operations: buildOperations(prog, label), findings: saved.data?.findings ?? [],
    });
    setView('ops');
  };

  if ((view === 'choose' || !state) && prog) {
    const due = dueServices(
      prog,
      { km: ro.or.mileage ?? vehicle?.mileage ?? null, date: today() },
      null,
      { date: vehicle?.firstRegistrationDate ?? null },
    );
    // Mission 10, carte 1 : l'entretien choisi de l'OR ouvre le parcours sans ecran de choix
    // (premiere ouverture seulement ; « Choisir un autre entretien » reste possible ensuite).
    const orx = ro.or as unknown as { service_code?: string | null; reason_code?: string | null };
    const orService = isServiceCode(orx.service_code) ? orx.service_code : serviceCodeForReason(orx.reason_code ?? null);
    const auto = !state && saved.isSuccess && !journeyStarted(saved.data) && orService
      ? due.find((d) => serviceKindOf(d.service.service, d.service.km ?? null, d.service.mois ?? null) === orService) ?? null
      : null;
    if (auto) return <AutoStart onStart={() => startService(auto.service.service)} />;
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
      </div>
    );
  }

  if (!state) {
    return <div className="grid place-items-center py-24"><Loader2 className="size-7 animate-spin text-muted-foreground" /></div>;
  }

  // --- procédure pas à pas -------------------------------------------------
  const openOp = state.operations.find((o) => o.id === openOpId) ?? null;
  const openAtelier = dbMode && openOp && !openOp.parcoursId ? atelierOf(openOp.id) : null;
  const openProc = linkedId ? linked.data ?? null
    : openOp?.parcoursId ? procedures.data?.[openOp.parcoursId] ?? null
      : openAtelier && openAtelier.steps.length ? toProcedure(openAtelier, t('ownProc.remark')) : null;

  const toggleStep = (n: number) => {
    patch((s) => ({
      ...s,
      operations: s.operations.map((o) => {
        if (o.id !== openOpId) return o;
        const steps = { ...o.steps };
        if (steps[String(n)]) delete steps[String(n)]; else steps[String(n)] = new Date().toISOString();
        return { ...o, steps };
      }),
    }));
    // Lot D : la derniere etape cochee coche l'operation de l'OR (tracee en base).
    const cur = state.operations.find((o) => o.id === openOpId);
    const d = openOpId ? dbByKey.get(openOpId) : undefined;
    if (dbMode && cur && d && d.status === 'a_faire' && !cur.steps[String(n)]) {
      const total = cur.parcoursId ? stepCounts[cur.parcoursId] ?? 0 : atelierOf(cur.id)?.steps.length ?? 0;
      if (total > 0 && Object.keys(cur.steps).length + 1 >= total) po.set.mutate({ op: d, status: 'fait' });
    }
  };

  // Lot D : la case de l'operation est celle de l'OR (en base, tracee) ; une « non faite » se
  // remet « a faire » par son bouton.
  const toggleOperation = (id: string) => {
    const d = dbByKey.get(id);
    if (dbMode && d) {
      if (d.status === 'non_fait' || po.set.isPending || !po.editable) return;
      po.set.mutate({ op: d, status: d.status === 'fait' ? 'a_faire' : 'fait' });
      return;
    }
    patch((s) => ({ ...s, operations: s.operations.map((o) => (o.id === id ? { ...o, done: !o.done } : o)) }));
  };
  const planDialogs = dbMode ? (
    <>
      <NotDoneDialog
        op={notDoneOp} reasons={po.reasons} busy={po.set.isPending}
        onCancel={() => setNotDoneOp(null)}
        onConfirm={(v) => { if (notDoneOp) po.set.mutate({ op: notDoneOp, status: 'non_fait', reason: v.reason, note: v.note }, { onSuccess: () => setNotDoneOp(null) }); }}
      />
      <FinishDialog
        open={finishOpen} done={po.progress.done} notDone={po.progress.notDone} busy={po.finish.isPending}
        onCancel={() => setFinishOpen(false)}
        onConfirm={() => po.finish.mutate(undefined, {
          onSuccess: () => {
            setFinishOpen(false);
            patch((st) => ({ ...st, finishedAt: st.finishedAt ?? new Date().toISOString() }));
            qc.invalidateQueries({ queryKey: ['journey-ctx', orId] });
            // Moto prête : on revient au dossier, à l'étape Payer et sortir.
            setTimeout(() => navigate({ to: '/workshop/dossier/$id', params: { id: orId } }), 150);
          },
        })}
      />
    </>
  ) : null;
  // Aucune operation n'a de mode operatoire : on le dit une fois au-dessus de la liste (revue UX 20/11).
  const anyProcedure = (state?.operations ?? []).some((o) => !!o.parcoursId || (dbMode && !!atelierOf(o.id)));
  const finishButton = dbMode && po.canFinish ? (
    <Button className="h-12 text-[15px]" disabled={po.finish.isPending} onClick={() => setFinishOpen(true)}>
      {po.finish.isPending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} {t('planOps.finish')}
    </Button>
  ) : null;

  // Lot A : Play sur une operation = pointage sur cette operation (le travail en cours sur une autre
  // operation du meme OR s'arrete tout seul ; un autre OR demande confirmation). Sur l'operation en
  // cours = Pause (motif). Sans la migration : l'ancien chrono local.
  const toggleChrono = (id: string) => {
    if (pointage) {
      if (running === id) pt.setPauseOpen(true);
      else pt.start.mutate(id);
      return;
    }
    patch((s) => ({
      ...s,
      operations: runningOperationId(s.operations) === id ? stopChrono(s.operations) : startChrono(s.operations, id),
    }));
  };
  const pauseDialog = pointage ? (
    <PauseDialog
      open={pt.pauseOpen} reasons={pt.reasons} orStatus={ro.or.status} busy={pt.pause.isPending}
      onCancel={() => pt.setPauseOpen(false)} onConfirm={(v) => pt.pause.mutate(v)}
    />
  ) : null;

  // Chantier C1 : la photo part dans les documents de l'OR ; réseau coupé, elle attend sur la tablette.
  const addFinding = (f: NewFinding) => {
    const finding: Finding = { ...f, id: uid(), at: new Date().toISOString() };
    patch((s) => ({ ...s, findings: [...s.findings, finding] }));
    if (!finding.photoData) return;
    void storeFindingPhoto(companyId, orId, finding).then((stored) => {
      if (!stored.photoPath) { toast.warning(t('dossier.notePending')); return; }
      patch((s) => ({ ...s, findings: s.findings.map((x) => (x.id === stored.id ? stored : x)) }));
      void qc.invalidateQueries({ queryKey: ['attachments', 'repair_order', orId] });
    });
  };

  const removeFinding = (id: string) => patch((s) => ({ ...s, findings: s.findings.filter((f) => f.id !== id) }));

  const editorDialog = editor ? (
    <WorkshopProcedureEditor
      open orId={orId} companyId={companyId} opLabel={editor.label} info={own.data ?? null}
      existing={atelierOf(editor.opKey)} onClose={() => setEditor(null)}
    />
  ) : null;

  // ATE014 : operation sans mode operatoire Ducati ni de l'atelier → l'atelier peut l'ecrire.
  if (view === 'procedure' && openOp && !openOp.parcoursId && !openProc && dbMode && !linkedId) {
    return (
      <>
        {banners}
        <WorkshopProcedureEmpty
          label={openOp.label} info={own.data ?? null}
          onBack={() => { setOpenOpId(null); setView('ops'); }}
          onWrite={() => setEditor({ opKey: openOp.id, label: dbByKey.get(openOp.id)?.label ?? openOp.label })}
        />
        {editorDialog}
      </>
    );
  }

  if (view === 'procedure' && openOp && openProc) {
    return (
      <>
        {banners}
        <ProcedureView
          key={openProc.id}
          header={openAtelier && !linkedId ? (
            <WorkshopProcedureHeader
              wp={openAtelier} canWrite={!!own.data?.can_write}
              onEdit={() => setEditor({ opKey: openOp.id, label: dbByKey.get(openOp.id)?.label ?? openOp.label })}
            />
          ) : undefined}
          procedure={openProc}
          operation={openOp}
          running={running === openOp.id}
          pointage={pointage}
          spentMin={opMinutes(openOp) + tick * 0}
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
        {pauseDialog}
        {planDialogs}
        {editorDialog}
      </>
    );
  }

  // --- récapitulatif -------------------------------------------------------
  if (view === 'summary') {
    const s = summarize(state, stepCounts, referenceMinutes, billed, Date.now(), pointage ? pt.total : null);
    return (
      <div className="pb-6">
        {banners}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-data text-[13px] text-muted-foreground">{bikeLabel} · {serviceLabelDisplay(state.serviceLabel)}</p>
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
              <Row label={ducatiRef == null && forfait.data != null ? t('journey.forfaitTime') : t('journey.officialTime')} value={fmtMinutes(s.times.official)} />
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
                    <FindingPhoto key={p.id} f={p} className="size-24" />
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
                await appendJourneyLines(companyId, ro, s.lines, `${serviceLabelDisplay(state.serviceLabel)} — ${fill(t('journey.progress'), { done: s.progress.opsDone, total: s.progress.opsTotal, percent: s.progress.percent })} · ${t('journey.spent')} ${fmtMinutes(s.spent)}`);
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
          {/* Mission 07 carte 2 : la préparation reprend le kit de l'échéance + les pièces relevées. */}
          <Button
            variant="outline" className="h-13 min-h-[52px] text-[15px]" disabled={picking}
            onClick={async () => {
              try {
                setError(null);
                setPicking(true);
                const id = await openPickingForRepairOrder(orId);
                navigate({ to: '/preparation/$pickingId', params: { pickingId: id } });
              } catch (e) {
                setError(e instanceof Error ? e.message : t('journey.errSave'));
              } finally {
                setPicking(false);
              }
            }}
          >
            <ClipboardCheck /> {t('workshop.createPicking')}
          </Button>
          <Button variant="outline" className="h-13 min-h-[52px] text-[15px]" onClick={() => setOrderOpen(true)}>
            <ShoppingCart /> {t('workshop.orderMissing')}
          </Button>
          {finishButton}
        </div>
        {planDialogs}
        {orderOpen && (
          <OrderFromWorkshopDialog
            orId={orId} companyId={companyId} label={`OR ${ro.or.number ?? ''}`.trim()}
            onClose={() => setOrderOpen(false)}
          />
        )}
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
          <h2 className="font-display text-[20px] font-bold uppercase">{serviceLabelDisplay(state.serviceLabel)}</h2>
          <p className="font-data text-[13px] tabular-nums text-muted-foreground">
            {progress && fill(t('journey.progress'), { done: progress.opsDone, total: progress.opsTotal, percent: progress.percent })}
            {' · '}{t('journey.totalSpent')} {fmtMinutes(spent)}
            {official != null && <> · {t('journey.officialTime')} {fmtMinutes(official)}</>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* Revue UX (20/11) : « Terminer le parcours » n'est l'action principale (rouge) que quand tout
              est coche ; avant, le rouge va a « Démarrer » / a l'operation en cours. */}
          <Button className="h-12 text-[15px]" variant={finishButton || (progress?.percent ?? 0) < 100 ? 'outline' : 'default'} onClick={() => setView('summary')}><ClipboardCheck /> {t('journey.finish')}</Button>
          {finishButton}
        </div>
      </div>
      <Progress value={progress?.percent ?? 0} className="mb-4 h-2.5" />
      {/* Lot A : etat du pointage + Demarrer / Pause / Reprendre / Terminer, sur tout poste. */}
      {pointage && (
        <OrWorkControls orId={orId} companyId={companyId} orStatus={ro.or.status} workAllowed={workAllowed} />
      )}

      {!anyProcedure && state.operations.length > 0 && (
        <p className="mb-2 flex items-center gap-1.5 text-[13px] text-muted-foreground"><NotebookPen className="size-4" aria-hidden />{dbMode ? `${t('planOps.noProcedure')} ${own.data?.can_write ? t('ownProc.bannerHint') : ''}`.trim() : t('journey.noProcedure')}</p>
      )}
      <ul className="space-y-2">
        {state.operations.map((op, i) => {
          const atelier = dbMode && !op.parcoursId ? atelierOf(op.id) : null;
          const n = op.parcoursId ? stepCounts[op.parcoursId] ?? 0 : atelier?.steps.length ?? 0;
          const dbOp = dbMode ? dbByKey.get(op.id) : undefined;
          const done = dbOp ? dbOp.status === 'fait' : isOperationDone(op, n);
          const notDone = dbOp?.status === 'non_fait';
          const isRunning = running === op.id;
          const isResume = resume?.operationId === op.id;
          const mins = opMinutes(op) + tick * 0;
          return (
            <li key={op.id} className={`rounded-md border bg-card ${done ? 'border-success/40' : notDone ? 'border-warning/40' : isResume ? 'border-ducati-red/50' : 'border-border'}`}>
              <div className="flex items-stretch gap-2 p-2 sm:p-3">
                <button
                  type="button"
                  onClick={() => toggleOperation(op.id)}
                  aria-label={t('journey.markDone')}
                  aria-pressed={done}
                  className={`grid size-12 shrink-0 place-items-center self-start rounded-md border font-data text-[15px] font-bold tabular-nums ${done ? 'border-success bg-success text-gray-0' : notDone ? 'border-warning bg-warning-bg text-warning' : 'border-border bg-accent'}`}
                >
                  {done ? <Check className="size-6" aria-hidden /> : notDone ? <Ban className="size-6" aria-hidden /> : i + 1}
                </button>

                <button
                  type="button"
                  disabled={!op.parcoursId && !dbMode}
                  onClick={() => { setOpenOpId(op.id); setLinkedId(null); setView('procedure'); }}
                  className="min-w-0 flex-1 rounded-md px-1 py-1 text-left enabled:hover:bg-accent disabled:cursor-default"
                >
                  <p className="text-[15px] leading-snug sm:text-[16px]">{op.label}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
                    {op.parcoursId
                      ? <span className="inline-flex items-center gap-1"><ChevronRight className="size-3.5" aria-hidden />{n ? fill(t('journey.steps'), { n }) : t('journey.openProcedure')}</span>
                      : atelier
                        ? <span className="inline-flex items-center gap-1"><NotebookPen className="size-3.5" aria-hidden />{t('ownProc.badge')} · {fill(t('ownProc.steps'), { n })}</span>
                        : dbMode && own.data?.can_write
                          ? <span className="inline-flex items-center gap-1"><ChevronRight className="size-3.5" aria-hidden />{t('ownProc.write')}</span>
                          : anyProcedure && <span className="inline-flex items-center gap-1"><NotebookPen className="size-3.5" aria-hidden />{dbMode ? t('planOps.noProcedure') : t('journey.noProcedure')}</span>}
                    {dbOp && <DueTag v={po.dueInfo.get(dbOp.id)} />}
                    {notDone && dbOp && <StatusBadge tone="warning" icon={Ban} label={`${t('planOps.journeyNotDone')} : ${reasonText(dbOp.not_done_reason, po.reasons, t)}`} />}
                    {dbOp && dbOp.status === 'fait' && dbOp.done_by_name && <span>{dbOp.done_by_name}</span>}
                    {n > 0 && <span className="tabular-nums">{fill(t('journey.stepsProgress'), { done: Math.min(n, Object.keys(op.steps).length), total: n })}</span>}
                    {mins > 0 && <span className="inline-flex items-center gap-1 tabular-nums"><Timer className="size-3.5" aria-hidden />{fmtMinutes(mins)}</span>}
                    {isResume && <StatusBadge tone="info" label={t('journey.resumeHere')} />}
                  </p>
                </button>

                {operationExtra?.({
                  orId, opKey: op.id, label: op.label, procedureId: op.parcoursId,
                  familyCodes: dbOp?.family_codes ?? [], lines: dbOp ? po.byOp.get(dbOp.id) ?? [] : [],
                })}
                {dbOp && po.editable && dbOp.status === 'a_faire' && (
                  <Button variant="outline" className="h-12 shrink-0 self-start px-3 text-[14px]" onClick={() => setNotDoneOp(dbOp)} aria-label={t('planOps.notDone')}>
                    <Ban /> <span className="hidden sm:inline">{t('planOps.notDone')}</span>
                  </Button>
                )}
                {dbOp && po.editable && dbOp.status === 'non_fait' && (
                  <Button variant="outline" className="h-12 shrink-0 self-start px-3 text-[14px]" disabled={po.set.isPending} onClick={() => po.set.mutate({ op: dbOp, status: 'a_faire' })} aria-label={t('planOps.reset')}>
                    <RotateCcw /> <span className="hidden sm:inline">{t('planOps.reset')}</span>
                  </Button>
                )}
                <Button
                  variant={isRunning ? 'default' : 'outline'}
                  className="h-12 w-12 shrink-0 self-start p-0"
                  disabled={pointage && (pt.busy || (!isRunning && !workAllowed))}
                  onClick={() => toggleChrono(op.id)}
                  aria-label={isRunning ? (pointage ? t('pointage.pause') : t('journey.chronoStop')) : (pointage ? t('pointage.startOperation') : t('journey.chronoStart'))}
                >
                  {isRunning ? <Pause /> : <Play />}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      {dbMode && <NotDueBlock items={po.notDue} editable={po.editable} busy={po.force.isPending} onForce={(o) => po.force.mutate(o)} />}

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

      {pauseDialog}
      {planDialogs}
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
      {f.kind === 'photo' && <FindingPhoto f={f} className="size-10 shrink-0" />}
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
