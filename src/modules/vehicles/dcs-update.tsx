/**
 * Mise à jour d'une moto depuis le DCS par l'extension (Simon, 23/11/2026) : lancée à la création
 * d'une moto et par un bouton sur chaque fiche. Rien n'est lancé sans VIN complet.
 */
import { useState } from 'react';
import { CheckCircle2, CircleDashed, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';
import { useDcsRunning } from '@/lib/dcs-progress';
import { requestMyDucati } from '@/lib/myducati';
import { normalizeVin } from '@/lib/vin';

export const canAskDcs = (vin: string | null | undefined) => normalizeVin(vin ?? '').length === 17;

export async function launchDcsUpdate(vin: string | null | undefined, auto = false): Promise<boolean> {
  if (!canAskDcs(vin)) return false;
  const ok = await requestMyDucati(normalizeVin(vin as string));
  // Lancée : le chargement s'affiche sur la page. À la création, la moto est bien enregistrée :
  // l'extension absente n'est pas une erreur.
  if (!ok && auto) toast.info(t('vehicles.ducatiExtMissing'));
  else if (!ok) toast.error(t('vehicles.ducatiExtMissing'));
  return ok;
}

export function DcsUpdateButton({ vin, syncedAt = null, size = 'default' }: {
  vin: string | null | undefined;
  /** Dernière lecture DCS enregistrée sur la fiche. */
  syncedAt?: string | null;
  size?: 'default' | 'sm';
}) {
  const [asking, setAsking] = useState(false);
  const running = useDcsRunning();
  const busy = asking || running.includes(normalizeVin(vin ?? ''));
  if (!canAskDcs(vin)) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" size={size} disabled={busy} title={t('vehicles.ducatiUpdateHint')}
        onClick={() => { setAsking(true); void launchDcsUpdate(vin).finally(() => setAsking(false)); }}>
        {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />} {t('vehicles.ducatiUpdate')}
      </Button>
      <span role="status" className={`inline-flex items-center gap-1 text-[12px] font-medium ${busy ? 'text-info' : syncedAt ? 'text-success' : 'text-muted-foreground'}`}>
        {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden />
          : syncedAt ? <CheckCircle2 className="size-3.5" aria-hidden /> : <CircleDashed className="size-3.5" aria-hidden />}
        {busy ? t('dossier.dcsLoading')
          : syncedAt ? t('dossier.dcsReadOn').replace('{date}', new Date(syncedAt).toLocaleString('fr-BE', { dateStyle: 'short', timeStyle: 'short' }))
            : t('dossier.dcsNeverRead')}
      </span>
    </span>
  );
}
