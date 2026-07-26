import { createFileRoute, useNavigate, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, ExternalLink, Mail, MessageSquare, Send } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { VehicleForm } from '@/modules/vehicles/vehicle-form';
import { getVehicle, updateVehicle, listOwners, listVehicleDocuments, vehicleLabel, type VehicleInsert, type Vehicle } from '@/modules/vehicles/api';
import { AttachmentsPanel } from '@/modules/documents/attachments-panel';
import { DucatiInfoPanel } from '@/modules/vehicles/ducati-panel';
import { findInterestedContacts, notifyInterestedContact, type InterestedContact, type NotifyChannel } from '@/modules/crm/matching-api';
import { contactDisplayName } from '@/modules/contacts/api';
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
        key={vehicle.my_ducati_synced_at ?? vehicle.id}
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

      <div className="mt-6 rounded-md border border-border bg-card p-4 shadow-[var(--shadow-card)]">
        <h2 className="mb-2 font-ui text-[15px] font-bold">{t('matching.title')}</h2>
        <InterestedContactsPanel companyId={activeCompanyId} vehicle={vehicle} />
      </div>
    </>
  );
}

function InterestedContactsPanel({ companyId, vehicle }: { companyId: string; vehicle: Vehicle }) {
  const [notifyingId, setNotifyingId] = useState<string | null>(null);
  const [notifyingAll, setNotifyingAll] = useState(false);

  const { data: matches, isLoading } = useQuery({
    queryKey: ['vehicle-interested-contacts', vehicle.id],
    queryFn: () => findInterestedContacts(companyId, vehicle),
  });

  const notify = async (m: InterestedContact, channel: NotifyChannel) => {
    setNotifyingId(`${m.contact.id}:${channel}`);
    try {
      await notifyInterestedContact({ companyId, contact: m.contact, vehicle, channel });
      toast.success(t('matching.notified'));
    } catch {
      toast.error(t('matching.notifyError'));
    } finally {
      setNotifyingId(null);
    }
  };

  const notifyAll = async () => {
    const targets = (matches ?? []).filter((m) => m.contact.email);
    if (targets.length === 0) { toast.info(t('matching.notifyAllNone')); return; }
    setNotifyingAll(true);
    let sent = 0;
    for (const m of targets) {
      try {
        await notifyInterestedContact({ companyId, contact: m.contact, vehicle, channel: 'email' });
        sent += 1;
      } catch { /* best-effort — on continue les autres */ }
    }
    setNotifyingAll(false);
    toast.success(t('matching.notifyAllResult').replace('{count}', String(sent)));
  };

  if (isLoading) return <p className="text-sm text-muted-foreground">{t('state.loading')}</p>;
  if (!matches || matches.length === 0) return <p className="text-sm text-muted-foreground">{t('matching.none')}</p>;

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button type="button" variant="outline" size="sm" onClick={notifyAll} disabled={notifyingAll}>
          {notifyingAll ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} {t('matching.notifyAll')}
        </Button>
      </div>
      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted">
            <tr>
              {[t('matching.colContact'), t('matching.colReason'), t('matching.colContactInfo'), t('matching.colActions')].map((h, i) => (
                <th key={h} className={`px-3 py-2 font-ui text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${i === 3 ? 'text-right' : 'text-left'}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matches.map((m) => {
              const isModel = m.reason === 'model';
              return (
                <tr key={m.contact.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">
                    <Link to="/clients/$contactId" params={{ contactId: m.contact.id }} className="font-medium text-primary hover:underline">
                      {contactDisplayName(m.contact)}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded-[var(--radius-badge)] px-1.5 py-0.5 text-[11px] ${isModel ? 'bg-success-bg text-success' : 'bg-info-bg text-info'}`}>
                      {isModel ? t('matching.reasonModel') : t('matching.reasonUsage')}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {[m.contact.email, m.contact.mobile].filter(Boolean).join(' · ') || '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex gap-1">
                      {m.contact.email && (
                        <Button
                          type="button" variant="ghost" size="sm" title={t('matching.notifyEmail')}
                          disabled={notifyingId === `${m.contact.id}:email`}
                          onClick={() => notify(m, 'email')}
                        >
                          {notifyingId === `${m.contact.id}:email` ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
                        </Button>
                      )}
                      {m.contact.mobile && (
                        <Button
                          type="button" variant="ghost" size="sm" title={t('matching.notifySms')}
                          disabled={notifyingId === `${m.contact.id}:sms`}
                          onClick={() => notify(m, 'sms')}
                        >
                          {notifyingId === `${m.contact.id}:sms` ? <Loader2 className="size-4 animate-spin" /> : <MessageSquare className="size-4" />}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
