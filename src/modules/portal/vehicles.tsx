/**
 * « Mes motos » : liste et fiche (infos, photo, entretiens et réparations,
 * documents du véhicule déposés par le client, factures liées).
 */
import { useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bike, CalendarClock, CheckCircle2, ChevronRight, Circle, FileText, ImageIcon, Plus, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';
import { getVehicle, listVehicles, openFile, VEHICLE_DOC_KINDS, type PortalFile, type UploadKind } from './api';
import {
  Card, EmptyState, ErrorBox, Loading, PortalPage, RepairStatus, SectionTitle, SignedImage, UploadButtons,
  dateFr, eur, km, vehicleName,
} from './ui';
import { DeclareVehicleForm, DeclaredVehiclesCard } from './declare-vehicle';

export function VehicleListView() {
  const { data, isLoading, error } = useQuery({ queryKey: ['portal', 'vehicles'], queryFn: listVehicles });
  // Mission 04, carte 8 : le client déclare sa moto ; elle attend la validation de l'équipe.
  const [adding, setAdding] = useState(false);
  return (
    <PortalPage title={t('portal.vehicles.title')} subtitle={t('portal.vehicles.subtitle')}
      actions={!adding ? (
        <Button size="sm" onClick={() => setAdding(true)}><Plus /> {t('motoClient.portalAdd')}</Button>
      ) : undefined}>
      {adding && <DeclareVehicleForm onDone={() => setAdding(false)} />}
      <DeclaredVehiclesCard />
      {isLoading && <Loading />}
      {error && <ErrorBox error={error} />}
      {data && data.length === 0 && (
        <EmptyState icon={<Bike className="size-8" />} text={t('portal.vehicles.empty')} />
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {data?.map((v) => (
          <Link key={v.id} to="/mon-espace/motos/$vehicleId" params={{ vehicleId: v.id }}
            className="overflow-hidden rounded-md border border-border bg-card">
            <div className="aspect-[16/9] w-full bg-muted">
              <SignedImage path={v.photo_path} alt={vehicleName(v)} className="size-full object-cover"
                fallback={<div className="grid size-full place-items-center text-muted-foreground"><Bike className="size-10" /></div>} />
            </div>
            <div className="flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-bold">{vehicleName(v)}</p>
                <p className="truncate text-[12px] text-muted-foreground">
                  {[v.model_year, v.plate, km(v.mileage)].filter(Boolean).join(' · ')}
                </p>
                {!(v.photo_path && v.has_registration && v.has_insurance) && (
                  <p className="mt-1 text-[12px] font-medium text-warning">{t('portal.vehicles.toComplete')}</p>
                )}
              </div>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </div>
          </Link>
        ))}
      </div>
      <p className="text-[12px] text-muted-foreground">{t('portal.vehicles.missingHint')}</p>
    </PortalPage>
  );
}

function Info({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className={mono ? 'break-all text-right font-mono text-[13px]' : 'text-right text-[14px] tabular-nums'}>{value}</dd>
    </div>
  );
}

export function VehicleDetailView({ vehicleId }: { vehicleId: string }) {
  const qc = useQueryClient();
  const { data: v, isLoading, error } = useQuery({
    queryKey: ['portal', 'vehicle', vehicleId],
    queryFn: () => getVehicle(vehicleId),
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['portal', 'vehicle', vehicleId] });
    qc.invalidateQueries({ queryKey: ['portal', 'vehicles'] });
    qc.invalidateQueries({ queryKey: ['portal', 'home'] });
  };

  if (isLoading) return <Loading />;
  if (error || !v) return <ErrorBox error={error} />;

  const lastOf = (kind: UploadKind) => v.files.find((f) => f.kind === kind);
  const open = (f: PortalFile) => openFile(f.path).catch((e) => toast.error(e instanceof Error ? e.message : String(e)));

  return (
    <PortalPage title={vehicleName(v)} subtitle={[v.model_year, v.plate].filter(Boolean).join(' · ')}>
      {/* Photo */}
      <Card className="p-0">
        <div id="vehicle_photo" className="aspect-[16/9] w-full overflow-hidden rounded-t-md bg-muted">
          <SignedImage path={v.photo_path} alt={vehicleName(v)} className="size-full object-cover"
            fallback={<div className="grid size-full place-items-center text-muted-foreground"><ImageIcon className="size-10" /></div>} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 p-3">
          <p className="text-[13px] text-muted-foreground">
            {v.photo_path ? t('portal.vehicles.photoChange') : t('portal.vehicles.photoAdd')}
          </p>
          <UploadButtons kind="vehicle_photo" vehicleId={v.id} onDone={refresh} photoOnly compact />
        </div>
      </Card>

      <Button asChild className="w-full">
        <Link to="/mon-espace/rendez-vous" search={{ nouveau: true, moto: v.id }}>
          <CalendarClock /> {t('portal.appointments.requestForVehicle')}
        </Link>
      </Button>

      {/* Informations */}
      <Card>
        <SectionTitle>{t('portal.vehicles.info')}</SectionTitle>
        <dl className="divide-y divide-border">
          <Info label={t('portal.vehicles.vin')} value={v.vin} mono />
          <Info label={t('portal.vehicles.plate')} value={v.plate} />
          <Info label={t('portal.vehicles.year')} value={v.model_year} />
          <Info label={t('portal.vehicles.color')} value={v.color} />
          <Info label={t('portal.vehicles.mileage')} value={km(v.mileage)} />
          <Info label={t('portal.vehicles.firstRegistration')} value={dateFr(v.first_registration_date)} />
          <Info label={t('portal.vehicles.displacement')} value={v.displacement ? `${v.displacement} cm³` : null} />
          <Info label={t('portal.vehicles.power')} value={v.power_kw ? `${v.power_kw} kW${v.power_cv ? ` (${v.power_cv} ch)` : ''}` : null} />
          <Info label={t('portal.vehicles.restricted')} value={v.is_restricted ? t('portal.common.yes') : null} />
          <Info label={t('portal.vehicles.nextInspection')} value={dateFr(v.next_inspection_date)} />
          <Info label={t('portal.vehicles.warrantyEnd')} value={dateFr(v.warranty_end)} />
        </dl>
      </Card>

      {/* Documents du véhicule */}
      <Card>
        <SectionTitle>{t('portal.vehicles.documents')}</SectionTitle>
        <p className="mb-3 text-[12px] text-muted-foreground">{t('portal.vehicles.documentsHint')}</p>
        <ul className="space-y-3">
          {VEHICLE_DOC_KINDS.map((kind) => {
            const f = lastOf(kind);
            return (
              <li key={kind} id={kind} className="rounded-md border border-border p-3">
                <div className="mb-2 flex items-center gap-2">
                  {f ? <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden /> : <Circle className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
                  <span className="flex-1 text-[14px] font-medium">{t(`portal.docKinds.${kind}`)}</span>
                  {f && (
                    <button type="button" onClick={() => open(f)} className="text-[13px] font-medium text-info underline-offset-2 hover:underline">
                      {t('portal.common.open')}
                    </button>
                  )}
                </div>
                {f && <p className="mb-2 truncate text-[12px] text-muted-foreground">{f.file_name} · {dateFr(f.created_at)}</p>}
                <UploadButtons kind={kind} vehicleId={v.id} onDone={refresh} compact />
              </li>
            );
          })}
        </ul>
      </Card>

      {/* Entretiens et réparations */}
      <Card>
        <SectionTitle>{t('portal.vehicles.repairs')}</SectionTitle>
        {v.repairs.length === 0 && v.maintenance.length === 0 && (
          <p className="text-[13px] text-muted-foreground">{t('portal.vehicles.noRepairs')}</p>
        )}
        <ul className="divide-y divide-border">
          {v.repairs.map((r) => (
            <li key={r.id} className="flex items-start gap-3 py-3">
              <Wrench className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-medium">{dateFr(r.date)}</span>
                  <RepairStatus status={r.status} />
                </div>
                {r.work_description && <p className="mt-0.5 text-[13px]">{r.work_description}</p>}
                <p className="text-[12px] text-muted-foreground">{[r.number, km(r.mileage)].filter(Boolean).join(' · ')}</p>
                {r.invoice_document_id && (
                  <Link to="/mon-espace/factures/$documentId" params={{ documentId: r.invoice_document_id }}
                    className="text-[13px] font-medium text-info underline-offset-2 hover:underline">
                    {t('portal.vehicles.seeInvoice')}
                  </Link>
                )}
              </div>
            </li>
          ))}
          {v.maintenance.map((m, i) => (
            <li key={`m-${i}`} className="flex items-start gap-3 py-3">
              <Wrench className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-medium">{m.service_type || m.kind || t('portal.vehicles.maintenance')}</p>
                <p className="text-[12px] text-muted-foreground">
                  {[dateFr(m.event_date) || (m.due_date ? `${t('portal.vehicles.due')} ${dateFr(m.due_date)}` : ''), km(m.km), m.dealer, m.state]
                    .filter(Boolean).join(' · ')}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {/* Factures liées */}
      {v.invoices.length > 0 && (
        <Card>
          <SectionTitle>{t('portal.vehicles.invoices')}</SectionTitle>
          <ul className="divide-y divide-border">
            {v.invoices.map((d) => (
              <li key={d.id}>
                <Link to="/mon-espace/factures/$documentId" params={{ documentId: d.id }} className="flex items-center gap-3 py-3">
                  <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 text-[14px]">{t(`portal.docTypes.${d.doc_type}`)} {d.number} · {dateFr(d.issue_date)}</span>
                  <span className="font-data text-[14px] tabular-nums">{eur(d.total_ttc)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </PortalPage>
  );
}
