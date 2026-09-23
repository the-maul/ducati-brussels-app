/**
 * M8 — Parcours d'entretien pas à pas (mission 07).
 *
 * Formes de données du manuel d'atelier Ducati, indépendantes de leur provenance :
 * aujourd'hui le fichier de démonstration `public/demo/parcours-entretien.json`,
 * demain les tables du lot `lot-manuels` (voir `source.ts`).
 */

/** Attention (danger) / Important / Remarque / Élimination : distingués à l'écran. */
export type WarningKind = 'attention' | 'important' | 'remarque' | 'elimination' | 'avertissement' | string;

export type Figure = {
  /** Miniature (affichage dans le flux des étapes). */
  src: string;
  /** Pleine résolution (plein écran, zoom). */
  zoom: string;
};

export type Warning = { type: WarningKind; titre: string; texte: string };

/** Couple de serrage : la valeur en Nm et le repère de la figure sont mis en avant. */
export type Torque = {
  etape?: number | null;
  valeurNm: number | null;
  min?: number | null;
  max?: number | null;
  tolerance?: string | null;
  reperes?: string[];
  texte?: string;
};

export type SpecialTool = { reference?: string | null; description?: string | null; image?: Figure };

export type ProcedureLink = { parcoursId: string; titre: string };

/** D'où vient la page du manuel (jamais perdu : le technicien doit pouvoir remonter à la source). */
export type ManualSource = { manualRoot?: string; code?: string; version?: string; updateDate?: string; titre?: string };

export type ProcedureStep = {
  n: number;
  phase?: string;
  sousPhase?: string;
  texte: string;
  sousEtapes?: { n: number; texte: string }[];
  figures?: Figure[];
  outils?: string[];
  produits?: string[];
  couples?: Torque[];
  reperes?: string[];
  avertissements?: Warning[];
  liens?: ProcedureLink[];
};

export type Procedure = {
  id: string;
  titre: string;
  source?: ManualSource;
  intervention?: { operation?: string; services?: string[] };
  outils?: SpecialTool[];
  produits?: string[];
  couples?: Torque[];
  avertissements?: Warning[];
  figuresIntro?: Figure[];
  etapes: ProcedureStep[];
};

/** Un entretien du programme constructeur (Oil Service, Desmo Service…). */
export type ServiceDef = {
  service: string;
  km?: number | null;
  mois?: number | null;
  texte?: string;
  premiereEcheance?: boolean;
};

/** Les opérations que le concessionnaire doit faire pour cet entretien (texte du manuel). */
export type ServiceSchedule = {
  echeance: string;
  km?: number | null;
  mois?: number | null;
  definition?: string;
  operations: string[];
  source?: ManualSource;
};

/** Temps officiel Ducati (UT = unité de temps, 1 UT = 6 minutes). */
export type OfficialTime = { intitule: string; minutes?: number | null; ut?: number | null };

/** Programme d'entretien d'un modèle-année du catalogue Ducati. */
export type MaintenanceProgram = {
  /** Id du modèle-année (`ducati_catalog_model_years.id`, = `myId` des manuels). */
  modelYearId: string;
  famille: string;
  modele: string;
  annee: string;
  manualRoot?: string;
  services: ServiceDef[];
  echeances: ServiceSchedule[];
  proceduresParService: Record<string, { parcoursId: string; titre: string; operation: string }[]>;
  temps: OfficialTime[];
};

// ---------------------------------------------------------------------------
// Avancement du technicien (ce que le DMS enregistre, pas le manuel)
// ---------------------------------------------------------------------------

export type FindingKind = 'observation' | 'piece' | 'photo';

/** Observation, pièce à remplacer ou photo prise pendant le parcours. */
export type Finding = {
  id: string;
  kind: FindingKind;
  operationId: string;
  stepNo: number | null;
  texte: string;
  /** Pièce à remplacer : référence et quantité (alimentent les lignes de l'OR). */
  reference?: string | null;
  quantity?: number | null;
  /** Photo : nom du fichier et image (base64) tant que la GED n'est pas branchée. */
  photoName?: string | null;
  photoData?: string | null;
  at: string;
};

/** Un départ/arrêt de chrono sur une opération. */
export type ChronoSegment = { startedAt: string; endedAt: string | null };

export type OperationProgress = {
  id: string;
  /** Libellé de l'opération, tel qu'écrit dans le programme d'entretien. */
  label: string;
  /** Procédure pas à pas du manuel, ou null : opération sans procédure (simple case à cocher). */
  parcoursId: string | null;
  /** Coché « fait » (par le technicien, ou automatiquement quand toutes les étapes sont faites). */
  done: boolean;
  /** Étapes cochées : numéro d'étape → horodatage. */
  steps: Record<string, string>;
  note: string;
  chrono: ChronoSegment[];
};

export type JourneyState = {
  version: 1;
  orId: string;
  modelYearId: string;
  /** Nom de l'entretien choisi, tel qu'il figure au manuel. */
  serviceLabel: string;
  startedAt: string;
  finishedAt: string | null;
  operations: OperationProgress[];
  findings: Finding[];
  /** Le récapitulatif a déjà été reporté sur l'OR (on ne facture jamais tout seul). */
  reportedToOr: boolean;
};
