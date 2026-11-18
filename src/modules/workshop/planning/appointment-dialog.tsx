/**
 * M8 — « Assistant planification » (G8, 07-atelier.md §5 et §13) : creation / modification d'un RDV.
 * Statut, type de RDV, case « Sans affectation (RDV en attente) », compagnon, date / heure,
 * temps prevu (h + min), client, moto, kilometrage (obligatoire des qu'une moto est choisie),
 * travaux, observations, moto de pret (reservation du pret sur la duree du RDV), SMS de rappel,
 * motif (entretien → reservation des pieces). Boutons « Enregistrer » et « Valider RDV et saisie OR »
 * (temps prevu obligatoire, G8 « Veuillez saisir le temps prevu »).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Loader2, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { getContact, contactDisplayName, type Contact } from '@/modules/contacts/api';
import { vehiclePickLabel } from '@/modules/vehicles/api';
import { VehiclePicker } from '@/modules/vehicles/vehicle-picker';
import { type VehiclePickRow } from '@/modules/vehicles/vehicle-pick';
import { listWorkshopReasons } from '@/modules/workshop/checkup/api';
import { MaintenancePartsPopup } from '@/modules/workshop/parts-popup';
import { isMaintenanceReasonCode } from '@/modules/workshop/parts-popup-rules';
import { ReservedPartsDialog } from '@/modules/workshop/reservations/reserved-parts-dialog';
import { serviceCodeForReason } from '@/modules/workshop/service-code';
import { supabase } from '@/integrations/supabase/client';
import { t } from '@/lib/i18n';
import {
  createPlanningAppointment, updatePlanningAppointment, createOrFromPlanningAppointment,
  type PlanningAppointment, type AppointmentInput,
} from './api';
import {
  SELECTABLE_STATUSES, atMinutes, checkDrop, formatMinutes, localYmd, minutesOfDay, parseMileage,
  plannedMinutesFrom, planningMechanics, timeToMinutes, type DayContext, type LoadAppointment,
} from './rules';
import type { usePlanningBase } from './planning-data';
import { ContactPicker, Field, Picked } from './ui-bits';
import { listLoanerVehicles, createLoan, listLoansForAppointment, loansSchemaReady } from '../loans/api';
import { checkPeriod } from '../loans/rules';

const NONE = '__none__';

export type AppointmentDefaults = { startsAt?: Date; mechanicId?: string | null; unassigned?: boolean };

export function AppointmentDialog({ companyId, base, ctx, appts, appointment, defaults, reservationsOn, onClose, onSaved, onOrCreated }: {
  companyId: string;
  base: ReturnType<typeof usePlanningBase>;
  ctx: DayContext;
  appts: LoadAppointment[];
  appointment: PlanningAppointment | null;
  defaults?: AppointmentDefaults;
  reservationsOn: boolean;
  onClose: () => void;
  onSaved: () => void;
  onOrCreated: (orId: string) => void;
}) {
  const a = appointment;
  const start0 = a ? new Date(a.starts_at) : defaults?.startsAt ?? atMinutes(new Date(), timeToMinutes(base.settings.day_start) ?? 540);
  const [status, setStatus] = useState(a?.status ?? 'prevu');
  const [unassigned, setUnassigned] = useState(a ? a.unassigned : !!defaults?.unassigned);
  const [mechanicId, setMechanicId] = useState<string>(a?.mechanic_id ?? defaults?.mechanicId ?? '');
  const [type, setType] = useState<string>(a?.appointment_type ?? '');
  const [date, setDate] = useState(localYmd(start0));
  const [time, setTime] = useState(`${String(start0.getHours()).padStart(2, '0')}:${String(start0.getMinutes()).padStart(2, '0')}`);
  const pm = a?.planned_minutes ?? null;
  const [hours, setHours] = useState(pm ? String(Math.floor(pm / 60)) : '');
  const [mins, setMins] = useState(pm ? String(pm % 60) : '');
  const [contact, setContact] = useState<Contact | null>(null);
  const [vehicle, setVehicle] = useState<VehiclePickRow | null>(null);
  const [mileage, setMileage] = useState(a?.mileage != null ? String(a.mileage) : '');
  const [work, setWork] = useState(a?.work_description ?? '');
  const [notes, setNotes] = useState(a?.reception_notes ?? '');
  const [notify, setNotify] = useState(a?.notify_sms ?? false);
  const [reasonCode, setReasonCode] = useState(a?.reason_code ?? '');
  const [loanerId, setLoanerId] = useState('');
  const [loanEnd, setLoanEnd] = useState(localYmd(start0));
  const [created, setCreated] = useState<{ id: string; startsAt: string } | null>(null);

  // Rechargement du client / de la moto d'un RDV existant.
  useEffect(() => {
    if (a?.contact_id) void getContact(a.contact_id).then((c) => c && setContact(c));
    if (a?.vehicle_id) {
      void supabase.from('vehicles').select('id, vin, plate, brand, model, model_year').eq('id', a.vehicle_id).maybeSingle()
        .then(({ data }) => data && setVehicle(data as VehiclePickRow));
    }
  }, [a?.contact_id, a?.vehicle_id]);

  const reasonsQ = useQuery({ queryKey: ['workshop-reasons', companyId], queryFn: () => listWorkshopReasons(companyId), staleTime: 300_000 });
  const loansReady = useQuery({ queryKey: ['loans-schema'], queryFn: loansSchemaReady, staleTime: Infinity });
  const loanersQ = useQuery({ queryKey: ['loaners', companyId], queryFn: () => listLoanerVehicles(companyId), enabled: loansReady.data === true });
  const existingLoans = useQuery({ queryKey: ['loans-appt', a?.id], queryFn: () => listLoansForAppointment(a!.id), enabled: !!a?.id && loansReady.data === true });

  const mechanics = planningMechanics(base.mechanics);
  const planned = plannedMinutesFrom(hours, mins);
  const startsAt = useMemo(() => new Date(`${date}T${time || '00:00'}`), [date, time]);
  const km = parseMileage(mileage);

  const warning = useMemo(() => {
    if (unassigned || !mechanicId || Number.isNaN(startsAt.getTime())) return null;
    const res = checkDrop({
      mechanicId, day: startsAt, startMinutes: minutesOfDay(startsAt), minutes: planned, ctx, appts,
      slotMinutes: base.settings.slot_minutes, blockOverlaps: true, appointmentId: a?.id,
    });
    return res.ok ? null : res.reason;
  }, [unassigned, mechanicId, startsAt, planned, ctx, appts, base.settings.slot_minutes, a?.id]);

  const validate = (forOr: boolean): string | null => {
    if (Number.isNaN(startsAt.getTime())) return t('planningG8.errDate');
    if (!unassigned && !mechanicId) return t('planningG8.errMechanic');
    if (vehicle && km === null) return t('planningG8.errMileageRequired');
    if (Number.isNaN(km as number)) return t('planningG8.errMileage');
    if (forOr && !planned) return t('planningG8.errPlannedTime');
    return null;
  };

  const input = (): AppointmentInput => {
    const m = mechanics.find((x) => x.id === mechanicId) ?? base.mechanics.find((x) => x.id === mechanicId) ?? null;
    return {
      companyId, status, unassigned, mechanicId: unassigned ? null : mechanicId || null, mechanicName: unassigned ? null : m?.name ?? null,
      appointmentType: type || null, startsAt: startsAt.toISOString(), plannedMinutes: planned, contactId: contact?.id ?? null,
      vehicleId: vehicle?.id ?? null, mileage: km === null || Number.isNaN(km) ? null : km, workDescription: work || null,
      receptionNotes: notes || null, notifySms: notify, reasonCode: reasonCode || null,
    };
  };

  const save = useMutation({
    mutationFn: async (forOr: boolean) => {
      const err = validate(forOr);
      if (err) throw new Error(err);
      const p = input();
      let id = a?.id ?? null;
      if (id) await updatePlanningAppointment(id, p);
      else id = await createPlanningAppointment(p);
      // Moto de pret : reservee du debut du RDV a la fin de la journee « fin prevue ».
      if (loanerId && id) {
        const end = atMinutes(new Date(`${loanEnd}T00:00`), timeToMinutes(base.settings.day_end) ?? 18 * 60);
        const period = { loaner_id: loanerId, status: 'reserve', planned_start: startsAt.toISOString(), planned_end: end.toISOString() };
        const pErr = checkPeriod([], period);
        if (pErr) throw new Error(t(`loans.err_${pErr}`));
        await createLoan({ companyId, loanerId, contactId: contact?.id ?? null, appointmentId: id, plannedStart: period.planned_start, plannedEnd: period.planned_end });
      }
      let orId: string | null = null;
      if (forOr) {
        const full: PlanningAppointment = {
          ...(a ?? ({} as PlanningAppointment)), id, company_id: companyId, contact_id: p.contactId, vehicle_id: p.vehicleId,
          or_id: null, mechanic_id: p.mechanicId, mechanic_name: p.mechanicName, unassigned: p.unassigned, appointment_type: p.appointmentType,
          mileage: p.mileage, starts_at: p.startsAt, planned_minutes: p.plannedMinutes, work_description: p.workDescription,
          reception_notes: p.receptionNotes, status: p.status, notify_sms: p.notifySms, reason_code: p.reasonCode,
        } as PlanningAppointment;
        orId = await createOrFromPlanningAppointment(full, base.mechanics);
      }
      return { id: id!, orId };
    },
    onSuccess: ({ id, orId }) => {
      toast.success(t('feedback.saved'));
      if (orId) { onOrCreated(orId); return; }
      if (!a && vehicle?.id && isMaintenanceReasonCode(reasonCode)) { setCreated({ id, startsAt: startsAt.toISOString() }); return; }
      onSaved();
    },
    onError: (e) => toast.error(e instanceof Error ? (e.message === 'planned_time_required' ? t('planningG8.errPlannedTime') : e.message) : t('feedback.error')),
  });

  const popupDone = useCallback(() => onSaved(), [onSaved]);
  if (created && reservationsOn) {
    const svc = reasonCode ? ((reasonsQ.data ?? []).find((r) => r.code === reasonCode)?.serviceCode ?? serviceCodeForReason(reasonCode)) : null;
    return <ReservedPartsDialog appointmentId={created.id} startsAt={created.startsAt} serviceCode={svc} onClose={popupDone} />;
  }
  if (created) {
    return <MaintenancePartsPopup ctx={{ companyId, vehicleId: vehicle?.id ?? null, contactId: contact?.id ?? null, reasonCode, appointmentId: created.id, appointmentAt: created.startsAt }} onDone={popupDone} />;
  }

  const onType = (code: string) => {
    setType(code === NONE ? '' : code);
    const def = base.types.find((x) => x.code === code)?.defaultMinutes;
    if (def && !planned) { setHours(String(Math.floor(def / 60))); setMins(String(def % 60)); }
  };
  const endPreview = planned && !Number.isNaN(startsAt.getTime()) ? new Date(startsAt.getTime() + planned * 60000) : null;
  const statuses = a?.status === 'demande' ? ['demande', ...SELECTABLE_STATUSES] : SELECTABLE_STATUSES;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle>{a ? t('planningG8.editRdv') : t('planningG8.assistant')}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label={t('planningG8.status')}>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{statuses.map((s) => <SelectItem key={s} value={s}>{t(`planningG8.status_${s}`)}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label={t('planningG8.type')}>
            <Select value={type || NONE} onValueChange={onType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t('planningG8.typeNone')}</SelectItem>
                {base.types.map((x) => <SelectItem key={x.code} value={x.code}>{x.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t('partsPopup.rdvReason')}>
            <Select value={reasonCode || NONE} onValueChange={(v) => setReasonCode(v === NONE ? '' : v)}>
              <SelectTrigger><SelectValue placeholder={t('partsPopup.rdvReasonNone')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t('partsPopup.rdvReasonNone')}</SelectItem>
                {(reasonsQ.data ?? []).map((r) => <SelectItem key={r.code} value={r.code}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>

          <label className="flex items-center gap-2 text-sm sm:col-span-3">
            <input type="checkbox" checked={unassigned} onChange={(e) => setUnassigned(e.target.checked)} className="size-4 accent-[var(--ducati-red)]" />
            {t('planningG8.unassigned')}
          </label>

          <Field label={t('planningG8.mechanic')}>
            <Select value={unassigned ? NONE : mechanicId || NONE} onValueChange={(v) => setMechanicId(v === NONE ? '' : v)} disabled={unassigned}>
              <SelectTrigger><SelectValue placeholder={t('planningG8.mechanicNone')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t('planningG8.mechanicNone')}</SelectItem>
                {mechanics.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label={unassigned ? t('planningG8.wishedDate') : t('workshop.rdvDate')}><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label={t('workshop.rdvTime')}><Input type="time" step={base.settings.slot_minutes * 60} value={time} onChange={(e) => setTime(e.target.value)} /></Field>

          <Field label={t('planningG8.plannedTime')}>
            <div className="flex items-center gap-1">
              <Input value={hours} onChange={(e) => setHours(e.target.value)} inputMode="decimal" className="w-16 text-right tabular-nums" aria-label={t('planningG8.hoursShort')} />
              <span className="text-[12px] text-muted-foreground">{t('planningG8.hoursShort')}</span>
              <Input value={mins} onChange={(e) => setMins(e.target.value)} inputMode="numeric" className="w-16 text-right tabular-nums" aria-label={t('planningG8.minutesShort')} />
              <span className="text-[12px] text-muted-foreground">{t('planningG8.minutesShort')}</span>
            </div>
          </Field>
          <Field label={t('planningG8.plannedEnd')}>
            <p className="flex h-9 items-center font-data text-sm tabular-nums text-muted-foreground">{endPreview ? endPreview.toLocaleString('fr-BE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}{planned ? ` · ${formatMinutes(planned)}` : ''}</p>
          </Field>
          <div />

          <Field label={t('workshop.client')}>{contact ? <Picked label={contactDisplayName(contact)} onClear={() => setContact(null)} /> : <ContactPicker companyId={companyId} onPick={setContact} />}</Field>
          <Field label={t('workshop.vehicle')}>{vehicle ? <Picked label={vehiclePickLabel(vehicle)} onClear={() => setVehicle(null)} /> : <VehiclePicker companyId={companyId} contactId={contact?.id ?? null} onPick={setVehicle} placeholder={t('workshop.vehiclePlaceholder')} />}</Field>
          <Field label={vehicle ? `${t('planningG8.mileage')} *` : t('planningG8.mileage')}>
            <Input value={mileage} onChange={(e) => setMileage(e.target.value)} inputMode="numeric" className="text-right tabular-nums" />
          </Field>

          <Field label={t('workshop.workDescription')} className="sm:col-span-3"><Textarea rows={2} value={work} onChange={(e) => setWork(e.target.value)} /></Field>
          <Field label={t('planningG8.receptionNotes')} className="sm:col-span-3"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>

          {loansReady.data === true && (
            <>
              <Field label={t('loans.loanVehicle')}>
                <Select value={loanerId || NONE} onValueChange={(v) => setLoanerId(v === NONE ? '' : v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>{t('loans.noLoan')}</SelectItem>
                    {(loanersQ.data ?? []).filter((l) => l.is_active).map((l) => <SelectItem key={l.id} value={l.id}>{[l.label, l.plate].filter(Boolean).join(' · ')}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              {loanerId && <Field label={t('loans.plannedReturn')}><Input type="date" value={loanEnd} onChange={(e) => setLoanEnd(e.target.value)} /></Field>}
              {(existingLoans.data ?? []).filter((l) => l.status !== 'annule').length > 0 && (
                <p className="self-end text-[12px] text-muted-foreground sm:col-span-1">
                  {t('loans.alreadyLinked')} {(existingLoans.data ?? []).filter((l) => l.status !== 'annule').map((l) => l.number).join(', ')}
                </p>
              )}
            </>
          )}

          <label className="flex items-center gap-2 text-sm sm:col-span-3">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="size-4 accent-[var(--ducati-red)]" /> {t('workshop.rdvNotify')}
          </label>
          {warning && <p className="text-[12px] font-medium text-warning sm:col-span-3">{t(`planningG8.warn_${warning}`)}</p>}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button variant="outline" onClick={() => save.mutate(false)} disabled={save.isPending}>{save.isPending ? <Loader2 className="animate-spin" /> : null} {t('action.save')}</Button>
          {!a?.or_id && (
            <Button onClick={() => save.mutate(true)} disabled={save.isPending || unassigned} title={unassigned ? t('planningG8.orNeedsSlot') : undefined}>
              <FileText /> {t('planningG8.validateAndOr')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
