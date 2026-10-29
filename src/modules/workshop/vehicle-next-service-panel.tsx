/**
 * M3 / M8 — Encadré « Prochain entretien » de la fiche moto (mission 07, cartes 4 et 5).
 * « Annuel — avant le 14/05/2026 (dépassé de 169 j) — source : extract DCS du 30/10 »,
 * bouton « Recalculer », et ce que le client a déclaré (km actuel, dernier entretien : date, km,
 * chez nous / ailleurs), modifiable par l'équipe pour lui. Chaque enregistrement relance le calcul.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, CheckCircle2, Info, Loader2, RefreshCw, Save } from 'lucide-react';
import { toast } from 'sonner';
import { StatusBadge, type StatusTone } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { t } from '@/lib/i18n';
import { fill } from '@/modules/catalog/format';
import { getVehicleDue, isMissingSchema, recomputeVehicleDue, saveServiceDeclaration, type MaintenanceDue } from './maintenance-due-api';
import { dueStatus } from './maintenance-due';
import { fmtKm } from './maintenance-plans';

type VehicleLike = { id: string; mileage?: number | null } & Record<string, unknown>;

export const fmtDateFr = (d: string | null | undefined) =>
  d ? new Date(d.length === 10 ? `${d}T00:00:00` : d).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';

const todayIso = () => new Date().toISOString().slice(0, 10);

/** Ligne lisible d'une échéance + badge d'état (couleur + icône + libellé, charte §5.4). */
export function DueSummary({ due, km }: { due: MaintenanceDue; km: number | null }) {
  const st = dueStatus({ dueDate: due.due_date, dueKm: due.due_km }, { date: todayIso(), km });
  let tone: StatusTone = 'success'; let Icon = CheckCircle2; let label = '';
  if (st.reached) {
    tone = 'danger'; Icon = AlertTriangle;
    label = st.reachedBy === 'km' ? t('maintenance.dueKmReached') : fill(t('maintenance.dueOverdue'), { n: String(-(st.daysLeft ?? 0)) });
  } else if (st.daysLeft != null) {
    tone = st.daysLeft <= 30 ? 'warning' : 'success'; Icon = CalendarClock;
    label = fill(t('maintenance.dueIn'), { n: String(st.daysLeft) });
  }
  const main = due.due_date
    ? fill(t('maintenance.dueLine'), { kind: t(`maintenance.kind_${due.kind}`), date: fmtDateFr(due.due_date) })
    : fill(t('maintenance.dueLineKm'), { kind: t(`maintenance.kind_${due.kind}`), km: fmtKm(due.due_km) });
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[15px] font-semibold">{main}</span>
        {label && <StatusBadge tone={tone} icon={Icon} label={label} />}
        {due.due_date && due.due_km != null && (
          <span className="text-sm tabular-nums text-muted-foreground">
            {fill(t('maintenance.dueOrKm'), { km: fmtKm(due.due_km) })}
            {st.kmLeft != null && st.kmLeft > 0 && <> ({fill(t('maintenance.dueKmLeft'), { km: fmtKm(st.kmLeft) })})</>}
          </span>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        {fill(t('maintenance.dueSource'), { source: t(`maintenance.src_${due.source}`) })}
        {due.source_ref && <> — {due.source_ref}</>}
      </p>
      {due.last_service_at && (
        <p className="text-sm text-muted-foreground">
          {fill(t('maintenance.dueLastService'), { date: fmtDateFr(due.last_service_at), km: due.last_service_km != null ? ` · ${fmtKm(due.last_service_km)}` : '' })}
        </p>
      )}
      <p className="text-[12px] text-muted-foreground">{fill(t('maintenance.dueComputedAt'), { date: fmtDateFr(due.computed_at) })}</p>
    </div>
  );
}

const num = (v: unknown): number | null => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown): string => (v == null ? '' : String(v));

export function VehicleNextServicePanel({ vehicle, companyId }: { vehicle: VehicleLike; companyId: string }) {
  const qc = useQueryClient();
  const due = useQuery({ queryKey: ['maintenance', 'due', vehicle.id], queryFn: () => getVehicleDue(vehicle.id), retry: false });

  const [km, setKm] = useState(str(vehicle.declared_km));
  const [lastAt, setLastAt] = useState(str(vehicle.last_service_at).slice(0, 10));
  const [lastKm, setLastKm] = useState(str(vehicle.last_service_km));
  const [where, setWhere] = useState<string>(str(vehicle.last_service_where) || 'unknown');
  useEffect(() => {
    setKm(str(vehicle.declared_km)); setLastAt(str(vehicle.last_service_at).slice(0, 10));
    setLastKm(str(vehicle.last_service_km)); setWhere(str(vehicle.last_service_where) || 'unknown');
  }, [vehicle.id, vehicle.declared_km, vehicle.last_service_at, vehicle.last_service_km, vehicle.last_service_where]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['maintenance', 'due', vehicle.id] });
    qc.invalidateQueries({ queryKey: ['vehicle', vehicle.id] });
  };
  const recompute = useMutation({
    mutationFn: () => recomputeVehicleDue(companyId, vehicle.id),
    onSuccess: () => { toast.success(t('maintenance.recomputed')); refresh(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : t('maintenance.saveErr')),
  });
  const save = useMutation({
    mutationFn: () => saveServiceDeclaration(companyId, vehicle.id, {
      declared_km: num(km), last_service_at: lastAt || null, last_service_km: num(lastKm),
      last_service_where: where === 'ici' || where === 'ailleurs' ? where : null,
    }),
    onSuccess: () => { toast.success(t('serviceDecl.saved')); refresh(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : t('maintenance.saveErr')),
  });

  const invalidKm = (km !== '' && (num(km) == null || Number(km) < 0)) || (lastKm !== '' && (num(lastKm) == null || Number(lastKm) < 0));
  const invalidDate = !!lastAt && lastAt > todayIso();
  const dirty = km !== str(vehicle.declared_km) || lastAt !== str(vehicle.last_service_at).slice(0, 10)
    || lastKm !== str(vehicle.last_service_km) || where !== (str(vehicle.last_service_where) || 'unknown');

  const currentKm = Math.max(num(vehicle.declared_km) ?? 0, vehicle.mileage ?? 0) || null;

  return (
    <div className="space-y-4">
      {due.isLoading ? <Loader2 className="size-5 animate-spin text-muted-foreground" />
        : due.error ? (
          <p className="flex items-start gap-2 text-sm text-warning">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {isMissingSchema(due.error) ? t('maintenance.dueMigrationMissing') : t('maintenance.loadErr')}
          </p>
        ) : due.data ? <DueSummary due={due.data} km={currentKm} />
        : (
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden /> {t('maintenance.dueNone')}
          </p>
        )}
      <div>
        <Button variant="outline" size="sm" onClick={() => recompute.mutate()} disabled={recompute.isPending || !!due.error}>
          {recompute.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />} {t('maintenance.recompute')}
        </Button>
      </div>

      <div className="rounded-md border border-border bg-muted/30 p-3">
        <p className="mb-2 text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('maintenance.clientFields')}</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <Label htmlFor="ns-km">{t('serviceDecl.km')}</Label>
            <Input id="ns-km" type="number" inputMode="numeric" min={0} value={km} onChange={(e) => setKm(e.target.value)} className="tabular-nums" />
            {vehicle.declared_km_at ? <p className="text-[11px] text-muted-foreground">{fill(t('maintenance.declaredKmAt'), { date: fmtDateFr(str(vehicle.declared_km_at)) })}</p> : null}
          </div>
          <div className="space-y-1">
            <Label htmlFor="ns-last">{t('serviceDecl.lastDate')}</Label>
            <Input id="ns-last" type="date" max={todayIso()} value={lastAt} onChange={(e) => setLastAt(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ns-lastkm">{t('serviceDecl.lastKm')}</Label>
            <Input id="ns-lastkm" type="number" inputMode="numeric" min={0} value={lastKm} onChange={(e) => setLastKm(e.target.value)} className="tabular-nums" />
          </div>
          <div className="space-y-1">
            <Label>{t('serviceDecl.where')}</Label>
            <Select value={where} onValueChange={setWhere}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="unknown">{t('serviceDecl.where_unknown')}</SelectItem>
                <SelectItem value="ici">{t('serviceDecl.where_ici')}</SelectItem>
                <SelectItem value="ailleurs">{t('serviceDecl.where_ailleurs')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {invalidKm && <p className="mt-2 text-[13px] text-danger">{t('serviceDecl.errKm')}</p>}
        {invalidDate && <p className="mt-2 text-[13px] text-danger">{t('serviceDecl.errDate')}</p>}
        <div className="mt-3 flex justify-end">
          <Button size="sm" onClick={() => save.mutate()} disabled={!dirty || invalidKm || invalidDate || save.isPending}>
            {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} {t('serviceDecl.save')}
          </Button>
        </div>
      </div>
    </div>
  );
}
