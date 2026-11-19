// LOT ITALTEST (19/11/2026, COM005) — Société de TEST : aucun envoi sortant.
//
// Une société de test (table `test_companies`, migration 20261119160000) est une copie du
// référentiel d'une vraie société (ItalTest ← ITALBIKE STORE). Ses contacts sont de vraies
// personnes : aucun mail, SMS, envoi Shopify, paiement Stripe, transfert comptable ni relève de
// boîte mail ne doit partir pour elle. La base coupe déjà la file `notifications` et force les
// réglages d'envoi à l'arrêt ; chaque fonction Edge qui envoie refait le contrôle ici.
//
// FERMÉ PAR DÉFAUT : si la base ne répond pas, on considère la société comme « test » (rien ne
// part). Seule l'absence de la table (migration pas encore posée) vaut « aucune société de test ».
//
// deno-lint-ignore-file
declare const Deno: { env: { get(k: string): string | undefined } };

const URL = Deno.env.get('SUPABASE_URL');
const SVC = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

/** Code d'erreur renvoyé par les fonctions quand l'envoi est refusé pour une société de test. */
export const TEST_COMPANY_ERROR = 'test_company';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** La table n'existe pas encore (migration non posée) : PostgREST répond 404 / PGRST205 / 42P01. */
async function tableMissing(r: Response): Promise<boolean> {
  if (r.status !== 404 && r.status !== 400) return false;
  const body = await r.text().catch(() => '');
  return /PGRST205|42P01|test_companies/.test(body);
}

/** Ensemble des sociétés de test. Lève une erreur si la base ne répond pas (fermé par défaut). */
export async function testCompanyIds(): Promise<Set<string>> {
  if (!URL || !SVC) throw new Error('test_company_check_unavailable');
  const r = await fetch(`${URL}/rest/v1/test_companies?select=company_id`, { headers: { apikey: SVC, Authorization: `Bearer ${SVC}` } });
  if (!r.ok) {
    if (await tableMissing(r)) return new Set();
    throw new Error(`test_company_check_failed_${r.status}`);
  }
  const rows = await r.json().catch(() => null);
  if (!Array.isArray(rows)) throw new Error('test_company_check_failed');
  return new Set(rows.map((x: { company_id?: string }) => String(x.company_id ?? '')).filter((x) => UUID_RE.test(x)));
}

/** La société est-elle une société de test ? En cas de doute (base injoignable) : oui. */
export async function isTestCompany(companyId: unknown): Promise<boolean> {
  if (typeof companyId !== 'string' || !UUID_RE.test(companyId)) return false;
  try {
    const ids = await testCompanyIds();
    return ids.has(companyId.toLowerCase()) || ids.has(companyId);
  } catch {
    return true;
  }
}
