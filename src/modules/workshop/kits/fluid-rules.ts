/**
 * Rattrapage G8 (19/11/2026, lot forfaits) — liquides des kits d'entretien : regles PURES,
 * miroir des fonctions SQL `_maintenance_fluid_convert` et `_maintenance_engine_profile_for`
 * (migration 20261119140000). Le serveur fait foi ; tests : tests/forfaits-g8.test.ts.
 *
 *  - Une ligne « huile moteur 3,4 l » du manuel devient « MOTO 4XT TECH EN FUT x 3,4 » (vendu au
 *    litre) ; « huile de fourche 521 cc » devient « HUILE DE FOURCHE ELF x 2 » (flacons de 0,5 l,
 *    arrondi a l'unite superieure). La quantite de la source reste dans la provenance.
 *  - Quand la source ne donne pas la quantite, on prend celle du forfait G8 de la famille moteur
 *    (profil), marquee « quantite reprise du forfait G8 ».
 */

export type FluidConversion = {
  /** Quantite de la source ramenee en litres (null : unite inconnue). */
  liters: number | null;
  /** Quantite dans l'unite de vente de l'article (null : non calculable). */
  quantity: number | null;
  /** Vraisemblable : entre 0,05 et 10 litres, sans correction d'unite. */
  plausible: boolean;
  /** « 587,5 l » lu comme 587,5 cm3 (quantite >= 100 annoncee en litres). */
  corrected: boolean;
};

const LITER_UNITS = new Set(['l', 'lt', 'litre', 'litres', 'dm3', 'dm³']);
const ML_UNITS = new Set(['cc', 'cm3', 'cm³', 'ml']);

/** Facteur unite -> litres ; null si l'unite n'est pas reconnue. */
export function literFactor(unit: string | null | undefined): number | null {
  const u = String(unit ?? '').trim().toLowerCase();
  if (LITER_UNITS.has(u)) return 1;
  if (ML_UNITS.has(u)) return 0.001;
  return null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function convertFluidQuantity(
  qty: number | null | undefined, unit: string | null | undefined,
  litersPerUnit: number | null | undefined, wholeUnits: boolean,
): FluidConversion {
  const k = literFactor(unit);
  const q = Number(qty);
  if (k === null || !Number.isFinite(q) || q <= 0) return { liters: null, quantity: null, plausible: false, corrected: false };
  const corrected = k === 1 && q >= 100;
  const liters = corrected ? q * 0.001 : q * k;
  const per = Number(litersPerUnit);
  const raw = per > 0 ? liters / per : liters;
  const quantity = wholeUnits ? Math.ceil(Math.round(raw * 1e6) / 1e6) : round2(raw);
  return { liters: Math.round(liters * 1e6) / 1e6, quantity, plausible: liters >= 0.05 && liters <= 10, corrected };
}

export type FluidVolume = { valeur: number; unite?: string | null; type?: string; condition?: string | null };

/**
 * Volume a retenir sur une ligne de ravitaillement du manuel (miroir de la fonction SQL
 * `_maintenance_fluid_service_volume`, migration 20261123133000). Huile moteur : le volume de
 * revision avec filtre, jamais « moteur a sec » ; s'il n'y a que celui-la, rien (a completer).
 */
export function pickServiceVolume(quantities: ReadonlyArray<FluidVolume> | null | undefined, family: string): FluidVolume | null {
  const isOil = family === 'huile_moteur';
  const cond = (q: FluidVolume) => String(q.condition ?? '').toLowerCase();
  const rank = (q: FluidVolume) => {
    if (isOil && /(r[ée]vision|remplacement|vidange|filtre)/.test(cond(q))) return 0;
    return q.condition == null ? 1 : 2;
  };
  const usable = (quantities ?? [])
    .filter((q) => (q.type ?? 'volume') === 'volume')
    .filter((q) => !isOil || !/(^|[^\p{L}])sec($|[^\p{L}])/u.test(cond(q)));
  return usable.reduce<FluidVolume | null>((best, q) => (best === null || rank(q) < rank(best) ? q : best), null);
}

/** Ligne de kit apres rattachement : quantite, niveau, provenance de la quantite. */
export type FluidLinkResult = {
  quantity: number;
  confidence: 'sur' | 'a_confirmer';
  quantitySource: 'manuel' | 'forfait_g8' | 'a_verifier';
};

/**
 * Regle de rattachement d'une ligne de liquide (meme ordre que la fonction SQL) :
 *  1. quantite donnee par la source et vraisemblable -> convertie, « sur » ;
 *  2. sinon, si un profil G8 donne une quantite (huile moteur) -> celle-ci, « sur », « forfait_g8 » ;
 *  3. sinon -> 1 unite, « a confirmer ».
 */
export function linkFluidLine(p: {
  qty: number | null; unit: string | null; qtyFromSource: boolean;
  litersPerUnit: number | null; wholeUnits: boolean; profileQuantity?: number | null;
}): FluidLinkResult {
  const c = convertFluidQuantity(p.qty, p.unit, p.litersPerUnit, p.wholeUnits);
  if (p.qtyFromSource && c.plausible && !c.corrected && c.quantity && c.quantity > 0) {
    return { quantity: c.quantity, confidence: 'sur', quantitySource: 'manuel' };
  }
  if (p.profileQuantity && p.profileQuantity > 0) {
    return { quantity: p.profileQuantity, confidence: 'sur', quantitySource: 'forfait_g8' };
  }
  return { quantity: 1, confidence: 'a_confirmer', quantitySource: 'a_verifier' };
}

export type EngineProfileLike = {
  code: string; priority: number; pattern: string; exclude: string | null;
  yearFrom: number | null; yearTo: number | null; active?: boolean;
};

/**
 * Premier profil (priorite croissante) dont le motif correspond a la carte d'identite du kit
 * (libelle + modeles du catalogue) et dont les annees encadrent celles du kit.
 */
export function matchEngineProfile<P extends EngineProfileLike>(
  descriptor: string, minYear: number | null, maxYear: number | null, profiles: ReadonlyArray<P>,
): P | null {
  const sorted = [...profiles].filter((p) => p.active !== false).sort((a, b) => a.priority - b.priority);
  for (const p of sorted) {
    if (!new RegExp(p.pattern, 'i').test(descriptor)) continue;
    if (p.exclude && new RegExp(p.exclude, 'i').test(descriptor)) continue;
    if (p.yearFrom != null && (minYear == null || minYear < p.yearFrom)) continue;
    if (p.yearTo != null && (maxYear == null || maxYear > p.yearTo)) continue;
    return p;
  }
  return null;
}
