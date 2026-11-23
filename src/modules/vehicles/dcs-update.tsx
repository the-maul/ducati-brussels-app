/**
 * Mise à jour d'une moto depuis le DCS par l'extension (Simon, 23/11/2026) : lancée à la création
 * d'une moto et par un bouton sur chaque fiche. Rien n'est lancé sans VIN complet.
 */
import { useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';
import { requestMyDucati } from '@/lib/myducati';
import { normalizeVin } from '@/lib/vin';

export const canAskDcs = (vin: string | null | undefined) => normalizeVin(vin ?? '').length === 17;

export async function launchDcsUpdate(vin: string | null | undefined, auto = false): Promise<boolean> {
  if (!canAskDcs(vin)) return false;
  const ok = await requestMyDucati(normalizeVin(vin as string));
  if (ok) toast.info(t('vehicles.ducatiUpdating'));
  // À la création, la moto est bien enregistrée : l'extension absente n'est pas une erreur.
  else if (auto) toast.info(t('vehicles.ducatiExtMissing'));
  else toast.error(t('vehicles.ducatiExtMissing'));
  return ok;
}

export function DcsUpdateButton({ vin, size = 'default' }: { vin: string | null | undefined; size?: 'default' | 'sm' }) {
  const [busy, setBusy] = useState(false);
  if (!canAskDcs(vin)) return null;
  return (
    <Button type="button" variant="outline" size={size} disabled={busy} title={t('vehicles.ducatiUpdateHint')}
      onClick={() => { setBusy(true); void launchDcsUpdate(vin).finally(() => setBusy(false)); }}>
      {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />} {t('vehicles.ducatiUpdate')}
    </Button>
  );
}
