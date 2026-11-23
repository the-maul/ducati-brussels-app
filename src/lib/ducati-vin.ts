/**
 * Décodeur VIN Ducati — 2 niveaux.
 * 1) VIN EXACT connu des factures (table `ducati_vin_facts`) -> fiche riche
 *    (modèle, couleur, n° moteur, plaque, mise en circulation, fin de garantie, km…).
 * 2) Sinon, générique par code VDS (table `ducati_vds`) -> modèle/cylindrée/CV/Euro.
 * Toujours déterministe : marque (ZDM), année (pos 10), usine (pos 11).
 */
import { supabase } from '@/integrations/supabase/client';
import { vinYear } from '@/lib/vin-identify';

const PLANTS: Record<string, string> = { B: 'Bologne (Italie)' };

export type DucatiVinDecode = {
  vds: string; brand: string; year?: number; plant?: string;
  source: 'facts' | 'vds' | 'none';
  model?: string; displacement?: number; powerCv?: number; euro?: string;
  cylinders?: number; modelYear?: number;
  color?: string; engineNumber?: string; plate?: string;
  firstRegistrationDate?: string; warrantyEnd?: string;
  category?: string; origin?: string; mileage?: number; reference?: string;
  known: boolean;
};

export function isDucatiVin(vin: string): boolean {
  return /^ZDM[A-Z0-9]{14}$/.test(vin.trim().toUpperCase());
}

export async function decodeDucatiVin(vin: string): Promise<DucatiVinDecode | null> {
  const v = vin.trim().toUpperCase();
  if (!isDucatiVin(v)) return null;
  const vds = v.slice(3, 9);
  const year = vinYear(v[9]) ?? undefined;
  const plant = PLANTS[v[10]];
  const base = { vds, brand: 'DUCATI', year, plant } as const;

  // 1) Faits exacts (factures)
  const { data: fx } = await supabase.from('ducati_vin_facts').select('*').eq('vin', v).maybeSingle();
  if (fx) {
    return {
      ...base, source: 'facts', known: true,
      model: fx.model ?? undefined, displacement: fx.displacement ?? undefined,
      powerCv: fx.power_cv ?? undefined, euro: fx.antipollution ?? undefined,
      cylinders: fx.cylinders ?? undefined, modelYear: fx.model_year ?? undefined,
      year: fx.model_year ?? year,
      color: fx.color ?? undefined, engineNumber: fx.engine_number ?? undefined, plate: fx.plate ?? undefined,
      firstRegistrationDate: fx.first_registration_date ?? undefined, warrantyEnd: fx.warranty_end ?? undefined,
      category: fx.category ?? undefined, origin: fx.origin ?? undefined,
      mileage: fx.mileage ?? undefined, reference: fx.reference ?? undefined,
    };
  }

  // 2) Générique par VDS
  const { data } = await supabase.from('ducati_vds')
    .select('model, displacement_cc, power_cv, euro').eq('vds', vds).maybeSingle();
  return {
    ...base, source: data ? 'vds' : 'none', known: !!data,
    model: data?.model ?? undefined, displacement: data?.displacement_cc ?? undefined,
    powerCv: data?.power_cv ?? undefined, euro: data?.euro ?? undefined,
  };
}
