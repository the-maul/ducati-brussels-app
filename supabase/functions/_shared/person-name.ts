/**
 * VP1 (20/11/2026, « tout comme G8 ») : les nom et prénom des fiches sont en MAJUSCULES (Q67),
 * mais un mail ou un SMS salue le client poliment : « Bonjour Jean », « Bonjour Jean-Pierre »,
 * « Bonjour Anne Marie », jamais « Bonjour JEAN ».
 * Même règle que la fonction SQL public.name_title_case (migration 20261120340000) et que
 * src/lib/person-name.ts (écrans) — copie à garder identique (Deno ne lit pas src/).
 */

/** Casse titre d'un nom de personne : majuscule en début de mot et après espace, trait d'union ou apostrophe. */
export function titleCaseName(s: string | null | undefined): string {
  if (!s) return '';
  return s.trim().toLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (_m, p: string, l: string) => p + l.toUpperCase());
}

type GreetingContact = {
  type?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
};

/**
 * Nom à mettre après « Bonjour » : le prénom en casse titre (Jean) ; sans prénom, la raison
 * sociale telle quelle (société) ; sinon le nom en casse titre ; sinon vide.
 */
export function greetingName(c: GreetingContact | null | undefined): string {
  if (!c) return '';
  const first = titleCaseName(c.first_name);
  if (first) return first;
  const company = (c.company_name ?? '').trim();
  if (company) return company;
  return titleCaseName(c.last_name);
}
