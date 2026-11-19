/**
 * M8 — Planning atelier, version G8 (rattrapage du 18/11/2026, ATE002, ATE005, bloquants #7 et #14).
 * Meme ecran que l'ancien planning (`/workshop/planning`), quatre vues :
 *   - Reception : semainier par jour, capacite et taux d'occupation (G8 « Reception atelier ») ;
 *   - Activite : colonnes par compagnon, lignes par creneau, liste d'attente, glisser-deposer ;
 *   - Motos de pret : disponibilite, prets, contrat ;
 *   - Reglages : compagnons, horaires, parametres, calendrier (chef d'atelier et administrateurs).
 * Barre commune : semaine / jour precedent-suivant, aujourd'hui, filtre compagnon, legende des
 * statuts cochable, Rechercher RDV, Nouveau RDV, Nouveau RDV en attente.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, ChevronLeft, ChevronRight, Inbox, MessageSquareText, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/lib/auth/auth-context';
import { t } from '@/lib/i18n';
import { ReservedPartsDialog } from '@/modules/workshop/reservations/reserved-parts-dialog';
import { reservationSchemaReady } from '@/modules/workshop/reservations/api';
import { isServiceCode, serviceCodeForReason } from '@/modules/workshop/service-code';
import {
  assignAppointment, createOrFromPlanningAppointment, setPlannedMinutes, type PlanningAppointment,
} from './api';
import {
  APPOINTMENT_STATUSES, addDays, atMinutes, localYmd, plannedMinutesFrom, planningMechanics, startOfDay,
  orIntakeNeeds, parseMileage, statusTone, timeToMinutes, weekDays, weekStartFor,
} from './rules';
import { dayContext, usePlanningBase, usePlanningPeriod, usePlanningRefresh } from './planning-data';
import { AppointmentDialog, type AppointmentDefaults } from './appointment-dialog';
import { ReceptionView } from './reception-view';
import { ActivityView } from './activity-view';
import { AppointmentSearchDialog } from './search-dialog';
import { PlanningSettingsView } from './settings-view';
import { StatusIcon } from './status-icon';
import { LoansView } from '../loans/loans-view';
import { loansSchemaReady } from '../loans/api';
import { Field, Picked, motoLabel } from './ui-bits';
import { ScheduledSmsDialog } from '@/modules/crm/sms-queue';
import { VehiclePicker } from '@/modules/vehicles/vehicle-picker';
import { setAppointmentVehicleMileage } from './api';

export const PLANNING_VIEWS = ['reception', 'activite', 'prets', 'reglages'] as const;
export type PlanningView = (typeof PLANNING_VIEWS)[number];
const ALL = '__all__';

const apptService = (a: PlanningAppointment): string | null =>
  (isServiceCode(a.service_code) ? a.service_code : serviceCodeForReason(a.reason_code ?? null)) ?? null;

export function PlanningScreen({ companyId, view, onView, onOpenOr }: {
  companyId: string; view: PlanningView; onView: (v: PlanningView) => void; onOpenOr: (orId: string) => void;
}) {
  const { activeCompany, isAdmin, hasRole } = useAuth();
  const canSettings = isAdmin() || hasRole('chef_atelier');
  // Annuler / programmer un SMS : droit d'ecriture sur les RDV (verifie aussi en base, can_write_table).
  const canWriteSms = canSettings || hasRole('mecanicien');
  const base = usePlanningBase(companyId);
  const refresh = usePlanningRefresh(companyId);
  const [ref, setRef] = useState(() => startOfDay(new Date()));
  const [mechanicFilter, setMechanicFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<Set<string>>(() => new Set(APPOINTMENT_STATUSES.filter((s) => s !== 'annule')));
  const [dialog, setDialog] = useState<{ appt: PlanningAppointment | null; defaults?: AppointmentDefaults } | null>(null);
  const [searching, setSearching] = useState(false);
  const [smsOpen, setSmsOpen] = useState(false);
  const [askTime, setAskTime] = useState<PlanningAppointment | null>(null);
  const [intake, setIntake] = useState<PlanningAppointment | null>(null);
  const [partsFor, setPartsFor] = useState<PlanningAppointment | null>(null);
  const reservationSchema = useQuery({ queryKey: ['reservation-schema'], queryFn: reservationSchemaReady, staleTime: Infinity });
  const loansReady = useQuery({ queryKey: ['loans-schema'], queryFn: loansSchemaReady, staleTime: Infinity });

  const s = base.settings;
  const weekStart = weekStartFor(ref, s.first_weekday);
  const days = weekDays(weekStart, s.days_shown);
  const from = view === 'activite' ? ref : weekStart;
  const to = view === 'activite' ? addDays(ref, 1) : addDays(weekStart, 7);
  const period = usePlanningPeriod(companyId, from, to);
  const ctx = useMemo(() => dayContext(base, period.blocks), [base, period.blocks]);

  const step = view === 'activite' ? 1 : 7;
  const go = (n: number) => setRef((d) => addDays(d, n * step));

  const assign = async (a: PlanningAppointment, mechanicId: string, startsAt: Date) => {
    try {
      await assignAppointment(a.id, { mechanicId, startsAt: startsAt.toISOString(), fromRequest: a.status === 'demande' });
      toast.success(t('planningG8.assigned'));
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('feedback.error'));
    }
  };
  const createOr = async (a: PlanningAppointment, intakeDone = false) => {
    if (!a.planned_minutes || a.planned_minutes <= 0) { setAskTime(a); return; }
    // Decision Q42 (18/11) : moto sans km, ou pas de moto → on les demande avant d'ouvrir l'OR.
    if (!intakeDone && orIntakeNeeds(a) !== 'none') { setIntake(a); return; }
    try {
      const orId = await createOrFromPlanningAppointment(a, base.mechanics);
      refresh();
      onOpenOr(orId);
    } catch (e) {
      toast.error(e instanceof Error ? (e.message === 'planned_time_required' ? t('planningG8.errPlannedTime') : e.message === 'mileage_required' ? t('planningG8.errMileageOr') : e.message) : t('feedback.error'));
    }
  };
  const newAt = (day: Date, mechanicId?: string | null) => setDialog({
    appt: null, defaults: { startsAt: atMinutes(day, timeToMinutes(s.day_start) ?? 540), mechanicId: mechanicId ?? mechanicFilter },
  });

  const toggleStatus = (st: string) => setStatusFilter((x) => { const n = new Set(x); if (n.has(st)) n.delete(st); else n.add(st); return n; });
  const views: PlanningView[] = PLANNING_VIEWS.filter((v) => (v === 'reglages' ? canSettings : v === 'prets' ? loansReady.data === true : true));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border border-border bg-card p-0.5" role="tablist">
          {views.map((v) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => onView(v)}
              className={`rounded-[var(--radius-badge)] px-3 py-1.5 text-[12px] font-bold uppercase tracking-[0.04em] ${view === v ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-accent'}`}>
              {t(`planningG8.view_${v}`)}
            </button>
          ))}
        </div>
        {(view === 'reception' || view === 'activite') && (
          <>
            <Button variant="outline" size="sm" onClick={() => go(-1)} aria-label={t('planningG8.previous')}><ChevronLeft className="size-4" /></Button>
            <Button variant="outline" size="sm" onClick={() => setRef(startOfDay(new Date()))}>{t('planningG8.today')}</Button>
            <Button variant="outline" size="sm" onClick={() => go(1)} aria-label={t('planningG8.next')}><ChevronRight className="size-4" /></Button>
            <Input type="date" value={localYmd(ref)} onChange={(e) => e.target.value && setRef(startOfDay(new Date(`${e.target.value}T00:00`)))} className="h-8 w-40" />
            {view === 'reception' && (
              <Select value={mechanicFilter ?? ALL} onValueChange={(v) => setMechanicFilter(v === ALL ? null : v)}>
                <SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{t('planningG8.allMechanics')}</SelectItem>
                  {planningMechanics(base.mechanics).map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <div className="ml-auto flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setSearching(true)}><Search className="size-4" /> {t('planningG8.search')}</Button>
              {/* G8 « SMS programmes » (lot SMS Brevo) : liste, annulation, programmation de rappels. */}
              <Button variant="outline" size="sm" onClick={() => setSmsOpen(true)}><MessageSquareText className="size-4" /> {t('sms.planningButton')}</Button>
              <Button variant="outline" size="sm" onClick={() => setDialog({ appt: null, defaults: { startsAt: atMinutes(ref, timeToMinutes(s.day_start) ?? 540), unassigned: true } })}>
                <Inbox className="size-4" /> {t('planningG8.newWaiting')}{period.waiting.length ? ` (${period.waiting.length})` : ''}
              </Button>
              <Button size="sm" onClick={() => newAt(ref)}><Plus className="size-4" /> {t('workshop.newRdv')}</Button>
            </div>
          </>
        )}
      </div>

      {view === 'reception' && (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {APPOINTMENT_STATUSES.map((st) => {
              const Icon = StatusIcon(st); const tone = statusTone(st);
              return (
                <label key={st} className="flex items-center gap-1 text-[12px]">
                  <input type="checkbox" checked={statusFilter.has(st)} onChange={() => toggleStatus(st)} className="size-3.5 accent-[var(--ducati-red)]" />
                  <Icon className={`size-3.5 ${tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : tone === 'info' ? 'text-info' : 'text-neutral-tag'}`} />
                  {t(`planningG8.status_${st}`)}
                </label>
              );
            })}
            {period.waiting.length > 0 && (
              <button type="button" onClick={() => onView('activite')} className="ml-auto flex items-center gap-1 text-[12px] font-bold text-warning">
                <CalendarClock className="size-3.5" /> {t('planningG8.waitingCount').replace('{n}', String(period.waiting.length))}
              </button>
            )}
          </div>
          <ReceptionView base={base} ctx={ctx} days={days} appts={period.appts} mechanicFilter={mechanicFilter} statusFilter={statusFilter}
            onOpen={(a) => setDialog({ appt: a })} onNew={(d) => newAt(d)} onCreateOr={(a) => void createOr(a)} onViewOr={onOpenOr}
            onParts={reservationSchema.data === true ? setPartsFor : null} canParts={(a) => !!apptService(a)} />
        </>
      )}
      {view === 'activite' && (
        <ActivityView base={base} ctx={ctx} day={ref} appts={period.appts} waiting={period.waiting}
          onOpen={(a) => setDialog({ appt: a })} onAssign={(a, m, at) => void assign(a, m, at)}
          onNew={(m, at) => setDialog({ appt: null, defaults: { startsAt: at, mechanicId: m } })}
          onNewWaiting={() => setDialog({ appt: null, defaults: { startsAt: atMinutes(ref, timeToMinutes(s.day_start) ?? 540), unassigned: true } })} />
      )}
      {view === 'prets' && <LoansView companyId={companyId} companyName={activeCompany?.name ?? ''} settings={s} />}
      {view === 'reglages' && canSettings && <PlanningSettingsView companyId={companyId} base={base} onChanged={refresh} />}

      {dialog && (
        <AppointmentDialog companyId={companyId} base={base} ctx={ctx} appts={period.appts} appointment={dialog.appt} defaults={dialog.defaults}
          reservationsOn={reservationSchema.data === true} onClose={() => setDialog(null)}
          onSaved={() => { setDialog(null); refresh(); }} onOrCreated={(orId) => { setDialog(null); refresh(); onOpenOr(orId); }} />
      )}
      {smsOpen && <ScheduledSmsDialog companyId={companyId} canWrite={canWriteSms} onClose={() => setSmsOpen(false)} />}
      {searching && (
        <AppointmentSearchDialog companyId={companyId} onClose={() => setSearching(false)} onPick={(r) => {
          setSearching(false);
          setRef(startOfDay(new Date(r.starts_at)));
          const hit = [...period.appts, ...period.waiting].find((x) => x.id === r.id);
          if (hit) setDialog({ appt: hit });
        }} />
      )}
      {intake && <OrIntakeDialog companyId={companyId} appt={intake} onClose={() => setIntake(null)} onDone={(a) => { setIntake(null); void createOr(a, true); }} />}
      {askTime && <PlannedTimeDialog appt={askTime} onClose={() => setAskTime(null)} onDone={(a) => { setAskTime(null); void createOr(a); }} />}
      {partsFor && <ReservedPartsDialog appointmentId={partsFor.id} startsAt={partsFor.starts_at} serviceCode={apptService(partsFor)} onClose={() => setPartsFor(null)} />}
    </div>
  );
}

/** G8 : « Veuillez saisir le temps prevu » avant de valider le RDV et d'ouvrir l'OR. */
function PlannedTimeDialog({ appt, onClose, onDone }: { appt: PlanningAppointment; onClose: () => void; onDone: (a: PlanningAppointment) => void }) {
  const [h, setH] = useState(''); const [m, setM] = useState('');
  const [busy, setBusy] = useState(false);
  const minutes = plannedMinutesFrom(h, m);
  const save = async () => {
    if (!minutes) { toast.error(t('planningG8.errPlannedTime')); return; }
    setBusy(true);
    try {
      await setPlannedMinutes(appt.id, minutes);
      onDone({ ...appt, planned_minutes: minutes });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('feedback.error'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-[420px]">
        <DialogHeader><DialogTitle>{t('planningG8.errPlannedTime')}</DialogTitle></DialogHeader>
        <Field label={t('planningG8.plannedTime')}>
          <div className="flex items-center gap-1">
            <Input autoFocus value={h} onChange={(e) => setH(e.target.value)} inputMode="decimal" className="w-20 text-right tabular-nums" />
            <span className="text-[12px] text-muted-foreground">{t('planningG8.hoursShort')}</span>
            <Input value={m} onChange={(e) => setM(e.target.value)} inputMode="numeric" className="w-20 text-right tabular-nums" />
            <span className="text-[12px] text-muted-foreground">{t('planningG8.minutesShort')}</span>
          </div>
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button onClick={() => void save()} disabled={busy}>{t('planningG8.validateAndOr')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Decision Q42 (18/11, comme G8) : avant d'ouvrir l'OR depuis le RDV, la moto et son km. Moto connue
 * sans km : km obligatoire. Pas de moto (moto a creer) : on propose de la choisir (km alors
 * obligatoire) ou d'ouvrir l'OR sans moto (le km sera demande quand une moto y sera rattachee).
 * Le RDV est mis a jour (audit trg_appt_audit) avant l'ouverture de l'OR.
 */
function OrIntakeDialog({ companyId, appt, onClose, onDone }: {
  companyId: string; appt: PlanningAppointment; onClose: () => void; onDone: (a: PlanningAppointment) => void;
}) {
  const [vehicle, setVehicle] = useState<{ id: string; label: string } | null>(
    appt.vehicle_id ? { id: appt.vehicle_id, label: motoLabel(appt.vehicles ?? null) || appt.vehicle_id.slice(0, 8) } : null,
  );
  const [km, setKm] = useState(appt.mileage != null ? String(appt.mileage) : '');
  const [busy, setBusy] = useState(false);
  const parsed = parseMileage(km);
  const go = async (withVehicle: boolean) => {
    if (withVehicle && (parsed === null || Number.isNaN(parsed))) { toast.error(t('planningG8.errMileageOr')); return; }
    setBusy(true);
    try {
      if (withVehicle && vehicle) {
        await setAppointmentVehicleMileage(appt.id, vehicle.id, parsed as number);
        onDone({ ...appt, vehicle_id: vehicle.id, mileage: parsed as number });
      } else {
        onDone(appt);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('feedback.error'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-[480px]">
        <DialogHeader><DialogTitle>{t('planningG8.intakeTitle')}</DialogTitle></DialogHeader>
        <p className="text-[13px] text-muted-foreground">{appt.vehicle_id ? t('planningG8.intakeMileageHint') : t('planningG8.intakeVehicleHint')}</p>
        <Field label={t('workshop.vehicle')}>
          {vehicle
            ? (appt.vehicle_id ? <p className="text-sm">{vehicle.label}</p> : <Picked label={vehicle.label} onClear={() => setVehicle(null)} />)
            : <VehiclePicker companyId={companyId} contactId={appt.contact_id} onPick={(v) => setVehicle({ id: v.id, label: [[v.brand, v.model].filter(Boolean).join(' '), v.plate].filter(Boolean).join(' · ') || v.id.slice(0, 8) })} placeholder={t('workshop.vehiclePlaceholder')} />}
        </Field>
        {vehicle && (
          <Field label={`${t('planningG8.mileage')} *`}>
            <Input autoFocus value={km} onChange={(e) => setKm(e.target.value)} inputMode="numeric" className="w-40 text-right tabular-nums" />
          </Field>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>{t('action.cancel')}</Button>
          {!appt.vehicle_id && !vehicle && <Button variant="outline" onClick={() => void go(false)} disabled={busy}>{t('planningG8.intakeOpenWithoutVehicle')}</Button>}
          {vehicle && <Button onClick={() => void go(true)} disabled={busy}>{t('planningG8.intakeOpen')}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
