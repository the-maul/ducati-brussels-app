/**
 * M3 / M8 — Plan d'entretien sur la fiche moto (mission 07, carte 1).
 * La moto doit être rattachée à un modèle-année du catalogue Ducati (vehicles.ducati_model_year_id,
 * rempli par la carte 06-4 « Reconnaître la moto par son VIN »). Usage route par défaut ;
 * l'usage choisi par le client est enregistré sur la moto (vehicles.maintenance_usage).
 */
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Info } from 'lucide-react';
import { toast } from 'sonner';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { t } from '@/lib/i18n';
import { fill } from '@/modules/catalog/format';
import { getCatalogModelYear, listPlansForModelYear, loadHourlyRateHt, setVehicleMaintenanceUsage } from './maintenance-api';
import { DEFAULT_USAGE, MAINTENANCE_USAGES, planForUsage, type MaintenanceUsage } from './maintenance-plans';
import { PlanServices, UsageBadge, yearsLabel } from './maintenance-plan-view';

type VehicleLike = { id: string; ducati_model_year_id?: string | null; maintenance_usage?: string | null };

export function VehicleMaintenancePanel({ vehicle, companyId }: { vehicle: VehicleLike; companyId: string }) {
  const qc = useQueryClient();
  const myId = vehicle.ducati_model_year_id ?? null;
  const modelYear = useQuery({ queryKey: ['maintenance', 'model-year', myId], queryFn: () => getCatalogModelYear(myId!), enabled: !!myId });
  const plans = useQuery({ queryKey: ['maintenance', 'vehicle-plans', myId], queryFn: () => listPlansForModelYear(myId!), enabled: !!myId });
  const rate = useQuery({ queryKey: ['maintenance', 'rate', companyId], queryFn: () => loadHourlyRateHt(companyId), enabled: !!myId });

  const usage = (vehicle.maintenance_usage as MaintenanceUsage | null) ?? DEFAULT_USAGE;
  const save = useMutation({
    mutationFn: (u: MaintenanceUsage) => setVehicleMaintenanceUsage(vehicle.id, u),
    onSuccess: () => {
      toast.success(t('maintenance.vehUsageSaved'));
      qc.invalidateQueries({ queryKey: ['vehicle', vehicle.id] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t('maintenance.saveErr')),
  });

  if (!myId) {
    return (
      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden /> {t('maintenance.vehNoLink')}
      </p>
    );
  }
  if (plans.isLoading || modelYear.isLoading) return <Loader2 className="size-5 animate-spin text-muted-foreground" />;
  if (plans.error) return <p className="text-sm text-danger">{t('maintenance.loadErr')}</p>;

  const list = plans.data ?? [];
  const plan = planForUsage(list, usage);
  const my = modelYear.data;
  const usages = [...new Set(list.map((p) => p.usage))];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        {my && (
          <p className="text-sm">
            {fill(t('maintenance.vehModelYear'), { model: my.model, year: my.year ?? '' })}
            {my.name && <span className="ml-1 text-[12px] text-muted-foreground">{my.name}</span>}
          </p>
        )}
        <div className="w-48 space-y-1">
          <Label>{t('maintenance.vehUsage')}</Label>
          <Select value={usage} onValueChange={(v) => save.mutate(v as MaintenanceUsage)} disabled={save.isPending}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {MAINTENANCE_USAGES.map((u) => <SelectItem key={u} value={u}>{t(`maintenance.usage_${u}`)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!list.length ? (
        <p className="text-sm text-muted-foreground">{t('maintenance.vehNoPlan')}</p>
      ) : !plan ? (
        <p className="text-sm text-muted-foreground">
          {fill(t('maintenance.vehNoPlanUsage'), { usage: t(`maintenance.usage_${usage}`), list: usages.map((u) => t(`maintenance.usage_${u}`)).join(', ') })}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold">{plan.model_text}</span>
            <span className="tabular-nums text-muted-foreground">{yearsLabel(plan.year_from, plan.year_to)}</span>
            <UsageBadge usage={plan.usage} />
          </div>
          <PlanServices planId={plan.id} rate={rate.data ?? null} year={my?.year ?? null} compact />
        </>
      )}
      <Link to="/workshop/maintenance-plans" className="text-[12px] text-primary hover:underline">{t('maintenance.vehOpenPlan')}</Link>
    </div>
  );
}
