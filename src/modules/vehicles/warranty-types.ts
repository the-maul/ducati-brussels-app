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
