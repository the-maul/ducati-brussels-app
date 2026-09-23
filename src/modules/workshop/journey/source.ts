/**
 * M8 — Parcours d'entretien : COUCHE D'ACCÈS aux manuels d'atelier.
 *
 * L'écran technicien ne sait pas d'où viennent les données. Deux fournisseurs :
 *
 *  - **démonstration** (aujourd'hui) : `public/demo/parcours-entretien.json`, extrait des manuels
 *    Ducati par `tools/journey-demo/build.mjs` ;
 *  - **base** (lot `lot-manuels`) : les tables des manuels d'atelier, dès qu'elles existent.
 *
 * La bascule est automatique : au premier appel on regarde si les tables sont là (`probeManualTables`).
 * Tant qu'elles ne le sont pas, l'écran affiche un bandeau « données de démonstration ».
 *
 * À BRANCHER quand `lot-manuels` sera en base : les trois fonctions de `baseSource` ci-dessous.
 * Les noms de tables et de colonnes attendus sont ceux de `MANUAL_TABLES` — à ajuster en une seule
 * ligne si le lot en choisit d'autres.
 */
import { supabase } from '@/integrations/supabase/client';
import type { MaintenanceProgram, Procedure } from './types';

/** Tables attendues du lot `lot-manuels` (un seul endroit à corriger si les noms changent). */
export const MANUAL_TABLES = {
  /** Programme d'entretien par modèle-année : échéances, opérations, temps UT. */
  program: 'ducati_manual_programs',
  /** Procédures dédoublonnées : titre, source, outils, produits, couples, avertissements. */
  procedure: 'ducati_manual_procedures',
  /** Étapes d'une procédure : texte, figures, outils, produits, couples, avertissements, liens. */
  steps: 'ducati_manual_procedure_steps',
} as const;

export type SourceKind = 'demo' | 'base';

export type JourneySource = {
  kind: SourceKind;
  /** Modèles-années couverts (en démonstration : les motos du fichier). */
  listPrograms(): Promise<MaintenanceProgram[]>;
  /** Programme d'entretien d'un modèle-année, ou null s'il n'est pas couvert. */
  getProgram(modelYearId: string): Promise<MaintenanceProgram | null>;
  /** Une procédure pas à pas. */
  getProcedure(parcoursId: string): Promise<Procedure | null>;
};

/**
 * Base des figures. Les images des manuels (~300 Mo) ne sont pas dans le dépôt :
 * `node tools/journey-demo/copy-images.mjs` les copie dans `public/manuels/`.
 * En production elles viendront du stockage du lot `lot-manuels` (VITE_MANUELS_BASE).
 */
export function figureUrl(relativePath: string | null | undefined): string | null {
  if (!relativePath) return null;
  const base = (import.meta.env?.VITE_MANUELS_BASE as string | undefined) ?? '/manuels/';
  return `${base.replace(/\/+$/, '')}/${String(relativePath).replace(/^\/+/, '')}`;
}

// ---------------------------------------------------------------------------
// Fournisseur « démonstration »
// ---------------------------------------------------------------------------

type DemoFile = { bikes: MaintenanceProgram[]; procedures: Record<string, Procedure> };
let demoCache: Promise<DemoFile> | null = null;

function loadDemo(): Promise<DemoFile> {
  demoCache ??= fetch('/demo/parcours-entretien.json')
    .then((r) => { if (!r.ok) throw new Error(`parcours-entretien.json : ${r.status}`); return r.json() as Promise<DemoFile>; })
    .catch((e) => { demoCache = null; throw e; });
  return demoCache;
}

const demoSource: JourneySource = {
  kind: 'demo',
  async listPrograms() { return (await loadDemo()).bikes; },
  async getProgram(modelYearId) {
    const d = await loadDemo();
    return d.bikes.find((b) => String(b.modelYearId) === String(modelYearId)) ?? null;
  },
  async getProcedure(parcoursId) { return (await loadDemo()).procedures[parcoursId] ?? null; },
};

// ---------------------------------------------------------------------------
// Fournisseur « base » (lot-manuels) — à brancher
// ---------------------------------------------------------------------------

/** Accès non typé : les tables du lot `lot-manuels` ne sont pas encore dans `types.ts`. */
type LooseResult = { data: unknown; error: { message: string } | null };
type LooseQuery = {
  select: (cols: string) => LooseQuery;
  eq: (col: string, value: unknown) => LooseQuery;
  order: (col: string) => LooseQuery;
  limit: (n: number) => Promise<LooseResult>;
  maybeSingle: () => Promise<LooseResult>;
  then: Promise<LooseResult>['then'];
};
const loose = supabase as unknown as { from: (table: string) => LooseQuery };

const baseSource: JourneySource = {
  kind: 'base',
  async listPrograms() {
    const { data, error } = await loose.from(MANUAL_TABLES.program).select('*').order('model_year_id').limit(2000);
    if (error) throw new Error(error.message);
    return (data as MaintenanceProgram[] | null) ?? [];
  },
  async getProgram(modelYearId) {
    const { data, error } = await loose.from(MANUAL_TABLES.program).select('*').eq('model_year_id', modelYearId).maybeSingle();
    if (error) throw new Error(error.message);
    return (data as MaintenanceProgram | null) ?? null;
  },
  async getProcedure(parcoursId) {
    const { data, error } = await loose.from(MANUAL_TABLES.procedure).select('*, etapes:' + MANUAL_TABLES.steps + '(*)').eq('id', parcoursId).maybeSingle();
    if (error) throw new Error(error.message);
    return (data as Procedure | null) ?? null;
  },
};

// ---------------------------------------------------------------------------
// Bascule
// ---------------------------------------------------------------------------

let probe: Promise<boolean> | null = null;

/** Les tables des manuels existent-elles (lot `lot-manuels` appliqué) ? Une seule interrogation par session. */
export function probeManualTables(): Promise<boolean> {
  probe ??= (async () => {
    try {
      const { error } = await loose.from(MANUAL_TABLES.program).select('model_year_id').limit(1);
      return !error;
    } catch {
      return false;
    }
  })();
  return probe;
}

/** Le fournisseur à utiliser : la base si le lot `lot-manuels` est là, sinon la démonstration. */
export async function getJourneySource(): Promise<JourneySource> {
  return (await probeManualTables()) ? baseSource : demoSource;
}

/** Pour les tests et l'écran : forcer un fournisseur (jamais utilisé en production). */
export function __setManualProbe(value: boolean | null): void {
  probe = value == null ? null : Promise.resolve(value);
}
