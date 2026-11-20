/**
 * M8 — Adresse de la fiche OR `/workshop/$orId` (constat du 20/11/2026, erreurs 400 de « Mon atelier »).
 *
 * `/workshop/mon-atelier` (le nom francais de l'ecran, tape ou garde en favori) n'est pas une page :
 * le routeur la prenait pour la fiche de l'OR « mon-atelier » et la fiche lancait ses requetes
 * (OR, lignes, pieces jointes, temps, parcours, dossier accident) avec un identifiant invalide :
 * ~6 reponses 400 par chargement. Regles pures, sans React ni base.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Un identifiant d'OR valide (uuid). Tout le reste : « Introuvable », sans requete. */
export function isOrRouteId(id: string | null | undefined): boolean {
  return !!id && UUID_RE.test(id.trim());
}

/** Noms d'ecrans de l'atelier tapes a la place d'un n° d'OR → leur vraie adresse. */
const ALIASES: Record<string, '/workshop/my-workshop' | '/workshop/new' | '/workshop/chrono'> = {
  'mon-atelier': '/workshop/my-workshop',
  'mon_atelier': '/workshop/my-workshop',
  'monatelier': '/workshop/my-workshop',
  'mijn-werkplaats': '/workshop/my-workshop',
  'mia-officina': '/workshop/my-workshop',
  'nouveau': '/workshop/new',
  'pointeuse': '/workshop/chrono',
};

export function workshopPathAlias(id: string | null | undefined): (typeof ALIASES)[string] | null {
  if (!id) return null;
  let key = id;
  try { key = decodeURIComponent(id); } catch { /* adresse mal formee : telle quelle */ }
  return ALIASES[key.trim().toLowerCase()] ?? null;
}
