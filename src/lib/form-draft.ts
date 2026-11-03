/**
 * Brouillon des formulaires en cours (UX011, retour client du 03/11/2026).
 *
 * Vecu : sur « Nouvel OR », on choisit le client et la moto, on ouvre un autre ecran (fiche
 * moto, « Ajouter une moto »), Retour → le formulaire revient vide. Le formulaire etait
 * demonte, sa saisie perdue. Desormais les formulaires de creation (OR, document de vente,
 * client, article) gardent leur saisie dans `sessionStorage` (propre a l'onglet, efface a sa
 * fermeture), la restaurent a leur retour et l'effacent :
 * - a l'enregistrement (`clearFormDraft`) ;
 * - a l'abandon explicite : bouton Retour de l'en-tete (apres confirmation si modifie) ou
 *   « Recommencer a zero » du bandeau de brouillon restaure (`discardActiveDrafts`, `discard`).
 *
 * Logique pure + petit registre ici (teste) ; le hook React est `use-form-draft.ts`.
 * Cle = route + identifiant (societe active pour une creation) : jamais le brouillon d'une
 * societe dans l'autre.
 */

export const DRAFT_PREFIX = 'dms-draft:v1:';
/** Au-dela, un brouillon oublie n'est plus propose (une journee de travail). */
export const DRAFT_TTL_MS = 12 * 60 * 60 * 1000;

export type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** `formDraftKey('/workshop/new', companyId)` → `dms-draft:v1:/workshop/new#<societe>`. */
export function formDraftKey(route: string, id?: string | null): string {
  const r = (route || '/').split('?')[0].split('#')[0];
  return `${DRAFT_PREFIX}${r}${id ? `#${id}` : ''}`;
}

export function serializeDraft(value: unknown, now: number): string {
  return JSON.stringify({ at: now, value });
}

/** Lit un brouillon : `null` s'il est absent, illisible ou trop vieux. */
export function parseDraft<T = unknown>(raw: string | null | undefined, now: number, ttlMs = DRAFT_TTL_MS): T | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as { at?: unknown; value?: unknown };
    if (!obj || typeof obj !== 'object' || typeof obj.at !== 'number') return null;
    if (now - obj.at > ttlMs || obj.at - now > 60_000) return null;
    if (obj.value === undefined || obj.value === null) return null;
    return obj.value as T;
  } catch {
    return null;
  }
}

/** Le stockage de l'onglet, ou `null` (rendu serveur, navigation privee bloquee). */
export function draftStorage(): DraftStorage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function readDraft<T = unknown>(key: string, storage: DraftStorage | null = draftStorage(), now = Date.now()): T | null {
  try {
    return parseDraft<T>(storage?.getItem(key), now);
  } catch {
    return null;
  }
}

export function writeDraft(key: string, value: unknown, storage: DraftStorage | null = draftStorage(), now = Date.now()): void {
  if (suspended.has(key)) return;
  try {
    storage?.setItem(key, serializeDraft(value, now));
  } catch {
    /* quota plein : on garde le formulaire tel quel, sans brouillon */
  }
}

export function removeDraft(key: string, storage: DraftStorage | null = draftStorage()): void {
  try {
    storage?.removeItem(key);
  } catch {
    /* rien a faire */
  }
}

// --- Registre des brouillons ouverts a l'ecran -------------------------------------------
// Un formulaire monte s'inscrit ; « suspendu » = il vient d'etre enregistre ou abandonne,
// il ne doit plus rien ecrire jusqu'a son demontage (sinon le brouillon renaitrait).

const active = new Map<string, number>();
const suspended = new Set<string>();

export function registerDraft(key: string): () => void {
  active.set(key, (active.get(key) ?? 0) + 1);
  suspended.delete(key);
  return () => {
    const n = (active.get(key) ?? 1) - 1;
    if (n <= 0) {
      active.delete(key);
      suspended.delete(key);
    } else active.set(key, n);
  };
}

export function isDraftSuspended(key: string): boolean {
  return suspended.has(key);
}

/** Enregistrement reussi : le brouillon disparait et le formulaire n'en ecrit plus. */
export function clearFormDraft(key: string, storage: DraftStorage | null = draftStorage()): void {
  if (active.has(key)) suspended.add(key);
  removeDraft(key, storage);
}

/** Abandon explicite (bouton Retour) : efface les brouillons des formulaires a l'ecran. */
export function discardActiveDrafts(storage: DraftStorage | null = draftStorage()): void {
  for (const key of active.keys()) clearFormDraft(key, storage);
}

/** Reservee aux tests. */
export function resetDraftRegistry(): void {
  active.clear();
  suspended.clear();
}
