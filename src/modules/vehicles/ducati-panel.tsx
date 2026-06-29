/**
 * Panneau « Infos Ducati » de la fiche moto : garantie + maintenance + bulletins techniques,
 * synchronisés depuis My Ducati par l'extension navigateur (par VIN).
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { t } from '@/lib/i18n';
import type { Vehicle } from './api';

const fdate = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString('fr-BE') : '—');

export function DucatiInfoPanel({ vehicle }: { vehicle: Vehicle }) {
  const v = vehicle as unknown as Record<string, unknown>;
  const maint = useQuery({ queryKey: ['veh-maint', vehicle.id], queryFn: async () => (await supabase.from('vehicle_maintenance').select('*').eq('vehicle_id', vehicle.id).order('event_date', { ascending: false })).data ?? [] });
  const bull = useQuery({ queryKey: ['veh-bull', vehicle.id], queryFn: async () => (await supabase.from('vehicle_bulletins').select('*').eq('vehicle_id', vehicle.id).order('published_at', { ascending: false })).data ?? [] });

  const hasWarranty = v.warranty_start || v.warranty_end || v.warranty_state || v.warranty_activated_by;
  const hasAny = v.my_ducati_synced_at || hasWarranty || (maint.data?.length ?? 0) > 0 || (bull.data?.length ?? 0) > 0;
  if (!hasAny) return <p className="text-sm text-muted-foreground">{t('vehicles.ducatiNoData')}</p>;

  const Cell = ({ label, value }: { label: string; value: unknown }) => (
    <div><p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</p><p className="text-[13px]">{(value as string) || '—'}</p></div>
  );

  return (
    <div className="space-y-4">
      {hasWarranty && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Cell label={t('vehicles.warrantyStart')} value={fdate(v.warranty_start as string)} />
          <Cell label={t('vehicles.warrantyEnd')} value={fdate(v.warranty_end as string)} />
          <Cell label={t('vehicles.warrantyType')} value={v.warranty_type} />
          <Cell label={t('vehicles.warrantyState')} value={v.warranty_state} />
          <Cell label={t('vehicles.warrantyActivatedBy')} value={v.warranty_activated_by} />
        </div>
      )}

      {(maint.data?.length ?? 0) > 0 && (
        <div>
          <h3 className="mb-1 text-[13px] font-bold">{t('vehicles.ducatiMaintenance')}</h3>
          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full border-collapse font-data text-[13px]">
              <thead className="bg-muted"><tr>{['Type', 'État', 'Km', 'Date', 'Concession.'].map((h) => <th key={h} className="px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{h}</th>)}</tr></thead>
              <tbody>
                {maint.data!.map((m) => (
                  <tr key={m.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-1.5">{m.service_type ?? '—'}</td><td className="px-3 py-1.5">{m.state ?? '—'}</td>
                    <td className="px-3 py-1.5 tabular-nums">{m.km ?? '—'}</td><td className="px-3 py-1.5 font-mono text-[12px]">{m.event_date ?? m.due_date ?? '—'}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{m.dealer ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(bull.data?.length ?? 0) > 0 && (
        <div>
          <h3 className="mb-1 text-[13px] font-bold">{t('vehicles.ducatiBulletins')}</h3>
          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full border-collapse font-data text-[13px]">
              <thead className="bg-muted"><tr>{['N°', 'Titre', 'Date'].map((h) => <th key={h} className="px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{h}</th>)}</tr></thead>
              <tbody>
                {bull.data!.map((b) => (
                  <tr key={b.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-1.5 font-mono text-[12px]">{b.number ?? '—'}</td><td className="px-3 py-1.5">{b.title ?? '—'}</td>
                    <td className="px-3 py-1.5 font-mono text-[12px]">{b.published_at ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {v.my_ducati_synced_at ? <p className="text-[11px] text-muted-foreground">{t('contacts.myDucatiSyncedAt')} {new Date(v.my_ducati_synced_at as string).toLocaleString('fr-BE')}</p> : null}
    </div>
  );
}
