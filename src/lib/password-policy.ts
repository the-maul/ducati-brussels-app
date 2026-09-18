/**
 * Règles de mot de passe — UNE SEULE source de vérité (décision U-4 du 18/09).
 *
 * Utilisée partout où un mot de passe est choisi ou fixé :
 *   - inscription en ligne (/inscription) et borne du comptoir (/borne) ;
 *   - choix ou changement du mot de passe (/reset-password) ;
 *   - création d'un compte avec mot de passe (Paramètres → Utilisateurs) ;
 * côté écran (indicateur des règles remplies) ET côté serveur (signup.functions.ts,
 * admin.functions.ts). Ne jamais recopier ces règles ailleurs : importer ce fichier.
 *
 * Règles : au moins 8 caractères, une majuscule, une minuscule, un chiffre et un
 * caractère spécial (tout ce qui n'est ni une lettre ni un chiffre : ! ? . - _ @ # …).
 * Maximum 72 caractères (limite technique du hachage des mots de passe).
 */

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72;

export type PasswordRuleKey = 'length' | 'upper' | 'lower' | 'digit' | 'special';

const RULES: { key: PasswordRuleKey; test: (pw: string) => boolean }[] = [
  { key: 'length', test: (pw) => pw.length >= PASSWORD_MIN_LENGTH },
  { key: 'upper', test: (pw) => /\p{Lu}/u.test(pw) },
  { key: 'lower', test: (pw) => /\p{Ll}/u.test(pw) },
  { key: 'digit', test: (pw) => /\d/.test(pw) },
  { key: 'special', test: (pw) => /[^\p{L}\p{N}]/u.test(pw) },
];

/** Libellés i18n de chaque règle : clés `pwd.rules.<key>` dans src/lib/i18n/fr.ts. */
export const PASSWORD_RULE_KEYS: PasswordRuleKey[] = RULES.map((r) => r.key);

/** État de chaque règle pour le mot de passe donné (pour l'indicateur visuel). */
export function checkPassword(pw: string): { key: PasswordRuleKey; ok: boolean }[] {
  return RULES.map((r) => ({ key: r.key, ok: r.test(pw) }));
}

/** Vrai si le mot de passe respecte TOUTES les règles. */
export function isStrongPassword(pw: string): boolean {
  return pw.length <= PASSWORD_MAX_LENGTH && RULES.every((r) => r.test(pw));
}
