// LOT SÉCURITÉ S — Contrôle d'accès commun aux Edge Functions.
// Réf. docs/bible/securite-lot-S.md §S6.
//
// Trois sortes d'appelants légitimes :
//   - la CLÉ DE SERVICE (Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>) : autres Edge
//     Functions, scripts d'administration ;
//   - pg_cron, qui présente l'en-tête x-cron-secret (valeur = secret Edge CRON_SECRET, lue
//     côté base dans le coffre Vault « cron_secret ») ;
//   - un UTILISATEUR CONNECTÉ, dont le jeton est vérifié auprès de Supabase Auth, et qui doit
//     être membre ACTIF (profiles.is_active) de la société concernée.
// La clé publique (anon) n'ouvre plus rien.
//
// Le dossier _shared est inclus automatiquement par `supabase functions deploy <nom>`
// (import relatif). Avec l'outil MCP deploy_edge_function, joindre aussi ce fichier.
//
// deno-lint-ignore-file
declare const Deno: { env: { get(k: string): string | undefined } };

const URL = Deno.env.get('SUPABASE_URL');
const SVC = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const CRON_SECRET = Deno.env.get('CRON_SECRET');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

export type Caller =
  | { kind: 'service' }
  | { kind: 'cron' }
  | { kind: 'user'; id: string; email: string };

/** Comparaison en temps constant (évite de deviner un secret caractère par caractère). */
function sameSecret(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;    // la longueur n'est pas un secret
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

async function db(path: string): Promise<Response> {
  return fetch(`${URL}/rest/v1/${path}`, { headers: { apikey: SVC!, Authorization: `Bearer ${SVC}` } });
}

/**
 * Qui appelle ? null = personne de reconnu (clé publique seule, jeton expiré, rien).
 * Ordre : clé de service, secret pg_cron, puis jeton utilisateur.
 */
export async function identify(req: Request): Promise<Caller | null> {
  const auth = req.headers.get('Authorization') ?? '';
  if (SVC && sameSecret(auth, `Bearer ${SVC}`)) return { kind: 'service' };

  const cron = req.headers.get('x-cron-secret');
  // Secret absent ou trop court côté fonction : on refuse (fermé par défaut).
  if (cron && CRON_SECRET && CRON_SECRET.length >= 32 && sameSecret(cron, CRON_SECRET)) return { kind: 'cron' };

  if (!auth.startsWith('Bearer ') || !URL || !SVC) return null;
  const r = await fetch(`${URL}/auth/v1/user`, { headers: { apikey: SVC, Authorization: auth } });
  if (!r.ok) return null;                       // la clé anon n'est pas un utilisateur : 401/403 ici
  const u = await r.json().catch(() => null);
  return isUuid(u?.id) ? { kind: 'user', id: u.id, email: String(u.email ?? '').toLowerCase() } : null;
}

/** Sociétés dont l'utilisateur est membre ACTIF (vide si compte désactivé ou sans rôle). */
export async function activeCompaniesOf(userId: string): Promise<string[]> {
  if (!isUuid(userId)) return [];
  const prof = await (await db(`profiles?select=is_active&id=eq.${userId}&limit=1`)).json().catch(() => null);
  if (!Array.isArray(prof) || prof.length === 0 || prof[0]?.is_active !== true) return [];
  const roles = await (await db(`user_roles?select=company_id&user_id=eq.${userId}`)).json().catch(() => null);
  if (!Array.isArray(roles)) return [];
  return [...new Set(roles.map((x: { company_id: string }) => x.company_id).filter(isUuid))];
}

/** L'utilisateur est-il membre actif de CETTE société ? */
export async function isActiveMember(userId: string, companyId: string): Promise<boolean> {
  if (!isUuid(companyId)) return false;
  return (await activeCompaniesOf(userId)).includes(companyId);
}
