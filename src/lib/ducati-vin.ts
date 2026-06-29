/**
 * Décodeur VIN Ducati — 2 niveaux.
 * 1) VIN EXACT connu des factures (table `ducati_vin_facts`) -> fiche riche
 *    (modèle, couleur, n° moteur, plaque, mise en circulation, fin de garantie, km…).
 * 2) Sinon, générique par code VDS (table `ducati_vds`) -> modèle/cylindrée/CV/Euro.
 * Toujours déterministe : marque (ZDM), année (pos 10), usine (pos 11).
 */
import { supabase } from '@/integrations/supabase/client';

const YEAR_CODES: Record<string, number> = {
  A: 2010, B: 2011, C: 2012, D: 2013, E: 2014, F: 2015, G: 2016, H: 2017, J: 2018, K: 2019,
  L: 2020, M: 2021, N: 2022, P: 2023, R: 2024, S: 2025, T: 2026, V: 2027, W: 2028, X: 2029, Y: 2030,
  '1': 2031, '2': 2032, '3': 2033, '4': 2034, '5': 2035, '6': 2036, '7': 2037, '8': 2038, '9': 2039,
};
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
  const year = YEAR_CODES[v[9]];
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
