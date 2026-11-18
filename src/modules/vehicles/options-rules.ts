/**
 * Rattrapage G8 (18/11/2026, lot parc) — catalogue d'options par modele (« Catalogues d'options » G8).
 * Logique PURE, testee dans tests/parc-options.test.ts.
 *
 * Une option = groupe, code, libelle, prix d'achat HT, prix de vente TTC. A la vente d'une moto
 * neuve, les options cochees deviennent des lignes du document (une ligne par option, prix TTC
 * respecte : PU HT = PV TTC / (1 + TVA)) et le vendeur voit le « PV vehicule + options ».
 */
const r2 = (n: number) => Math.round(n * 100) / 100;

export type VehicleOption = {
  id: string; model_id: string; group_code: string | null; code: string; label: string;
  purchase_price_ht: number; sale_price_ttc: number; vat_rate: number; info: string | null; sort_order: number;
};

export type OptionLine = {
  article_id: null; designation: string; quantity: number; unit_price_ht: number; vat_rate: number; discount_pct: number;
  line_type: 'article'; reference: string | null;
};

/** Lignes de document des options cochees, dans l'ordre du catalogue. */
export function optionsToLines(options: ReadonlyArray<VehicleOption>, prefix = ''): OptionLine[] {
  return options.slice().sort((a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code)).map((o) => {
    const vat = Number.isFinite(Number(o.vat_rate)) ? Number(o.vat_rate) : 21;
    return {
      article_id: null,
      designation: `${prefix}${o.label}`.trim(),
      quantity: 1,
      unit_price_ht: r2(Number(o.sale_price_ttc || 0) / (1 + vat / 100)),
      vat_rate: vat,
      discount_pct: 0,
      line_type: 'article',
      reference: o.code || null,
    };
  });
}

/** « PV vehicule + options » (TTC), cout des options (PA HT) et marge brute des options (HT). */
export function vehiclePlusOptions(vehicleTtc: number | null | undefined, options: ReadonlyArray<VehicleOption>): {
  optionsTtc: number; optionsCostHt: number; optionsMarginHt: number; totalTtc: number;
} {
  let ttc = 0, cost = 0, ht = 0;
  for (const o of options) {
    const vat = Number.isFinite(Number(o.vat_rate)) ? Number(o.vat_rate) : 21;
    ttc += Number(o.sale_price_ttc || 0);
    cost += Number(o.purchase_price_ht || 0);
    ht += Number(o.sale_price_ttc || 0) / (1 + vat / 100);
  }
  return { optionsTtc: r2(ttc), optionsCostHt: r2(cost), optionsMarginHt: r2(ht - cost), totalTtc: r2(Number(vehicleTtc || 0) + ttc) };
}

/** Options regroupees par groupe (G8 : colonne Groupe), groupes dans l'ordre alphabetique, « sans groupe » en dernier. */
export function groupOptions(options: ReadonlyArray<VehicleOption>): { group: string; items: VehicleOption[] }[] {
  const map = new Map<string, VehicleOption[]>();
  for (const o of options) {
    const g = (o.group_code ?? '').trim();
    if (!map.has(g)) map.set(g, []);
    map.get(g)!.push(o);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
    .map(([group, items]) => ({ group, items: items.sort((a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code)) }));
}

/** Modele du catalogue propose pour une ligne de vente : celui relie a l'article, sinon par code / libelle. */
export function suggestOptionModel<M extends { id: string; code: string; label: string; article_id: string | null }>(
  models: ReadonlyArray<M>, hint: { articleId?: string | null; text?: string | null },
): M | null {
  if (hint.articleId) {
    const byArticle = models.find((m) => m.article_id === hint.articleId);
    if (byArticle) return byArticle;
  }
  const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const txt = norm(hint.text ?? '');
  if (!txt) return null;
  return models.find((m) => norm(m.code) && txt.includes(norm(m.code)))
    ?? models.find((m) => norm(m.label) && txt.includes(norm(m.label))) ?? null;
}
