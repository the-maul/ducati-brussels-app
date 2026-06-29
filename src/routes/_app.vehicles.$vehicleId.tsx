import { createFileRoute, useNavigate, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, ExternalLink } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { VehicleForm } from '@/modules/vehicles/vehicle-form';
import { getVehicle, updateVehicle, listOwners, listVehicleDocuments, vehicleLabel, type VehicleInsert } from '@/modules/vehicles/api';
import { AttachmentsPanel } from '@/modules/documents/attachments-panel';
import { DucatiInfoPanel } from '@/modules/vehicles/ducati-panel';
import { ducatiVinHistoryUrl } from '@/lib/ducati';
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
  const { data: docs } = useQuery({ queryKey: ['vehicle-docs', vehicleId], queryFn: () => listVehicleDocuments(vehicleId) });

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
      <PageHeader
        title={vehicleLabel(vehicle)}
        description={vehicle.vin ?? undefined}
        actions={
          vehicle.vin ? (
            <Button
              variant="outline"
              onClick={() => window.open(ducatiVinHistoryUrl(vehicle.vin!), '_blank', 'noopener,noreferrer')}
              title={ducatiVinHistoryUrl(vehicle.vin)}
            >
              <ExternalLink /> {t('vehicles.ducatiHistory')}
            </Button>
          ) : undefined
        }
      />

      {/* Historique propriétaires (VEH003) */}
      <div className="mb-6 rounded-md border border-border bg-card p-4 shadow-[var(--shadow-card)]">
        <h2 className="mb-2 font-ui text-[15px] font-bold">{t('vehicles.secOwners')}</h2>
        {!owners || owners.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('vehicles.ownerNoHistory')}</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {owners.map((o) => {
              const c = o.contact;
              const name = c ? (c.company_name || [c.first_name, c.last_name].filter(Boolean).join(' ') || '—') : '—';
              return (
                <li key={o.id} className="flex items-center gap-2">
                  <span className="font-mono text-[12px] text-muted-foreground">{o.from_date}{o.to_date ? ` → ${o.to_date}` : ''}</span>
                  <span className="text-muted-foreground">·</span>
                  {c ? (
                    <Link to="/clients/$contactId" params={{ contactId: c.id }} className="font-medium text-primary hover:underline">{name}</Link>
                  ) : (
                    <span className="font-medium">{name}</span>
                  )}
                  {o.is_current && <span className="rounded-[var(--radius-badge)] bg-success-bg px-1.5 py-0.5 text-[11px] text-success">{t('vehicles.ownerCurrent')}</span>}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Historique : factures / OR / devis rattachés à cette moto (cliquables) */}
      {docs && docs.length > 0 && (
        <div className="mb-6 rounded-md border border-border bg-card p-4 shadow-[var(--shadow-card)]">
          <h2 className="mb-2 font-ui text-[15px] font-bold">{t('vehicles.secDocuments')} ({docs.length})</h2>
          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full border-collapse font-data text-[13px]">
              <thead className="bg-muted">
                <tr>
                  {['N°', 'Type', 'Date', 'Total TTC', 'Statut'].map((h, i) => (
                    <th key={h} className={`px-3 py-2 font-ui text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${i === 3 ? 'text-right' : 'text-left'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr
                    key={d.id}
                    onClick={() => navigate({ to: '/sales/$documentId', params: { documentId: d.id } })}
                    className="cursor-pointer border-b border-border last:border-0 hover:bg-accent"
                  >
                    <td className="px-3 py-2 font-mono">{d.number ?? '—'}</td>
                    <td className="px-3 py-2">{d.doc_type}</td>
                    <td className="px-3 py-2 font-mono text-[12px]">{d.issue_date}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{d.total_ttc.toLocaleString('fr-BE', { minimumFractionDigits: 2 })} €</td>
                    <td className="px-3 py-2">{d.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <VehicleForm
        initial={vehicle}
        companyId={activeCompanyId}
        submitting={m.isPending}
        error={error}
        onSubmit={(p) => { setError(null); m.mutate(p); }}
        onCancel={() => navigate({ to: '/vehicles' })}
      />

      <div className="mt-6 rounded-md border border-border bg-card p-4 shadow-[var(--shadow-card)]">
        <h2 className="mb-2 font-ui text-[15px] font-bold">{t('vehicles.secDucati')}</h2>
        <DucatiInfoPanel vehicle={vehicle} />
      </div>

      <div className="mt-6 rounded-md border border-border bg-card p-4">
        <h2 className="mb-2 font-ui text-[15px] font-bold">{t('ged.title')}</h2>
        <AttachmentsPanel companyId={activeCompanyId} entityType="vehicle" entityId={vehicleId} />
      </div>
    </>
  );
}
