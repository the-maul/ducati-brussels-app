/**
 * M8 — Vue « Activite atelier » (G8, 07-atelier.md §13.2) : une colonne par compagnon, une ligne
 * par creneau (granularite des reglages, 10 min par defaut), horaires / pauses / absences /
 * fermetures grises, RDV en blocs (couleur du type, charte §5.6), ligne « maintenant », et la
 * liste d'attente a droite. Glisser-deposer : un RDV de la liste d'attente (ou deja place) se
 * depose sur un compagnon et un creneau ; refus sur un creneau indisponible ou deja pris.
 */
import { useMemo, useState, type DragEvent } from 'react';
import { toast } from 'sonner';
import { CalendarPlus, GripVertical, Inbox } from 'lucide-react';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';
import {
  availableIntervals, blockOnDay, checkDrop, closedDayReason, formatMinutes, localYmd, minutesOfDay,
  minutesToTime, plannedOrSlot, planningMechanics, slotsOfDay, snapMinutes, statusTone, timeToMinutes,
  atMinutes, type DayContext,
} from './rules';
import type { PlanningAppointment } from './api';
import type { usePlanningBase } from './planning-data';
import { contactLabel, fmtDate, fmtTime, motoLabel } from './ui-bits';
import { typeBlockClass } from './reception-view';
import { StatusIcon } from './status-icon';
import { OrWorkBadge, useOrWorkStatusMap } from '../pointage/work-controls';
import { PlanProgressBadge, usePlanProgressMap } from '../plan-ops/plan-ops-panel';

const PX_PER_MIN = 1.6;
const DRAG_MIME = 'application/x-ducati-appointment';
const NO_MECHANIC = '__none__';

type Hover = { mechanicId: string; minutes: number; ok: boolean } | null;

export function ActivityView({ base, ctx, day, appts, waiting, onOpen, onAssign, onNew, onNewWaiting }: {
  base: ReturnType<typeof usePlanningBase>;
  ctx: DayContext;
  day: Date;
  appts: PlanningAppointment[];
  waiting: PlanningAppointment[];
  onOpen: (a: PlanningAppointment) => void;
  onAssign: (a: PlanningAppointment, mechanicId: string, startsAt: Date) => void;
  onNew: (mechanicId: string, startsAt: Date) => void;
  onNewWaiting: () => void;
}) {
  const s = base.settings;
  const dayStart = timeToMinutes(s.day_start) ?? 540;
  const dayEnd = timeToMinutes(s.day_end) ?? 1080;
  const slots = slotsOfDay(s.day_start, s.day_end, s.slot_minutes);
  const height = (dayEnd - dayStart) * PX_PER_MIN;
  const mechanics = planningMechanics(base.mechanics);
  const [hover, setHover] = useState<Hover>(null);
  const key = localYmd(day);
  const closed = closedDayReason(day, ctx);

  const ofDay = useMemo(() => appts.filter((a) => !a.unassigned && a.status !== 'annule' && localYmd(new Date(a.starts_at)) === key), [appts, key]);
  const orphans = ofDay.filter((a) => !a.mechanic_id || !mechanics.some((m) => m.id === a.mechanic_id));
  const all = useMemo(() => [...appts, ...waiting], [appts, waiting]);
  const labelEvery = s.slot_minutes >= 30 ? s.slot_minutes : 60;
  // Lot A (19/11) : sur la case, l'OR « en cours (par qui, depuis quand) » ou « en pause (motif) ».
  const work = useOrWorkStatusMap(ofDay.map((a) => a.or_id));
  // Lot D (19/11) : avancement des operations du plan (x / y).
  const planProgress = usePlanProgressMap(ofDay.map((a) => a.or_id));

  const minutesAt = (e: DragEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const raw = dayStart + (e.clientY - rect.top) / PX_PER_MIN;
    return Math.min(Math.max(snapMinutes(raw, s.slot_minutes), dayStart), dayEnd - s.slot_minutes);
  };
  const dragged = (e: DragEvent) => all.find((x) => x.id === e.dataTransfer.getData(DRAG_MIME)) ?? null;
  const check = (a: PlanningAppointment | null, mechanicId: string, minutes: number) => checkDrop({
    mechanicId, day, startMinutes: minutes, minutes: a?.planned_minutes ?? null, ctx, appts,
    slotMinutes: s.slot_minutes, blockOverlaps: s.block_overlaps, appointmentId: a?.id,
  });

  const onDragOver = (mechanicId: string) => (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const m = minutesAt(e);
    // L'id n'est lisible qu'au depot : pendant le survol on controle la seule disponibilite du creneau.
    const ok = check(null, mechanicId, m).ok;
    if (!hover || hover.mechanicId !== mechanicId || hover.minutes !== m || hover.ok !== ok) setHover({ mechanicId, minutes: m, ok });
  };
  const onDrop = (mechanicId: string) => (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setHover(null);
    const a = dragged(e);
    if (!a) return;
    const m = minutesAt(e);
    const res = check(a, mechanicId, m);
    if (!res.ok) { toast.error(t(`planningG8.drop_${res.reason}`)); return; }
    onAssign(a, mechanicId, atMinutes(day, m));
  };
  const startDrag = (a: PlanningAppointment) => (e: DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData(DRAG_MIME, a.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const now = new Date();
  const nowLine = localYmd(now) === key ? (minutesOfDay(now) - dayStart) * PX_PER_MIN : null;

  const block = (a: PlanningAppointment, mechanicId: string) => {
    const top = (minutesOfDay(new Date(a.starts_at)) - dayStart) * PX_PER_MIN;
    const h = Math.max(plannedOrSlot(a, s.slot_minutes) * PX_PER_MIN, 18);
    return (
      <div key={`${mechanicId}-${a.id}`} draggable={!a.or_id} onDragStart={startDrag(a)} onDragEnd={() => setHover(null)} onDoubleClick={() => onOpen(a)}
        title={t('planningG8.dragHint')}
        style={{ top, height: h }}
        className={`absolute inset-x-1 z-10 cursor-grab overflow-hidden rounded-[var(--radius-badge)] border-l-[3px] px-1.5 py-0.5 font-data text-[12px] leading-tight active:cursor-grabbing active:opacity-50 ${typeBlockClass(base.types, a.appointment_type)}`}>
        <div className="flex items-start justify-between gap-1">
          <span className="font-bold tabular-nums">{fmtTime(a.starts_at)}{a.planned_minutes ? ` · ${formatMinutes(a.planned_minutes)}` : ''}</span>
          {/* Statut en petit badge sur la case (decision Q47) : couleur de statut + icone + libelle. */}
          <StatusBadge tone={statusTone(a.status)} icon={StatusIcon(a.status)} label={t(`planningG8.statusShort_${a.status}`)} className="px-1 py-px text-[10px]" />
        </div>
        {a.or_id && work.map.get(a.or_id) && <div className="mt-0.5"><OrWorkBadge row={work.map.get(a.or_id)} reasons={work.reasons} compact /></div>}
        {a.or_id && planProgress.get(a.or_id) && <div className="mt-0.5"><PlanProgressBadge done={planProgress.get(a.or_id)!.done} resolved={planProgress.get(a.or_id)!.done + planProgress.get(a.or_id)!.not_done} total={planProgress.get(a.or_id)!.total} compact /></div>}
        {a.contacts && <p className="truncate font-bold">{contactLabel(a.contacts)}</p>}
        {a.vehicles && <p className="truncate text-muted-foreground">{motoLabel(a.vehicles)}</p>}
        {a.work_description && <p className="truncate text-muted-foreground">{a.work_description}</p>}
      </div>
    );
  };

  const column = (mechanicId: string, name: string, rows: PlanningAppointment[], droppable: boolean) => {
    const free = droppable ? availableIntervals(mechanicId, day, ctx) : [];
    const blocks = ctx.blocks.filter((b) => !b.mechanic_id || b.mechanic_id === mechanicId)
      .map((b) => ({ b, iv: blockOnDay(b, day) })).filter((x) => x.iv) as { b: (typeof ctx.blocks)[number]; iv: [number, number] }[];
    return (
      <div key={mechanicId} className="min-w-[150px] flex-1 border-l border-border">
        <div className="sticky top-0 z-20 h-8 truncate border-b border-border bg-card px-2 py-1.5 text-[12px] font-bold uppercase tracking-[0.04em]">{name}</div>
        <div className="relative bg-muted" style={{ height }}
          onDragOver={droppable ? onDragOver(mechanicId) : undefined} onDragLeave={() => setHover(null)} onDrop={droppable ? onDrop(mechanicId) : undefined}
          onDoubleClick={droppable ? (e) => {
            if (e.target !== e.currentTarget && !(e.target as HTMLElement).dataset.free) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const m = snapMinutes(dayStart + (e.clientY - rect.top) / PX_PER_MIN, s.slot_minutes);
            onNew(mechanicId, atMinutes(day, m));
          } : undefined}>
          {free.map(([a, b]) => (
            <div key={`${a}-${b}`} data-free="1" className="absolute inset-x-0 bg-card" style={{ top: (Math.max(a, dayStart) - dayStart) * PX_PER_MIN, height: (Math.min(b, dayEnd) - Math.max(a, dayStart)) * PX_PER_MIN }} />
          ))}
          {slots.map((m) => <div key={m} className={`pointer-events-none absolute inset-x-0 border-t ${m % 60 === 0 ? 'border-border' : 'border-border/40'}`} style={{ top: (m - dayStart) * PX_PER_MIN }} />)}
          {blocks.map(({ b, iv }) => {
            const a = Math.max(iv[0], dayStart); const z = Math.min(iv[1], dayEnd);
            if (z <= a) return null;
            return (
              <div key={`${b.id ?? b.starts_at}-${mechanicId}`} className="pointer-events-none absolute inset-x-0 overflow-hidden px-1 text-[11px] text-neutral-tag" style={{ top: (a - dayStart) * PX_PER_MIN, height: (z - a) * PX_PER_MIN }}>
                {b.label || t(`planningG8.block_${b.kind}`)}
              </div>
            );
          })}
          {hover && hover.mechanicId === mechanicId && (
            <div className={`pointer-events-none absolute inset-x-0 z-30 border-2 ${hover.ok ? 'border-info' : 'border-danger'}`} style={{ top: (hover.minutes - dayStart) * PX_PER_MIN, height: s.slot_minutes * PX_PER_MIN }} />
          )}
          {nowLine !== null && nowLine >= 0 && nowLine <= height && <div className="pointer-events-none absolute inset-x-0 z-30 h-0.5 bg-[var(--ducati-red)]" style={{ top: nowLine }} />}
          {rows.map((a) => block(a, mechanicId))}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-3 xl:flex-row">
      <div className="min-w-0 flex-1 rounded-md border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <p className="text-[12px] font-bold uppercase tracking-[0.04em]">{fmtDate(day)}</p>
          {closed && <StatusBadge tone="neutral" label={closed.holiday ? t(`planningG8.holiday_${closed.holiday}`) : closed.label || t(`planningG8.block_${closed.kind}`)} />}
        </div>
        {mechanics.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{t('planningG8.noMechanics')}</p>
        ) : (
          <div className="flex max-h-[75vh] overflow-auto">
            <div className="w-14 shrink-0">
              <div className="sticky top-0 z-20 h-8 border-b border-border bg-card" />
              <div className="relative" style={{ height }}>
                {slots.filter((m) => (m - dayStart) % labelEvery === 0).map((m) => (
                  <span key={m} className="absolute right-1 -translate-y-1/2 font-data text-[11px] tabular-nums text-muted-foreground" style={{ top: (m - dayStart) * PX_PER_MIN }}>{minutesToTime(m)}</span>
                ))}
              </div>
            </div>
            {mechanics.map((m) => column(m.id, m.name, ofDay.filter((a) => a.mechanic_id === m.id), true))}
            {orphans.length > 0 && column(NO_MECHANIC, t('planningG8.noMechanicColumn'), orphans, false)}
          </div>
        )}
      </div>

      <aside className="w-full shrink-0 rounded-md border border-border bg-card xl:w-72">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <p className="flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-[0.04em]"><Inbox className="size-4" /> {t('planningG8.waitingList')} ({waiting.length})</p>
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={onNewWaiting}><CalendarPlus className="size-3.5" /> {t('planningG8.newWaiting')}</Button>
        </div>
        <p className="px-3 pt-2 text-[11px] text-muted-foreground">{t('planningG8.waitingHint')}</p>
        <div className="max-h-[70vh] space-y-2 overflow-auto p-2">
          {waiting.length === 0 && <p className="px-1 text-[12px] text-muted-foreground">{t('planningG8.waitingEmpty')}</p>}
          {waiting.map((a) => (
            <div key={a.id} draggable onDragStart={startDrag(a)} onDragEnd={() => setHover(null)} onDoubleClick={() => onOpen(a)}
              className={`flex cursor-grab gap-1.5 rounded-md border border-border border-l-[3px] p-2 text-[12px] active:cursor-grabbing active:opacity-50 ${typeBlockClass(base.types, a.appointment_type)}`}>
              <GripVertical className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1">
                  <span className="font-data tabular-nums text-muted-foreground">{fmtDate(a.starts_at)}</span>
                  <StatusBadge tone={statusTone(a.status)} icon={StatusIcon(a.status)} label={t(`planningG8.status_${a.status}`)} />
                </div>
                {a.contacts && <p className="truncate font-medium">{contactLabel(a.contacts)}</p>}
                {a.vehicles && <p className="truncate text-muted-foreground">{motoLabel(a.vehicles)}</p>}
                {a.work_description && <p className="truncate text-muted-foreground">{a.work_description}</p>}
                <p className="font-data tabular-nums text-muted-foreground">{t('planningG8.plannedTime')} : {a.planned_minutes ? formatMinutes(a.planned_minutes) : '—'}</p>
              </div>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
