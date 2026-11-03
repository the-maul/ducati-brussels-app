/**
 * Etat des listes dans l'adresse (UX011, retour client du 03/11/2026).
 *
 * « Le bouton Retour ne revient pas a la page d'avant avec la selection. » Les listes
 * principales (Pieces, Clients, Ventes, Atelier, Vehicules, Commandes, CRM) gardaient leur
 * recherche, leurs filtres, leur onglet et leur page dans l'etat React : en ouvrant une fiche,
 * la liste etait demontee et Retour la retrouvait vierge. Ces valeurs vivent maintenant dans
 * les parametres de recherche de l'adresse (search params TanStack) : Retour, un rechargement
 * ou un lien copie retrouvent exactement la meme liste.
 *
 * Logique pure ici (testee) ; le branchement React est dans `use-list-search.ts`.
 *
 * Regles :
 * - chaque liste declare ses valeurs par defaut (le type de chaque cle en decoule) ;
 * - une valeur egale au defaut n'apparait pas dans l'adresse (adresse courte et lisible) ;
 * - une valeur illisible ou hors liste (`choices`) retombe sur le defaut, sans erreur ;
 * - un objet plat de cases a cocher (ex. filtres « contenu » des ventes) est accepte.
 */

export type ListPrimitive = string | number | boolean;
export type ListValue = ListPrimitive | Record<string, ListPrimitive>;
export type ListValues = Record<string, ListValue>;
/** Valeurs permises pour les cles texte (onglet, statut, tri...). */
export type ListChoices<T extends ListValues> = Partial<{ [K in keyof T]: readonly string[] }>;

const MAX_TEXT = 200;

function coercePrimitive(raw: unknown, def: ListPrimitive): ListPrimitive {
  if (typeof def === 'number') {
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : def;
  }
  if (typeof def === 'boolean') {
    if (raw === true || raw === 'true' || raw === 1 || raw === '1') return true;
    if (raw === false || raw === 'false' || raw === 0 || raw === '0') return false;
    return def;
  }
  if (typeof raw === 'string') return raw.slice(0, MAX_TEXT);
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  return def;
}

function coerce(raw: unknown, def: ListValue, choices?: readonly string[]): ListValue {
  if (typeof def === 'object') {
    let obj: unknown = raw;
    if (typeof raw === 'string') {
      try { obj = JSON.parse(raw); } catch { obj = null; }
    }
    const src = obj && typeof obj === 'object' && !Array.isArray(obj) ? (obj as Record<string, unknown>) : {};
    const out: Record<string, ListPrimitive> = {};
    for (const k of Object.keys(def)) out[k] = coercePrimitive(src[k], def[k]);
    return out;
  }
  const v = coercePrimitive(raw, def);
  if (choices && typeof v === 'string' && !choices.includes(v)) return def;
  return v;
}

function sameValue(a: ListValue, b: ListValue): boolean {
  if (typeof a === 'object' || typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b);
  return a === b;
}

/** Lit l'adresse : toutes les cles de la liste, valeur lue ou defaut. */
export function readListSearch<T extends ListValues>(raw: Record<string, unknown> | null | undefined, defaults: T, choices?: ListChoices<T>): T {
  const src = raw ?? {};
  const out = {} as Record<string, ListValue>;
  for (const k of Object.keys(defaults)) out[k] = coerce(src[k], defaults[k], choices?.[k as keyof T]);
  return out as T;
}

/**
 * Ce que la route garde dans son `validateSearch` : seulement les cles differentes du defaut
 * (toutes facultatives, donc un lien `to="/parts"` reste valide sans parametre).
 */
export function listSearchFromRaw<T extends ListValues>(raw: Record<string, unknown> | null | undefined, defaults: T, choices?: ListChoices<T>): Partial<T> {
  const values = readListSearch(raw, defaults, choices);
  const out: Partial<T> = {};
  for (const k of Object.keys(defaults) as (keyof T)[]) {
    if (!sameValue(values[k], defaults[k])) out[k] = values[k];
  }
  return out;
}

/**
 * Applique une modification a l'adresse courante : les cles de la liste egales au defaut
 * sont retirees, les autres parametres (ex. `lead` du CRM) sont gardes tels quels.
 */
export function applyListPatch<T extends ListValues>(
  prevRaw: Record<string, unknown> | null | undefined,
  patch: Partial<T>,
  defaults: T,
  choices?: ListChoices<T>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(prevRaw ?? {}) };
  for (const k of Object.keys(patch) as (keyof T & string)[]) {
    if (!(k in defaults)) continue;
    const v = coerce(patch[k], defaults[k], choices?.[k]);
    if (sameValue(v, defaults[k])) delete next[k];
    else next[k] = v;
  }
  return next;
}
