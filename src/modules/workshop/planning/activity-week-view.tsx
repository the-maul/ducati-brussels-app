/**
 * M8 — Activité atelier à la semaine (retour de Domenico, 23/11/2026) : les jours à la verticale,
 * les compagnons à l'horizontale, et le remplissage de chaque journée dans sa case.
 */
import { Ban, Plus } from 'lucide-react';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { fillVars, t } from '@/lib/i18n';
import {
  atMinutes, availableIntervals, closedDayReason, dayLoad, formatMinutes, localYmd, minutesOfDay, nextFreeStart,
  plannedOrSlot, planningMechanics, statusTone, sumLoads,
} from './rules';
import type { DayContext } from './rules';
import type { PlanningAppointment } from './api';
import type { usePlanningBase } from './planning-data';
import { LoadChip } from './occupancy-gauge';
import { typeBlockClass } from './reception-view';
import { StatusIcon } from './status-icon';
import { contactLabel, fmtDate, fmtTime, motoLabel } from './ui-bits';

export function ActivityWeekView({ base, ctx, days, appts, waitingCount, mechanicFilter, onOpen, onNew, onDay }: {
  base: ReturnType<typeof usePlanningBase>;
  ctx: DayContext;
  days: Date[];
  appts: PlanningAppointment[];
  waitingCount: number;
  mechanicFilter: string | null;
  onOpen: (a: PlanningAppointment) => void;
  onNew: (mechanicId: string, startsAt: Date) => void;
  onDay: (d: Date) => void;
}) {
  const slot = base.settings.slot_minutes;
  const mechanics = planningMechanics(base.mechanics).filter((m) => !mechanicFilter || m.id === mechanicFilter);
  const visible = appts.filter((a) => !a.unassigned && a.status !== 'annule');
  const today = localYmd(new Date());
  const load = (d: Date, mechanicId?: string | null) => dayLoad(d, base.mechanics, appts, ctx, slot, mechanicId);

  if (mechanics.length === 0) {
    return <p className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">{t('planningG8.noMechanics')}</p>;
  }

  const cell = (d: Date, mechanicId: string) => {
    const key = localYmd(d);
    const rows = visible
      .filter((a) => a.mechanic_id === mechanicId && localYmd(new Date(a.starts_at)) === key)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    const l = load(d, mechanicId);
    const free = l.capacity > 0 && !l.closed;
    const addNew = () => {
      const busy = rows.map((a) => {
        const start = minutesOfDay(new Date(a.starts_at));
        return [start, start + plannedOrSlot(a, slot)] as [number, number];
      });
      const at = nextFreeStart(availableIntervals(mechanicId, d, ctx), busy);
      if (at !== null) onNew(mechanicId, atMinutes(d, at));
    };
    return (
      <td key={mechanicId} className={`min-w-[170px] border-l border-t border-border p-1.5 align-top ${free ? 'bg-card' : 'bg-muted'}`}>
        <div className="mb-1 flex items-start gap-1">
          <div className="min-w-0 flex-1"><LoadChip load={l} /></div>
          {free && (
            <Button type="button" size="icon" variant="ghost" className="size-7 shrink-0 pointer-coarse:size-11" onClick={addNew}
              aria-label={t('planningG8.newRdvDay')} title={t('planningG8.newRdvDay')}>
              <Plus className="size-3.5" />
            </Button>
          )}
        </div>
        <div className="space-y-1">
          {rows.map((a) => (
            <button key={a.id} type="button" onClick={() => onOpen(a)}
              className={`block w-full overflow-hidden rounded-[var(--radius-badge)] border-l-[3px] px-1.5 py-1 text-left font-data text-[12px] leading-tight hover:opacity-80 ${typeBlockClass(base.types, a.appointment_type)}`}>
              <span className="flex items-center justify-between gap-1">
                <span className="font-bold tabular-nums">{fmtTime(a.starts_at)}{a.planned_minutes ? ` · ${formatMinutes(a.planned_minutes)}` : ''}</span>
                <StatusBadge tone={statusTone(a.status)} icon={StatusIcon(a.status)} label={t(`planningG8.statusShort_${a.status}`)} className="px-1 py-px text-[10px]" />
              </span>
              {a.contacts && <span className="block truncate font-bold">{contactLabel(a.contacts)}</span>}
              {a.vehicles && <span className="block truncate text-muted-foreground">{motoLabel(a.vehicles)}</span>}
            </button>
          ))}
        </div>
      </td>
    );
  };

  return (
    <div className="rounded-md border border-border bg-card">
      {waitingCount > 0 && (
        <button type="button" onClick={() => onDay(days[0])} className="block w-full border-b border-border px-3 py-2 text-left text-[12px] font-bold text-warning">
          {fillVars(t('dossier.planWaitingWeek'), { n: waitingCount })}
        </button>
      )}
      <div className="max-h-[75vh] overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-[12px]">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-30 min-w-[130px] border-b border-border bg-card px-2 py-2 text-left font-bold uppercase tracking-[0.04em]">{t('dossier.planDay')}</th>
              {mechanics.map((m) => (
                <th key={m.id} className="sticky top-0 z-20 min-w-[170px] border-b border-l border-border bg-card px-2 py-2 text-left font-normal">
                  <span className="block truncate font-bold uppercase tracking-[0.04em]">{m.name}</span>
                  <LoadChip load={sumLoads(days.map((d) => load(d, m.id)))} prefix={t('dossier.planWeek')} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map((d) => {
              const closed = closedDayReason(d, ctx);
              const isToday = localYmd(d) === today;
              return (
                <tr key={localYmd(d)}>
                  <th scope="row" className={`sticky left-0 z-10 min-w-[130px] border-t border-border px-2 py-1.5 text-left align-top font-normal ${isToday ? 'bg-accent' : 'bg-card'}`}>
                    <button type="button" onClick={() => onDay(d)} className="block font-bold uppercase tracking-[0.04em] underline-offset-2 hover:underline" title={t('dossier.planOpenDay')}>
                      {fmtDate(d)}
                    </button>
                    {closed ? (
                      <span className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Ban className="size-3" aria-hidden />
                        {closed.holiday ? t(`planningG8.holiday_${closed.holiday}`) : closed.label || t(`planningG8.block_${closed.kind}`)}
                      </span>
                    ) : <LoadChip load={load(d, mechanicFilter)} />}
                  </th>
                  {mechanics.map((m) => cell(d, m.id))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
