/**
 * M8 — Fiche de la moto sous le véhicule choisi, dans la fenêtre du rendez-vous (comme G8).
 * Lecture seule : « Compléter la fiche » ouvre la moto dans un nouvel onglet, le rendez-vous en
 * cours reste ouvert et la fiche se met à jour au retour sur l'onglet.
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { fillVars, t } from '@/lib/i18n';
import { sheetMissingCount, vehicleSheetGroups, VEHICLE_SHEET_COLUMNS, type VehicleSheetRow } from './vehicle-sheet';

const loose = supabase as unknown as {
  from: (table: string) => { select: (cols: string) => { eq: (c: string, v: string) => { maybeSingle: () => PromiseLike<{ data: unknown; error: { message: string } | null }> } } };
};

export function VehicleRdvSheet({ vehicleId }: { vehicleId: string }) {
  const q = useQuery({
    queryKey: ['rdv-vehicle-sheet', vehicleId],
    queryFn: async () => {
      const { data, error } = await loose.from('vehicles').select(VEHICLE_SHEET_COLUMNS).eq('id', vehicleId).maybeSingle();
      if (error) throw new Error(error.message);
      return (data as VehicleSheetRow | null) ?? null;
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  if (q.isLoading) {
    return <div className="flex justify-center rounded-md border border-border bg-card p-3 sm:col-span-3"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div>;
  }
  if (q.error) return <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger sm:col-span-3">{(q.error as Error).message}</p>;
  if (!q.data) return null;

  const groups = vehicleSheetGroups(q.data, { yes: t('dossier.sheetYes'), no: t('dossier.sheetNo') });
  const missing = sheetMissingCount(groups);

  return (
    <section className="rounded-md border border-border bg-card p-3 sm:col-span-3" aria-label={t('dossier.sheetTitle')}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-[14px] font-bold">{t('dossier.sheetTitle')}</h3>
        {missing > 0 ? (
          <span className="inline-flex items-center gap-1 rounded bg-warning-bg px-2 py-0.5 text-[12px] font-bold text-warning">
            <AlertTriangle className="size-3.5" aria-hidden /> {fillVars(t('dossier.sheetMissing'), { n: missing })}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded bg-success-bg px-2 py-0.5 text-[12px] font-bold text-success">
            <CheckCircle2 className="size-3.5" aria-hidden /> {t('dossier.sheetComplete')}
          </span>
        )}
        <Link to="/vehicles/$vehicleId" params={{ vehicleId }} target="_blank" rel="noopener"
          className="ml-auto inline-flex min-h-9 items-center gap-1 text-[13px] font-medium text-info underline-offset-2 hover:underline">
          <ExternalLink className="size-3.5" aria-hidden /> {t('dossier.sheetOpen')}
        </Link>
      </div>
      <div className="grid gap-x-5 gap-y-3 md:grid-cols-3">
        {groups.map((g) => (
          <div key={g.titleKey} className="min-w-0">
            <h4 className="mb-1 border-b border-border pb-1 text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t(g.titleKey)}</h4>
            <dl>
              {g.fields.map((x) => (
                <div key={x.key} className="grid grid-cols-[minmax(0,44%)_minmax(0,1fr)] items-baseline gap-2 py-0.5 text-[13px]">
                  <dt className="truncate text-muted-foreground" title={t(x.labelKey)}>{t(x.labelKey)}</dt>
                  <dd className="min-w-0 truncate font-medium tabular-nums" title={x.value ?? undefined}>
                    {x.value ?? (x.optional ? <span className="text-muted-foreground">—</span> : <span className="font-normal text-warning">{t('dossier.sheetEmpty')}</span>)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </section>
  );
}
