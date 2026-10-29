/**
 * Espace client — « Mes motos » : carte « Prochain entretien » (mission 07, cartes 4 et 5).
 * Le client voit la date calculée (annuel, vidange, premier entretien) et son état (dépassé,
 * bientôt, à venir) ; il renseigne son kilométrage actuel et son dernier entretien (date, km,
 * chez nous / ailleurs), ce qui met la fiche à jour et relance le calcul. Jamais de source
 * technique affichée au client : seulement la date et un bouton « Prendre rendez-vous ».
 */
import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, CheckCircle2, Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { StatusBadge, type StatusTone } from '@/components/status-badge';
import {
  EMPTY_SERVICE_DECLARATION, ServiceDeclarationFields, hasServiceDeclaration, serviceDeclarationErrors,
  serviceDeclarationPayload, type ServiceDeclarationValue,
} from '@/components/service-declaration-fields';
import { t } from '@/lib/i18n';
import { fill } from '@/modules/catalog/format';
import { declareVehicleService, portalErrorMessage, type PortalMaintenanceDue, type PortalVehicleDetail } from './api';
import { CollapsibleCard, dateFr, km as kmFmt } from './ui';

function DueLine({ due }: { due: PortalMaintenanceDue }) {
  const days = due.days_left;
  let tone: StatusTone = 'success'; let Icon = CheckCircle2; let badge = '';
  if (days != null && days <= 0) { tone = 'danger'; Icon = AlertTriangle; badge = fill(t('portal.vehicles.nextServiceOverdue'), { n: String(-days) }); }
  else if (days != null) { tone = days <= 30 ? 'warning' : 'success'; Icon = CalendarClock; badge = fill(t('portal.vehicles.nextServiceIn'), { n: String(days) }); }
  const kind = t(`portal.vehicles.kind_${due.kind}`);
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[15px] font-bold">
          {due.due_date ? fill(t('portal.vehicles.nextServiceLine'), { kind, date: dateFr(due.due_date) }) : fill(t('portal.vehicles.nextServiceKm'), { kind, km: kmFmt(due.due_km) })}
        </span>
        {badge && <StatusBadge tone={tone} icon={Icon} label={badge} />}
      </div>
      {due.due_date && due.due_km != null && (
        <p className="text-[13px] text-muted-foreground">{fill(t('portal.vehicles.nextServiceOrKm'), { km: kmFmt(due.due_km) })}</p>
      )}
    </div>
  );
}

export function NextServiceCard({ vehicle, onDone }: { vehicle: PortalVehicleDetail; onDone: () => void }) {
  const initial = (): ServiceDeclarationValue => ({
    km: vehicle.declared_km != null ? String(vehicle.declared_km) : '',
    lastDate: vehicle.last_service_at ? vehicle.last_service_at.slice(0, 10) : '',
    lastKm: vehicle.last_service_km != null ? String(vehicle.last_service_km) : '',
    where: vehicle.last_service_where ?? 'unknown',
  });
  const [value, setValue] = useState<ServiceDeclarationValue>(initial);
  // La fiche se recharge après l'enregistrement : on repart de ses valeurs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setValue(initial()); }, [vehicle.id, vehicle.declared_km, vehicle.last_service_at, vehicle.last_service_km, vehicle.last_service_where]);
  const errors = serviceDeclarationErrors(value);
  const save = useMutation({
    mutationFn: () => {
      const p = serviceDeclarationPayload(value);
      const last = p.last_services[0];
      return declareVehicleService(vehicle.id, {
        km: p.mileage_km, lastServiceAt: last?.date ?? null, lastServiceKm: last?.km ?? null, where: last?.where ?? null,
      });
    },
    onSuccess: () => { toast.success(t('serviceDecl.saved')); onDone(); },
    onError: (e) => toast.error(portalErrorMessage(e)),
  });
  const due = vehicle.maintenance_due ?? null;
  const dirty = JSON.stringify(value) !== JSON.stringify(initial());

  return (
    <CollapsibleCard id="vehicle-next-service" title={t('portal.vehicles.nextService')}
      hint={due?.due_date ? dateFr(due.due_date) : null}>
      {due ? <DueLine due={due} /> : (
        <p className="text-[13px] text-muted-foreground">{t('portal.vehicles.nextServiceNone')}</p>
      )}
      {due && due.days_left != null && due.days_left <= 60 && (
        <Button asChild variant="outline" className="mt-3 w-full">
          <Link to="/mon-espace/rendez-vous" search={{ nouveau: true, moto: vehicle.id }}>
            <CalendarClock /> {t('portal.vehicles.nextServiceBook')}
          </Link>
        </Button>
      )}
      <div className="mt-4 border-t border-border pt-3">
        <ServiceDeclarationFields value={value} onChange={setValue} idPrefix={`ns-${vehicle.id.slice(0, 8)}`} errors={errors} />
        <div className="mt-3 flex justify-end">
          <Button size="sm" onClick={() => save.mutate()}
            disabled={!dirty || !hasServiceDeclaration(value) || !!errors.km || !!errors.date || save.isPending}>
            {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} {t('serviceDecl.save')}
          </Button>
        </div>
      </div>
    </CollapsibleCard>
  );
}
