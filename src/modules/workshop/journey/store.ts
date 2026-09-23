/**
 * M8 — Parcours d'entretien : ENREGISTREMENT DE L'AVANCEMENT.
 *
 * L'atelier a du wifi capricieux et la tablette peut s'éteindre : l'avancement est écrit
 * **localement à chaque geste** (instantané, résiste à une coupure) et **recopié en base** quand
 * elle répond. À la reprise, on garde la version la plus récente des deux.
 *
 * La table `workshop_journeys` est créée par `supabase/migrations/20260923110000_m8_parcours_entretien.sql`
 * (non appliquée à ce jour) : tant qu'elle n'existe pas, tout vit dans le navigateur de la tablette et
 * l'écran le dit. Aucune donnée n'est perdue : le récapitulatif est reporté sur l'OR, qui, lui, est en base.
 */
import { supabase } from '@/integrations/supabase/client';
import type { JourneyState } from './types';

const KEY = (orId: string) => `ducati.parcours.${orId}`;
const TABLE = 'workshop_journeys';

export type Persistence = 'base' | 'local';

type LooseResult = { data: unknown; error: { message: string } | null };
type LooseQuery = {
  select: (cols: string) => LooseQuery;
  eq: (col: string, value: unknown) => LooseQuery;
  maybeSingle: () => Promise<LooseResult>;
  upsert: (row: Record<string, unknown>, opts?: Record<string, unknown>) => Promise<LooseResult>;
  delete: () => LooseQuery;
  then: Promise<LooseResult>['then'];
};
const loose = supabase as unknown as { from: (table: string) => LooseQuery };

let probe: Promise<boolean> | null = null;

/** La table d'avancement existe-t-elle (migration appliquée) ? */
export function probeJourneyTable(): Promise<boolean> {
  probe ??= (async () => {
    try {
      const { error } = await loose.from(TABLE).select('or_id').eq('or_id', '00000000-0000-0000-0000-000000000000').maybeSingle();
      return !error;
    } catch {
      return false;
    }
  })();
  return probe;
}

export async function persistenceMode(): Promise<Persistence> {
  return (await probeJourneyTable()) ? 'base' : 'local';
}

// --- navigateur -------------------------------------------------------------

function readLocal(orId: string): JourneyState | null {
  try {
    const raw = globalThis.localStorage?.getItem(KEY(orId));
    if (!raw) return null;
    const s = JSON.parse(raw) as JourneyState;
    return s && s.version === 1 && s.orId === orId ? s : null;
  } catch {
    return null;
  }
}

function writeLocal(state: JourneyState): void {
  try {
    globalThis.localStorage?.setItem(KEY(state.orId), JSON.stringify(state));
  } catch {
    // quota plein (photos) : l'avancement reste en mémoire et part en base au prochain enregistrement
  }
}

// --- base -------------------------------------------------------------------

async function readBase(orId: string): Promise<JourneyState | null> {
  if (!(await probeJourneyTable())) return null;
  try {
    const { data, error } = await loose.from(TABLE).select('state').eq('or_id', orId).maybeSingle();
    if (error || !data) return null;
    const s = (data as { state?: JourneyState }).state;
    return s && s.version === 1 ? s : null;
  } catch {
    return null;
  }
}

async function writeBase(companyId: string | null, state: JourneyState): Promise<boolean> {
  if (!(await probeJourneyTable())) return false;
  try {
    const { error } = await loose.from(TABLE).upsert({
      or_id: state.orId,
      company_id: companyId,
      model_year_id: state.modelYearId,
      service_label: state.serviceLabel,
      started_at: state.startedAt,
      finished_at: state.finishedAt,
      reported_to_or: state.reportedToOr,
      state,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'or_id' });
    return !error;
  } catch {
    return false;
  }
}

// --- API --------------------------------------------------------------------

/** Dernier point d'avancement connu : la version la plus récemment enregistrée gagne. */
export async function loadJourney(orId: string): Promise<JourneyState | null> {
  const [local, base] = await Promise.all([Promise.resolve(readLocal(orId)), readBase(orId)]);
  if (!base) return local;
  if (!local) return base;
  return stamp(local) >= stamp(base) ? local : base;
}

/** Enregistre tout de suite dans la tablette, puis en base sans bloquer l'écran. */
export function saveJourney(companyId: string | null, state: JourneyState): void {
  writeLocal(state);
  void writeBase(companyId, state);
}

export async function clearJourney(orId: string): Promise<void> {
  try { globalThis.localStorage?.removeItem(KEY(orId)); } catch { /* rien */ }
  if (await probeJourneyTable()) {
    try { await loose.from(TABLE).delete().eq('or_id', orId); } catch { /* rien */ }
  }
}

/** Horodatage du dernier geste (fin, sinon dernier chrono ou dernière étape cochée, sinon début). */
export function stamp(s: JourneyState): string {
  let max = s.startedAt;
  const keep = (v: string | null | undefined) => { if (v && v > max) max = v; };
  keep(s.finishedAt);
  for (const op of s.operations) {
    for (const at of Object.values(op.steps)) keep(at);
    for (const c of op.chrono) { keep(c.startedAt); keep(c.endedAt); }
  }
  for (const f of s.findings) keep(f.at);
  return max;
}

/** Pour les tests : forcer la présence (ou non) de la table. */
export function __setJourneyTableProbe(value: boolean | null): void {
  probe = value == null ? null : Promise.resolve(value);
}
