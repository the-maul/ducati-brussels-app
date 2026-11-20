/**
 * M8 — Lot UX atelier (20/11/2026) : la fiche OR en 3 onglets (revue UX/UI, « Fiche OR en 3 zones »).
 * Règles PURES (testées dans `tests/atelier-ux-atelier.test.ts`) :
 *  - les 3 onglets et leur nom dans l'adresse (`?tab=`) ;
 *  - l'onglet par défaut selon l'étape : « Travail » tant que la moto se travaille (mécanicien),
 *    « Lignes et prix » quand elle est prête ou facturée (réception, facturation).
 */
export const OR_TABS = ['travail', 'lignes', 'documents'] as const;
export type OrTab = (typeof OR_TABS)[number];

export const isOrTab = (v: unknown): v is OrTab => typeof v === 'string' && (OR_TABS as readonly string[]).includes(v);
export const parseOrTab = (v: unknown): OrTab | undefined => (isOrTab(v) ? v : undefined);

/** Statuts où le travail est fini : l'étape est la facture. */
const BILLING_STATUSES = new Set(['pret', 'client_informe', 'facture']);

export function defaultOrTab(status: string | null | undefined): OrTab {
  return status && BILLING_STATUSES.has(status) ? 'lignes' : 'travail';
}

/** Volet de l'éditeur d'OR à montrer pour un onglet (l'onglet Documents n'en montre aucun). */
export function editorPane(tab: OrTab): 'work' | 'lines' | 'none' {
  return tab === 'travail' ? 'work' : tab === 'lignes' ? 'lines' : 'none';
}
