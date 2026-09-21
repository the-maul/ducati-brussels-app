/**
 * Mission 06, carte 4 — appel de la reconnaissance hors ligne `vin_identify` (base).
 * Référentiel sans donnée personnelle, appelable par l'équipe et par l'espace client.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { isFullVin, type VinIdentifyResult } from '@/lib/vin-identify';
import { normalizeVin } from '@/lib/vin';

// Fonction ajoutée par la migration 20260921210000 (types.ts pas encore régénéré).
const rpcUntyped = supabase.rpc.bind(supabase) as unknown as (
  fn: string, args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

export async function identifyVin(vin: string): Promise<VinIdentifyResult | null> {
  const v = normalizeVin(vin);
  if (!isFullVin(v)) return null;
  const { data, error } = await rpcUntyped('vin_identify', { _vin: v });
  if (error) throw new Error(error.message);
  return (data as VinIdentifyResult | null) ?? null;
}

/** Reconnaissance dès que le VIN est complet (17 caractères valides). */
export function useVinIdentify(vin: string | null | undefined) {
  const v = normalizeVin(vin);
  return useQuery({
    queryKey: ['vin-identify', v],
    queryFn: () => identifyVin(v),
    enabled: isFullVin(v),
    staleTime: Infinity,
    retry: false,
  });
}
