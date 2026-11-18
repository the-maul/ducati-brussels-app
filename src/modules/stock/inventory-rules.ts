/**
 * M5 — Règles PURES de l'inventaire guidé (rattrapage G8 du 18/11/2026).
 * Miroir exact des fonctions SQL de supabase/migrations/20261118210000_m5_inventaire_guide.sql :
 *   methodSteps        ↔ _inventory_method_steps
 *   methodCode         ↔ _inventory_method_code
 *   nextArreteQty      ↔ _arrete_next_qty          (B6 sur l'arrêté)
 *   realReadjustDelta  ↔ stock_readjust             (B6 sur le stock réel)
 *   reintegrationDelta ↔ _inventory_reintegrate     (B4, réintégration unique)
 *   resetDeltas        ↔ _stock_reset               (remise à zéro tous / négatifs)
 *   isAutoCopyDay      ↔ _cron_maybe_stock_copy     (copies du 15 et de fin de mois)
 * Testées dans tests/inventaire-guide.test.ts (règle 7 : arrêté / réintégration).
 */

export type StepCode =
  | 'debut' | 'sauvegarde' | 'generation_arrete' | 'raz_stock_reel' | 'edition_arrete_initial'
  | 'raz_arrete' | 'comptage' | 'reajustement_arrete' | 'reajustement_reel' | 'edition_ecarts'
  | 'edition_arrete_final' | 'sauvegarde_finale' | 'reintegration' | 'copie_stock' | 'fin';

export type MethodFlags = { open: boolean; erase: boolean; gaps: boolean };

/** Les 8 méthodes G8 : magasin ouvert / fermé × effacement × édition des écarts. */
export const ALL_METHODS: MethodFlags[] = [true, false].flatMap((open) =>
  [false, true].flatMap((erase) => [false, true].map((gaps) => ({ open, erase, gaps }))));

export function methodCode(f: MethodFlags): string {
  return `${f.open ? 'ouvert' : 'ferme'}${f.erase ? '_effacement' : ''}${f.gaps ? '_ecarts' : ''}`;
}

/** Étapes d'une méthode, dans l'ordre G8. */
export function methodSteps(f: MethodFlags): StepCode[] {
  if (f.open) {
    return [
      'debut', 'sauvegarde', 'generation_arrete', 'raz_stock_reel', 'edition_arrete_initial',
      ...(f.erase ? (['raz_arrete'] as StepCode[]) : []),
      'comptage', 'reajustement_arrete',
      ...(f.gaps ? (['edition_ecarts'] as StepCode[]) : []),
      'edition_arrete_final', 'sauvegarde_finale', 'reintegration', 'copie_stock', 'fin',
    ];
  }
  return [
    'debut', 'sauvegarde', 'generation_arrete', 'edition_arrete_initial',
    ...(f.erase ? (['raz_stock_reel'] as StepCode[]) : []),
    'comptage', 'reajustement_reel',
    ...(f.gaps ? (['edition_ecarts'] as StepCode[]) : []),
    'sauvegarde_finale', 'copie_stock', 'fin',
  ];
}

/** Mode de réajustement proposé par défaut : effacement → cumul, sinon annule et remplace. */
export function defaultMode(f: MethodFlags): ReadjustMode {
  return f.erase ? 'cumul' : 'annule_remplace';
}

/** Prochaine étape à valider (la première non validée), ou null si tout est fait. */
export function nextStep(steps: StepCode[], validated: ReadonlySet<string>): StepCode | null {
  return steps.find((s) => !validated.has(s)) ?? null;
}

/** Étape annulable par « Retour » : la dernière validée (pile), sauf la réintégration (définitive). */
export function rollbackTarget(steps: StepCode[], validated: ReadonlySet<string>): StepCode | null {
  const done = steps.filter((s) => validated.has(s));
  const last = done[done.length - 1] ?? null;
  return last === 'reintegration' ? null : last;
}

/** Ce que fait une étape : écrit en base, ouvre un écran de saisie, ou une édition à consulter. */
export function stepKind(step: StepCode): 'action' | 'saisie' | 'edition' | 'repere' {
  switch (step) {
    case 'sauvegarde': case 'sauvegarde_finale': case 'copie_stock': case 'generation_arrete':
    case 'raz_stock_reel': case 'raz_arrete': case 'reintegration': case 'fin':
      return 'action';
    case 'comptage': case 'reajustement_arrete': case 'reajustement_reel':
      return 'saisie';
    case 'edition_arrete_initial': case 'edition_arrete_final': case 'edition_ecarts':
      return 'edition';
    default:
      return 'repere';
  }
}

/** Étapes qui demandent une confirmation forte (elles touchent au stock réel). */
export function isDangerousStep(step: StepCode): boolean {
  return step === 'raz_stock_reel' || step === 'reintegration' || step === 'raz_arrete';
}

export type ReadjustMode = 'annule_remplace' | 'cumul' | 'casier';

/** Un réajustement déjà enregistré sur l'arrêté (ordre = id croissant). */
export type ArreteAdjustment = { id: number; mode: ReadjustMode | 'raz' | 'retour'; counted: number | null; bin: string | null };

const COUNT_MODES = new Set(['annule_remplace', 'cumul', 'casier', 'raz']);

/**
 * Nouvelle quantité de l'arrêté après un comptage (B6) :
 *  - annule et remplace : la saisie remplace ;
 *  - cumul : la saisie s'ajoute aux comptages « cumul » faits depuis le dernier comptage
 *    d'un autre mode (multi-emplacements : on part de 0) ;
 *  - casier : somme du DERNIER comptage de chaque casier depuis le dernier comptage d'un
 *    autre mode (recompter un casier remplace ce casier seulement).
 */
export function nextArreteQty(history: ArreteAdjustment[], mode: ReadjustMode, counted: number, bin?: string | null): number {
  if (mode === 'annule_remplace') return counted;
  const sorted = [...history].sort((a, b) => a.id - b.id);
  const lastOther = sorted.filter((h) => COUNT_MODES.has(h.mode) && h.mode !== mode).reduce((m, h) => Math.max(m, h.id), 0);
  const recent = sorted.filter((h) => h.mode === mode && h.id > lastOther);
  if (mode === 'cumul') return recent.reduce((s, h) => s + (h.counted ?? 0), 0) + counted;
  const latestByBin = new Map<string, number>();
  for (const h of recent) latestByBin.set(h.bin ?? '', h.counted ?? 0);
  latestByBin.delete(bin ?? '');
  return [...latestByBin.values()].reduce((s, v) => s + v, 0) + counted;
}

/**
 * Mouvement de réajustement du STOCK RÉEL (B6) :
 *  - annule et remplace : compté − réel ;
 *  - cumul : la saisie s'ajoute ;
 *  - casier : article à un seul emplacement → compté − réel ; multi-emplacements →
 *    compté − stock connu du casier.
 */
export function realReadjustDelta(mode: ReadjustMode, real: number, counted: number, opts: { multiBin?: boolean; binQty?: number } = {}): number {
  if (mode === 'cumul') return counted;
  if (mode === 'casier' && opts.multiBin) return round3(counted - (opts.binQty ?? 0));
  return round3(counted - real);
}

/**
 * Réintégration de l'arrêté (une seule fois) : stock réel cible = arrêté réajusté +
 * mouvements faits depuis l'arrêté hors inventaire (ventes, réceptions pendant le comptage).
 * Le mouvement inséré = cible − réel actuel. Juste avec ou sans remise à zéro du réel.
 */
export function reintegrationDelta(adjustedQty: number, movesSinceOutsideInventory: number, currentReal: number): number {
  return round3(adjustedQty + movesSinceOutsideInventory - currentReal);
}

export type StockLevel = { article_id: string; real_qty: number; mgmt_type: string };

/** Remise à zéro : mouvements −réel des articles visés (tous ≠ 0, ou négatifs seuls). */
export function resetDeltas(levels: StockLevel[], scope: 'tous' | 'negatifs', keepVehicles: boolean): { article_id: string; delta: number }[] {
  return levels
    .filter((l) => l.real_qty !== 0)
    .filter((l) => scope !== 'negatifs' || l.real_qty < 0)
    .filter((l) => !keepVehicles || !['V', 'O', 'P', 'D'].includes(l.mgmt_type))
    .map((l) => ({ article_id: l.article_id, delta: -l.real_qty }));
}

/** Phrase à taper pour confirmer une remise à zéro (contrôlée aussi côté base). */
export const RESET_CONFIRM_PHRASE = 'REMISE A ZERO';

/** Copie automatique : le 15 ou le dernier jour du mois (date locale de Bruxelles). */
export function isAutoCopyDay(d: { year: number; month: number; day: number }): boolean {
  if (d.day === 15) return true;
  const last = new Date(Date.UTC(d.year, d.month, 0)).getUTCDate(); // month : 1-12
  return d.day === last;
}

/** Stock d'un article à une date : somme des mouvements (hors réservations) jusqu'à la date incluse. */
export function stockAtDate(moves: { qty_delta: number; occurred_at: string; is_reservation: boolean }[], at: string): number {
  const t = Date.parse(at);
  return round3(moves.filter((m) => !m.is_reservation && Date.parse(m.occurred_at) <= t).reduce((s, m) => s + m.qty_delta, 0));
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
