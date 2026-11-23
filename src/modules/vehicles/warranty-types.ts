/**
 * Types de garantie d'une moto (Domenico et Simon, 23/11/2026). Ces libellés sont ceux du DCS : ils
 * serviront aux demandes de garantie. CarGarantie se précise par une formule.
 */
export const WARRANTY_TYPES = [
  'Conventionnelle (24 mois)',
  'Factory Ever Red +12',
  'Factory Ever Red +24',
  'CarGarantie',
] as const;

export const FOUR_EVER_WARRANTY = '4Ever Ducati (48 mois)';

const compact = (v: unknown) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** 4Ever Ducati : famille Multistrada à partir de 2020, et DesertX quelle que soit l'année (Simon, 23/11/2026). */
export function isFourEverEligible(v: { category?: unknown; model?: unknown; model_year?: unknown }): boolean {
  const family = compact(v.category);
  const model = compact(v.model);
  if (family.startsWith('DESERTX') || model.startsWith('DESERTX')) return true;
  if (family !== 'MULTISTRADA' && !model.startsWith('MULTISTRADA')) return false;
  const year = Number(v.model_year);
  return Number.isFinite(year) && year >= 2020;
}

/** Choix proposés pour cette moto. Une valeur déjà sur la fiche reste affichée par la liste. */
export function warrantyTypesFor(v: { category?: unknown; model?: unknown; model_year?: unknown }): readonly string[] {
  if (!isFourEverEligible(v)) return WARRANTY_TYPES;
  const last = WARRANTY_TYPES.length - 1;
  return [...WARRANTY_TYPES.slice(0, last), FOUR_EVER_WARRANTY, WARRANTY_TYPES[last]];
}

export const CARGARANTIE_PLANS = [
  'EverRed (12 mois)',
  'EverRed (24 mois)',
  'EverRed (36 mois)',
  'EverRed Plus (12 mois)',
] as const;

export const isCarGarantie = (type: unknown) => String(type ?? '').trim().toUpperCase() === 'CARGARANTIE';

/** La formule n'existe que pour CarGarantie. */
export function warrantyPlanFor(type: unknown, plan: unknown): string | null {
  const p = String(plan ?? '').trim();
  return isCarGarantie(type) && p ? p : null;
}

/**
 * Type lu au DCS. « - » ne dit rien. Une CarGarantie choisie à la main est conservée : le DCS peut
 * n'afficher que la garantie constructeur de la même moto.
 */
export function dcsWarrantyType(raw: unknown, current: unknown): string | undefined {
  if (isCarGarantie(current)) return undefined;
  const s = String(raw ?? '').trim();
  return s && s !== '-' ? s : undefined;
}
