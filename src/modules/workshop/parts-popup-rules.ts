/**
 * Popup « des pieces manquent pour cet entretien : les mettre en commande ? »
 * (mission 09, carte 3 ; ATE013). Regles pures, testees par tests/workshop-parts-popup.test.ts.
 *
 *   manquant = kit − stock reel disponible (reel − reserve, jamais negatif) − deja en commande ;
 *   une piece deja proposee pour le meme OR / le meme RDV n'est jamais redemandee ;
 *   type propose : « urgente » si le rendez-vous est a moins de N jours (reglage, defaut 5),
 *   « standard » sinon ; pas de popup si rien ne manque.
 */

/** Reglage par defaut : urgente si le RDV est a moins de 5 jours (reference_values order_threshold / urgente, extra.urgent_within_days). */
export const DEFAULT_URGENT_WITHIN_DAYS = 5;

export type KitStockLine = {
  articleId: string | null;
  reference: string | null;
  designation: string;
  /** quantite du kit */
  quantity: number;
  realQty: number;
  reservedQty: number;
  onOrderQty: number;
  /** une piece « a confirmer » du kit (mission 07) n'est pas proposee */
  confidence?: 'sur' | 'a_confirmer';
};

export type MissingPart = {
  articleId: string | null;
  reference: string;
  designation: string;
  qtyNeeded: number;
  realQty: number;
  reservedQty: number;
  onOrderQty: number;
  qtyMissing: number;
};

const num = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Cle d'une piece : l'article, sinon la reference. */
export function partKey(p: { articleId: string | null; reference: string | null }): string {
  return p.articleId ?? `ref:${String(p.reference ?? '').trim().toUpperCase()}`;
}

/**
 * Pieces du kit non couvertes par le stock reel ni par une commande en cours.
 * Les lignes d'un meme article sont additionnees ; les pieces deja proposees (`asked`)
 * sont ecartees ; les pieces sans article ni reference, ou « a confirmer », aussi.
 */
export function missingKitParts(kit: KitStockLine[], asked: Iterable<string> = []): MissingPart[] {
  const skip = new Set(asked);
  const merged = new Map<string, MissingPart>();
  for (const k of kit) {
    if (k.confidence === 'a_confirmer') continue;
    if (!k.articleId && !String(k.reference ?? '').trim()) continue;
    const key = partKey(k);
    if (skip.has(key)) continue;
    const cur = merged.get(key);
    if (cur) { cur.qtyNeeded = round3(cur.qtyNeeded + num(k.quantity)); continue; }
    merged.set(key, {
      articleId: k.articleId, reference: String(k.reference ?? '').trim(), designation: k.designation,
      qtyNeeded: num(k.quantity), realQty: num(k.realQty), reservedQty: num(k.reservedQty), onOrderQty: num(k.onOrderQty), qtyMissing: 0,
    });
  }
  const out: MissingPart[] = [];
  for (const m of merged.values()) {
    const free = Math.max(m.realQty - m.reservedQty, 0);
    m.qtyMissing = round3(Math.max(m.qtyNeeded - free - m.onOrderQty, 0));
    if (m.qtyMissing > 0.0005) out.push(m);
  }
  return out.sort((a, b) => a.reference.localeCompare(b.reference));
}

/** Pas de popup si rien ne manque. */
export function popupNeeded(missing: MissingPart[]): boolean {
  return missing.length > 0;
}

/** Jours entiers entre aujourd'hui et le rendez-vous (negatif = passe). */
export function daysUntil(appointment: string | Date, today: string | Date = new Date()): number {
  const toUtc = (d: string | Date) => {
    const x = typeof d === 'string' ? new Date(d) : d;
    return Date.UTC(x.getFullYear(), x.getMonth(), x.getDate());
  };
  return Math.round((toUtc(appointment) - toUtc(today)) / 86_400_000);
}

export type PopupKind = 'standard' | 'urgente';

/**
 * Type propose : urgente si le RDV est a moins de N jours (N = reglage, defaut 5) ;
 * sans date de RDV (ouverture d'un OR, la moto est la) : urgente aussi, car la moto attend.
 */
export function suggestedKind(appointment: string | Date | null, today: string | Date = new Date(), urgentWithinDays: number = DEFAULT_URGENT_WITHIN_DAYS): PopupKind {
  if (!appointment) return 'urgente';
  return daysUntil(appointment, today) < urgentWithinDays ? 'urgente' : 'standard';
}

/** Lignes a envoyer au panier (basket_add_lines) / a la commande de pieces de repli. */
export function basketLines(missing: MissingPart[]): { article_id: string | null; reference: string; designation: string; qty: number }[] {
  return missing.filter((m) => m.qtyMissing > 0).map((m) => ({ article_id: m.articleId, reference: m.reference, designation: m.designation, qty: m.qtyMissing }));
}

/** Memoire du popup : ce qu'on enregistre pour ne jamais redemander ces pieces. */
export function promptLines(missing: MissingPart[]): { article_id: string | null; reference: string; designation: string; qty_missing: number }[] {
  return missing.map((m) => ({ article_id: m.articleId, reference: m.reference, designation: m.designation, qty_missing: m.qtyMissing }));
}

/** Code de motif « entretien » (meme regle que le check-up : entretien_* ou vidange). */
export function isMaintenanceReasonCode(code: string | null | undefined): boolean {
  return !!code && (code.startsWith('entretien') || code === 'vidange');
}
