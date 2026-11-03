/**
 * M8 — « L'entretien choisi » (mission 10, carte 1, M-109 / M-110) : une seule donnee, portee par
 * l'OR et le RDV (`service_code`), qui pilote le kit, le check-up, la picking list, le parcours
 * technicien et le prochain entretien. Codes = types d'echeance du manuel Ducati :
 *   annual     = Annual Service        (« Entretien annuel »)
 *   oil        = Oil Service           (« Entretien annuel + huile »)
 *   first_1000 = 1er entretien 1 000 km
 *   desmo      = Desmo Service
 * Regles pures, miroir des fonctions SQL de la migration 20261103270000 (workshop_service_for_reason,
 * workshop_service_kit_codes, _workshop_service_kit_items, maintenance_service_kind).
 */

export const SERVICE_CODES = ['annual', 'oil', 'first_1000', 'desmo'] as const;
export type ServiceCode = (typeof SERVICE_CODES)[number];

export function isServiceCode(v: unknown): v is ServiceCode {
  return typeof v === 'string' && (SERVICE_CODES as readonly string[]).includes(v);
}

/** Motif d'entree -> entretien (regle d'origine ; le reglage du motif `extra.service_code` prime). */
const REASON_TO_SERVICE: Record<string, ServiceCode> = {
  entretien_annuel: 'annual',
  entretien_annuel_huile: 'oil',
  entretien_1000: 'first_1000',
  // retires de la liste (M-109), gardes pour les anciens OR
  entretien_15000: 'oil',
  entretien_30000: 'desmo',
};

/** Motif a proposer pour un entretien (espace client, RDV pris depuis la fiche moto). */
export const SERVICE_TO_REASON: Record<ServiceCode, string | null> = {
  annual: 'entretien_annuel',
  oil: 'entretien_annuel_huile',
  first_1000: 'entretien_1000',
  desmo: null,
};

/**
 * L'entretien d'un motif. `configured` = valeur `extra.service_code` du motif (Parametres -> Tables),
 * prioritaire ; sinon la regle d'origine ; un motif sans entretien (pneus, freins, vidange...) -> null.
 */
export function serviceCodeForReason(reason: string | null | undefined, configured?: string | null): ServiceCode | null {
  if (configured && isServiceCode(configured.trim())) return configured.trim() as ServiceCode;
  if (!reason) return null;
  return REASON_TO_SERVICE[reason] ?? null;
}

/** Cle i18n du libelle de l'atelier (« Entretien annuel (Annual Service) »...). */
export function serviceLabelKey(code: ServiceCode): string {
  return `reservation.service_${code}`;
}

/** Les types de kit a reunir pour un entretien : annuel + huile = Annual Service + Oil Service (M-109). */
export function kitKindsFor(code: string | null | undefined): ServiceCode[] {
  switch (code) {
    case 'annual': return ['annual'];
    case 'oil': return ['annual', 'oil'];
    case 'first_1000': return ['first_1000'];
    case 'desmo': return ['desmo'];
    default: return [];
  }
}

export type KitItemLike = {
  articleId: string | null;
  reference: string | null;
  familyCode?: string | null;
  designation: string;
  quantity: number;
};

/** Cle de dedoublonnage d'une piece entre deux kits : article, sinon reference, famille, designation. */
export function kitItemKey(i: KitItemLike): string {
  if (i.articleId) return i.articleId;
  const ref = (i.reference ?? '').trim().toUpperCase();
  if (ref) return ref;
  if (i.familyCode) return `fam:${i.familyCode}`;
  return `des:${i.designation.trim().toLowerCase()}`;
}

/**
 * Reunit les kits d'un entretien (dans l'ordre de `kitKindsFor`) : une piece une seule fois, la plus
 * grande quantite gagne. Quand l'Annual Service contient deja la vidange, « annuel + huile » donne
 * exactement le kit annuel : pas de double huile, pas de double filtre.
 */
export function mergeServiceKits<T extends KitItemLike>(kits: T[][]): T[] {
  const out = new Map<string, T>();
  for (const kit of kits) {
    for (const item of kit) {
      const key = kitItemKey(item);
      const cur = out.get(key);
      if (!cur || item.quantity > cur.quantity) out.set(key, item);
    }
  }
  return [...out.values()];
}

/**
 * Type d'une echeance d'apres son nom ou son code (manuel « Oil Service 1000km/600mi », plan « oil »,
 * extract DCS « Annual Service ») : miroir de maintenance_service_kind (SQL, kits du 03/11).
 */
export function serviceKindOf(label: string | null | undefined, km?: number | null, months?: number | null): ServiceCode | null {
  const s = String(label ?? '').toLowerCase();
  if (km === 1000 || /(^|[^0-9])1[_ .]?000([^0-9]|$)/.test(s) || /(first|premier|1er)/.test(s)) return 'first_1000';
  if (/(desmo|valve|soupape)/.test(s)) return 'desmo';
  if (/(oil|huile)/.test(s)) return 'oil';
  if (/(annual|annuel|temporel|12_?mois)/.test(s)) return 'annual';
  if (months != null && km == null) return 'annual';
  if (km != null && km >= 10000 && km <= 15000) return 'oil';
  if (km != null && km >= 20000 && km <= 30000) return 'desmo';
  return null;
}

/**
 * Choisit dans une liste d'echeances (plan, manuel) celle de l'entretien choisi : meme type d'abord,
 * le plus petit km a egalite ; rien si aucune ne correspond (on ne devine pas une autre echeance).
 */
export function pickServiceForCode<T extends { name: string; code?: string | null; km?: number | null; kmFirst?: number | null; kmInterval?: number | null; months?: number | null }>(
  services: T[], code: string | null | undefined,
): T | null {
  if (!code || !services.length) return null;
  const matches = services.filter((s) => {
    const km = s.km ?? s.kmFirst ?? s.kmInterval ?? null;
    return (serviceKindOf(s.code ?? '', null, null) ?? serviceKindOf(s.name, km, s.months ?? null)) === code;
  });
  if (!matches.length) return null;
  return [...matches].sort((a, b) => (a.km ?? a.kmFirst ?? a.kmInterval ?? Infinity) - (b.km ?? b.kmFirst ?? b.kmInterval ?? Infinity))[0];
}
