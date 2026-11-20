/**
 * Sondes de schéma regroupées (perf, lot perf 2 — 20/11/2026).
 *
 * Le dépôt et la base divergent (migrations pas toutes appliquées) : chaque module « sonde » sa
 * colonne ou sa table avant d'afficher un bloc (`xxxSchemaReady()`). Avant : une requête par
 * sonde (10 à 12 à l'ouverture d'une fiche OR, certaines en cascade). Maintenant :
 *   - les sondes demandées dans le même instant partent en UNE requête (`schema_probe`, migration
 *     20261120112000) ;
 *   - une sonde « présente » est retenue pour l'onglet (sessionStorage) : une colonne ne disparaît
 *     pas ; une sonde « absente » est refaite à la page suivante (migration appliquée entre-temps) ;
 *   - si la fonction `schema_probe` manque, échoue ou tarde (> 4 s), chaque sonde repart seule
 *     par son ancienne requête (`fallback`) ; celle-ci est bornée à 8 s puis répond « absent ».
 * Une sonde ne bloque donc jamais l'écran : au pire le bloc concerné reste masqué.
 *
 * Équivalence : `schema_probe` répond « présent » quand la colonne existe ET que l'utilisateur a
 * le droit de la lire (`has_column_privilege`), soit exactement quand `select colonne limit 1`
 * réussit (la RLS filtre des lignes, elle ne fait pas échouer la requête).
 */
import { supabase } from '@/integrations/supabase/client';

/** Une vérification = `table.colonne` (schéma public). */
export type SchemaCheck = `${string}.${string}`;

type Rpc = (checks: string[]) => Promise<string[] | null>;
type Store = { get(): string[]; add(keys: string[]): void };

export const PROBE_BATCH_MS = 15;
export const PROBE_RPC_TIMEOUT_MS = 4000;
export const PROBE_FALLBACK_TIMEOUT_MS = 8000;
const STORE_KEY = 'ducati.schema-probe.v1';

function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const id = setTimeout(() => resolve(onTimeout), ms);
    p.then((v) => { clearTimeout(id); resolve(v); }, () => { clearTimeout(id); resolve(onTimeout); });
  });
}

/** Fabrique (injectable pour les essais) : `rpc` renvoie les vérifications présentes, ou null en cas d'échec. */
export function createSchemaProber(rpc: Rpc, store: Store, opts: { batchMs?: number; rpcTimeoutMs?: number; fallbackTimeoutMs?: number } = {}) {
  const batchMs = opts.batchMs ?? PROBE_BATCH_MS;
  const rpcTimeout = opts.rpcTimeoutMs ?? PROBE_RPC_TIMEOUT_MS;
  const fallbackTimeout = opts.fallbackTimeoutMs ?? PROBE_FALLBACK_TIMEOUT_MS;
  type Waiter = { checks: string[]; fallback: () => Promise<boolean>; resolve: (v: boolean) => void };
  let queue: Waiter[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function flush() {
    const batch = queue;
    queue = [];
    timer = null;
    const all = [...new Set(batch.flatMap((w) => w.checks))];
    const present = await withTimeout(rpc(all).catch(() => null), rpcTimeout, null);
    if (present === null) {
      // Fonction absente / en erreur / trop lente : chaque sonde repart par son ancienne requête.
      for (const w of batch) {
        void withTimeout(w.fallback().catch(() => false), fallbackTimeout, false).then((ok) => {
          if (ok) store.add(w.checks);
          w.resolve(ok);
        });
      }
      return;
    }
    const set = new Set(present);
    const known: string[] = [];
    for (const w of batch) {
      const ok = w.checks.every((c) => set.has(c));
      if (ok) known.push(...w.checks);
      w.resolve(ok);
    }
    if (known.length) store.add(known);
  }

  /** Vrai si toutes les vérifications sont présentes. Ne rejette jamais. */
  return function probe(checks: SchemaCheck | SchemaCheck[], fallback: () => Promise<boolean>): Promise<boolean> {
    const list = (Array.isArray(checks) ? checks : [checks]).map((c) => c.replace(/\s+/g, ''));
    const known = new Set(store.get());
    if (list.every((c) => known.has(c))) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      queue.push({ checks: list, fallback, resolve });
      timer ??= setTimeout(() => { void flush(); }, batchMs);
    });
  };
}

const sessionStore: Store = {
  get() {
    try {
      if (typeof window === 'undefined') return [];
      const raw = window.sessionStorage.getItem(STORE_KEY);
      const v = raw ? JSON.parse(raw) : [];
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    } catch { return []; }
  },
  add(keys) {
    try {
      if (typeof window === 'undefined') return;
      const next = [...new Set([...sessionStore.get(), ...keys])];
      window.sessionStorage.setItem(STORE_KEY, JSON.stringify(next));
    } catch { /* stockage indisponible : on resondera */ }
  },
};

const rpcLoose = supabase as unknown as {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

const schemaProbeRpc: Rpc = async (checks) => {
  const { data, error } = await rpcLoose.rpc('schema_probe', { _checks: checks });
  if (error || !Array.isArray(data)) return null;
  return data.filter((x): x is string => typeof x === 'string');
};

/**
 * Sonde regroupée de l'application. `fallback` = l'ancienne requête de la sonde (utilisée
 * seulement si `schema_probe` n'est pas disponible).
 */
export const schemaProbe = createSchemaProber(schemaProbeRpc, sessionStore);
