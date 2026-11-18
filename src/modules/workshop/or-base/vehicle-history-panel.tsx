/**
 * M8 — Historique atelier sur la fiche moto (rattrapage G8 « Historique client / vehicule », 18/11/2026).
 * Les OR de la moto (date, n°, statut, km, travaux, montant ; « Entretien » quand l'OR porte un
 * entretien), les releves de kilometrage connus et le dernier entretien. Un clic ouvre l'OR.
 */
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Gauge, Loader2, Wrench } from 'lucide-react';
import { t, fillVars } from '@/lib/i18n';
import { isMaintenanceReasonCode } from '../parts-popup-rules';
import { listVehicleRepairOrders, vehicleMileageReadings } from './api';
import { OrStatusBadge } from './or-status-badge';
import { formatOrDate, lastReading } from './rules';

const eur = (n: number) => `${(Math.round(Number(n) * 100) / 100).toFixed(2).replace('.', ',')} €`;

export function VehicleWorkshopHistoryPanel({ vehicleId }: { vehicleId: string }) {
  const navigate = useNavigate();
  const orsQ = useQuery({ queryKey: ['vehicle-ors', vehicleId], queryFn: () => listVehicleRepairOrders(vehicleId) });
  const kmQ = useQuery({ queryKey: ['vehicle-mileage', vehicleId], queryFn: () => vehicleMileageReadings(vehicleId) });
  const ors = orsQ.data ?? [];
  const readings = [...(kmQ.data ?? [])].sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
  const last = lastReading(readings);
  const service = readings.find((r) => r.source === 'service');

  return (
    <div className="mb-6 rounded-md border border-border bg-card p-4 shadow-[var(--shadow-card)]">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h2 className="font-ui text-[15px] font-bold">{t('orBase.historyTitle')}</h2>
        {last && (
          <span className="flex items-center gap-1 font-data text-[13px] tabular-nums text-muted-foreground">
            <Gauge className="size-4" aria-hidden />
            {fillVars(t('orBase.lastReading'), { km: last.km.toLocaleString('fr-BE'), date: formatOrDate(last.at), ref: last.ref ? fillVars(t('orBase.lastReadingRef'), { ref: last.ref }) : '' })}
          </span>
        )}
        {service && (
          <span className="flex items-center gap-1 text-[13px] text-muted-foreground">
            <Wrench className="size-4" aria-hidden />
            {fillVars(t('orBase.historyLastService'), { date: formatOrDate(service.at), km: ` · ${service.km.toLocaleString('fr-BE')} km` })}
          </span>
        )}
      </div>
      {orsQ.isLoading && <Loader2 className="size-5 animate-spin text-muted-foreground" />}
      {orsQ.data && ors.length === 0 && <p className="text-sm text-muted-foreground">{t('orBase.historyEmpty')}</p>}
      {ors.length > 0 && (
        <>
          <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{fillVars(t('orBase.historyOrs'), { n: ors.length })}</p>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full border-collapse font-data text-[13px]">
              <thead className="bg-muted">
                <tr>
                  <Th>{t('orBase.colDate')}</Th><Th>{t('orBase.colNumber')}</Th><Th>{t('orBase.colStatus')}</Th>
                  <Th className="text-right">{t('orBase.colMileage')}</Th><Th>{t('orBase.colWork')}</Th><Th className="text-right">{t('orBase.colAmount')}</Th>
                </tr>
              </thead>
              <tbody>
                {ors.map((o) => {
                  const maintenance = !!o.service_code || isMaintenanceReasonCode(o.reason_code) || o.repair_type === 'entretien';
                  return (
                    <tr key={o.id} onClick={() => navigate({ to: '/workshop/$orId', params: { orId: o.id } })} className="cursor-pointer border-b border-border last:border-0 hover:bg-accent">
                      <td className="px-3 py-2 tabular-nums">{formatOrDate(o.created_at.slice(0, 10))}</td>
                      <td className="px-3 py-2 font-mono text-[12px]">{o.number ?? '—'}</td>
                      <td className="px-3 py-2"><OrStatusBadge status={o.status} /></td>
                      <td className="px-3 py-2 text-right tabular-nums">{o.mileage != null ? o.mileage.toLocaleString('fr-BE') : '—'}</td>
                      <td className="max-w-[360px] px-3 py-2">
                        {maintenance && <span className="mr-1.5 rounded-[var(--radius-badge)] bg-info-bg px-1.5 py-0.5 text-[11px] font-bold uppercase text-info">{t('orBase.historyMaintenance')}</span>}
                        <span className="text-muted-foreground">{(o.work_description ?? '').split('\n')[0] || '—'}</span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{eur(o.total_ttc)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      {readings.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('orBase.historyReadings')} ({readings.length})</summary>
          <ul className="mt-1 space-y-0.5 font-data text-[13px] tabular-nums">
            {readings.map((r, i) => (
              <li key={`${r.source}-${r.orId ?? i}`} className="flex gap-3">
                <span className="w-24 text-muted-foreground">{formatOrDate(r.at ? r.at.slice(0, 10) : null) || '—'}</span>
                <span className="w-24 text-right">{r.km.toLocaleString('fr-BE')} km</span>
                <span className="text-muted-foreground">{t(`orBase.readingSource.${r.source}`)}{r.ref ? ` ${r.ref}` : ''}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
