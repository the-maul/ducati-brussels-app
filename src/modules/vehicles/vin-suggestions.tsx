/**
 * Motos du parc proposées pendant la saisie du n° de châssis (retour de Domenico, 23/11/2026).
 * Sur la fiche d'un client, une moto trouvée s'attribue à ce client. Le changement de propriétaire
 * passe par `vehicle_attach_owner` (tracé) ; le statut et le stock de la moto ne bougent pas :
 * une moto du stock n'en sort que par une vente facturée.
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Bike, Link2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/confirm-provider';
import { fillVars, t } from '@/lib/i18n';
import { parseVinQuery } from '@/lib/vin-search';
import { searchVehiclesByVinPattern, vehicleLabel, type VinMatch } from './api';

const STOCK_STATUSES = ['stock_vn', 'stock_vo', 'repris', 'reserve', 'depot_vente', 'courtoisie'];

/** Ce que l'attribution change, dit avant de confirmer. */
export function vinAttachMessage(m: { owner_id?: string | null; owner_name?: string | null; status: string }): string {
  if (m.owner_id) return fillVars(t('motoClient.vinAttachFromClient'), { owner: m.owner_name ?? t('motoClient.noOwner') });
  return STOCK_STATUSES.includes(m.status)
    ? fillVars(t('motoClient.vinAttachFromStock'), { status: t(`vehicles.status_${m.status}`) })
    : t('motoClient.vinAttachNoOwner');
}

export function VinSuggestions({ companyId, term, client, ownerFrom, onAttach, attaching }: {
  companyId: string;
  term: string;
  client?: { id: string; name: string } | null;
  ownerFrom: string;
  onAttach?: (vehicleId: string, ownerFrom: string) => void;
  attaching?: boolean;
}) {
  const confirm = useConfirm();
  const [deb, setDeb] = useState(term);
  useEffect(() => { const id = setTimeout(() => setDeb(term), 200); return () => clearTimeout(id); }, [term]);
  const query = parseVinQuery(deb);
  // VIN complet : le bloc « Ce VIN existe déjà » prend le relais.
  const active = !!query && !(query.mode === 'starts' && query.text.length >= 17);
  const q = useQuery({
    queryKey: ['vin-suggestions', companyId, query?.mode, query?.text],
    queryFn: () => searchVehiclesByVinPattern(companyId, deb),
    enabled: active,
    staleTime: 30_000,
  });
  if (!active) return null;

  const attach = async (m: VinMatch) => {
    if (!client || !onAttach) return;
    const ok = await confirm({
      title: fillVars(t('motoClient.vinAttachTitle'), { client: client.name }),
      message: vinAttachMessage(m), confirmLabel: t('motoClient.vinAttach'), cancelLabel: t('action.cancel'),
    });
    if (ok) onAttach(m.id, ownerFrom);
  };

  const rows = q.data ?? [];
  return (
    <div className="col-span-full rounded-md border border-border bg-card p-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[13px] font-bold">{t('motoClient.vinFound')}</p>
        <p className="text-[12px] text-muted-foreground">{t('motoClient.vinHelp')}</p>
      </div>
      {q.isLoading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      {q.error && <p className="text-[13px] text-danger">{(q.error as Error).message}</p>}
      {!q.isLoading && !q.error && rows.length === 0 && <p className="text-[13px] text-muted-foreground">{t('motoClient.vinNone')}</p>}
      {rows.length > 0 && (
        <ul className="space-y-1.5">
          {rows.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border px-3 py-2 text-[13px]">
              <Bike className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="font-medium">{vehicleLabel(m)}</span>
              <span className="font-mono text-[12px]">{m.vin}</span>
              {m.plate && <span className="font-mono text-[12px] text-muted-foreground">{m.plate}</span>}
              <span className="text-[12px] text-muted-foreground">{t(`vehicles.status_${m.status}`)}</span>
              <span className="text-[12px] text-muted-foreground">{t('motoClient.currentOwner')}{m.owner_name ?? t('motoClient.noOwner')}</span>
              <span className="ml-auto flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" asChild>
                  <Link to="/vehicles/$vehicleId" params={{ vehicleId: m.id }} target="_blank">{t('motoClient.openExisting')}</Link>
                </Button>
                {client && onAttach && (
                  m.owner_id === client.id
                    ? <span className="self-center text-[12px] font-medium text-success">{t('motoClient.vinAlready')}</span>
                    : (
                      <Button type="button" size="sm" disabled={attaching} onClick={() => { void attach(m); }}>
                        {attaching ? <Loader2 className="animate-spin" /> : <Link2 />} {t('motoClient.vinAttach')}
                      </Button>
                    )
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
