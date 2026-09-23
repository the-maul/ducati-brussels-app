/**
 * M8 — Parcours d'entretien : COUCHE D'ACCÈS aux manuels d'atelier.
 *
 * L'écran technicien ne sait pas d'où viennent les données. Deux fournisseurs :
 *
 *  - **démonstration** (aujourd'hui) : `public/demo/parcours-entretien.json`, extrait des manuels
 *    Ducati par `tools/journey-demo/build.mjs` ;
 *  - **base** (lot `lot-manuels`, branché le 23/09) : les manuels d'atelier Ducati chargés en
 *    production — 461 manuels couvrant 469 modèles-années, 3 336 procédures, 36 326 étapes —, lus
 *    par les trois vues `ducati_manual_*` posées au-dessus des tables `wsm_*` (décision M-33).
 *
 * La bascule est automatique : au premier appel on regarde si les vues sont là (`probeManualTables`).
 * Tant qu'elles ne le sont pas, l'écran affiche un bandeau « données de démonstration ».
 */
import { supabase } from '@/integrations/supabase/client';
import type { MaintenanceProgram, Procedure } from './types';

/**
 * Vues publiées par le lot `lot-manuels` au-dessus des tables `wsm_*`
 * (migration `20260923103000_m8_manuels_atelier_vues_parcours.sql`, décision M-33).
 * Les noms et les formes sont exactement ceux attendus ici : rien d'autre à ajuster.
 */
export const MANUAL_TABLES = {
  /** Programme d'entretien par modèle-année : échéances, opérations, temps UT. Une ligne par modèle-année. */
  program: 'ducati_manual_programs',
  /** Procédures dédoublonnées : titre, source, outils, produits, couples, avertissements — et `etapes`. */
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

/**
 * Colonnes d'identité d'un programme. La vue porte AUSSI tout le programme (échéances, opérations,
 * procédures par échéance, temps) : un `select('*')` sur les 461 manuels ramènerait **6,47 Mo**,
 * alors que la liste ne sert qu'à choisir une moto en mode démonstration. On ne prend donc que
 * l'identité (32 Ko) ; le programme complet arrive avec `getProgram`, moto par moto.
 */
const PROGRAM_ID_COLS = 'model_year_id,"modelYearId",famille,modele,annee,"manualRoot"';

const baseSource: JourneySource = {
  kind: 'base',
  async listPrograms() {
    const { data, error } = await loose.from(MANUAL_TABLES.program).select(PROGRAM_ID_COLS).order('model_year_id').limit(2000);
    if (error) throw new Error(error.message);
    // Les listes absentes de la projection sont rendues vides : la liste n'affiche que le modèle.
    return ((data as Partial<MaintenanceProgram>[] | null) ?? []).map((p) => ({
      services: [], echeances: [], proceduresParService: {}, temps: [], ...p,
    })) as MaintenanceProgram[];
  },
  async getProgram(modelYearId) {
    const { data, error } = await loose.from(MANUAL_TABLES.program).select('*').eq('model_year_id', modelYearId).maybeSingle();
    if (error) throw new Error(error.message);
    return (data as MaintenanceProgram | null) ?? null;
  },
  async getProcedure(parcoursId) {
    // `etapes` est déjà une colonne de la vue : pas de ressource imbriquée à demander (PostgREST ne
    // sait pas toujours déduire la relation entre deux vues, et l'aller-retour serait inutile).
    const { data, error } = await loose.from(MANUAL_TABLES.procedure).select('*').eq('id', parcoursId).maybeSingle();
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
