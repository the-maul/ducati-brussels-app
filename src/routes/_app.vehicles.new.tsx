import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/layout/page-header';
import { VehicleForm } from '@/modules/vehicles/vehicle-form';
import { createVehicle, type VehicleInsert } from '@/modules/vehicles/api';
import { useAuth } from '@/lib/auth/auth-context';
import { t } from '@/lib/i18n';
import { useSaveMutation } from '@/lib/use-save-mutation';

export const Route = createFileRoute('/_app/vehicles/new')({
  head: () => ({ meta: [{ title: 'Nouveau véhicule — Ducati Bruxelles' }] }),
  component: NewVehicle,
});

function NewVehicle() {
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const m = useSaveMutation({
    mutationFn: (p: VehicleInsert) => createVehicle(p),
    success: t('feedback.created'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vehicles'] }),
    // Différé de SETTLE_MS : laisse voir la coche du bouton avant de quitter l'écran.
    onDone: (v) => navigate({ to: '/vehicles/$vehicleId', params: { vehicleId: v.id } }),
    onError: (e) => setError(e instanceof Error ? e.message : t('vehicles.errSave')),
  });

  if (!activeCompanyId) return null;
  return (
    <>
      <PageHeader title={t('vehicles.new')} />
      <VehicleForm
        initial={null}
        companyId={activeCompanyId}
        status={m.status}
        error={error}
        onSubmit={(p) => { setError(null); m.mutate(p); }}
        onCancel={() => navigate({ to: '/vehicles' })}
      />
    </>
  );
}
