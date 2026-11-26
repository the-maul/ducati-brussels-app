/**
 * VEH001 — sous le champ plaque de la fiche moto :
 *  - « Anciennes plaques : X (jusqu'au …), Y » quand la moto en a porté d'autres ;
 *  - pendant la saisie, les autres motos qui portent déjà cette plaque : même client (la plaque y sera
 *    enlevée à l'enregistrement, par la base) ou autre client (avertissement, rien n'est bloqué).
 */
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, History, Info } from 'lucide-react';
import { fillVars, t } from '@/lib/i18n';
import { listPlateConflicts, listPlateHistory, type PlateConflict } from './plate-history-api';
import { previousPlates } from './plate-history';

const fmtDay = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('fr-BE');
};

export function PlateHistoryLine({ vehicleId, currentPlate }: { vehicleId: string; currentPlate?: string | null }) {
  const q = useQuery({ queryKey: ['vehicle-plate-history', vehicleId, currentPlate ?? ''], queryFn: () => listPlateHistory(vehicleId), staleTime: 60_000 });
  const rows = previousPlates(q.data ?? [], currentPlate);
  if (!rows.length) return null;
  const list = rows.map((r) => (r.to_date ? fillVars(t('dossier.plateUntil'), { plate: r.plate, date: fmtDay(r.to_date) }) : r.plate));
  return (
    <p className="flex items-start gap-1.5 text-[12px] text-muted-foreground" title={rows.map((r) => r.reason).filter(Boolean).join('\n') || undefined}>
      <History className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>{fillVars(t('dossier.platePrevious'), { list: list.join(', ') })}</span>
    </p>
  );
}

export const plateConflictBike = (c: PlateConflict) =>
  [[c.brand, c.model].filter(Boolean).join(' '), c.model_year, c.vin].filter(Boolean).join(' · ');

export function usePlateConflicts(p: { companyId: string; plate: string; vehicleId?: string | null; contactId?: string | null; enabled: boolean }) {
  const plate = p.plate.trim().toUpperCase();
  return useQuery({
    queryKey: ['vehicle-plate-conflicts', p.companyId, plate, p.vehicleId ?? null, p.contactId ?? null],
    queryFn: () => listPlateConflicts({ companyId: p.companyId, plate, vehicleId: p.vehicleId, contactId: p.contactId }),
    enabled: p.enabled && plate.length >= 2,
    staleTime: 30_000,
  });
}

export function PlateConflicts({ conflicts }: { conflicts: PlateConflict[] }) {
  if (!conflicts.length) return null;
  return (
    <ul className="space-y-1">
      {conflicts.map((c) => (
        c.same_rider ? (
          <li key={c.vehicle_id} className="flex items-start gap-1.5 rounded-md bg-neutral-bg px-2 py-1.5 text-[12px] text-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span>{fillVars(t('dossier.plateSameRider'), { bike: plateConflictBike(c) })}</span>
          </li>
        ) : (
          <li key={c.vehicle_id} className="flex items-start gap-1.5 rounded-md bg-warning-bg px-2 py-1.5 text-[12px] font-medium text-warning">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>{fillVars(t('dossier.plateOtherClient'), { bike: plateConflictBike(c), owner: c.owner_name ?? t('dossier.plateNoOwner') })}</span>
          </li>
        )
      ))}
    </ul>
  );
}
