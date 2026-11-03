import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Plus, ChevronLeft, ChevronRight, Search, FileText, Package } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useAuth } from '@/lib/auth/auth-context';
import { listContacts, contactDisplayName, type Contact } from '@/modules/contacts/api';
import { LinkedLines, useLinkedBrief } from '@/modules/contacts/linked-line';
import { vehiclePickLabel } from '@/modules/vehicles/api';
import { VehiclePicker } from '@/modules/vehicles/vehicle-picker';
import { type VehiclePickRow } from '@/modules/vehicles/vehicle-pick';
import { listAppointments, createAppointment, updateAppointmentStatus, createOrFromAppointment, type Appointment } from '@/modules/workshop/planning-api';
import { listWorkshopReasons } from '@/modules/workshop/checkup/api';
import { MaintenancePartsPopup } from '@/modules/workshop/parts-popup';
import { isMaintenanceReasonCode } from '@/modules/workshop/parts-popup-rules';
import { ReservedPartsDialog } from '@/modules/workshop/reservations/reserved-parts-dialog';
import { reservationSchemaReady } from '@/modules/workshop/reservations/api';
import { isServiceCode, serviceCodeForReason } from '@/modules/workshop/service-code';

/** Entretien choisi d'un RDV : colonne de la migration 20261103270000, sinon le motif. */
const apptService = (a: Appointment): string | null => {
  const x = a as Appointment & { service_code?: string | null; reason_code?: string | null };
  return isServiceCode(x.service_code) ? x.service_code : serviceCodeForReason(x.reason_code ?? null);
};
import { t, pageTitle } from '@/lib/i18n';

export const Route = createFileRoute('/_app/workshop/planning')({
  head: () => ({ meta: [{ title: pageTitle('workshopPlanning') }] }),
  validateSearch: (s: Record<string, unknown>) => ({ week: typeof s.week === 'string' ? s.week : undefined }),
  component: PlanningPage,
});

// « demande » = demande de rendez-vous envoyée par un client depuis son espace (/mon-espace),
// à confirmer par l'atelier (passer à « prévu ») ou à annuler.
const APPT_STATUS = ['demande', 'prevu', 'arrive', 'en_cours', 'termine', 'annule'] as const;
const tone = (s: string) => (s === 'termine' ? 'success' : s === 'annule' ? 'neutral' : s === 'en_cours' ? 'info' : s === 'arrive' || s === 'demande' ? 'warning' : 'info');
const apptLabel = (s: string) => (s === 'demande' ? t('portal.staff.requestStatus') : t(`workshop.apptStatus_${s}`));
const num = (s: string) => { const n = Number(String(s).replace(',', '.')); return Number.isFinite(n) ? n : 0; };

function mondayOf(d: Date) { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); x.setHours(0, 0, 0, 0); return x; }
function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function ymd(d: Date) { return d.toISOString().slice(0, 10); }

function PlanningPage() {
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [showNew, setShowNew] = useState(false);
  const [partsFor, setPartsFor] = useState<Appointment | null>(null);
  const reservationSchema = useQuery({ queryKey: ['reservation-schema'], queryFn: reservationSchemaReady, staleTime: Infinity });
  const weekEnd = addDays(weekStart, 7);

  const { data, isLoading } = useQuery({
    queryKey: ['appointments', activeCompanyId, ymd(weekStart)],
    queryFn: () => listAppointments(activeCompanyId!, weekStart.toISOString(), weekEnd.toISOString()),
    enabled: !!activeCompanyId,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['appointments', activeCompanyId, ymd(weekStart)] });

  const setStatus = useMutation({ mutationFn: ({ id, status }: { id: string; status: string }) => updateAppointmentStatus(id, status), onSuccess: refresh });
  const makeOr = useMutation({ mutationFn: (a: Appointment) => createOrFromAppointment(a), onSuccess: (orId) => navigate({ to: '/workshop/$orId', params: { orId } }) });

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const byDay = (d: Date) => (data ?? []).filter((a) => a.starts_at.slice(0, 10) === ymd(d));

  return (
    <>
      <PageHeader
        title={t('workshop.planningTitle')}
        description={t('workshop.planningSubtitle')}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate({ to: '/workshop' })}><ArrowLeft /> {t('workshop.back')}</Button>
            <Button onClick={() => setShowNew(true)}><Plus /> {t('workshop.newRdv')}</Button>
          </div>
        }
      />
      <div className="mb-3 flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setWeekStart((w) => addDays(w, -7))}><ChevronLeft className="size-4" /></Button>
        <Button variant="outline" size="sm" onClick={() => setWeekStart(mondayOf(new Date()))}>{t('workshop.thisWeek')}</Button>
        <Button variant="outline" size="sm" onClick={() => setWeekStart((w) => addDays(w, 7))}><ChevronRight className="size-4" /></Button>
        <span className="ml-2 font-data text-sm text-muted-foreground">{ymd(weekStart)} → {ymd(addDays(weekStart, 6))}</span>
      </div>

      {isLoading && <div className="grid place-items-center py-10"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-7">
        {days.map((d) => (
          <div key={ymd(d)} className="rounded-md border border-border bg-card p-2">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{d.toLocaleDateString('fr-BE', { weekday: 'short', day: '2-digit', month: '2-digit' })}</p>
            <div className="space-y-2">
              {byDay(d).length === 0 && <p className="px-1 text-[12px] text-muted-foreground">—</p>}
              {byDay(d).map((a) => (
                <div key={a.id} className="rounded-md border border-border p-2 text-[12px]">
                  <div className="flex items-center justify-between">
                    <span className="font-data tabular-nums">{new Date(a.starts_at).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}</span>
                    <StatusBadge tone={tone(a.status)} label={apptLabel(a.status)} />
                  </div>
                  {a.source === 'portail' && (
                    <p className="mt-1 font-medium text-warning">
                      {t('portal.staff.fromPortal')}{a.requested_slot ? ` · ${t(`portal.slots.${a.requested_slot}`)}` : ''}
                    </p>
                  )}
                  {a.work_description && <p className="mt-1 truncate text-muted-foreground">{a.work_description}</p>}
                  {a.mechanic_name && <p className="text-muted-foreground">{a.mechanic_name}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-1">
                    <Select value={a.status} onValueChange={(v) => setStatus.mutate({ id: a.id, status: v })}>
                      <SelectTrigger className="h-7 w-28 text-[12px]"><SelectValue /></SelectTrigger>
                      <SelectContent>{APPT_STATUS.filter((s) => s !== 'demande' || a.status === 'demande').map((s) => <SelectItem key={s} value={s}>{apptLabel(s)}</SelectItem>)}</SelectContent>
                    </Select>
                    {a.or_id
                      ? <Button size="sm" variant="ghost" className="h-7" onClick={() => navigate({ to: '/workshop/$orId', params: { orId: a.or_id! } })}><FileText className="size-3.5" /> {t('workshop.viewOr')}</Button>
                      : <Button size="sm" variant="ghost" className="h-7" onClick={() => makeOr.mutate(a)} disabled={makeOr.isPending}>{t('workshop.createOrFromRdv')}</Button>}
                    {reservationSchema.data === true && apptService(a) && (
                      <Button size="sm" variant="ghost" className="h-7" onClick={() => setPartsFor(a)}><Package className="size-3.5" /> {t('reservation.button')}</Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {showNew && <NewRdvDialog companyId={activeCompanyId!} defaultDate={ymd(weekStart)} reservationsOn={reservationSchema.data === true} onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); refresh(); }} />}
      {partsFor && (
        <ReservedPartsDialog appointmentId={partsFor.id} startsAt={partsFor.starts_at} serviceCode={apptService(partsFor)} onClose={() => setPartsFor(null)} />
      )}
    </>
  );
}

const NO_REASON = '__none__';

function NewRdvDialog({ companyId, defaultDate, reservationsOn, onClose, onCreated }: { companyId: string; defaultDate: string; reservationsOn: boolean; onClose: () => void; onCreated: () => void }) {
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState('09:00');
  const [minutes, setMinutes] = useState('60');
  const [mechanic, setMechanic] = useState('');
  const [loaner, setLoaner] = useState('');
  const [work, setWork] = useState('');
  const [notify, setNotify] = useState(false);
  const [contact, setContact] = useState<Contact | null>(null);
  const [vehicle, setVehicle] = useState<VehiclePickRow | null>(null);
  // Motif du RDV (mission 09, carte 3) : un motif entretien + une moto → controle des pieces du kit.
  const [reasonCode, setReasonCode] = useState('');
  const reasonsQ = useQuery({ queryKey: ['workshop-reasons', companyId], queryFn: () => listWorkshopReasons(companyId), staleTime: 300_000 });
  const [created, setCreated] = useState<{ id: string; startsAt: string } | null>(null);
  const popupDone = useCallback(() => onCreated(), [onCreated]);

  const create = useMutation({
    mutationFn: () => createAppointment({
      companyId, contactId: contact?.id ?? null, vehicleId: vehicle?.id ?? null, mechanicName: mechanic,
      startsAt: new Date(`${date}T${time}`).toISOString(), plannedMinutes: Math.round(num(minutes)) || 60,
      workDescription: work, loanerVehicle: loaner, notifySms: notify, reasonCode: reasonCode || null,
    }),
    onSuccess: (id) => {
      if (vehicle?.id && isMaintenanceReasonCode(reasonCode)) setCreated({ id, startsAt: new Date(`${date}T${time}`).toISOString() });
      else onCreated();
    },
  });

  if (created && reservationsOn) {
    // Les pieces du kit viennent d'etre reservees par la base (M-111) ; le manque est au panier.
    const svc = reasonCode ? ((reasonsQ.data ?? []).find((r) => r.code === reasonCode)?.serviceCode ?? serviceCodeForReason(reasonCode)) : null;
    return <ReservedPartsDialog appointmentId={created.id} startsAt={created.startsAt} serviceCode={svc} onClose={popupDone} />;
  }
  if (created) {
    return (
      <MaintenancePartsPopup
        ctx={{ companyId, vehicleId: vehicle?.id ?? null, contactId: contact?.id ?? null, reasonCode, appointmentId: created.id, appointmentAt: created.startsAt }}
        onDone={popupDone}
      />
    );
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>{t('workshop.newRdv')}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('workshop.rdvDate')}><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label={t('workshop.rdvTime')}><Input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
          <Field label={t('workshop.rdvDuration')}><Input type="number" value={minutes} onChange={(e) => setMinutes(e.target.value)} className="text-right tabular-nums" /></Field>
          <Field label={t('workshop.mechanicName')}><Input value={mechanic} onChange={(e) => setMechanic(e.target.value)} /></Field>
          <Field label={t('workshop.client')}>{contact ? <Picked label={contactDisplayName(contact)} onClear={() => setContact(null)} /> : <ContactPicker companyId={companyId} onPick={setContact} />}</Field>
          <Field label={t('workshop.vehicle')}>{vehicle ? <Picked label={vehiclePickLabel(vehicle)} onClear={() => setVehicle(null)} /> : <VehiclePicker companyId={companyId} contactId={contact?.id ?? null} onPick={setVehicle} placeholder={t('workshop.vehiclePlaceholder')} />}</Field>
          <Field label={t('partsPopup.rdvReason')}>
            <Select value={reasonCode || NO_REASON} onValueChange={(v) => setReasonCode(v === NO_REASON ? '' : v)}>
              <SelectTrigger><SelectValue placeholder={t('partsPopup.rdvReasonNone')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_REASON}>{t('partsPopup.rdvReasonNone')}</SelectItem>
                {(reasonsQ.data ?? []).map((r) => <SelectItem key={r.code} value={r.code}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t('workshop.rdvLoaner')}><Input value={loaner} onChange={(e) => setLoaner(e.target.value)} /></Field>
          <Field label={t('workshop.workDescription')}><Input value={work} onChange={(e) => setWork(e.target.value)} /></Field>
          <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="size-4 accent-[var(--ducati-red)]" /> {t('workshop.rdvNotify')}</label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button onClick={() => create.mutate()} disabled={create.isPending}>{create.isPending ? <Loader2 className="animate-spin" /> : null} {t('action.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Picked({ label, onClear }: { label: string; onClear: () => void }) {
  return <div className="flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm"><span className="truncate">{label}</span><button type="button" onClick={onClear} className="ml-auto text-muted-foreground">×</button></div>;
}
function ContactPicker({ companyId, onPick }: { companyId: string; onPick: (c: Contact) => void }) {
  const [term, setTerm] = useState(''); const [deb, setDeb] = useState('');
  useEffect(() => { const id = setTimeout(() => setDeb(term.trim()), 250); return () => clearTimeout(id); }, [term]);
  const { data } = useQuery({ queryKey: ['rdv-cpick', companyId, deb], queryFn: () => listContacts(companyId, deb), enabled: deb.length >= 2 });
  // Fiches liees des resultats affiches, en un appel (retour du 05/10).
  const linkedByContact = useLinkedBrief((data ?? []).slice(0, 8).map((c) => c.id));
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t('workshop.clientPlaceholder')} className="h-9 pl-9" />
      {data && data.length > 0 && deb.length >= 2 && (
        <div className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-popover shadow-[var(--shadow-modal)]">
          {data.slice(0, 8).map((c) => (
            <div key={c.id} className="border-b border-border last:border-0">
              <button type="button" onClick={() => onPick(c)} className="block w-full px-3 pt-2 text-left text-sm hover:bg-accent">{contactDisplayName(c)}</button>
              {/* Fiche liee sous la ligne, en plus clair (retour du 05/10). */}
              <div className="px-3 pb-1.5"><LinkedLines links={linkedByContact.get(c.id)} clickable={false} /></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-1"><label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</label>{children}</div>;
}
