/**
 * M1 — Règles de la FICHE LIÉE (retour de Simon du 05/10).
 *
 * Deux règles, écrites ici une seule fois et testées (`tests/fiche-liee.test.ts`) :
 *
 *  1. REPRISE DU NOM — sur une fiche PRO liée à exactement UNE fiche privée nommée,
 *     le prénom et le nom sont ceux de la fiche privée (source unique : la personne
 *     physique) et ne sont pas modifiables. S'il y a PLUSIEURS fiches privées liées
 *     (un couple, une société à deux gérants), il n'y a pas de source unique : les
 *     champs restent modifiables et l'écran le dit.
 *     La vérité est en base (déclencheurs, migration 20261005140000) ; ce module sert
 *     à ce que l'écran grise les bons champs et affiche la bonne mention.
 *
 *  2. RECHERCHE — un contact est trouvé par son propre nom OU par le nom de sa fiche
 *     liée. Miroir fidèle du SQL de `contacts_search` (migration 20261005141000) :
 *     accents et casse retirés, découpage en mots, chaque mot doit apparaître d'un
 *     côté ou de l'autre.
 */

/** Types de fiche considérés « professionnels » (une société, pas une personne). */
export const PRO_CONTACT_TYPES = ['professionnel', 'fournisseur', 'banque_leasing'] as const;

export function isProContactType(type: string | null | undefined): boolean {
  return (PRO_CONTACT_TYPES as readonly string[]).includes(type ?? '');
}

/** Ce dont les règles ont besoin d'un contact — pas la ligne complète (120 colonnes). */
export type NameCandidate = {
  id: string;
  type: string | null;
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
};

/** Une fiche privée n'est source du nom que si elle porte au moins un nom ou un prénom. */
export function hasPersonName(c: NameCandidate): boolean {
  return Boolean((c.last_name ?? '').trim() || (c.first_name ?? '').trim());
}

export type LinkedNameLock =
  /** Prénom / nom repris de `source` : champs non modifiables. */
  | { locked: true; source: NameCandidate }
  /** Modifiables. `reason` dit pourquoi, pour l'afficher à l'écran. */
  | { locked: false; reason: 'not_pro' | 'no_private_link' | 'several_private' };

/**
 * La fiche `contact` doit-elle reprendre le prénom / nom d'une fiche privée liée ?
 * `linked` = les fiches liées (l'autre extrémité des liens), dans n'importe quel ordre.
 */
export function linkedNameLock(contact: NameCandidate, linked: NameCandidate[]): LinkedNameLock {
  if (!isProContactType(contact.type)) return { locked: false, reason: 'not_pro' };
  const sources = linked.filter((c) => c.type === 'particulier' && hasPersonName(c));
  if (sources.length === 0) return { locked: false, reason: 'no_private_link' };
  // Plusieurs personnes physiques liées : aucune ne fait autorité sur le nom.
  if (sources.length > 1) return { locked: false, reason: 'several_private' };
  return { locked: true, source: sources[0] };
}

/* ---------------- Recherche (miroir du SQL) ---------------- */

/** Minuscules sans accents, comme `lower(unaccent(...))` côté base. */
export function foldText(s: string | null | undefined): string {
  return (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Mots cherchés : accents et casse retirés, espaces multiples réduits. */
export function searchTokens(q: string | null | undefined): string[] {
  return foldText(q).replace(/\s+/g, ' ').trim().split(' ').filter((t) => t !== '');
}

/** Champs cherchables de la fiche liée (miroir de `_contact_link_haystack_part`). */
export function linkedHaystack(linked: Array<NameCandidate & { code?: string | null; legacy_code?: string | null }>): string {
  return linked
    .map((c) => foldText([c.last_name, c.first_name, c.company_name, c.code, c.legacy_code].filter(Boolean).join(' ')))
    .join(' ');
}

/**
 * Chaque mot cherché apparaît soit dans les champs de la fiche, soit dans ceux d'une
 * fiche liée : chercher « AGM FISC » remonte la personne liée, et inversement.
 * `ownHaystack` est le texte cherchable de la fiche elle-même, déjà replié.
 */
export function matchesWithLinked(q: string, ownHaystack: string, linkedHay: string): boolean {
  const own = foldText(ownHaystack);
  const link = foldText(linkedHay);
  return searchTokens(q).every((tok) => own.includes(tok) || link.includes(tok));
}
