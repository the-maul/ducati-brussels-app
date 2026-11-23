/**
 * Panneau « Infos Ducati » de la fiche moto : garantie + maintenance + bulletins techniques,
 * synchronisés depuis My Ducati par l'extension navigateur (par VIN).
 */
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, ExternalLink, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { requestMyDucati } from '@/lib/myducati';
import { t } from '@/lib/i18n';
import type { Vehicle } from './api';

const fdate = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString('fr-BE') : '—');

type DcsEvent = {
  id: string; kind: string | null; event_category?: string | null; service_type: string | null; reference?: string | null;
  state: string | null; symptom?: string | null; cause?: string | null; km: number | null;
  event_date: string | null; due_date: string | null; dealer: string | null;
};
// Les trois tableaux du DCS, chacun avec sa propre date.
const EVENT_GROUPS = [
  { kind: 'upcoming', title: 'dossier.dcsEventsUpcoming', dateLabel: 'dossier.dcsColDue' },
  { kind: 'current', title: 'dossier.dcsEventsCurrent', dateLabel: 'dossier.dcsColCreated' },
  { kind: 'past', title: 'dossier.dcsEventsPast', dateLabel: 'dossier.dcsColDate' },
] as const;

export function DucatiInfoPanel({ vehicle }: { vehicle: Vehicle }) {
  const v = vehicle as unknown as Record<string, unknown>;
  const maint = useQuery({ queryKey: ['veh-maint', vehicle.id], queryFn: async () => (await supabase.from('vehicle_maintenance').select('*').eq('vehicle_id', vehicle.id).order('event_date', { ascending: false })).data ?? [] });
  const bull = useQuery({ queryKey: ['veh-bull', vehicle.id], queryFn: async () => (await supabase.from('vehicle_bulletins').select('*').eq('vehicle_id', vehicle.id).order('published_at', { ascending: false })).data ?? [] });

  // Ouvre le PDF du bulletin rapatrié dans le DMS (bucket ged, URL signée temporaire).
  const openBulletin = async (path: string) => {
    const { data, error } = await supabase.storage.from('ged').createSignedUrl(path, 120);
    if (error || !data) { toast.error(t('vehicles.bulletinMissing')); return; }
    window.open(data.signedUrl, '_blank', 'noopener');
  };

  // Boolean() : les champs de `v` sont typés unknown, et `{unknown && …}` en JSX
  // n'est pas un ReactNode valide.
  const hasWarranty = Boolean(v.warranty_start || v.warranty_end || v.warranty_state || v.warranty_activated_by);
  const hasAny = v.my_ducati_synced_at || hasWarranty || (maint.data?.length ?? 0) > 0 || (bull.data?.length ?? 0) > 0;

  // Demande à l'extension d'ouvrir l'URL VIN sur My Ducati, scraper et réimporter (par VIN).
  const requestUpdate = async () => {
    if (!vehicle.vin) return;
    const ok = await requestMyDucati(vehicle.vin);
    if (!ok) toast.error(t('vehicles.ducatiExtMissing'));
  };

  const Cell = ({ label, value }: { label: string; value: unknown }) => (
    <div><p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</p><p className="text-[13px]">{(value as string) || '—'}</p></div>
  );

  return (
    <div className="space-y-4">
      {vehicle.vin && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={requestUpdate}><RefreshCw className="size-4" /> {t('vehicles.ducatiUpdate')}</Button>
          <span className="text-[11px] text-muted-foreground">{t('vehicles.ducatiUpdateHint')}</span>
        </div>
      )}
      {!hasAny && <p className="text-sm text-muted-foreground">{t('vehicles.ducatiNoData')}</p>}
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
        <div className="space-y-3">
          <h3 className="text-[13px] font-bold">{t('vehicles.ducatiMaintenance')}</h3>
          {EVENT_GROUPS.map((g) => {
            const rows = (maint.data as unknown as DcsEvent[]).filter((m) => (m.kind ?? 'past') === g.kind);
            if (!rows.length) return null;
            return (
              <div key={g.kind}>
                <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t(g.title)} ({rows.length})</p>
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="w-full border-collapse font-data text-[13px]">
                    <thead className="bg-muted"><tr>{[t('dossier.dcsColEvent'), t('dossier.dcsColType'), t('dossier.dcsColReference'), t('dossier.dcsColState'), t('dossier.dcsColSymptom'), t('dossier.dcsColCause'), t('dossier.dcsColKm'), t(g.dateLabel), t('dossier.dcsColDealer')].map((h) => <th key={h} className="px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{h}</th>)}</tr></thead>
                    <tbody>
                      {rows.map((m) => (
                        <tr key={m.id} className="border-b border-border last:border-0">
                          <td className="px-3 py-1.5">{m.event_category ?? '—'}</td><td className="px-3 py-1.5">{m.service_type ?? '—'}</td>
                          <td className="px-3 py-1.5 font-mono text-[12px]">{m.reference ?? '—'}</td><td className="px-3 py-1.5">{m.state ?? '—'}</td>
                          <td className="px-3 py-1.5">{m.symptom ?? '—'}</td><td className="px-3 py-1.5">{m.cause ?? '—'}</td>
                          <td className="px-3 py-1.5 tabular-nums">{m.km ?? '—'}</td>
                          <td className="px-3 py-1.5 font-mono text-[12px]">{fdate(g.kind === 'upcoming' ? m.due_date : m.event_date)}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">{m.dealer ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {(bull.data?.length ?? 0) > 0 && (
        <div>
          <h3 className="mb-1 text-[13px] font-bold">{t('vehicles.ducatiBulletins')}</h3>
          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full border-collapse font-data text-[13px]">
              <thead className="bg-muted"><tr>{['N°', 'Titre', 'Date'].map((h) => <th key={h} className="px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{h}</th>)}</tr></thead>
              <tbody>
                {bull.data!.map((b) => {
                  const bb = b as { url?: string | null; storage_path?: string | null };
                  const title = b.title ?? t('vehicles.bulletinOpen');
                  return (
                    <tr key={b.id} className="border-b border-border last:border-0">
                      <td className="px-3 py-1.5 font-mono text-[12px]">{b.number ?? '—'}</td>
                      <td className="px-3 py-1.5">
                        {bb.storage_path
                          ? <button type="button" onClick={() => openBulletin(bb.storage_path!)} className="inline-flex items-center gap-1 text-primary hover:underline">{title}<FileText className="size-3" /></button>
                          : bb.url
                            ? <a href={bb.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">{title}<ExternalLink className="size-3" /></a>
                            : (b.title ?? '—')}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-[12px]">{b.published_at ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {v.my_ducati_synced_at ? <p className="text-[11px] text-muted-foreground">{t('contacts.myDucatiSyncedAt')} {new Date(v.my_ducati_synced_at as string).toLocaleString('fr-BE')}</p> : null}
    </div>
  );
}
