/**
 * M2 / M4 — Etat d'une piece chez Ducati, lu dans le tarif (colonne « Etat », TAR008, 03/11/2026).
 *
 * Comptage sur les trois fichiers ListPrice Ducati (PARTS, ACCESSORIES, APPAREL) :
 *  - vide = reference ACTIVE, commandable           -> supplier_availability 'green'
 *  - E    = reference REMPLACEE (colonne Remplacement) -> 'yellow' (valeur existante de la contrainte)
 *  - F    = FIN DE SERIE sans remplacant, plus commandable -> 'red'
 * Le DMS lisait l'inverse avant le 03/11 (E = vert, vide = rien).
 *
 * Garde-fous (fonctions PURES, testees dans tests/supply-state.test.ts) :
 *  - une piece en fin de serie ne part ni dans un panier fournisseur, ni dans une commande de
 *    pieces, ni sur Shopify ; son stock restant se vend normalement ;
 *  - une piece remplacee n'est jamais commandee sous l'ancien numero : on suit la chaine de
 *    remplacement (superseded_by_id) jusqu'a la derniere reference, sinon on refuse avec la raison.
 */
import { t } from '@/lib/i18n';
import { followReplacementChain } from '@/modules/sales/replacement-chain';

export type SupplierAvailability = 'green' | 'yellow' | 'red';
export type SupplyState = 'orderable' | 'replaced' | 'discontinued' | 'unknown';

/** Valeur de la colonne -> etat lisible. Toute autre valeur (ou vide) = inconnu. */
export function supplyStateOf(availability: string | null | undefined): SupplyState {
  if (availability === 'green') return 'orderable';
  if (availability === 'yellow') return 'replaced';
  if (availability === 'red') return 'discontinued';
  return 'unknown';
}

/** Article minimal pour decider d'une commande fournisseur. */
export type SupplyArticle = {
  id: string;
  reference: string;
  supplier_availability?: string | null;
  superseded_by_id?: string | null;
};

export type SupplierOrderDecision =
  | { ok: true; articleId: string; reference: string; substitutedFrom?: string }
  | { ok: false; code: 'discontinued' | 'replaced'; reference: string; replacementRef: string | null; message: string };

const fill = (s: string, vars: Record<string, string>) =>
  Object.entries(vars).reduce((acc, [k, v]) => acc.replace(`{${k}}`, v), s);

export function discontinuedMessage(reference: string): string {
  return fill(t('articles.supplyOrderDiscontinued'), { ref: reference });
}

export function replacedMessage(reference: string, replacementRef: string | null): string {
  return replacementRef
    ? fill(t('articles.supplyOrderReplacedBy'), { ref: reference, new: replacementRef })
    : fill(t('articles.supplyOrderReplaced'), { ref: reference });
}

/**
 * Peut-on commander cet article chez le fournisseur ?
 * `byId` contient l'article et sa chaine de remplacement (chargee par supply-guard.ts).
 *  - fin de serie : refus ;
 *  - remplacee : on commande la DERNIERE reference de la chaine si elle est connue et elle-meme
 *    commandable ; sinon refus avec la nouvelle reference ;
 *  - commandable ou inconnu : accepte tel quel (inconnu = tarif pas encore importe).
 */
export function supplierOrderDecision(start: SupplyArticle, byId: Map<string, SupplyArticle>): SupplierOrderDecision {
  const state = supplyStateOf(start.supplier_availability);
  if (state === 'discontinued') {
    return { ok: false, code: 'discontinued', reference: start.reference, replacementRef: null, message: discontinuedMessage(start.reference) };
  }
  if (state !== 'replaced') return { ok: true, articleId: start.id, reference: start.reference };

  const direct = start.superseded_by_id ? byId.get(start.superseded_by_id) ?? null : null;
  const chain = followReplacementChain(start.id, (id) => {
    const n = byId.get(id)?.superseded_by_id ?? null;
    return n && byId.has(n) ? n : null;
  });
  const last = chain.lastId ? byId.get(chain.lastId) ?? null : null;
  const refused = (replacementRef: string | null): SupplierOrderDecision => ({
    ok: false, code: 'replaced', reference: start.reference, replacementRef, message: replacedMessage(start.reference, replacementRef),
  });
  if (!last || chain.loop) return refused(direct?.reference ?? null);
  const lastState = supplyStateOf(last.supplier_availability);
  // La derniere reference doit elle-meme etre commandable (pas fin de serie, pas « remplacee » sans suite connue).
  if (lastState === 'discontinued' || lastState === 'replaced') return refused(last.reference);
  return { ok: true, articleId: last.id, reference: last.reference, substitutedFrom: start.reference };
}

/** Message affiche quand une ligne est commandee sous la nouvelle reference. */
export function substitutedMessage(from: string, to: string): string {
  return fill(t('articles.supplyOrderSubstituted'), { ref: from, new: to });
}

/**
 * Applique la decision a une liste de lignes de panier : les lignes refusees sont retirees
 * (avec leur message), les lignes remplacees passent sur la derniere reference.
 */
export function guardSupplierLinesPure<L extends { article_id: string }>(
  lines: L[],
  byId: Map<string, SupplyArticle>,
): { lines: L[]; refused: string[]; substituted: string[] } {
  const out: L[] = [];
  const refused: string[] = [];
  const substituted: string[] = [];
  for (const l of lines) {
    const a = byId.get(l.article_id);
    if (!a) { out.push(l); continue; }
    const d = supplierOrderDecision(a, byId);
    if (!d.ok) { refused.push(d.message); continue; }
    if (d.substitutedFrom) {
      substituted.push(substitutedMessage(d.substitutedFrom, d.reference));
      out.push({ ...l, article_id: d.articleId });
    } else out.push(l);
  }
  return { lines: out, refused, substituted };
}

/** Pastille de la recherche d'article : rien pour une piece commandable ou inconnue. */
export function supplyBadgeOf(availability: string | null | undefined): { tone: 'warning' | 'danger'; label: string; hint: string } | null {
  const s = supplyStateOf(availability);
  if (s === 'replaced') return { tone: 'warning', label: t('articles.supplyReplaced'), hint: t('articles.availYellow') };
  if (s === 'discontinued') return { tone: 'danger', label: t('articles.supplyDiscontinued'), hint: t('articles.availRed') };
  return null;
}
