import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { VehicleForm } from '@/modules/vehicles/vehicle-form';
import { getVehicle, updateVehicle, listOwners, vehicleLabel, type VehicleInsert } from '@/modules/vehicles/api';
import { useAuth } from '@/lib/auth/auth-context';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/vehicles/$vehicleId')({
  head: () => ({ meta: [{ title: 'Véhicule — Ducati Bruxelles' }] }),
  component: EditVehicle,
});

function EditVehicle() {
  const { vehicleId } = Route.useParams();
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const { data: vehicle, isLoading } = useQuery({ queryKey: ['vehicle', vehicleId], queryFn: () => getVehicle(vehicleId) });
  const { data: owners } = useQuery({ queryKey: ['vehicle-owners', vehicleId], queryFn: () => listOwners(vehicleId) });

  const m = useMutation({
    mutationFn: (p: VehicleInsert) => updateVehicle(vehicleId, p),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vehicles'] });
      qc.invalidateQueries({ queryKey: ['vehicle', vehicleId] });
      navigate({ to: '/vehicles' });
    },
    onError: (e) => setError(e instanceof Error ? e.message : t('vehicles.errSave')),
  });

  if (isLoading) return <div className="grid place-items-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  if (!vehicle || !activeCompanyId) {
    return (<><PageHeader title={t('vehicles.title')} /><p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{t('vehicles.errLoad')}</p></>);
  }

  return (
    <>
      <PageHeader title={vehicleLabel(vehicle)} description={vehicle.vin ?? undefined} />

      {/* Historique propriétaires (VEH003) */}
      <div className="mb-6 rounded-md border border-border bg-card p-4 shadow-[var(--shadow-card)]">
        <h2 className="mb-2 font-ui text-[15px] font-bold">{t('vehicles.secOwners')}</h2>
        {!owners || owners.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('vehicles.ownerNoHistory')}</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {owners.map((o) => (
              <li key={o.id} className="flex items-center gap-2">
                <span className="font-mono text-[12px] text-muted-foreground">{o.from_date}{o.to_date ? ` → ${o.to_date}` : ''}</span>
                <span className="text-muted-foreground">·</span>
                <span className="font-mono text-[11px]">{o.contact_id.slice(0, 8)}</span>
                {o.is_current && <span className="rounded-[var(--radius-badge)] bg-success-bg px-1.5 py-0.5 text-[11px] text-success">{t('vehicles.ownerCurrent')}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <VehicleForm
        initial={vehicle}
        companyId={activeCompanyId}
        submitting={m.isPending}
        error={error}
        onSubmit={(p) => { setError(null); m.mutate(p); }}
        onCancel={() => navigate({ to: '/vehicles' })}
      />
    </>
  );
}
