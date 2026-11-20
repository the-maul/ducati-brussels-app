/**
 * M8 — Vue « Reception atelier » (G8 semainier, 07-atelier.md §5 et §13) : une colonne par jour,
 * capacite du jour (temps prevu / capacite des compagnons) et taux d'occupation, jours feries et
 * fermetures, RDV tries par heure puis avancement, couleur du type de RDV, statut couleur + icone
 * + libelle. Double-clic = ouvrir le RDV ; (+) = nouveau RDV ce jour-la.
 */
import { Plus, FileText, Package, Ban } from 'lucide-react';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';
import {
  appointmentBlockClass, dayLoad, formatMinutes, localYmd, receptionSort,
  statusTone, type AppointmentType, type DayContext,
} from './rules';
import type { PlanningAppointment } from './api';
import type { usePlanningBase } from './planning-data';
import { contactLabel, fmtDate, fmtTime, motoLabel } from './ui-bits';
import { StatusIcon } from './status-icon';
import { OccupancyGauge } from './occupancy-gauge';
import { OrWorkBadge, useOrWorkStatusMap } from '../pointage/work-controls';
import { PlanProgressBadge, usePlanProgressMap } from '../plan-ops/plan-ops-panel';

/** Fond de la case = couleur du type de RDV (decision Q47), neutre sans couleur. */
export function typeBlockClass(types: AppointmentType[], code: string | null) {
  return appointmentBlockClass(types.find((x) => x.code === code)?.color ?? null);
}

export function ReceptionView({ base, ctx, days, appts, mechanicFilter, statusFilter, onOpen, onNew, onCreateOr, onViewOr, onParts, canParts }: {
  base: ReturnType<typeof usePlanningBase>;
  ctx: DayContext;
  days: Date[];
  appts: PlanningAppointment[];
  mechanicFilter: string | null;
  statusFilter: Set<string>;
  onOpen: (a: PlanningAppointment) => void;
  onNew: (day: Date) => void;
  onCreateOr: (a: PlanningAppointment) => void;
  onViewOr: (orId: string) => void;
  onParts: ((a: PlanningAppointment) => void) | null;
  canParts: (a: PlanningAppointment) => boolean;
}) {
  const visible = appts.filter((a) => !a.unassigned && statusFilter.has(a.status) && (!mechanicFilter || a.mechanic_id === mechanicFilter));
  // Lot A (19/11) : OR « en cours (par qui, depuis quand) » / « en pause (motif) ».
  const work = useOrWorkStatusMap(visible.map((a) => a.or_id));
  // Lot D (19/11) : avancement des operations du plan (x / y).
  const planProgress = usePlanProgressMap(visible.map((a) => a.or_id));
  const cols = days.length >= 6 ? 'lg:grid-cols-7' : days.length === 5 ? 'lg:grid-cols-5' : days.length === 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3';
  return (
    <div className={`grid grid-cols-1 gap-3 md:grid-cols-2 ${cols}`}>
      {days.map((d) => {
        const load = dayLoad(d, base.mechanics, appts, ctx, base.settings.slot_minutes, mechanicFilter);
        const rows = receptionSort(visible.filter((a) => localYmd(new Date(a.starts_at)) === localYmd(d)));
        return (
          <div key={localYmd(d)} className="rounded-md border border-border bg-card p-2">
            <div className="mb-2 flex items-start justify-between gap-1">
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{fmtDate(d)}</p>
                {load.closed ? (
                  <p className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-neutral-tag">
                    <Ban className="size-3" />
                    {load.closed.holiday ? t(`planningG8.holiday_${load.closed.holiday}`) : load.closed.label || t(`planningG8.block_${load.closed.kind}`)}
                  </p>
                ) : (
                  <>
                    <p className="mt-0.5 font-data text-[12px] tabular-nums text-muted-foreground">
                      {formatMinutes(load.planned)} / {formatMinutes(load.capacity)}
                    </p>
                    {/* Revue UX (20/11) : jauge avec icone + libelle, plus la couleur seule. */}
                    {base.settings.show_occupancy && load.pct !== null && <OccupancyGauge pct={load.pct} />}
                  </>
                )}
              </div>
              <Button size="sm" variant="ghost" className="h-7 px-1.5 pointer-coarse:h-11 pointer-coarse:min-w-11" onClick={() => onNew(d)} aria-label={t('planningG8.newRdvDay')}><Plus className="size-4" /></Button>
            </div>
            <div className="space-y-2">
              {rows.length === 0 && <p className="px-1 text-[12px] text-muted-foreground">—</p>}
              {rows.map((a) => (
                <div key={a.id} onDoubleClick={() => onOpen(a)}
                  className={`cursor-pointer rounded-md border border-border border-l-[3px] p-2 text-[12px] ${typeBlockClass(base.types, a.appointment_type)}`}>
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-data tabular-nums">{fmtTime(a.starts_at)}{a.planned_minutes ? ` · ${formatMinutes(a.planned_minutes)}` : ''}</span>
                    <StatusBadge tone={statusTone(a.status)} icon={StatusIcon(a.status)} label={t(`planningG8.status_${a.status}`)} />
                  </div>
                  {a.contacts && <p className="mt-1 truncate font-medium">{contactLabel(a.contacts)}</p>}
                  {a.vehicles && <p className="truncate text-muted-foreground">{motoLabel(a.vehicles)}</p>}
                  {a.work_description && <p className="truncate text-muted-foreground">{a.work_description}</p>}
                  {a.mechanic_name && <p className="text-muted-foreground">{a.mechanic_name}</p>}
                  {a.or_id && work.map.get(a.or_id) && <div className="mt-1"><OrWorkBadge row={work.map.get(a.or_id)} reasons={work.reasons} /></div>}
                  {a.or_id && planProgress.get(a.or_id) && <div className="mt-1"><PlanProgressBadge done={planProgress.get(a.or_id)!.done} resolved={planProgress.get(a.or_id)!.done + planProgress.get(a.or_id)!.not_done} total={planProgress.get(a.or_id)!.total} /></div>}
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    <Button size="sm" variant="ghost" className="h-7 px-2 pointer-coarse:h-11 pointer-coarse:px-3" onClick={() => onOpen(a)}>{t('action.edit')}</Button>
                    {a.or_id
                      ? <Button size="sm" variant="ghost" className="h-7 px-2 pointer-coarse:h-11 pointer-coarse:px-3" onClick={() => onViewOr(a.or_id!)}><FileText className="size-3.5" /> {t('workshop.viewOr')}</Button>
                      : a.status !== 'annule' && <Button size="sm" variant="ghost" className="h-7 px-2 pointer-coarse:h-11 pointer-coarse:px-3" onClick={() => onCreateOr(a)}>{t('planningG8.validateAndOr')}</Button>}
                    {onParts && canParts(a) && <Button size="sm" variant="ghost" className="h-7 px-2 pointer-coarse:h-11 pointer-coarse:px-3" onClick={() => onParts(a)}><Package className="size-3.5" /> {t('reservation.button')}</Button>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
