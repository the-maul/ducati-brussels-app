import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { VehicleForm, type VehicleSubmitMeta } from '@/modules/vehicles/vehicle-form';
import {
  attachVehicleOwner, createVehicle, createVehicleForContact, VinExistsError, type VehicleInsert,
} from '@/modules/vehicles/api';
import { contactDisplayName, getContact } from '@/modules/contacts/api';
import { useAuth } from '@/lib/auth/auth-context';
import { t } from '@/lib/i18n';
import { useSaveMutation } from '@/lib/use-save-mutation';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOrUndefined = (v: unknown) => (typeof v === 'string' && UUID_RE.test(v) ? v : undefined);

/**
 * Nouveau véhicule. Avec `?contact=<id>` (mission 04, carte 6 : bouton « Ajouter une
 * moto » de la fiche client) : moto de client, créée avec son lien propriétaire en une
 * transaction (vehicle_create_for_contact) ; un VIN déjà connu propose de rattacher
 * la moto existante au lieu d'en créer une 2e.
 */
export const Route = createFileRoute('/_app/vehicles/new')({
  head: () => ({ meta: [{ title: 'Nouveau véhicule — Ducati Bruxelles' }] }),
  validateSearch: (s: Record<string, unknown>) => ({ contact: uuidOrUndefined(s.contact) }),
  component: NewVehicle,
});

function NewVehicle() {
  const { activeCompanyId } = useAuth();
  const { contact: contactId } = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const contactQ = useQuery({
    queryKey: ['contact', contactId],
    queryFn: () => getContact(contactId!),
    enabled: !!contactId,
  });
  const contact = contactQ.data ?? null;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['vehicles'] });
    qc.invalidateQueries({ queryKey: ['client-parc'] });
  };

  const m = useSaveMutation({
    mutationFn: async ({ p, meta }: { p: VehicleInsert; meta: VehicleSubmitMeta }) => {
      if (contactId) {
        const id = await createVehicleForContact(activeCompanyId!, contactId, p, meta.ownerFrom);
        return { id };
      }
      return createVehicle(p);
    },
    success: contactId ? t('motoClient.created') : t('feedback.created'),
    onSuccess: invalidate,
    // Différé de SETTLE_MS : laisse voir la coche du bouton avant de quitter l'écran.
    onDone: (v) => navigate({ to: '/vehicles/$vehicleId', params: { vehicleId: v.id } }),
    onError: (e) => setError(
      e instanceof VinExistsError ? t('motoClient.vinExistsBlock')
        : e instanceof Error ? e.message : t('vehicles.errSave'),
    ),
  });

  const attach = useMutation({
    mutationFn: ({ vehicleId, ownerFrom }: { vehicleId: string; ownerFrom: string }) =>
      attachVehicleOwner(vehicleId, contactId!, ownerFrom),
    onSuccess: () => {
      invalidate();
      toast.success(t('motoClient.attached'));
      navigate({ to: '/clients/$contactId', params: { contactId: contactId! } });
    },
    onError: (e) => setError(e instanceof Error ? e.message : t('vehicles.errSave')),
  });

  if (!activeCompanyId) return null;
  if (contactId && contactQ.isLoading) {
    return <div className="grid place-items-center py-10"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
  }
  const client = contact ? { id: contact.id, name: contactDisplayName(contact) } : null;

  return (
    <>
      <PageHeader
        title={client ? t('motoClient.newForClient') : t('vehicles.new')}
        breadcrumbs={client ? [
          { label: t('nav.clients'), to: '/clients' },
          { label: client.name, to: `/clients/${client.id}` },
          { label: t('motoClient.addForClient') },
        ] : undefined}
      />
      <VehicleForm
        initial={null}
        companyId={activeCompanyId}
        status={m.status}
        error={error}
        client={client}
        onSubmit={(p, meta) => { setError(null); m.mutate({ p, meta }); }}
        onAttachExisting={client ? (vehicleId, ownerFrom) => { setError(null); attach.mutate({ vehicleId, ownerFrom }); } : undefined}
        attaching={attach.isPending}
        onCancel={() => (client
          ? navigate({ to: '/clients/$contactId', params: { contactId: client.id } })
          : navigate({ to: '/vehicles' }))}
      />
    </>
  );
}
