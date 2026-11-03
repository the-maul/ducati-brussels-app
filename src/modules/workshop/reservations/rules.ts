/**
 * M8 / M5 — Reservation des pieces de l'entretien des le RDV (mission 10, carte 6, M-111 a M-113).
 * Regles pures, miroir des fonctions SQL de la migration 20261103270000 :
 *   _workshop_reservations_sync     -> planReservationLine, basketKindFor
 *   _basket_minimax_need            -> minimaxStock, minimaxNeed
 *   _workshop_reservations_invoice  -> invoiceRelease
 *   workshop_reservations_list      -> displayStatus
 * Rappel B4 / B7 : disponible = reel - reserve (+ en commande) ; une reservation est un mouvement
 * append-only, jamais une sortie : seule la facture sort le stock reel.
 */

const q3 = (n: number) => Math.round(n * 1000) / 1000;

export type StockState = { real: number; reserved: number };

/**
 * Une piece du kit face au stock. `alreadyReserved` = ce que CETTE ligne tient deja (elle compte
 * comme disponible pour elle) ; `alreadyOrdered` = ce qui est deja parti au panier pour elle.
 */
export function planReservationLine(p: {
  needed: number; stock: StockState; alreadyReserved?: number; alreadyOrdered?: number;
}): { reserve: number; move: number; missing: number; toBasket: number } {
  const own = Math.max(p.alreadyReserved ?? 0, 0);
  const free = Math.max(p.stock.real - p.stock.reserved + own, 0);
  const reserve = q3(Math.min(Math.max(p.needed, 0), free));
  const missing = q3(Math.max(p.needed - reserve, 0));
  const toBasket = q3(Math.max(missing - Math.max(p.alreadyOrdered ?? 0, 0), 0));
  return { reserve, move: q3(reserve - own), missing, toBasket };
}

/** Panier du manque : urgente si le RDV est a moins de N jours (ou si la moto est deja la), standard sinon. */
export function basketKindFor(dueAt: string | Date | null, today: string | Date = new Date(), urgentWithinDays = 5): 'standard' | 'urgente' {
  if (!dueAt) return 'urgente';
  const day = (d: string | Date) => {
    const x = typeof d === 'string' ? new Date(d) : d;
    return Date.UTC(x.getFullYear(), x.getMonth(), x.getDate());
  };
  const days = Math.round((day(dueAt) - day(today)) / 86_400_000);
  return days < urgentWithinDays ? 'urgente' : 'standard';
}

/** Stock vu par le minimax (M-112) : reel - reserve - manque des RDV. */
export function minimaxStock(p: { real: number; reserved: number; workshopMissing: number }): number {
  return q3(p.real - p.reserved - p.workshopMissing);
}

/**
 * Quantite minimax apres reservation : 0 si le stock du minimax tient le minimum ; sinon
 * greatest(max, min) - stock du minimax - deja en commande (jamais negatif). Meme formule que le
 * panier (basket.ts minimaxQty) avec le stock du minimax a la place du reel.
 */
export function minimaxNeed(p: { stockMin: number; stockMax: number; minimaxStock: number; onOrder: number }): number {
  if (!(p.stockMin > 0) || p.minimaxStock >= p.stockMin) return 0;
  return q3(Math.max(Math.max(p.stockMax || 0, p.stockMin) - p.minimaxStock - (p.onOrder || 0), 0));
}

export type ReservationRow = { articleId: string; reserved: number };

/**
 * Facture de l'OR : chaque reservation est liberee (mouvement inverse) et « consommee » a hauteur
 * de ce que la facture a sorti pour cette piece ; la sortie du stock reel est celle de la facture,
 * jamais une deuxieme. Une piece reservee absente de la facture est simplement liberee.
 */
export function invoiceRelease(rows: ReservationRow[], invoiced: Map<string, number>): {
  articleId: string; liberation: number; consumed: number; status: 'consommee' | 'liberee'; reason: 'facture' | 'non_facturee';
}[] {
  return rows.map((r) => {
    const consumed = q3(Math.min(r.reserved, Math.max(invoiced.get(r.articleId) ?? 0, 0)));
    return {
      articleId: r.articleId, liberation: q3(-r.reserved), consumed,
      status: consumed > 0 ? 'consommee' : 'liberee', reason: consumed > 0 ? 'facture' : 'non_facturee',
    };
  });
}

/**
 * Mouvements d'une facture d'OR, par piece : la sortie du reel (facture) et le mouvement du reserve
 * (liberation). Le reel ne bouge qu'une fois, le reserve revient a zero.
 */
export function invoiceMoves(invoicedLines: { articleId: string; qty: number }[], rows: ReservationRow[]): Map<string, { real: number; reserved: number }> {
  const out = new Map<string, { real: number; reserved: number }>();
  const get = (id: string) => out.get(id) ?? { real: 0, reserved: 0 };
  for (const l of invoicedLines) { const c = get(l.articleId); out.set(l.articleId, { ...c, real: q3(c.real - l.qty) }); }
  const inv = new Map(invoicedLines.map((l) => [l.articleId, l.qty]));
  for (const r of invoiceRelease(rows, inv)) { const c = get(r.articleId); out.set(r.articleId, { ...c, reserved: q3(c.reserved + r.liberation) }); }
  return out;
}

/** RDV annule (ou entretien retire) : tout ce qui est tenu est libere. */
export function releaseAll(rows: ReservationRow[]): { articleId: string; liberation: number }[] {
  return rows.filter((r) => r.reserved > 0).map((r) => ({ articleId: r.articleId, liberation: q3(-r.reserved) }));
}

export type DisplayStatus = 'reservee' | 'a_commander' | 'commandee' | 'recue' | 'sortie' | 'liberee';

/** Statut affiche d'une ligne (bloc « Pieces reservees »). */
export function displayStatus(p: {
  status: 'active' | 'liberee' | 'consommee'; needed: number; reserved: number;
  basketStatus?: 'ouvert' | 'commande' | 'recu' | 'annule' | string | null;
}): DisplayStatus {
  if (p.status === 'consommee') return 'sortie';
  if (p.status === 'liberee') return 'liberee';
  if (p.needed - p.reserved <= 0) return 'reservee';
  if (p.basketStatus === 'recu') return 'recue';
  if (p.basketStatus === 'commande') return 'commandee';
  return 'a_commander';
}

export type ArticleReservation = { holder: string; contactName: string | null; dueAt: string | null; qtyReserved: number };

/**
 * Comptoir : avertir quand la vente mange une piece reservee pour un RDV. Rien si le libre
 * (reel - reserve) couvre la quantite, ou si aucune reservation atelier n'est en cours.
 */
export function reservedSaleWarning(p: { qty: number; real: number; reserved: number; reservations: ArticleReservation[] }): ArticleReservation[] | null {
  const active = p.reservations.filter((r) => r.qtyReserved > 0);
  if (!active.length) return null;
  const free = p.real - p.reserved;
  if (p.qty <= free) return null;
  return active;
}
