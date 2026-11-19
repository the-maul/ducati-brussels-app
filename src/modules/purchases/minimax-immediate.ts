/**
 * M4 / M5 — Réassort minimax immédiat (décisions de Simon du 18/11/2026) : règles pures.
 *
 * Le calcul fait foi en base (migration 20261119130000_m4_minimax_immediat.sql) :
 *  - toute ligne de stock_moves qui BAISSE le stock du minimax (sortie du réel, réservation) porte
 *    la ligne minimax du panier standard ouvert au besoin s'il est plus haut (jamais baissée) ;
 *  - toute ligne qui le REMONTE (entrée, libération) la ramène au besoin s'il est plus bas ;
 *  - au remplacement d'une référence, minimum / maximum (et conditionnement s'il est vide sur la
 *    nouvelle) passent sur la référence finale de la chaîne.
 * Ces fonctions en sont le miroir (tests `tests/minimax-immediat.test.ts`) et servent à l'écran
 * (réglage par société, fenêtre de proposition en mode manuel, comme G8).
 */

export const MINIMAX_MODES = ['auto', 'manuel'] as const;
export type MinimaxMode = (typeof MINIMAX_MODES)[number];

/** Réglage de la société ; tout ce qui n'est pas « manuel » vaut le défaut « auto ». */
export function parseMinimaxMode(v: unknown): MinimaxMode {
  return v === 'manuel' ? 'manuel' : 'auto';
}

/** Un mouvement baisse-t-il le stock du minimax (réel − réservé − manque) ? null = sans effet. */
export function movementLowersMinimax(qtyDelta: number, isReservation: boolean): boolean | null {
  if (!Number.isFinite(qtyDelta) || qtyDelta === 0) return null;
  return (qtyDelta < 0) !== isReservation;
}

/**
 * Nouvelle quantité de la ligne minimax après un mouvement (null = rien ne change).
 * `need` = besoin calculé (maximum − stock du minimax − déjà en commande hors cette ligne).
 */
export function minimaxImmediateQty(p: { lowering: boolean; current: number; need: number }): number | null {
  const need = Math.max(p.need, 0);
  const current = Math.max(p.current, 0);
  if (p.lowering) return need > current ? need : null;
  return current > need ? need : null;
}

/** Remplacement de référence : ce qui passe de l'ancienne à la nouvelle (miroir de _article_minimax_transfer). */
export type MinimaxCarrier = { stockMin: number; stockMax: number; packQty: number };
export function minimaxTransfer(source: MinimaxCarrier, target: MinimaxCarrier): {
  source: MinimaxCarrier; target: MinimaxCarrier; changed: boolean;
} {
  const move = source.stockMin > 0 || source.stockMax > 0;
  const take = move && target.stockMin <= 0 && target.stockMax <= 0;
  const pack = source.packQty > 1 && target.packQty <= 1;
  return {
    changed: move || pack,
    source: move ? { ...source, stockMin: 0, stockMax: 0 } : { ...source },
    target: {
      stockMin: take ? source.stockMin : target.stockMin,
      stockMax: take ? source.stockMax : target.stockMax,
      packQty: pack ? source.packQty : target.packQty,
    },
  };
}

// ------------------------------------------------------------------ fenêtre de proposition (mode manuel)

export type MinimaxCheckSource = 'vente' | 'caisse' | 'picking' | 'nuit';
export type MinimaxCheckRequest = {
  companyId: string; articleIds: string[]; reference: string | null; source: MinimaxCheckSource;
};

/** Événement navigateur écouté par MinimaxProposalHost (monté une fois dans la mise en page). */
export const MINIMAX_CHECK_EVENT = 'dms:minimax-check';

export function uniqueArticleIds(ids: readonly (string | null | undefined)[]): string[] {
  return [...new Set(ids.filter((x): x is string => typeof x === 'string' && x.length > 0))];
}

/**
 * Après une validation (vente, ticket, picking) : demande le contrôle des minimums. Sans effet hors
 * navigateur ou sans article ; l'hôte ne montre la fenêtre qu'en mode « proposition manuelle ».
 */
export function requestMinimaxCheck(req: Omit<MinimaxCheckRequest, 'articleIds'> & { articleIds: readonly (string | null | undefined)[] }): void {
  if (typeof window === 'undefined' || !req.companyId) return;
  const articleIds = uniqueArticleIds(req.articleIds);
  if (articleIds.length === 0) return;
  window.dispatchEvent(new CustomEvent<MinimaxCheckRequest>(MINIMAX_CHECK_EVENT, { detail: { ...req, articleIds } }));
}

/**
 * Mode « proposition manuelle » (décision Q52, 19/11/2026) : la tâche de nuit ne remplit plus le panier,
 * elle prépare la liste des pièces sous leur minimum. L'écran des achats / paniers demande à l'hôte de
 * l'ouvrir (MINIMAX_NIGHT_EVENT) ; une seule ouverture automatique par jour et par société.
 */
export const MINIMAX_NIGHT_EVENT = 'dms:minimax-night';

export function requestMinimaxNightList(companyId: string): void {
  if (typeof window === 'undefined' || !companyId) return;
  window.dispatchEvent(new CustomEvent<{ companyId: string }>(MINIMAX_NIGHT_EVENT, { detail: { companyId } }));
}

/** Clé de l'ouverture automatique du jour (heure locale du poste). */
export function nightAutoOpenKey(companyId: string, now: Date = new Date()): string {
  const d = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return `minimax-night-opened:${companyId}:${d}`;
}

/** La liste de la nuit s'ouvre-t-elle d'elle-même ? Mode manuel, au moins une pièce, pas encore ouverte aujourd'hui. */
export function shouldAutoOpenNightList(p: { mode: MinimaxMode; count: number; alreadyOpenedToday: boolean }): boolean {
  return p.mode === 'manuel' && p.count > 0 && !p.alreadyOpenedToday;
}

export type MinimaxProposalRow = {
  articleId: string; reference: string; designation: string;
  stockMin: number; stockMax: number; minimaxStock: number; onOrder: number; inBasket: number; qty: number;
};

const num = (v: unknown) => Number(v ?? 0) || 0;

export function mapProposalRow(r: Record<string, unknown>): MinimaxProposalRow {
  return {
    articleId: String(r.article_id), reference: String(r.reference ?? ''), designation: String(r.designation ?? ''),
    stockMin: num(r.stock_min), stockMax: num(r.stock_max), minimaxStock: num(r.minimax_stock),
    onOrder: num(r.on_order), inBasket: num(r.in_basket), qty: num(r.qty),
  };
}

export type ProposalChoice = { selected: boolean; qty: string };

/** Saisie « 2,5 » ou « 2.5 » ; vide ou invalide = 0. */
export function parseQty(s: string): number {
  const v = Number(String(s ?? '').replace(',', '.').trim());
  return Number.isFinite(v) ? v : 0;
}

export function defaultChoices(rows: readonly MinimaxProposalRow[]): Record<string, ProposalChoice> {
  return Object.fromEntries(rows.map((r) => [r.articleId, { selected: true, qty: String(r.qty).replace('.', ',') }]));
}

/** Lignes envoyées à « Ajouter » : cochées, quantité > 0. */
export function proposalLinesToApply(rows: readonly MinimaxProposalRow[], choices: Record<string, ProposalChoice>): { article_id: string; qty: number }[] {
  return rows
    .map((r) => ({ r, c: choices[r.articleId] }))
    .filter(({ c }) => c?.selected && parseQty(c.qty) > 0)
    .map(({ r, c }) => ({ article_id: r.articleId, qty: parseQty(c.qty) }));
}

/** Pièces écartées (décochées ou à 0) : tracées comme ignorées. */
export function ignoredArticleIds(rows: readonly MinimaxProposalRow[], choices: Record<string, ProposalChoice>): string[] {
  const kept = new Set(proposalLinesToApply(rows, choices).map((l) => l.article_id));
  return rows.map((r) => r.articleId).filter((id) => !kept.has(id));
}
