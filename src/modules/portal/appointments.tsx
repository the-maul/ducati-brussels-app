/**
 * « Mes rendez-vous » + « Demander un rendez-vous atelier » (décision P-2).
 * La demande arrive dans le planning atelier (workshop_appointments) avec le statut
 * « demande » à la date souhaitée (9 h le matin, 14 h l'après-midi) : l'atelier la
 * confirme en la passant à « prévu », ou l'annule. Aucun rappel n'est envoyé tant
 * qu'elle n'est pas confirmée (le rappel automatique ne vise que « prévu »).
 */
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, CalendarPlus, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useConfirm } from '@/components/confirm-provider';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import {
  cancelAppointmentRequest, listAppointments, listVehicles, requestAppointment, type AppointmentSlot,
} from './api';
import { AppointmentStatus, Card, EmptyState, ErrorBox, Loading, PortalPage, SectionTitle, dateLongFr, timeFr, vehicleName } from './ui';

const REASONS = ['entretien', 'pneus', 'reparation', 'garantie', 'diagnostic', 'accessoires', 'autre'] as const;
const NO_VEHICLE = 'none';

function isoDay(offsetDays: number) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function AppointmentsView({ openForm, vehicleId }: { openForm?: boolean; vehicleId?: string }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [showForm, setShowForm] = useState(!!openForm);
  const { data, isLoading, error } = useQuery({ queryKey: ['portal', 'appointments'], queryFn: listAppointments });

  const cancel = useMutation({
    mutationFn: cancelAppointmentRequest,
    meta: { success: t('portal.appointments.cancelled') },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal', 'appointments'] });
      qc.invalidateQueries({ queryKey: ['portal', 'home'] });
    },
  });

  const now = Date.now();
  const upcoming = (data ?? []).filter((a) => new Date(a.starts_at).getTime() >= now - 12 * 3600_000 && a.status !== 'annule' && a.status !== 'termine')
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const past = (data ?? []).filter((a) => !upcoming.includes(a));

  return (
    <PortalPage
      title={t('portal.appointments.title')}
      subtitle={t('portal.appointments.subtitle')}
      actions={!showForm && (
        <Button onClick={() => setShowForm(true)}><CalendarPlus /> <span className="hidden sm:inline">{t('portal.appointments.request')}</span></Button>
      )}
    >
      {showForm && (
        <RequestForm
          defaultVehicleId={vehicleId}
          onClose={() => setShowForm(false)}
          onDone={() => {
            setShowForm(false);
            qc.invalidateQueries({ queryKey: ['portal', 'appointments'] });
            qc.invalidateQueries({ queryKey: ['portal', 'home'] });
          }}
        />
      )}

      {isLoading && <Loading />}
      {error && <ErrorBox error={error} />}
      {data && data.length === 0 && !showForm && (
        <EmptyState icon={<CalendarClock className="size-8" />} text={t('portal.appointments.empty')}
          action={<Button onClick={() => setShowForm(true)}><CalendarPlus /> {t('portal.appointments.request')}</Button>} />
      )}

      {upcoming.length > 0 && (
        <Card>
          <SectionTitle>{t('portal.appointments.upcoming')}</SectionTitle>
          <ul className="divide-y divide-border">
            {upcoming.map((a) => (
              <li key={a.id} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[15px] font-medium first-letter:uppercase">{dateLongFr(a.starts_at)}</p>
                    <p className="text-[13px] text-muted-foreground">
                      {a.status === 'demande'
                        ? `${t(`portal.slots.${a.requested_slot ?? 'matin'}`)} · ${t('portal.appointments.awaitingConfirmation')}`
                        : timeFr(a.starts_at)}
                      {a.vehicle_label ? ` · ${a.vehicle_label}` : ''}
                    </p>
                    {a.work_description && <p className="mt-1 whitespace-pre-line text-[13px]">{a.work_description}</p>}
                  </div>
                  <AppointmentStatus status={a.status} />
                </div>
                {a.status === 'demande' && (
                  <Button variant="ghost" size="sm" className="mt-1 px-0 text-muted-foreground" disabled={cancel.isPending}
                    onClick={async () => {
                      if (await confirm({ title: t('portal.appointments.cancelConfirmTitle'), message: t('portal.appointments.cancelConfirmText'), confirmLabel: t('portal.appointments.cancelRequest'), cancelLabel: t('portal.common.keep') })) {
                        cancel.mutate(a.id);
                      }
                    }}>
                    <X className="size-4" /> {t('portal.appointments.cancelRequest')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {past.length > 0 && (
        <Card>
          <SectionTitle>{t('portal.appointments.past')}</SectionTitle>
          <ul className="divide-y divide-border">
            {past.map((a) => (
              <li key={a.id} className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-[14px] first-letter:uppercase">{dateLongFr(a.starts_at)}</p>
                  <p className="truncate text-[12px] text-muted-foreground">
                    {[a.vehicle_label, a.work_description].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <AppointmentStatus status={a.status} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </PortalPage>
  );
}

function RequestForm({ defaultVehicleId, onClose, onDone }: {
  defaultVehicleId?: string; onClose: () => void; onDone: () => void;
}) {
  const vehicles = useQuery({ queryKey: ['portal', 'vehicles'], queryFn: listVehicles });
  const [vehicle, setVehicle] = useState<string>(defaultVehicleId ?? '');
  const [reason, setReason] = useState<string>('entretien');
  const [details, setDetails] = useState('');
  const [date, setDate] = useState(isoDay(3));
  const [slot, setSlot] = useState<AppointmentSlot>('matin');
  const [formError, setFormError] = useState<string | null>(null);

  const list = vehicles.data ?? [];
  const selectedVehicle = vehicle || (list.length === 1 ? list[0].id : '');

  const send = useMutation({
    mutationFn: () => requestAppointment({
      vehicleId: selectedVehicle && selectedVehicle !== NO_VEHICLE ? selectedVehicle : null,
      reason: [t(`portal.reasons.${reason}`), details.trim()].filter(Boolean).join(' : '),
      date,
      slot,
    }),
    meta: { success: t('portal.appointments.sent') },
    onSuccess: onDone,
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!date || date <= isoDay(0)) { setFormError(t('portal.errors.invalidDate')); return; }
    if (reason === 'autre' && details.trim().length < 3) { setFormError(t('portal.errors.reasonRequired')); return; }
    send.mutate();
  };

  return (
    <Card>
      <form onSubmit={submit} className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[17px] font-bold">{t('portal.appointments.formTitle')}</h2>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label={t('portal.common.close')}><X className="size-4" /></Button>
        </div>
        <p className="text-[13px] text-muted-foreground">{t('portal.appointments.formLead')}</p>

        <div className="space-y-1.5">
          <Label htmlFor="appt-vehicle">{t('portal.appointments.vehicle')}</Label>
          <Select value={selectedVehicle || undefined} onValueChange={setVehicle}>
            <SelectTrigger id="appt-vehicle" className="h-11"><SelectValue placeholder={t('portal.appointments.chooseVehicle')} /></SelectTrigger>
            <SelectContent>
              {list.map((v) => <SelectItem key={v.id} value={v.id}>{vehicleName(v)}{v.plate ? ` · ${v.plate}` : ''}</SelectItem>)}
              <SelectItem value={NO_VEHICLE}>{t('portal.appointments.otherVehicle')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>{t('portal.appointments.reason')}</Label>
          <div className="flex flex-wrap gap-2">
            {REASONS.map((r) => (
              <button key={r} type="button" onClick={() => setReason(r)} aria-pressed={reason === r}
                className={cn('rounded-md border px-3 py-2 text-[13px]',
                  reason === r ? 'border-foreground bg-foreground text-background' : 'border-border bg-card text-foreground')}>
                {t(`portal.reasons.${r}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="appt-details">{t('portal.appointments.details')}</Label>
          <Textarea id="appt-details" rows={3} maxLength={900} value={details} onChange={(e) => setDetails(e.target.value)}
            placeholder={t('portal.appointments.detailsPlaceholder')} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="appt-date">{t('portal.appointments.date')}</Label>
            <Input id="appt-date" type="date" className="h-11" min={isoDay(1)} max={isoDay(180)} value={date} onChange={(e) => setDate(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label>{t('portal.appointments.slot')}</Label>
            <div className="grid grid-cols-2 gap-2">
              {(['matin', 'apres_midi'] as AppointmentSlot[]).map((s) => (
                <button key={s} type="button" onClick={() => setSlot(s)} aria-pressed={slot === s}
                  className={cn('h-11 rounded-md border text-[14px]',
                    slot === s ? 'border-foreground bg-foreground text-background' : 'border-border bg-card')}>
                  {t(`portal.slots.${s}`)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {formError && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger" role="alert">{formError}</p>}

        <Button type="submit" className="h-11 w-full" disabled={send.isPending}>
          {send.isPending ? <Loader2 className="animate-spin" /> : <CalendarPlus />} {t('portal.appointments.send')}
        </Button>
        <p className="text-[12px] text-muted-foreground">{t('portal.appointments.formFootnote')}</p>
      </form>
    </Card>
  );
}
