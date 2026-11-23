import { DcsUpdateButton } from '@/modules/vehicles/dcs-update';
import { loadVehicleFill } from '@/modules/vehicles/catalog-specs';
import { createFileRoute, useNavigate, Link } from '@tanstack/react-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, ExternalLink, Mail, MessageSquare, Send, Wrench, FileImage } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { VehicleForm } from '@/modules/vehicles/vehicle-form';
import { getVehicle, updateVehicle, listOwners, listVehicleDocuments, vehicleLabel, type VehicleInsert, type Vehicle } from '@/modules/vehicles/api';
import { AttachmentsPanel } from '@/modules/documents/attachments-panel';
import { DucatiInfoPanel } from '@/modules/vehicles/ducati-panel';
import { MotoSitePanel } from '@/modules/vehicles/moto-site-panel';
import { VehicleMaintenancePanel } from '@/modules/workshop/vehicle-maintenance-panel';
import { VehicleNextServicePanel } from '@/modules/workshop/vehicle-next-service-panel';
import { DeferredPanel } from '@/modules/workshop/checkup/deferred';
import { VehicleRegisterPanel } from '@/modules/vehicles/register-panel';
import { VehiclePartiesPanel, VehicleEconomicsPanel, VehicleBonusesPanel } from '@/modules/vehicles/fiche-g8-panels';
import { PosterDialog } from '@/modules/vehicles/poster-dialog';
import { VehicleWorkshopHistoryPanel } from '@/modules/workshop/or-base/vehicle-history-panel';
import { VehicleReceptionPhotos } from '@/modules/workshop/reception/vehicle-reception-photos';
import { findInterestedContacts, notifyInterestedContact, type InterestedContact, type NotifyChannel } from '@/modules/crm/matching-api';
import { contactDisplayName } from '@/modules/contacts/api';
import { ducatiVinHistoryUrl } from '@/lib/ducati';
import { useAuth } from '@/lib/auth/auth-context';
import { t, pageTitle } from '@/lib/i18n';
import { formatPhone } from '@/lib/phone';
import { useSaveMutation } from '@/lib/use-save-mutation';
import {
  VEHICLE_TABS, VEHICLE_TAB_LABEL, VEHICLE_DEFAULT_TAB, parseVehicleTab, showCommerceBlocks, type VehicleTab,
} from '@/modules/vehicles/fiche-tabs';

export const Route = createFileRoute('/_app/vehicles/$vehicleId')({
  head: () => ({ meta: [{ title: pageTitle('vehicle') }] }),
  // Lot design des fiches (20/11/2026) : l'onglet de la fiche est gardé dans l'adresse (?tab=).
  validateSearch: (s: Record<string, unknown>): { tab?: VehicleTab } => ({ tab: parseVehicleTab(s.tab) }),
  component: EditVehicle,
});

function EditVehicle() {
  const { vehicleId } = Route.useParams();
  const search = Route.useSearch();
  const routeNavigate = Route.useNavigate();
  const tab: VehicleTab = search.tab ?? VEHICLE_DEFAULT_TAB;
  const setTab = (v: string) => {
    const next = parseVehicleTab(v);
    if (next) void routeNavigate({ search: (prev) => ({ ...prev, tab: next === VEHICLE_DEFAULT_TAB ? undefined : next }), replace: true });
  };
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [posterOpen, setPosterOpen] = useState(false);

  const { data: vehicle, isLoading } = useQuery({ queryKey: ['vehicle', vehicleId], queryFn: () => getVehicle(vehicleId) });
  // Champs vides complétés depuis nos factures et le catalogue (enregistrés à la prochaine sauvegarde).
  const fillQ = useQuery({
    queryKey: ['vehicle-fill', vehicleId, vehicle?.my_ducati_synced_at ?? null],
    queryFn: () => loadVehicleFill(vehicle as NonNullable<typeof vehicle>),
    enabled: !!vehicle, staleTime: Infinity, gcTime: 0,
    placeholderData: (previous) => previous,
  });
  // Import DCS : le formulaire repart des nouvelles données seulement s'il n'y a pas de saisie en cours.
  const formDirty = useRef(false);
  const shownSync = useRef<string | null | undefined>(undefined);
  const [formVersion, setFormVersion] = useState(0);
  const freshFill = fillQ.isPlaceholderData ? null : fillQ.data?.vehicle ?? null;
  useEffect(() => {
    if (!freshFill) return;
    const synced = freshFill.my_ducati_synced_at ?? null;
    if (shownSync.current === undefined) { shownSync.current = synced; return; }
    if (synced === shownSync.current) return;
    shownSync.current = synced;
    if (!formDirty.current) setFormVersion((v) => v + 1);
  }, [freshFill]);
  const { data: owners } = useQuery({ queryKey: ['vehicle-owners', vehicleId], queryFn: () => listOwners(vehicleId) });
  const { data: docs } = useQuery({ queryKey: ['vehicle-docs', vehicleId], queryFn: () => listVehicleDocuments(vehicleId) });

  const m = useSaveMutation({
    mutationFn: (p: VehicleInsert) => updateVehicle(vehicleId, p),
    success: t('feedback.saved'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vehicles'] });
      qc.invalidateQueries({ queryKey: ['vehicle', vehicleId] });
    },
    // Différé de SETTLE_MS : laisse voir la coche du bouton avant de quitter l'écran.
    onDone: () => navigate({ to: '/vehicles' }),
    onError: (e) => setError(e instanceof Error ? e.message : t('vehicles.errSave')),
  });

  if (isLoading) return <div className="grid place-items-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  if (!vehicle || !activeCompanyId) {
    return (<><PageHeader title={t('vehicles.title')} /><p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{t('vehicles.errLoad')}</p></>);
  }

  const commerce = showCommerceBlocks(vehicle);
  const currentOwnerId = owners?.find((o) => o.is_current)?.contact_id ?? null;

  return (
    <>
      <PageHeader
        title={vehicleLabel(vehicle)}
        description={vehicle.vin ?? undefined}
        actions={
          <>
            {vehicle.vin ? (
              <Button
                variant="outline"
                onClick={() => window.open(ducatiVinHistoryUrl(vehicle.vin!), '_blank', 'noopener,noreferrer')}
                title={ducatiVinHistoryUrl(vehicle.vin)}
              >
                <ExternalLink /> {t('vehicles.ducatiHistory')}
              </Button>
            ) : null}
            <DcsUpdateButton vin={vehicle.vin} syncedAt={vehicle.my_ducati_synced_at ?? null} />
            {/* Nouvel OR depuis la fiche moto : moto et proprietaire courant pre-remplis (ATE001). */}
            <Button
              variant="outline"
              onClick={() => navigate({
                to: '/workshop/new',
                search: { vehicleId, contactId: currentOwnerId ?? undefined },
              })}
            >
              <Wrench /> {t('workshop.newOr')}
            </Button>
            {/* Rattrapage G8 : affichette moto (balises, 1 ou 2 par page, PDF). */}
            <Button variant="outline" onClick={() => setPosterOpen(true)}><FileImage /> {t('parcG8.poster')}</Button>
          </>
        }
      />

      {/* Charte §5.7 (lot design des fiches, 20/11/2026) : 5 onglets au lieu de 17 blocs empilés. */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto flex-wrap justify-start">
          {VEHICLE_TABS.map((v) => (
            <TabsTrigger key={v} value={v}>{t(VEHICLE_TAB_LABEL[v])}</TabsTrigger>
          ))}
        </TabsList>

        {/* forceMount : changer d'onglet ne perd pas une saisie en cours dans la fiche. */}
        <TabsContent value="infos" forceMount className="mt-4 space-y-6 data-[state=inactive]:hidden">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Historique propriétaires (VEH003) */}
            <Card title={t('vehicles.secOwners')}>
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
            </Card>
            {/* Rattrapage G8 : proprietaire / detenteur / utilisateur (3 tiers de l'onglet Proprietaire). */}
            <Card title={t('parcG8.partiesTitle')}>
              <VehiclePartiesPanel key={vehicle.id} companyId={activeCompanyId} vehicle={vehicle} currentOwnerId={currentOwnerId} />
            </Card>
          </div>
          {(fillQ.isFetched || !!fillQ.data) && (
            <VehicleForm
              key={`${vehicle.id}:${formVersion}`}
              dirtyRef={formDirty}
              initial={fillQ.data?.vehicle ?? vehicle}
              catalogFilled={fillQ.data?.filled}
              companyId={activeCompanyId}
              status={m.status}
              error={error}
              onSubmit={(p) => { setError(null); m.mutate(p); }}
              onCancel={() => navigate({ to: '/vehicles' })}
            />
          )}
        </TabsContent>

        <TabsContent value="atelier" className="mt-4 space-y-6">
          {/* Historique atelier : OR, km, entretiens (rattrapage G8 du 18/11). */}
          <VehicleWorkshopHistoryPanel vehicleId={vehicleId} />
          {/* Mission 07, cartes 4 et 5 : prochain entretien (date, source) et déclaration du client */}
          <Card title={t('maintenance.dueTitle')}>
            <VehicleNextServicePanel vehicle={vehicle as unknown as { id: string; mileage?: number | null } & Record<string, unknown>} companyId={activeCompanyId} />
          </Card>
          <Card title={t('maintenance.vehTitle')}>
            <VehicleMaintenancePanel vehicle={vehicle} companyId={activeCompanyId} />
          </Card>
          {/* Interventions reportees par le client a la signature de la proposition (ATE009) */}
          <DeferredPanel vehicleId={vehicleId} />
          <Card title={t('vehicles.secDucati')}>
            <DucatiInfoPanel vehicle={vehicle} />
          </Card>
        </TabsContent>

        <TabsContent value="documents" className="mt-4 space-y-6">
          {/* Historique : factures / OR / devis rattachés à cette moto (cliquables) */}
          <Card title={`${t('vehicles.secDocuments')}${docs && docs.length > 0 ? ` (${docs.length})` : ''}`}>
            {!docs || docs.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('clientTabs.noDocument')}</p>
            ) : (
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full border-collapse font-data text-[13px]">
                  <thead className="bg-muted">
                    <tr>
                      {[t('clientTabs.colNumber'), t('clientTabs.colType'), t('clientTabs.colDate'), t('clientTabs.colTtc'), t('clientTabs.colStatus')].map((h, i) => (
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
                        <td className="px-3 py-2 font-mono">
                          <Link to="/sales/$documentId" params={{ documentId: d.id }} onClick={(e) => e.stopPropagation()} className="underline-offset-2 hover:underline">{d.number ?? '—'}</Link>
                        </td>
                        <td className="px-3 py-2">{d.doc_type}</td>
                        <td className="px-3 py-2 font-mono text-[12px]">{d.issue_date}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{d.total_ttc.toLocaleString('fr-BE', { minimumFractionDigits: 2 })} €</td>
                        <td className="px-3 py-2">{t(`sales.status_${d.status}`)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <Card title={t('ged.title')}>
            <AttachmentsPanel companyId={activeCompanyId} entityType="vehicle" entityId={vehicleId} />
          </Card>
        </TabsContent>

        <TabsContent value="photos" className="mt-4 space-y-3">
          {/* Lot C (19/11) : photos de reception de ses OR (historique de la moto, B8). */}
          <VehicleReceptionPhotos vehicleId={vehicleId} emptyText={t('designFiches.vPhotosEmpty')} />
          <p className="text-[12px] text-muted-foreground">{t('designFiches.vPhotosHint')}</p>
        </TabsContent>

        <TabsContent value="comptabilite" className="mt-4 space-y-6">
          {commerce ? (
            <>
              <Card title={t('motoParc.title')}>
                <MotoSitePanel companyId={activeCompanyId} vehicle={vehicle} />
              </Card>
              {/* Rattrapage G8 : bilan economique et primes / aides de la moto. */}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <Card title={t('parcG8.ecoTitle')}>
                  <VehicleEconomicsPanel vehicle={vehicle} />
                </Card>
                <Card title={t('parcG8.bonusTitle')}>
                  <VehicleBonusesPanel companyId={activeCompanyId} vehicleId={vehicle.id} />
                </Card>
              </div>
              <Card title={t('matching.title')}>
                <InterestedContactsPanel companyId={activeCompanyId} vehicle={vehicle} />
              </Card>
            </>
          ) : (
            <p className="rounded-md border border-dashed border-border bg-card px-3 py-2 text-[13px] text-muted-foreground">{t('designFiches.vClientBikeNoCommerce')}</p>
          )}
          {/* VEH010 : registre des vehicules a moteur (AR n° 1 art. 28), entrees / sorties de cette moto */}
          <Card title={t('vehicleRegister.ficheTitle')}>
            <VehicleRegisterPanel companyId={activeCompanyId} vehicleId={vehicleId} />
          </Card>
        </TabsContent>
      </Tabs>
      {posterOpen && <PosterDialog companyId={activeCompanyId} kind="vehicle" initialIds={[vehicle.id]} onClose={() => setPosterOpen(false)} />}
    </>
  );
}

/** Bloc titré de la fiche moto (même apparence que les anciens encadrés). */
function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-card p-4 shadow-[var(--shadow-card)]">
      <h2 className="mb-2 font-ui text-[15px] font-bold">{title}</h2>
      {children}
    </div>
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
                    {[m.contact.email, formatPhone(m.contact.mobile)].filter(Boolean).join(' · ') || '—'}
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
