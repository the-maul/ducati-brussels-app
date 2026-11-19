/**
 * M0 COM005 — Société de TEST « ItalTest » (lot ItalTest, migration 20261119160000).
 *
 * Une société de test est une copie du référentiel d'une vraie société (articles, clients,
 * motos, stock, tarifs, paramètres, kits) pour rejouer les parcours G8 sans toucher à la vraie
 * société. Aucun envoi n'en part (mails, SMS, Shopify, Stripe, transfert comptable) : la base et
 * les fonctions serveur le garantissent, l'écran l'annonce par un bandeau.
 *
 * Copie / rafraîchissement depuis l'écran : `admin_test_company_start` puis
 * `admin_test_company_step` en boucle (chaque appel < 8 s, limite des requêtes de l'application).
 */
import { supabase } from '@/integrations/supabase/client';

type Res<T> = PromiseLike<{ data: T | null; error: { message: string; code?: string } | null }>;
// Tables et fonctions de la migration 20261119160000, hors types générés.
const sb = supabase as unknown as {
  from: (t: string) => { select: (c: string) => Res<unknown[]> };
  rpc: <T = unknown>(fn: string, args?: Record<string, unknown>) => Res<T>;
};

export const TEST_COMPANY_DEFAULT_NAME = 'ItalTest';

export type TestCompanyRow = {
  company_id: string;
  source_company_id: string;
  status: 'a_copier' | 'en_cours' | 'pret' | 'erreur';
  phase: string | null;
  progress: { copied?: Record<string, number>; purged?: number; started_at?: string; finished_at?: string } | null;
  last_error: string | null;
  started_at: string | null;
  finished_at: string | null;
};

export type StepResult = {
  company_id: string;
  status: TestCompanyRow['status'];
  phase: string;
  done: boolean;
  error?: string;
  progress?: TestCompanyRow['progress'];
};

/** La table n'existe pas encore (migration non posée) : aucune société de test. */
function missingTable(e: { message: string; code?: string }): boolean {
  return e.code === 'PGRST205' || e.code === '42P01' || /test_companies/.test(e.message);
}

/** Les sociétés de test visibles par l'utilisateur (vide si la migration n'est pas posée). */
export async function listTestCompanies(): Promise<TestCompanyRow[]> {
  const { data, error } = await sb.from('test_companies')
    .select('company_id, source_company_id, status, phase, progress, last_error, started_at, finished_at');
  if (error) {
    if (missingTable(error)) return [];
    throw new Error(error.message);
  }
  return (data ?? []) as TestCompanyRow[];
}

/** Ids des sociétés de test (pour le bandeau et le sélecteur) ; jamais d'erreur bloquante. */
export async function testCompanyIds(): Promise<string[]> {
  try {
    return (await listTestCompanies()).map((r) => r.company_id);
  } catch {
    return [];
  }
}

export async function startTestCompany(sourceId: string, name = TEST_COMPANY_DEFAULT_NAME): Promise<string> {
  const { data, error } = await sb.rpc<string>('admin_test_company_start', { _source: sourceId, _target_name: name });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function stepTestCompany(targetId: string, budgetMs = 4000): Promise<StepResult> {
  const { data, error } = await sb.rpc<StepResult>('admin_test_company_step', { _target: targetId, _budget_ms: budgetMs });
  if (error) throw new Error(error.message);
  return data as StepResult;
}

/** Étapes de la copie, dans l'ordre (libellés i18n `testCompany.phase_<code>`). */
export const TEST_COMPANY_PHASES = ['controle', 'purge', 'societe', 'map', 'copie', 'stock', 'fin'] as const;

/** Avancement approximatif (0 à 100) d'après l'étape en cours. */
export function phaseProgress(phase: string | null | undefined, done: boolean): number {
  if (done) return 100;
  const i = TEST_COMPANY_PHASES.indexOf((phase ?? 'controle') as (typeof TEST_COMPANY_PHASES)[number]);
  return Math.max(2, Math.round(((i < 0 ? 0 : i) / TEST_COMPANY_PHASES.length) * 100));
}

/**
 * Crée ou rafraîchit la société de test, étape par étape, jusqu'au bout.
 * `onStep` reçoit chaque résultat (avancement à l'écran). S'arrête à 2 000 appels au plus.
 */
export async function runTestCompanyCopy(
  sourceId: string,
  onStep: (r: StepResult) => void,
  name = TEST_COMPANY_DEFAULT_NAME,
): Promise<StepResult> {
  const target = await startTestCompany(sourceId, name);
  let last: StepResult = { company_id: target, status: 'en_cours', phase: 'controle', done: false };
  onStep(last);
  for (let i = 0; i < 2000; i++) {
    last = await stepTestCompany(target);
    onStep(last);
    if (last.status === 'erreur') throw new Error(last.error ?? 'erreur');
    if (last.done || last.status === 'pret') return last;
  }
  return last;
}
