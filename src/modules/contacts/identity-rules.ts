/**
 * M1 — Fiche client comme G8 (décision du client Q67, 20/11/2026). CON001 CLI-025 CLI-027 CLI-028 CLI-111
 * Particulier : civilité, nom et prénom obligatoires ; société (professionnel, fournisseur,
 * banque / leasing) : raison sociale obligatoire, la civilité ne s'applique pas. Nom, prénom et
 * raison sociale en MAJUSCULES (accents gardés). Même règle en base (trg_contacts_identity_g8,
 * migration 20261120154000) ; testé dans tests/contact-identity.test.ts.
 */

export type IdentityField = 'civility' | 'first_name' | 'last_name' | 'company_name';
export type IdentityInput = {
  type: string | null | undefined;
  civility?: string | null; first_name?: string | null; last_name?: string | null; company_name?: string | null;
};

const COMPANY_TYPES = new Set(['professionnel', 'fournisseur', 'banque_leasing']);
const blank = (s: string | null | undefined) => !(s ?? '').trim();

/** Champs manquants, dans l'ordre G8 (Civilité, Prénom, Nom ; ou Raison sociale). */
export function identityMissing(c: IdentityInput): IdentityField[] {
  if (c.type === 'particulier') {
    const out: IdentityField[] = [];
    if (blank(c.civility)) out.push('civility');
    if (blank(c.first_name)) out.push('first_name');
    if (blank(c.last_name)) out.push('last_name');
    return out;
  }
  if (c.type && COMPANY_TYPES.has(c.type)) return blank(c.company_name) ? ['company_name'] : [];
  return [];
}

/** Majuscules comme la base (upper() garde les accents : é → É). */
export function upperName(s: string | null | undefined): string | null {
  if (s == null) return null;
  return s.toUpperCase();
}

/**
 * CON002 (Simon, 26/11/2026) : une banque / un leasing n'a pas de prénom ni de nom de personne sur
 * sa fiche — seulement sa raison sociale et ses coordonnées générales (e-mail, téléphone) ; les
 * personnes à joindre sont dans la liste « Personnes de contact » (contact_subcontacts).
 */
export function hasPersonName(type: string | null | undefined): boolean {
  return type !== 'banque_leasing';
}
