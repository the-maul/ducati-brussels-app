/**
 * M8 — Parcours mecanicien, lot C (19/11/2026) : photos de reception sur la fiche moto (historique
 * cumule par vehicule, B8). Une rangee par OR, la plus recente d'abord, avec les commentaires.
 * Rien tant que la migration 20261119270000 manque ou que la moto n'a aucune photo.
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { t } from '@/lib/i18n';
import { listVehicleReceptionPhotos, receptionSchemaReady, type VehicleReceptionPhoto } from './api';
import { DAMAGE_SLOT, slotLabel } from './rules';
import { PhotoThumb } from './reception-sheet';

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-BE') : '');

/** `emptyText` : phrase affichée quand la moto n'a aucune photo (onglet Photos de la fiche moto) ; sinon rien. */
export function VehicleReceptionPhotos({ vehicleId, emptyText }: { vehicleId: string; emptyText?: string }) {
  const schema = useQuery({ queryKey: ['reception-schema'], queryFn: receptionSchemaReady, staleTime: Infinity });
  const q = useQuery({ queryKey: ['vehicle-reception-photos', vehicleId], queryFn: () => listVehicleReceptionPhotos(vehicleId), enabled: schema.data === true });
  const photos = q.data ?? [];
  if (!photos.length) {
    if (!emptyText || q.isLoading) return null;
    return <p className="rounded-md border border-dashed border-border bg-card py-10 text-center text-sm text-muted-foreground">{emptyText}</p>;
  }
  const groups = new Map<string, VehicleReceptionPhoto[]>();
  for (const p of photos) groups.set(p.or_id, [...(groups.get(p.or_id) ?? []), p]);
  return (
    <section className="mt-4 rounded-md border border-border bg-card p-4">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('reception.vehicleTitle')}</p>
      <div className="space-y-4">
        {[...groups.entries()].map(([orId, list]) => (
          <div key={orId}>
            <p className="mb-1 text-[13px]">
              <Link to="/workshop/$orId" params={{ orId }} className="font-bold underline-offset-2 hover:underline">OR {list[0].or_number ?? ''}</Link>
              <span className="ml-2 font-data tabular-nums text-muted-foreground">{day(list[0].taken_at ?? list[0].or_date)}</span>
            </p>
            <ul className="flex flex-wrap gap-3">
              {list.sort((a, b) => a.sort_order - b.sort_order).map((p) => {
                const label = p.slot_code === DAMAGE_SLOT ? t('reception.damage') : slotLabel({ code: p.slot_code }, t);
                return (
                  <li key={p.id} className="w-36">
                    <PhotoThumb path={p.storage_path} alt={label} className="aspect-[4/3] w-36 rounded border border-border" />
                    <p className="mt-0.5 truncate text-[12px] font-bold">{label}</p>
                    {p.comment && <p className="line-clamp-2 text-[12px] text-muted-foreground">{p.comment}</p>}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
