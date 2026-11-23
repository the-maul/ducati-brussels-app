/**
 * M8 — Chantier C1 (23/11/2026) : le dossier moto, un seul écran en 4 étapes.
 * « C'est un flux d'étapes à faire l'une après l'autre, hyper simple, ou à passer. »
 *
 * Le dossier s'ouvre par un RDV (pas encore d'OR : le n° arrive à l'entrée de la moto) ou par un OR.
 * L'étape vient de la règle pure `rules.ts`. Rien n'est refait ici : on range les écrans et fonctions
 * existants (pointage, photos de réception, opérations, accord client, contrôle du temps, facture).
 * La fiche OR reste accessible (« Fiche complète ») : aucune fonction ne disparaît.
 */
import { motoName } from '@/lib/moto-name';
import { lowerMileageMessage } from '../or-base/lower-mileage';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle, BellRing, CalendarClock, Camera, CheckCircle2, ClipboardCheck, ClipboardList, FileText, KeyRound, Layers, ListChecks,
  LifeBuoy, Loader2, Pause, PenLine, Play, Printer, Receipt, RotateCcw, Square, Undo2, Wallet, Wrench,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/status-badge';
import { useConfirm } from '@/components/confirm-provider';
import { useAuth } from '@/lib/auth/auth-context';
import { useCanWrite } from '@/lib/auth/use-access';
import { errorMessage } from '@/lib/mutation-feedback';
import { fillVars, getLocale, t } from '@/lib/i18n';
import { fmtMoney } from '@/modules/catalog/format';
import { contactDisplayName, getContact } from '@/modules/contacts/api';
import { ReadySmsLine } from '@/modules/crm/sms-queue';
import { getVehicle } from '@/modules/vehicles/api';
import { getRepairOrderFull, type RepairOrderFull } from '../api';
import { ApprovalPanel, VerbalApprovalDialog } from '../checkup/approval-panel';
import { getProposalSignToken, listDeferredToPlan, type DeferredIntervention } from '../checkup/api';
import { DeferredDateDialog } from '../checkup/deferred';
import { ExplodedViewsDialog } from '../exploded/exploded-views-dialog';
import { OperationExplodedButton } from '../exploded/operation-exploded-button';
import { orReadOnly } from '../exploded/rules';
import { labourTimeSchemaReady, saveTimeControl } from '../labour-time/api';
import type { ControlLineSource, ControlRow } from '../labour-time/rules';
import { TimeControlDialog } from '../labour-time/time-control-dialog';
import { OrPrintDialog } from '../or-base/print-dialog';
import { ReadyMailDialog } from '../or-base/ready-mail-dialog';
import { OrStatusBadge } from '../or-base/or-status-badge';
import { parseMileage } from '../or-base/rules';
import { finishPlanOps, getPlanProgress } from '../plan-ops/api';
import { FinishDialog, PlanOpsPanel } from '../plan-ops/plan-ops-panel';
import { createOrFromPlanningAppointment, listMechanics, type PlanningAppointment } from '../planning/api';
import { OrIntakeDialog, PlannedTimeDialog } from '../planning/planning-screen';
import { orIntakeNeeds } from '../planning/rules';
import { listVehicleOrs } from '../or-page-api';
import { isAccidentOr } from '../or-page-rules';
import { findAccidentFileFor } from '../accident/api';
import { WarrantyStatusBadge } from '../warranty/warranty-views';
import { openSiblings } from '../or-base/progress-rules';
import { PauseDialog, usePointage, workStateLabel } from '../pointage/work-controls';
import { stopWorkPointage } from '../pointage/api';
import { receptionSchemaReady, saveReception } from '../reception/api';
import { ReceptionPanel, ReceptionSheet, useReception } from '../reception/reception-sheet';
import { ReservedPartsBlock } from '../reservations/reserved-parts-block';
import { brusselsParts } from '../reservations/parts-flow';
import { openPickingForAppointment, openPickingForRepairOrder } from '../reservations/upcoming-api';
import { isServiceCode, serviceCodeForReason } from '../service-code';
import { sharedModeActive } from '../shared-tablet/store';
import { lineCoveredByWarranty } from '../warranty/rules';
import { setRepairOrderStatus, transformToInvoice } from '../write-api';
import {
  handOverMoto, loadDossierInvoice, loadDossierParts, loadHandover, resolveDossier, setOrMileage, undoHandOver,
} from './api';
import { DossierActionBar, DossierNotes, DossierTasks, DossierTrail, InfoCell, NoteButtons, fmtMinutes, plannedText } from './dossier-parts';
import { DossierLabelsLink } from './labels-link';
import { PartPathPanel } from '@/modules/purchases/part-path-ui';
import {
  DOSSIER_STEPS, dossierFlow, dossierPrimary, viewedStep,
  type DossierAction, type DossierFacts, type DossierFlow, type DossierSkip, type DossierStepKey,
} from './rules';

type StepProps = { wanted: DossierStepKey | null; onStep: (s: DossierStepKey | null) => void };

const ACTION_ICON: Partial<Record<DossierAction, typeof Play>> = {
  schedule: CalendarClock, create_or: Wrench, photos: Camera, approval: PenLine, start: Play, resume: RotateCcw,
  journey: ListChecks, ready: CheckCircle2, notify: BellRing, invoice: FileText, pay: Wallet, handover: KeyRound,
};

const whenText = (iso: string) => {
  const d = new Date(iso);
  return fillVars(t('dossier.rdvOn'), {
    date: d.toLocaleDateString(`${getLocale()}-BE`, { day: '2-digit', month: '2-digit', year: 'numeric' }),
    time: d.toLocaleTimeString(`${getLocale()}-BE`, { hour: '2-digit', minute: '2-digit' }),
  });
};

function appointmentFacts(a: PlanningAppointment | null): DossierFacts['appointment'] {
  if (!a) return null;
  return {
    status: a.status, unassigned: !!a.unassigned, hasMechanic: !!(a.mechanic_id || a.mechanic_name),
    day: a.starts_at ? brusselsParts(new Date(a.starts_at)).date : null,
    hasWork: !!(a.work_description?.trim() || a.reason_code || a.service_code), reasonCode: a.reason_code ?? null,
  };
}

const prevStep = (flow: DossierFlow, viewed: DossierStepKey): DossierStepKey | null => {
  const i = DOSSIER_STEPS.indexOf(viewed);
  for (let j = i - 1; j >= 0; j -= 1) if (flow.steps[j].state !== 'na') return DOSSIER_STEPS[j];
  return null;
};
const nextStep = (flow: DossierFlow, viewed: DossierStepKey): DossierStepKey | null => {
  const i = DOSSIER_STEPS.indexOf(viewed);
  for (let j = i + 1; j < DOSSIER_STEPS.length; j += 1) if (flow.steps[j].state !== 'na') return DOSSIER_STEPS[j];
  return null;
};

export function DossierScreen({ id, companyId, wanted, onStep }: StepProps & { id: string; companyId: string }) {
  const q = useQuery({ queryKey: ['dossier', id, companyId], queryFn: () => resolveDossier(id, companyId) });
  if (q.isLoading) return <div className="grid place-items-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  if (q.error || !q.data) return <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{t('dossier.notFound')}</p>;
  const { orId, appointment } = q.data;
  return orId
    ? <OrDossier key={orId} orId={orId} appointment={appointment} companyId={companyId} wanted={wanted} onStep={onStep} />
    : <RdvDossier key={appointment!.id} appointment={appointment!} companyId={companyId} wanted={wanted} onStep={onStep} />;
}

/** En-tête : la moto, la plaque, le client, le km, le n° d'OR, le type de dossier. */
function DossierHeader({ orNumber, orId, orStatus, contactId, vehicleId, mileage, planned, flow, trailing }: {
  orNumber: string | null; orId: string | null; orStatus: string | null; contactId: string | null; vehicleId: string | null;
  mileage: number | null; planned: number | null; flow: DossierFlow; trailing?: ReactNode;
}) {
  const contact = useQuery({ queryKey: ['ro-contact', contactId], enabled: !!contactId, staleTime: Infinity, queryFn: () => getContact(contactId!) });
  const vehicle = useQuery({ queryKey: ['ro-vehicle', vehicleId], enabled: !!vehicleId, staleTime: Infinity, queryFn: () => getVehicle(vehicleId!) });
  const v = vehicle.data ?? null;
  const moto = v ? motoName(v) : '';
  return (
    <section className="rounded-md border border-border bg-card px-3 py-2.5 shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="min-w-0 truncate text-[20px] font-bold leading-tight">{moto || t('myWorkshop.noVehicle')}</h1>
        {v?.plate && <span className="font-mono text-[16px]">{v.plate}</span>}
        <span className="min-w-0 truncate text-[16px]">{contact.data ? contactDisplayName(contact.data) : contactId ? '' : t('myWorkshop.noClient')}</span>
        <span className="font-data text-[15px] tabular-nums text-muted-foreground">
          {mileage != null ? fillVars(t('uxAtelier.kmValue'), { km: Number(mileage).toLocaleString('fr-BE') }) : t('uxAtelier.kmNone')}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {flow.variant !== 'client' && <StatusBadge tone="info" icon={Wrench} label={t(`dossier.variant_${flow.variant}`)} />}
          {orStatus && <OrStatusBadge status={orStatus} />}
          {trailing}
          {orId && (
            <Button asChild variant="outline" className="h-11">
              <Link to="/workshop/$orId" params={{ orId }}><FileText /> {t('dossier.fullSheet')}</Link>
            </Button>
          )}
        </div>
      </div>
      <p className="mt-0.5 flex flex-wrap gap-x-3 text-[13px] text-muted-foreground">
        <span className="font-mono">{orNumber ?? t('dossier.noOr')}</span>
        {plannedText(planned) && <span>{plannedText(planned)}</span>}
      </p>
    </section>
  );
}

function FlowNotice({ flow }: { flow: DossierFlow }) {
  const text = flow.cancelled ? t('dossier.cancelled')
    : flow.closed ? t('dossier.closed')
    : flow.blocked ? t(`dossier.blocked_${flow.blocked}`) : null;
  if (!text) return null;
  const tone = flow.closed ? 'bg-success-bg text-success' : flow.cancelled ? 'bg-muted text-foreground' : 'bg-warning-bg text-warning';
  const Icon = flow.closed ? CheckCircle2 : AlertTriangle;
  return <p className={`flex items-center gap-2 rounded-md px-3 py-2 text-[14px] font-bold ${tone}`}><Icon className="size-4 shrink-0" aria-hidden /> {text}</p>;
}

/** Étape « Réserver » : le RDV, le devis, les pièces et la liste de préparation. */
function ReservePanel({ companyId, a, orId, orNumber, contactId, vehicleId, serviceCode, readOnly }: {
  companyId: string; a: PlanningAppointment | null; orId: string | null; orNumber: string | null; contactId: string | null; vehicleId: string | null;
  serviceCode: string | null; readOnly: boolean;
}) {
  const navigate = useNavigate();
  const picking = useMutation({
    mutationFn: () => (orId ? openPickingForRepairOrder(orId) : openPickingForAppointment(a!.id)),
    meta: { success: false },
    onSuccess: (pickingId) => navigate({ to: '/preparation/$pickingId', params: { pickingId } }),
    onError: (e) => toast.error(e instanceof Error ? e.message : t('workshop.errSave')),
  });
  return (
    <div className="space-y-3">
      {a && (
        <section className="grid gap-3 rounded-md border border-border bg-card p-3 sm:grid-cols-3">
          <InfoCell label={t('dossier.task_date')}>
            <span className="tabular-nums">{whenText(a.starts_at)}</span>
            <span className="block text-[13px] text-muted-foreground">{a.mechanic_name ?? t('dossier.noMechanic')}</span>
          </InfoCell>
          <InfoCell label={t('dossier.rdvWork')}><span className="whitespace-pre-line">{a.work_description?.trim() || t('dossier.noWork')}</span></InfoCell>
          <InfoCell label={t('planningG8.plannedTime')}>{a.planned_minutes ? fmtMinutes(a.planned_minutes) : '—'}</InfoCell>
        </section>
      )}
      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          {a && <Button variant="outline" className="h-11" onClick={() => navigate({ to: '/workshop/planning', search: { rdv: a.id } })}><CalendarClock /> {t('dossier.editRdv')}</Button>}
          <Button variant="outline" className="h-11" onClick={() => navigate({ to: '/sales/new', search: { contactId: contactId ?? undefined, vehicleId: vehicleId ?? undefined, orNumber: orNumber ?? undefined, workshop: true } })}>
            <ClipboardList /> {t('dossier.quote')}
          </Button>
          {(orId || a) && (
            <Button variant="outline" className="h-11" disabled={picking.isPending} onClick={() => picking.mutate()}>
              {picking.isPending ? <Loader2 className="animate-spin" /> : <ClipboardCheck />} {t('dossier.picking')}
            </Button>
          )}
          <DossierLabelsLink companyId={companyId} orId={orId} />
        </div>
      )}
      {(orId || a) && <ReservedPartsBlock appointmentId={orId ? null : a!.id} orId={orId} serviceCode={serviceCode} readOnly={readOnly} compactWhenEmpty />}
      {(orId || a) && <PartPathPanel companyId={companyId} scope={orId ? 'repair_order' : 'appointment'} scopeId={orId ?? a!.id} />}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Dossier sans OR : le RDV, jusqu'à l'entrée de la moto
// ---------------------------------------------------------------------------------------------
function RdvDossier({ appointment: a, companyId, wanted, onStep }: StepProps & { appointment: PlanningAppointment; companyId: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const canWrite = useCanWrite();
  const mechanics = useQuery({ queryKey: ['dossier-mechanics', companyId], queryFn: () => listMechanics(companyId), staleTime: 300_000 });
  const parts = useQuery({ queryKey: ['dossier-parts', null, a.id], queryFn: () => loadDossierParts({ companyId, orId: null, appointmentId: a.id }) });
  const [askTime, setAskTime] = useState<PlanningAppointment | null>(null);
  const [intake, setIntake] = useState<PlanningAppointment | null>(null);
  const [busy, setBusy] = useState(false);

  const facts: DossierFacts = {
    today: brusselsParts(new Date()).date, appointment: appointmentFacts(a), or: null,
    receptionReady: true, receptionStatus: 'none', photosMissing: 0,
    pointageReady: true, workState: 'none', mineRunning: false, minePaused: false,
    planTotal: 0, planResolved: 0, planMandatoryOpen: 0,
    partsTotal: parts.data?.total ?? 0, partsMissing: parts.data?.missing ?? 0, partsToReserve: parts.data?.toReserve ?? 0,
    invoice: null, handedOver: false,
  };
  const flow = dossierFlow(facts);
  const viewed = viewedStep(flow, wanted);
  const primary = dossierPrimary(facts, flow, viewed);
  const svc = isServiceCode(a.service_code) ? a.service_code : serviceCodeForReason(a.reason_code ?? null);

  // Même enchaînement que le planning : temps prévu, km, puis l'OR naît « À faire », RDV « Réceptionné ».
  const createOr = async (x: PlanningAppointment, intakeDone = false, forceAck: number | null = null) => {
    if (!x.planned_minutes || x.planned_minutes <= 0) { setAskTime(x); return; }
    if (!intakeDone && orIntakeNeeds(x) !== 'none') { setIntake(x); return; }
    setBusy(true);
    try {
      const orId = await createOrFromPlanningAppointment(x, mechanics.data ?? await listMechanics(companyId), forceAck);
      await qc.invalidateQueries({ queryKey: ['dossier'] });
      void qc.invalidateQueries({ queryKey: ['repair-orders'] });
      navigate({ to: '/workshop/dossier/$id', params: { id: orId }, replace: true });
    } catch (e) {
      const hint = (e as { hint?: string } | null)?.hint;
      const last = Number((e as { details?: string } | null)?.details ?? 0);
      if (hint === 'mileage_lower' && last > 0 && forceAck == null) {
        const ok = await confirm({
          title: t('orBase.lowerTitle'),
          message: await lowerMileageMessage({ vehicleId: x.vehicle_id }, x.mileage ?? 0, last),
          confirmLabel: t('q64.forceLabel'), cancelLabel: t('orBase.lowerFix'),
        });
        if (ok) void createOr(x, true, last); else setIntake(x);
        return;
      }
      const m = e instanceof Error ? e.message : '';
      toast.error(m === 'planned_time_required' ? t('planningG8.errPlannedTime') : m === 'mileage_required' ? t('planningG8.errMileageOr') : m || errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const onAction = (x: DossierAction) => {
    if (x === 'go_current') return onStep(null);
    if (x === 'next_step') return onStep(nextStep(flow, viewed));
    if (x === 'schedule') return void navigate({ to: '/workshop/planning', search: { rdv: a.id } });
    if (x === 'create_or') return void createOr(a);
    return undefined;
  };
  const onSkip = (s: DossierSkip) => { if (s === 'view_next') onStep(nextStep(flow, viewed)); };
  const back = prevStep(flow, viewed);

  return (
    <div className="touch-44 space-y-3">
      <DossierHeader orNumber={null} orId={null} orStatus={null} contactId={a.contact_id} vehicleId={a.vehicle_id} mileage={a.mileage} planned={a.planned_minutes} flow={flow} />
      <DossierTrail flow={flow} viewed={viewed} onPick={onStep} />
      <FlowNotice flow={flow} />
      <p className="text-[14px] text-muted-foreground">{t(`dossier.intro_${viewed}`)}</p>
      <DossierTasks tasks={flow.tasks[viewed]} />
      {viewed === 'reserver' && <ReservePanel companyId={companyId} a={a} orId={null} orNumber={null} contactId={a.contact_id} vehicleId={a.vehicle_id} serviceCode={svc} readOnly={!canWrite} />}
      <DossierActionBar
        primary={primary} busy={busy} canWrite={canWrite} onAction={onAction} onSkip={onSkip}
        onBack={back ? () => onStep(back) : undefined}
        icon={ACTION_ICON[primary.action] ? iconOf(primary.action) : undefined}
      />
      {intake && <OrIntakeDialog companyId={companyId} appt={intake} onClose={() => setIntake(null)} onDone={(x) => { setIntake(null); void createOr(x, true); }} />}
      {askTime && <PlannedTimeDialog appt={askTime} onClose={() => setAskTime(null)} onDone={(x) => { setAskTime(null); void createOr(x); }} />}
    </div>
  );
}

function iconOf(a: DossierAction) {
  const Icon = ACTION_ICON[a];
  return Icon ? <Icon className="size-5" /> : undefined;
}

/** Km de l'OR : même contrôle qu'à la fiche (inférieur au dernier relevé : à forcer, comme G8). */
function MileageEditor({ orId, mileage, onSaved }: { orId: string; mileage: number | null; onSaved: () => void }) {
  const confirm = useConfirm();
  const [km, setKm] = useState(mileage != null ? String(mileage) : '');
  const [busy, setBusy] = useState(false);
  const parsed = parseMileage(km);
  const changed = parsed !== null && !Number.isNaN(parsed) && parsed !== mileage;
  const save = async (ack: number | null = null) => {
    if (parsed === null || Number.isNaN(parsed)) { toast.error(t('dossier.errKm')); return; }
    setBusy(true);
    try {
      await setOrMileage(orId, parsed, ack);
      toast.success(t('dossier.kmSaved'));
      onSaved();
    } catch (e) {
      const hint = (e as { hint?: string }).hint;
      const last = Number((e as { details?: string }).details ?? 0);
      if (hint === 'mileage_lower' && last > 0 && ack == null) {
        const ok = await confirm({
          title: t('orBase.lowerTitle'),
          message: await lowerMileageMessage({ orId }, parsed, last),
          confirmLabel: t('q64.forceLabel'), cancelLabel: t('orBase.lowerFix'),
        });
        if (ok) await save(last);
      } else toast.error(e instanceof Error ? e.message : t('workshop.errSave'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-card p-3">
      <label className="min-w-0">
        <span className="mb-1 block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('dossier.kmLabel')}</span>
        <Input value={km} onChange={(e) => setKm(e.target.value)} inputMode="numeric" className="h-11 w-40 text-right text-[16px] tabular-nums" />
      </label>
      <Button variant="outline" className="h-11" disabled={!changed || busy} onClick={() => void save()}>
        {busy ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} {t('dossier.kmSave')}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Dossier avec OR
// ---------------------------------------------------------------------------------------------
function OrDossier({ orId, appointment, companyId, wanted, onStep }: StepProps & { orId: string; appointment: PlanningAppointment | null; companyId: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const canWrite = useCanWrite();
  const { user, companies } = useAuth();
  const ro = useQuery({ queryKey: ['ro-full', orId], queryFn: () => getRepairOrderFull(orId) });
  const invoiceId = ro.data?.or.invoice_document_id ?? null;

  const refresh = () => {
    for (const key of [['ro-full', orId], ['dossier'], ['dossier-parts'], ['dossier-invoice'], ['dossier-handover', orId], ['plan-progress'], ['plan-ops', orId], ['reception', orId], ['repair-orders'], ['or-work', orId], ['or-work-status'], ['sms-ready', orId]]) {
      void qc.invalidateQueries({ queryKey: key });
    }
  };
  const pt = usePointage({ orId, companyId, onChanged: refresh });
  const rec = useReception(orId, companyId);
  const receptionSchema = useQuery({ queryKey: ['reception-schema'], queryFn: receptionSchemaReady, staleTime: Infinity });
  const plan = useQuery({ queryKey: ['plan-progress', orId], queryFn: () => getPlanProgress([orId]) });
  const parts = useQuery({ queryKey: ['dossier-parts', orId], queryFn: () => loadDossierParts({ companyId, orId, appointmentId: appointment?.id ?? null }) });
  const invoice = useQuery({ queryKey: ['dossier-invoice', invoiceId], enabled: !!invoiceId, queryFn: () => loadDossierInvoice(invoiceId) });
  const handover = useQuery({ queryKey: ['dossier-handover', orId], queryFn: () => loadHandover(orId) });
  const labourSchema = useQuery({ queryKey: ['labour-time-schema'], queryFn: labourTimeSchemaReady, staleTime: Infinity });
  const vehicleOrs = useQuery({
    queryKey: ['vehicle-ors', companyId, ro.data?.or.vehicle_id ?? null],
    enabled: !!ro.data?.or.vehicle_id,
    queryFn: () => listVehicleOrs(companyId, ro.data!.or.vehicle_id!),
  });
  const accidentFileId = useQuery({
    queryKey: ['accident-file-id-for-or', orId],
    enabled: isAccidentOr({ reasonCode: (ro.data?.or as { reason_code?: string | null } | undefined)?.reason_code ?? null, repairType: ro.data?.or.repair_type ?? null }),
    queryFn: () => findAccidentFileFor(companyId, { repairOrderId: orId }).catch(() => null),
  });
  const vehicleRow = useQuery({
    queryKey: ['ro-vehicle', ro.data?.or.vehicle_id ?? null], enabled: !!ro.data?.or.vehicle_id, staleTime: Infinity,
    queryFn: () => getVehicle(ro.data!.or.vehicle_id!),
  });

  const [receptionOpen, setReceptionOpen] = useState(false);
  const [verbalOpen, setVerbalOpen] = useState(false);
  const [readyOpen, setReadyOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [explodedOpen, setExplodedOpen] = useState(false);
  const [deferred, setDeferred] = useState<DeferredIntervention[] | null>(null);
  const [controlOpen, setControlOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onErr = (e: unknown) => toast.error(e instanceof Error ? e.message : errorMessage(e) || t('workshop.errSave'));
  const later = useMutation({
    mutationFn: () => saveReception(orId, rec.comment || null, 'later'),
    meta: { success: false }, onSuccess: refresh, onError: onErr,
  });
  const finish = useMutation({
    mutationFn: () => finishPlanOps(orId),
    meta: { success: false },
    onSuccess: () => { setFinishOpen(false); toast.success(t('planOps.finished')); refresh(); },
    onError: onErr,
  });
  const ready = useMutation({
    mutationFn: async () => {
      if (pt.ready && pt.state.mineOpen) await stopWorkPointage({ orId });
      await setRepairOrderStatus(orId, 'pret');
    },
    meta: { success: false },
    onSuccess: () => { toast.success(t('orLisible.readyDone')); refresh(); },
    onError: onErr,
  });
  const invoiced = () => { setControlOpen(false); toast.success(t('dossier.invoiceCreated')); refresh(); };
  const invoiceNow = useMutation({ mutationFn: () => transformToInvoice(orId), meta: { success: false }, onSuccess: invoiced, onError: onErr });
  const controlAndInvoice = useMutation({
    mutationFn: async (rows: ControlRow[]) => { if (rows.length) await saveTimeControl(orId, rows); return transformToInvoice(orId); },
    meta: { success: false }, onSuccess: invoiced,
    onError: (e) => setError(e instanceof Error ? e.message : errorMessage(e) || t('workshop.errSave')),
  });
  // Comme la fiche OR : date des interventions reportées, contrôle du temps (ne bloque pas), facture.
  const afterDeferred = () => { if (labourSchema.data === true) setControlOpen(true); else invoiceNow.mutate(); };
  const toInvoice = useMutation({
    mutationFn: async () => (ro.data?.or.vehicle_id ? listDeferredToPlan(ro.data.or.vehicle_id) : []),
    meta: { success: false, error: false },
    onSuccess: (list) => { if (list.length) setDeferred(list); else afterDeferred(); },
    onError: () => afterDeferred(),
  });
  const handOver = useMutation({
    mutationFn: () => handOverMoto(orId),
    meta: { success: false },
    onSuccess: () => { toast.success(t('dossier.handoverSaved')); refresh(); },
    onError: onErr,
  });
  const undo = useMutation({
    mutationFn: () => undoHandOver(orId),
    meta: { success: false },
    onSuccess: () => { toast.success(t('dossier.handoverUndone')); refresh(); },
    onError: onErr,
  });
  const signAtCounter = useMutation({
    mutationFn: async () => {
      const docId = (ro.data?.or as { proposal_document_id?: string | null } | undefined)?.proposal_document_id;
      if (!docId) throw new Error(t('checkup.noProposal'));
      return getProposalSignToken(docId);
    },
    meta: { success: false },
    onSuccess: (token) => navigate({ to: '/signer/$token', params: { token }, search: { mode: 'comptoir', retour: orId } }),
    onError: onErr,
  });

  // L'étape se calcule sur des faits complets : pas d'étape « photos » affichée le temps de les lire.
  const factsLoading = ro.isLoading || receptionSchema.isLoading || (rec.ready && !rec.loaded) || !pt.schemaKnown || (pt.ready && pt.loading)
    || plan.isLoading || parts.isLoading || handover.isLoading || (!!invoiceId && invoice.isLoading);
  if (factsLoading) return <div className="grid place-items-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  if (!ro.data) return <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{t('dossier.notFound')}</p>;

  const data: RepairOrderFull = ro.data;
  const or = data.or;
  const orx = or as typeof or & {
    customer_approval?: string | null; proposal_document_id?: string | null; reason_code?: string | null;
    service_code?: string | null; operator_id?: string | null; planned_minutes?: number | null;
  };
  const serviceCode = isServiceCode(orx.service_code) ? orx.service_code : serviceCodeForReason(orx.reason_code ?? null);
  const row = plan.data?.get(orId) ?? null;
  const inv = invoice.data ?? null;
  // Sans la migration de la remise : un OR facturé compte comme sorti (comportement d'avant).
  const handedOver = handover.data?.ready === false ? or.status === 'facture' : !!handover.data?.at;
  const facts: DossierFacts = {
    today: brusselsParts(new Date()).date,
    appointment: appointmentFacts(appointment),
    or: {
      status: or.status, customerApproval: orx.customer_approval ?? null, warrantyStatus: or.warranty_status,
      reasonCode: orx.reason_code ?? null, repairType: or.repair_type, serviceCode,
      hasVehicle: !!or.vehicle_id, hasContact: !!or.contact_id, mileage: or.mileage,
    },
    receptionReady: rec.ready, receptionStatus: rec.status, photosMissing: rec.summary.missing.length,
    pointageReady: pt.ready, workState: pt.state.state, mineRunning: !!pt.state.mineOpen, minePaused: !!pt.state.mineLastPaused,
    planTotal: row?.total ?? 0, planResolved: (row?.done ?? 0) + (row?.not_done ?? 0), planMandatoryOpen: row?.mandatory_open ?? 0,
    partsTotal: parts.data?.total ?? 0, partsMissing: parts.data?.missing ?? 0, partsToReserve: parts.data?.toReserve ?? 0,
    invoice: inv ? { status: inv.status, totalTtc: inv.totalTtc, paidAmount: inv.paidAmount } : null,
    handedOver,
  };
  const flow = dossierFlow(facts);
  const viewed = viewedStep(flow, wanted);
  const primary = dossierPrimary(facts, flow, viewed);
  const back = prevStep(flow, viewed);
  const closedOr = or.status === 'facture' || or.status === 'annule';
  const companyName = companies.find((c) => c.id === companyId)?.name ?? '';
  const modelYearId = (vehicleRow.data as { ducati_model_year_id?: string | null } | null | undefined)?.ducati_model_year_id ?? null;
  const siblings = openSiblings(vehicleOrs.data ?? [], orId);
  const remaining = inv ? Math.max(0, inv.totalTtc - inv.paidAmount) : 0;

  const start = async () => {
    // Moto d'un autre compagnon : une confirmation (le temps sera compté pour celui qui pointe).
    if (!sharedModeActive() && orx.operator_id && orx.operator_id !== user?.id && !pt.state.mineLastPaused) {
      const ok = await confirm({
        title: t('dossier.action_start'),
        message: fillVars(t('uxAtelier.confirmForeign'), { name: or.operator ?? '' }),
        confirmLabel: t('dossier.action_start'),
      });
      if (!ok) return;
    }
    pt.start.mutate(null);
  };
  const askHandOver = async (unpaid: boolean) => {
    const ok = await confirm(unpaid
      ? { title: t('dossier.handoverUnpaidTitle'), message: fillVars(t('dossier.handoverUnpaidMessage'), { amount: fmtMoney(remaining) }), confirmLabel: t('dossier.handoverUnpaidOk') }
      : { title: t('dossier.handoverTitle'), message: t('dossier.handoverMessage'), confirmLabel: t('dossier.handoverOk') });
    if (ok) handOver.mutate();
  };
  const askUndo = async () => {
    const ok = await confirm({ title: t('dossier.handoverUndoTitle'), message: t('dossier.handoverUndoMessage'), confirmLabel: t('dossier.handoverUndo') });
    if (ok) undo.mutate();
  };
  const askReady = async () => {
    if (facts.planTotal > 0) { setFinishOpen(true); return; }
    const ok = await confirm({ title: t('orLisible.readyTitle'), message: t('orLisible.readyMessage'), confirmLabel: t('orLisible.readyOk') });
    if (ok) ready.mutate();
  };

  const onAction = (a: DossierAction) => {
    switch (a) {
      case 'go_current': return onStep(null);
      case 'next_step': return onStep(nextStep(flow, viewed));
      case 'schedule': return appointment ? void navigate({ to: '/workshop/planning', search: { rdv: appointment.id } }) : undefined;
      case 'photos': return setReceptionOpen(true);
      case 'approval': return setVerbalOpen(true);
      case 'start': case 'resume': return void start();
      case 'journey': return void navigate({ to: '/workshop/journey/$orId', params: { orId } });
      case 'ready': return void askReady();
      case 'notify': return setReadyOpen(true);
      case 'invoice': setError(null); return toInvoice.mutate();
      case 'pay': return inv ? void navigate({ to: '/sales/$documentId', params: { documentId: inv.id } }) : undefined;
      case 'handover': return void askHandOver(false);
      default: return undefined;
    }
  };
  const onSkip = (s: DossierSkip) => {
    if (s === 'view_next') onStep(nextStep(flow, viewed));
    else if (s === 'photos_later') later.mutate();
    else if (s === 'invoice') { setError(null); toInvoice.mutate(); }
    else if (s === 'handover') void askHandOver(true);
  };
  const busy = pt.busy || later.isPending || finish.isPending || ready.isPending || toInvoice.isPending || invoiceNow.isPending
    || controlAndInvoice.isPending || handOver.isPending || undo.isPending;

  return (
    <div className="touch-44 space-y-3">
      <DossierHeader
        orNumber={or.number} orId={orId} orStatus={or.status} contactId={or.contact_id} vehicleId={or.vehicle_id}
        mileage={or.mileage} planned={orx.planned_minutes ?? appointment?.planned_minutes ?? null} flow={flow}
        trailing={(
          <>
            {flow.variant === 'garantie' && or.warranty_status && or.warranty_status !== 'aucune' && <WarrantyStatusBadge status={or.warranty_status} />}
            {flow.variant === 'accident' && accidentFileId.data && (
              <Button asChild variant="outline" className="h-11">
                <Link to="/workshop/accidents/$fileId" params={{ fileId: accidentFileId.data }}><LifeBuoy /> {t('orPage.accidentOpenFile')}</Link>
              </Button>
            )}
            <Button variant="outline" className="h-11" onClick={() => setPrintOpen(true)} aria-label={t('orBase.print')}><Printer /></Button>
          </>
        )}
      />
      {siblings.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-warning bg-warning-bg px-3 py-2 text-[13px] text-warning">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          <span className="font-bold">{t('orLisible.siblingsTitle')}</span>
          <span className="min-w-0 flex-1 text-foreground">{t('orLisible.siblingsHint')}</span>
          {siblings.slice(0, 3).map((o) => (
            <Button key={o.id} size="sm" variant="outline" className="h-11 gap-2 bg-card" onClick={() => navigate({ to: '/workshop/dossier/$id', params: { id: o.id } })}>
              {fillVars(t('orLisible.siblingOpen'), { number: o.number ?? '' })} <OrStatusBadge status={o.status} />
            </Button>
          ))}
        </div>
      )}
      <DossierTrail flow={flow} viewed={viewed} onPick={onStep} />
      <FlowNotice flow={flow} />
      <p className="text-[14px] text-muted-foreground">{t(`dossier.intro_${viewed}`)}</p>
      <DossierTasks tasks={flow.tasks[viewed]} />

      {viewed === 'reserver' && (
        <ReservePanel companyId={companyId} a={appointment} orId={orId} orNumber={or.number} contactId={or.contact_id} vehicleId={or.vehicle_id} serviceCode={serviceCode} readOnly={closedOr || !canWrite} />
      )}

      {viewed === 'rentrer' && (
        <div className="space-y-3">
          {!closedOr && canWrite && or.vehicle_id && <MileageEditor key={String(or.mileage)} orId={orId} mileage={or.mileage} onSaved={refresh} />}
          <ReceptionPanel orId={orId} orStatus={or.status} companyId={companyId} onOpen={() => setReceptionOpen(true)} />
          <ApprovalPanel
            or={orx} compactWhenNone
            onVerbal={() => setVerbalOpen(true)}
            onSignAtCounter={() => signAtCounter.mutate()} signBusy={signAtCounter.isPending}
            onOpenProposal={orx.proposal_document_id ? () => navigate({ to: '/sales/$documentId', params: { documentId: orx.proposal_document_id! } }) : undefined}
          />
          {or.work_description?.trim() && (
            <section className="rounded-md border border-border bg-card p-3">
              <InfoCell label={t('dossier.workTitle')}><span className="whitespace-pre-line">{or.work_description}</span></InfoCell>
            </section>
          )}
        </div>
      )}

      {viewed === 'travailler' && (
        <div className="space-y-3">
          {pt.ready && (
            <section className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card p-3">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('dossier.task_pointage')}</p>
                <p className="text-[15px]">{workStateLabel(pt.state, pt.reasons)}</p>
              </div>
              {pt.state.mineOpen && (
                <>
                  <Button variant="outline" className="h-12 text-[15px]" disabled={busy} onClick={() => pt.setPauseOpen(true)}><Pause /> {t('pointage.pause')}</Button>
                  <Button variant="outline" className="h-12 text-[15px]" disabled={busy} onClick={() => pt.finish.mutate()}><Square /> {t('pointage.finish')}</Button>
                </>
              )}
            </section>
          )}
          <PlanOpsPanel
            orId={orId} companyId={companyId} orStatus={or.status} autoInit={!!serviceCode} onChanged={refresh}
            operationExtra={(info) => (
              <>
                <OperationExplodedButton info={info} companyId={companyId} />
                {!closedOr && canWrite && <NoteButtons orId={orId} companyId={companyId} operationId={info.opKey} compact />}
              </>
            )}
          />
          <div className="flex flex-wrap gap-2">
            {(serviceCode || facts.planTotal > 0) && (
              <Button variant="outline" className="h-11" disabled={!!flow.blocked} onClick={() => navigate({ to: '/workshop/journey/$orId', params: { orId } })}>
                <ListChecks /> {t('dossier.openJourney')}
              </Button>
            )}
            <Button variant="outline" className="h-11" onClick={() => setExplodedOpen(true)}><Layers /> {t('dossier.explodedAll')}</Button>
            {!closedOr && canWrite && (
              <Button asChild variant="outline" className="h-11" title={t('dossier.partExtraHint')}>
                <Link to="/workshop/$orId" params={{ orId }} search={{ tab: 'travail' }}><PenLine /> {t('dossier.partExtra')}</Link>
              </Button>
            )}
          </div>
          <DossierNotes orId={orId} companyId={companyId} />
        </div>
      )}

      {viewed === 'payer' && (
        <div className="space-y-3">
          <section className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card p-3">
            <ReadySmsLine orId={orId} status={or.status} />
            {inv && (
              <span className="text-[15px]">
                <span className="font-mono">{fillVars(t('dossier.invoiceLine'), { number: inv.number ?? '' })}</span>
                {' · '}<span className="font-data tabular-nums">{fmtMoney(inv.totalTtc)}</span>
                {remaining > 0.005 && <span className="ml-2 text-warning">{fillVars(t('dossier.toPay'), { amount: fmtMoney(remaining) })}</span>}
              </span>
            )}
            <div className="ml-auto flex flex-wrap gap-2">
              {or.status === 'pret' && or.contact_id && primary.action !== 'notify' && (
                <Button variant="outline" className="h-11" onClick={() => setReadyOpen(true)}><BellRing /> {t('dossier.action_notify')}</Button>
              )}
              {inv && <Button variant="outline" className="h-11" onClick={() => navigate({ to: '/sales/$documentId', params: { documentId: inv.id } })}><Receipt /> {t('dossier.openInvoice')}</Button>}
            </div>
          </section>
          {handover.data?.ready === false && or.status === 'facture' && <p className="text-[13px] text-muted-foreground">{t('dossier.handoverMissing')}</p>}
          {handover.data?.at && (
            <section className="flex flex-wrap items-center gap-3 rounded-md border border-success bg-success-bg p-3">
              <KeyRound className="size-5 shrink-0 text-success" aria-hidden />
              <p className="min-w-0 flex-1 text-[15px] text-success">
                {handover.data.by
                  ? fillVars(t('dossier.handoverDone'), { date: new Date(handover.data.at).toLocaleDateString(`${getLocale()}-BE`), who: handover.data.by })
                  : fillVars(t('dossier.handoverDoneNoWho'), { date: new Date(handover.data.at).toLocaleDateString(`${getLocale()}-BE`) })}
              </p>
              {canWrite && handover.data.origin === 'dossier' && (
                <Button variant="outline" className="h-11 bg-card" disabled={busy} onClick={() => void askUndo()}><Undo2 /> {t('dossier.handoverUndo')}</Button>
              )}
            </section>
          )}
        </div>
      )}

      <DossierActionBar
        primary={primary} busy={busy} canWrite={canWrite} onAction={onAction} onSkip={onSkip}
        onBack={back ? () => onStep(back) : undefined} icon={iconOf(primary.action)}
      />

      <PauseDialog
        open={pt.pauseOpen} reasons={pt.reasons} orStatus={or.status} busy={pt.pause.isPending}
        onCancel={() => pt.setPauseOpen(false)} onConfirm={(v) => pt.pause.mutate(v)}
      />
      <FinishDialog
        open={finishOpen} done={row?.done ?? 0} notDone={row?.not_done ?? 0} busy={finish.isPending}
        onCancel={() => setFinishOpen(false)} onConfirm={() => finish.mutate()}
      />
      <VerbalApprovalDialog key={String(verbalOpen)} orId={orId} open={verbalOpen} onClose={() => setVerbalOpen(false)} onDone={refresh} />
      {receptionOpen && (
        <ReceptionSheet
          open orId={orId} orNumber={or.number} companyId={companyId} startMode={false}
          onClose={() => setReceptionOpen(false)} onDone={() => { setReceptionOpen(false); refresh(); }}
        />
      )}
      {readyOpen && (
        <ReadyMailDialog
          companyId={companyId} companyName={companyName}
          or={{ id: or.id, number: or.number, contact_id: or.contact_id, vehicle_id: or.vehicle_id, total_ttc: Number(or.total_ttc) }}
          onClose={() => setReadyOpen(false)} onInformed={() => { setReadyOpen(false); refresh(); }}
        />
      )}
      {printOpen && <OrPrintDialog orId={orId} orNumber={or.number} onClose={() => setPrintOpen(false)} />}
      {explodedOpen && (
        <ExplodedViewsDialog companyId={companyId} modelYearId={modelYearId} target={null} onClose={() => setExplodedOpen(false)} orId={orId} readOnly={orReadOnly(or.status)} onAdd={null} />
      )}
      {deferred && <DeferredDateDialog items={deferred} onDone={() => { setDeferred(null); afterDeferred(); }} onCancel={() => setDeferred(null)} />}
      {controlOpen && (
        <TimeControlDialog
          companyId={companyId} orId={orId} orNumber={or.number}
          lines={(data.lines as unknown as (ControlLineSource & { warranty_decision?: string | null })[]).map((l) => ({ ...l, is_warranty: lineCoveredByWarranty({ is_warranty: !!l.is_warranty, warranty_decision: l.warranty_decision ?? null }, or.warranty_status) }))}
          busy={controlAndInvoice.isPending} error={controlAndInvoice.isPending ? null : error}
          onConfirm={(rows) => { setError(null); controlAndInvoice.mutate(rows); }}
          onCancel={() => setControlOpen(false)}
        />
      )}
    </div>
  );
}
