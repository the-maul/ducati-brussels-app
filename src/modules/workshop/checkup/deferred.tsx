/**
 * M8 — Interventions reportées (décochées par le client à la signature de la proposition).
 *   - `DeferredDateDialog` : étape du comptoir à la facturation / remise des clés — liste des
 *     interventions à planifier pour la moto, date proposée (+30 j, modifiable) ou « pas maintenant » ;
 *   - `DeferredPanel` : encadré « Interventions reportées » des fiches moto et client (statut =
 *     couleur + icône + libellé, date, actions).
 * Table `deferred_interventions` (migration 20261031110000), lue aussi par l'agent « relances ».
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarClock, CalendarCheck, CheckCircle2, Clock, Loader2, XCircle, Bell, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBadge, type StatusTone } from '@/components/status-badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { t } from '@/lib/i18n';
import { listDeferredInterventions, planDeferredInterventions, setDeferredStatus, type DeferredIntervention, type DeferredStatus } from './api';
import { defaultPlannedDate } from './rules';

const eur = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`;
const dateFr = (d: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('fr-BE') : '—');

const STATUS_STYLE: Record<DeferredStatus, { tone: StatusTone; icon: LucideIcon }> = {
  a_planifier: { tone: 'warning', icon: Clock },
  planifie: { tone: 'info', icon: CalendarCheck },
  relance: { tone: 'info', icon: Bell },
  fait: { tone: 'success', icon: CheckCircle2 },
  abandonne: { tone: 'neutral', icon: XCircle },
};

export function DeferredStatusBadge({ status }: { status: DeferredStatus }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.a_planifier;
  return <StatusBadge tone={s.tone} icon={s.icon} label={t(`checkup.deferred_${status}`)} />;
}

/**
 * Étape « Date pour les interventions reportées » avant la facture. `onDone` est appelé dans tous
 * les cas (date fixée ou « pas maintenant ») pour que la facturation continue.
 */
export function DeferredDateDialog({ items, onDone, onCancel }: {
  items: DeferredIntervention[]; onDone: () => void; onCancel: () => void;
}) {
  const [date, setDate] = useState(defaultPlannedDate());
  const [selected, setSelected] = useState<Set<string>>(() => new Set(items.map((i) => i.id)));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const total = items.filter((i) => selected.has(i.id)).reduce((s, i) => s + i.amount_ttc, 0);
  const m = useMutation({
    mutationFn: () => planDeferredInterventions([...selected], date),
    onSuccess: () => { toast.success(t('checkup.deferredPlanned').replace('{date}', dateFr(date))); onDone(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : t('workshop.errSave')),
  });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('checkup.deferredStepTitle')}</DialogTitle>
          <DialogDescription>{t('checkup.deferredStepIntro')}</DialogDescription>
        </DialogHeader>
        <ul className="divide-y divide-border rounded-md border border-border">
          {items.map((i) => (
            <li key={i.id} className="flex items-center gap-3 px-3 py-2">
              <input type="checkbox" checked={selected.has(i.id)} onChange={() => toggle(i.id)} className="size-5 accent-[var(--ducati-red)]" aria-label={i.label} />
              <span className="min-w-0 flex-1 text-[14px]">{i.label}</span>
              <span className="font-data text-[14px] tabular-nums">{eur(i.amount_ttc)}</span>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="deferred-date">{t('checkup.deferredDate')}</Label>
            <Input id="deferred-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-11 w-48" />
            <p className="text-[12px] text-muted-foreground">{t('checkup.deferredDateHint')}</p>
          </div>
          <p className="ml-auto font-data text-[15px] tabular-nums">{t('checkup.deferredTotal')} <b>{eur(total)}</b></p>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="h-11" onClick={onDone}>{t('checkup.deferredNotNow')}</Button>
          <Button className="h-11" onClick={() => m.mutate()} disabled={m.isPending || selected.size === 0 || !date}>
            {m.isPending ? <Loader2 className="animate-spin" /> : <CalendarCheck />} {t('checkup.deferredConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Encadré des interventions reportées d'une moto ou d'un client. */
export function DeferredPanel({ vehicleId, contactId }: { vehicleId?: string; contactId?: string }) {
  const qc = useQueryClient();
  const key = ['deferred-interventions', vehicleId ?? '', contactId ?? ''];
  const q = useQuery({ queryKey: key, queryFn: () => listDeferredInterventions({ vehicleId, contactId }), enabled: !!(vehicleId || contactId) });
  const [editing, setEditing] = useState<string | null>(null);
  const [date, setDate] = useState(defaultPlannedDate());
  const refresh = () => qc.invalidateQueries({ queryKey: ['deferred-interventions'] });
  const plan = useMutation({
    mutationFn: (id: string) => planDeferredInterventions([id], date),
    onSuccess: () => { setEditing(null); refresh(); toast.success(t('checkup.deferredPlanned').replace('{date}', dateFr(date))); },
    onError: (e) => toast.error(e instanceof Error ? e.message : t('workshop.errSave')),
  });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: DeferredStatus }) => setDeferredStatus(id, status),
    onSuccess: refresh,
    onError: (e) => toast.error(e instanceof Error ? e.message : t('workshop.errSave')),
  });
  const rows = q.data ?? [];

  return (
    <div className="rounded-md border border-border bg-card p-4 shadow-[var(--shadow-card)]">
      <h2 className="mb-2 flex items-center gap-2 font-ui text-[15px] font-bold"><CalendarClock className="size-4 text-muted-foreground" aria-hidden /> {t('checkup.deferredTitle')}</h2>
      {q.isLoading ? <Loader2 className="size-5 animate-spin text-muted-foreground" /> : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('checkup.deferredEmpty')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2 py-2">
              <DeferredStatusBadge status={d.status} />
              <span className="min-w-0 flex-1 text-[14px]">{d.label}</span>
              <span className="font-data text-[13px] tabular-nums">{eur(d.amount_ttc)}</span>
              <span className="font-data text-[13px] tabular-nums text-muted-foreground">{d.planned_date ? dateFr(d.planned_date) : t('checkup.deferredNoDate')}</span>
              {editing === d.id ? (
                <span className="flex items-center gap-1">
                  <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9 w-40" aria-label={t('checkup.deferredDate')} />
                  <Button size="sm" onClick={() => plan.mutate(d.id)} disabled={plan.isPending}>{t('checkup.deferredConfirm')}</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>{t('action.cancel')}</Button>
                </span>
              ) : (d.status === 'a_planifier' || d.status === 'planifie' || d.status === 'relance') && (
                <span className="flex items-center gap-1">
                  <Button size="sm" variant="outline" onClick={() => { setDate(d.planned_date ?? defaultPlannedDate()); setEditing(d.id); }}><CalendarCheck className="size-4" /> {t('checkup.deferredSetDate')}</Button>
                  <Button size="sm" variant="ghost" onClick={() => setStatus.mutate({ id: d.id, status: 'fait' })} title={t('checkup.deferred_fait')}><CheckCircle2 className="size-4 text-success" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => { if (window.confirm(t('checkup.deferredAbandonConfirm'))) setStatus.mutate({ id: d.id, status: 'abandonne' }); }} title={t('checkup.deferred_abandonne')}><XCircle className="size-4 text-muted-foreground" /></Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
