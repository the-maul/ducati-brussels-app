/**
 * M8 — Kilométrage inférieur (Q64) : le message dit d'où vient le dernier relevé, par exemple
 * « OR-2026-00005 du 19/11/2026 » (retour de Domenico, 23/11/2026).
 * Si la source ne peut pas être lue, le message simple reste affiché : on ne bloque jamais.
 */
import { supabase } from '@/integrations/supabase/client';
import { fillVars, t } from '@/lib/i18n';
import { vehicleMileageReadings } from './api';
import { formatOrDate, type MileageReading } from './rules';

/** Le relevé à l'origine du blocage : même km, le plus récent. */
export function lowerReadingSource(readings: readonly MileageReading[], last: number): MileageReading | null {
  const same = readings.filter((r) => r.km === last);
  if (!same.length) return null;
  return [...same].sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')))[0];
}

export async function lowerMileageMessage(target: { vehicleId?: string | null; orId?: string | null }, km: number, last: number): Promise<string> {
  const kmText = km.toLocaleString('fr-BE');
  const lastText = last.toLocaleString('fr-BE');
  const plain = fillVars(t('q64.errLower'), { km: kmText, last: lastText });
  try {
    let vehicleId = target.vehicleId ?? null;
    if (!vehicleId && target.orId) {
      const { data } = await supabase.from('repair_orders').select('vehicle_id').eq('id', target.orId).maybeSingle();
      vehicleId = (data as { vehicle_id: string | null } | null)?.vehicle_id ?? null;
    }
    if (!vehicleId) return plain;
    const source = lowerReadingSource(await vehicleMileageReadings(vehicleId), last);
    if (!source) return plain;
    return fillVars(t('orBase.lowerBody'), {
      km: kmText, last: lastText,
      date: formatOrDate(source.at ? source.at.slice(0, 10) : null) || '-',
      ref: source.ref ? fillVars(t('orBase.lastReadingRef'), { ref: source.ref }) : '',
    });
  } catch {
    return plain;
  }
}
