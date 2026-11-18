/**
 * Rattrapage G8 (18/11/2026, lot parc) — insérer un kit / forfait comme LIGNES d'un OR ou d'un
 * document de vente (G8 : une nomenclature se rappelle en caisse et sur l'OR ; comparaison
 * atelier-parc §10, bloquant #17). Logique PURE, testee dans tests/kits-insertion.test.ts.
 *
 * Deux sources, toutes deux deja en base (on reutilise, on ne cree pas de 3e notion de kit) :
 *  - les KITS D'ENTRETIEN (maintenance_kits, par famille de moteur et entretien) ;
 *  - les FORFAITS / nomenclatures d'article (article_kit_items : un article parent + ses composants).
 * Deux modes :
 *  - « detail » : une ligne titre (texte) puis une ligne par piece, au prix de la piece (stock de
 *    chaque piece sorti a la facture, B7) ; une main-d'oeuvre (type T) devient une ligne MO ;
 *    un besoin sans article (« a confirmer ») devient une ligne texte, jamais une ligne a 0 € muette ;
 *  - « forfait » (forfaits a prix seulement) : une ligne de l'article forfait a SON prix, puis le
 *    contenu en lignes texte (comme le forfait TTC de G8).
 */
import { articleBaseSaleHt, articleVatRate } from '@/modules/sales/article-price';

export type KitComponent = {
  articleId: string | null;
  reference: string | null;
  designation: string;
  quantity: number;
};

export type PricedArticle = {
  id: string; reference: string; designation: string; mgmt_type: string | null;
  sale_price_ht?: number | null; sale_price_ttc?: number | null; vat_rate?: number | null;
};

/** Ligne neutre, convertie ensuite en ligne d'OR ou de document de vente. */
export type InsertLine = {
  type: 'piece' | 'mo' | 'texte';
  article_id: string | null;
  reference: string | null;
  designation: string;
  quantity: number;
  unit_price_ht: number;
  vat_rate: number;
};

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function kitInsertLines(p: {
  title: string;
  components: ReadonlyArray<KitComponent>;
  articles: ReadonlyMap<string, PricedArticle>;
  /** Arrondi catalogue de la societe (PU HT), facultatif. */
  effectiveHt?: (ht: number, vat: number) => number;
  /** Multiplicateur (G8 : quantite du forfait). */
  times?: number;
  mode?: 'detail' | 'forfait';
  /** Mode forfait : l'article forfait (parent) et son prix. */
  forfait?: PricedArticle | null;
  /** Prefixe des lignes de contenu en mode forfait (ex. « - »). */
  bullet?: string;
}): InsertLine[] {
  const times = p.times && p.times > 0 ? p.times : 1;
  const priceOf = (a: PricedArticle) => {
    const vat = articleVatRate(a);
    const base = articleBaseSaleHt(a);
    return { ht: p.effectiveHt ? p.effectiveHt(base, vat) : base, vat };
  };
  const out: InsertLine[] = [];

  if (p.mode === 'forfait' && p.forfait) {
    const { ht, vat } = priceOf(p.forfait);
    out.push({
      type: (p.forfait.mgmt_type ?? '') === 'T' ? 'mo' : 'piece', article_id: p.forfait.id, reference: p.forfait.reference,
      designation: p.forfait.designation || p.title, quantity: times, unit_price_ht: ht, vat_rate: vat,
    });
    for (const c of p.components) {
      const qty = r3(c.quantity * times);
      out.push({
        type: 'texte', article_id: null, reference: null,
        designation: `${p.bullet ?? '-'} ${[c.reference, c.designation].filter(Boolean).join(' ')} x ${String(qty).replace('.', ',')}`.trim(),
        quantity: 0, unit_price_ht: 0, vat_rate: 21,
      });
    }
    return out;
  }

  if (p.title.trim()) out.push({ type: 'texte', article_id: null, reference: null, designation: p.title.trim(), quantity: 0, unit_price_ht: 0, vat_rate: 21 });
  for (const c of p.components) {
    const qty = r3(c.quantity * times);
    const a = c.articleId ? p.articles.get(c.articleId) : undefined;
    if (!a) {
      out.push({
        type: 'texte', article_id: null, reference: null,
        designation: `${[c.reference, c.designation].filter(Boolean).join(' ')} x ${String(qty).replace('.', ',')}`.trim(),
        quantity: 0, unit_price_ht: 0, vat_rate: 21,
      });
      continue;
    }
    const { ht, vat } = priceOf(a);
    out.push({
      type: (a.mgmt_type ?? '') === 'T' ? 'mo' : 'piece', article_id: a.id, reference: a.reference,
      designation: a.designation || c.designation, quantity: qty, unit_price_ht: ht, vat_rate: vat,
    });
  }
  return out;
}

/** Total HT des lignes inserees (aperçu dans la fenetre). */
export function insertLinesTotalHt(lines: ReadonlyArray<InsertLine>): number {
  return Math.round(lines.reduce((s, l) => s + (l.type === 'texte' ? 0 : l.quantity * l.unit_price_ht), 0) * 100) / 100;
}

/** Ligne d'OR (RoLineInput) depuis une ligne inseree. */
export function toRoLine(l: InsertLine): { kind: 'piece' | 'mo' | 'texte'; article_id: string | null; designation: string; quantity: number; unit_price_ht: number; vat_rate: number; discount_pct: number; is_warranty: boolean } {
  return {
    kind: l.type, article_id: l.article_id, designation: l.designation,
    quantity: l.type === 'texte' ? 0 : l.quantity, unit_price_ht: l.type === 'texte' ? 0 : l.unit_price_ht,
    vat_rate: l.vat_rate, discount_pct: 0, is_warranty: false,
  };
}

/** Ligne de document de vente (LineInput) depuis une ligne inseree. */
export function toSaleLine(l: InsertLine): { article_id: string | null; designation: string; reference: string | null; quantity: number; unit_price_ht: number; vat_rate: number; discount_pct: number; line_type: 'article' | 'main_oeuvre' | 'texte' } {
  return {
    article_id: l.article_id, designation: l.designation, reference: l.reference,
    quantity: l.type === 'texte' ? 0 : l.quantity, unit_price_ht: l.type === 'texte' ? 0 : l.unit_price_ht,
    vat_rate: l.vat_rate, discount_pct: 0,
    line_type: l.type === 'texte' ? 'texte' : l.type === 'mo' ? 'main_oeuvre' : 'article',
  };
}

/**
 * « Remplacer une reference dans tous les kits » (G8 : Reference a remplacer -> nouvelle reference,
 * Modifier les forfaits) : apercu des kits touches. Une ligne deja presente avec la nouvelle piece
 * est FUSIONNEE (quantites additionnees) plutot que dupliquee — meme regle que la fonction SQL.
 */
export function replacementPreview<K extends { kitId: string; items: { articleId: string | null; quantity: number }[] }>(
  kits: ReadonlyArray<K>, oldId: string, newId: string,
): { kitId: string; merged: boolean; quantity: number }[] {
  if (!oldId || !newId || oldId === newId) return [];
  const out: { kitId: string; merged: boolean; quantity: number }[] = [];
  for (const k of kits) {
    const old = k.items.filter((i) => i.articleId === oldId);
    if (!old.length) continue;
    const already = k.items.filter((i) => i.articleId === newId);
    const qty = old.reduce((s, i) => s + i.quantity, 0) + already.reduce((s, i) => s + i.quantity, 0);
    out.push({ kitId: k.kitId, merged: already.length > 0, quantity: r3(qty) });
  }
  return out;
}
