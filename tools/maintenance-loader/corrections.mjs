/**
 * Corrections décidées par Simon, appliquées au chargement (plans.json n'est pas modifié).
 * Chaque correction garde sa source ; l'ancienne valeur est notée dans les notes du plan.
 */
export const PLAN_CORRECTIONS = [
  {
    id: 'monster_v2', modele: 'Monster V2', annees: { de: 2026, a: null },
    source: 'Simon, chat du 21/09/2026',
    note: 'Nouveau modèle Monster V2, millésime 2026 et suivants (et non une ancienne génération).',
  },
  {
    id: 'desertx_v2', modele: 'DesertX V2', annees: { de: 2026, a: null },
    source: 'Simon, chat du 21/09/2026',
    note: 'Nouveau modèle DesertX V2, millésime 2026 et suivants (et non une ancienne génération).',
  },
  {
    id: 'hyperv2', modele: 'Hypermotard V2', annees: { de: 2026, a: null },
    source: 'Simon, chat du 21/09/2026',
    note: 'Nouveau modèle Hypermotard V2, millésime 2026 et suivants (et non une ancienne génération).',
  },
];

const yearsText = (a) => (a && (a.de != null || a.a != null) ? `${a.de ?? '?'} → ${a.a ?? ''}`.trim() : 'non précisées');

/** Applique les corrections à un plan de plans.json (renvoie une copie ; notes complétées). */
export function applyPlanCorrections(plan, corrections = PLAN_CORRECTIONS) {
  const c = corrections.find((x) => x.id === plan.id);
  if (!c) return plan;
  const before = `modèle « ${plan.modele} », années ${yearsText(plan.annees)}`;
  return {
    ...plan,
    modele: c.modele ?? plan.modele,
    annees: c.annees ?? plan.annees,
    notes: [...(plan.notes || []),
      `Correction (${c.source}) : ${c.note} Avant correction : ${before}.`],
  };
}
