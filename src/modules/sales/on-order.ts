/**
 * M6 — « En commande » pour un client (mission 05, carte 7) : règles pures (testées par
 * tests/sales-on-order-client.test.ts). Même règle que la fonction SQL `article_on_order_for`,
 * seul calcul utilisé par le serveur ; ici on l'applique ligne par ligne pour EXPLIQUER le chiffre
 * dans l'écran « Associer une commande en cours à ce client ».
 *
 * « Ça ne devrait pas suivre l'attribution, sauf si c'était commandé pour le stock » (Domenico,
 * vidéo G8 4:49). Pour un document d'un client, une commande de pièces compte :
 *   - sa quantité CLIENT seulement si la commande est celle de ce client (contact) ou de ce document ;
 *   - sa quantité MAGASIN (pour le stock) tant qu'elle n'est associée à aucun client ;
 *   - la quantité magasin associée explicitement à ce client.
 * La quantité client d'un autre client n'est jamais comptée. Les commandes fournisseur (CMD) n'ont
 * pas de client : elles sont pour le stock.
 */
export type OpenOrderLine = {
  line_id: string; order_id: string; order_number: string | null; dispatch_status: string; order_kind: string;
  order_contact_id: string | null; order_contact_name: string | null; source_document_id: string | null;
  qty_client: number; qty_shop: number; allocated_qty: number; allocated_here: number; validated_at: string | null;
};

export type OnOrderWho = { contactId: string | null; documentId: string | null };

export function isOrderForClient(l: Pick<OpenOrderLine, 'order_contact_id' | 'source_document_id'>, who: OnOrderWho): boolean {
  return (!!who.contactId && l.order_contact_id === who.contactId) || (!!who.documentId && l.source_document_id === who.documentId);
}

export type OrderLineShare = { mine: number; stock: number; otherClient: number; freeForAllocation: number };

/** Part d'une ligne de commande de pièces : pour ce client, pour le stock, pour un autre client (exclue). */
export function orderLineShare(l: OpenOrderLine, who: OnOrderWho): OrderLineShare {
  const qc = Number(l.qty_client) || 0;
  const qs = Number(l.qty_shop) || 0;
  const allocAll = Math.min(Number(l.allocated_qty) || 0, qs);
  const allocHere = Math.min(Number(l.allocated_here) || 0, allocAll);
  const own = isOrderForClient(l, who);
  const stock = Math.max(qs - allocAll, 0);
  return {
    mine: (own ? qc : 0) + allocHere,
    stock,
    otherClient: (own ? 0 : qc) + (allocAll - allocHere),
    freeForAllocation: stock,
  };
}

/** « En commande » pour ce client = commandes fournisseur (stock) + Σ (part du client + part stock). */
export function onOrderForClient(lines: OpenOrderLine[], stockPurchaseQty: number, who: OnOrderWho): number {
  return lines.reduce((s, l) => {
    const sh = orderLineShare(l, who);
    return s + sh.mine + sh.stock;
  }, Number(stockPurchaseQty) || 0);
}
