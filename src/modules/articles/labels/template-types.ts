/**
 * M2/M5 (B12) — Formats d'étiquettes personnalisés (équivalent « Paramétrage
 * des étiquettes personnalisée » de G8). Un format = dimensions (rouleau ou
 * planche A4) + éléments positionnés en mm + code-barres + image importée.
 * Fonctions PURES (layout planche, données) — testées dans tests/label-templates.test.ts.
 */

export type LabelFont = 'Arial' | 'Helvetica' | 'Courier';

/** Clés d'éléments imprimables (mêmes lignes que l'écran G8). */
export const ELEMENT_KEYS = [
  'reference', 'designation', 'price_ttc', 'price_ht', 'price_promo', 'discount',
  'date', 'store_name', 'bin', 'bin2', 'pack_qty', 'barcode_value', 'free1', 'free2', 'free3',
] as const;
export type ElementKey = (typeof ELEMENT_KEYS)[number];

export type LabelElement = {
  key: ElementKey;
  visible: boolean;
  font: LabelFont;
  sizePt: number;
  bold: boolean;
  xMm: number;
  yMm: number;
  vertical: boolean; // orientation
};

export type LabelBarcode = { visible: boolean; xMm: number; yMm: number; widthMm: number; heightMm: number; vertical: boolean };
export type LabelImage = { visible: boolean; xMm: number; yMm: number; widthMm: number; heightMm: number; dataUrl: string | null };

export type LabelTemplateConfig = {
  widthMm: number;    // étiquette
  heightMm: number;
  sheetA4: boolean;   // planche A4 (sinon rouleau)
  paperWidthMm: number;  // rouleau : largeur/hauteur papier
  paperHeightMm: number;
  gapXMm: number;     // planche : espaces entre étiquettes
  gapYMm: number;
  elements: LabelElement[];
  barcode: LabelBarcode;
  image: LabelImage;
  /** Textes libres (imprimés tels quels quand l'élément est visible). */
  freeTexts: { free1: string; free2: string; free3: string };
  dateFormat: string; // ex. JJ/MM/AAAA
};

export type LabelTemplate = {
  id: string;
  company_id: string;
  name: string;
  is_default: boolean;
  config: LabelTemplateConfig;
};

/** Données d'une étiquette (article réel ou données de test). */
export type LabelData = {
  reference: string;
  designation: string;
  price_ttc: number | null;
  price_ht: number | null;
  price_promo: number | null;
  discount: string | null;
  store_name: string;
  bin: string | null;
  bin2: string | null;
  pack_qty: number | null;
  barcode_value: string;
};

export const eurLabel = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`;

/** Date du jour au format du template (JJ/MM/AAAA, MM/JJ/AAAA, AAAA-MM-JJ…). */
export function formatLabelDate(fmt: string, d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getFullYear());
  return (fmt || 'JJ/MM/AAAA').replace(/AAAA/g, yyyy).replace(/JJ/g, dd).replace(/MM/g, mm);
}

/** Texte affiché pour un élément (données réelles + textes libres du format). */
export function resolveElementText(key: ElementKey, data: LabelData, cfg: LabelTemplateConfig, now: Date): string {
  switch (key) {
    case 'reference': return data.reference;
    case 'designation': return data.designation;
    case 'price_ttc': return data.price_ttc != null ? eurLabel(data.price_ttc) : '';
    case 'price_ht': return data.price_ht != null ? eurLabel(data.price_ht) : '';
    case 'price_promo': return data.price_promo != null ? eurLabel(data.price_promo) : '';
    case 'discount': return data.discount ?? '';
    case 'date': return formatLabelDate(cfg.dateFormat, now);
    case 'store_name': return data.store_name;
    case 'bin': return data.bin ?? '';
    case 'bin2': return data.bin2 ?? '';
    case 'pack_qty': return data.pack_qty != null ? String(data.pack_qty) : '';
    case 'barcode_value': return data.barcode_value;
    case 'free1': return cfg.freeTexts.free1;
    case 'free2': return cfg.freeTexts.free2;
    case 'free3': return cfg.freeTexts.free3;
  }
}

/** Grille d'une planche A4 : colonnes/lignes/capacité pour un format donné. */
export function sheetLayout(cfg: LabelTemplateConfig, marginMm = 8): { cols: number; rows: number; perSheet: number } {
  // Garde-fou : dimensions nulles/négatives (champ vidé en cours de saisie)
  // → jamais de division par zéro ni d'Infinity (gel de l'onglet à l'aperçu).
  if (!(cfg.widthMm + cfg.gapXMm > 0) || !(cfg.heightMm + cfg.gapYMm > 0)) {
    return { cols: 1, rows: 1, perSheet: 1 };
  }
  const usableW = 210 - marginMm * 2;
  const usableH = 297 - marginMm * 2;
  const cols = Math.max(1, Math.floor((usableW + cfg.gapXMm) / (cfg.widthMm + cfg.gapXMm)));
  const rows = Math.max(1, Math.floor((usableH + cfg.gapYMm) / (cfg.heightMm + cfg.gapYMm)));
  return { cols, rows, perSheet: cols * rows };
}

/** Format par défaut — Brother 62×29 (rouleau), reproduit l'étiquette actuelle. */
export function defaultTemplateConfig(): LabelTemplateConfig {
  const el = (key: ElementKey, over: Partial<LabelElement> = {}): LabelElement => ({
    key, visible: false, font: 'Arial', sizePt: 8, bold: false, xMm: 1, yMm: 1, vertical: false, ...over,
  });
  return {
    // 62 × 29 : le code-barres (Y 17,5 + H 10 = 27,5) doit tenir DANS l'étiquette
    // (tout ce qui dépasse la hauteur est rogné par le SVG).
    widthMm: 62, heightMm: 29, sheetA4: false,
    paperWidthMm: 62, paperHeightMm: 29, gapXMm: 0, gapYMm: 0,
    elements: [
      el('reference', { visible: true, sizePt: 9, bold: true, xMm: 1, yMm: 0.5 }),
      el('designation', { visible: true, sizePt: 8, xMm: 1, yMm: 4 }),
      el('price_ttc', { visible: true, sizePt: 8, xMm: 2, yMm: 13.3 }),
      el('price_ht'),
      el('price_promo'),
      el('discount'),
      el('date'),
      el('store_name', { visible: true, sizePt: 8, xMm: 20, yMm: 14 }),
      el('bin', { visible: true, sizePt: 8, bold: true, xMm: 30, yMm: 0.5 }),
      el('bin2'),
      el('pack_qty'),
      el('barcode_value'),
      el('free1'), el('free2'), el('free3'),
    ],
    barcode: { visible: true, xMm: 13, yMm: 17.5, widthMm: 40, heightMm: 10, vertical: false },
    image: { visible: false, xMm: 49, yMm: 9.7, widthMm: 7, heightMm: 7, dataUrl: null },
    freeTexts: { free1: '', free2: '', free3: '' },
    dateFormat: 'JJ/MM/AAAA',
  };
}

/** Données de démonstration (panneau « données de test et prévisualisation »). */
export function sampleLabelData(storeName: string): LabelData {
  return {
    reference: 'REFERENCE', designation: 'DESIGNATION DESIGNATION DESIGNATION',
    price_ttc: 99999.99, price_ht: 83333.33, price_promo: null, discount: '0%',
    store_name: storeName, bin: 'LOCALISATION', bin2: 'LOCALISATION 2', pack_qty: 10,
    barcode_value: '1234567890128',
  };
}

/**
 * Normalise une config sauvegardée : complète les champs manquants avec les
 * défauts et fusionne les éléments PAR CLÉ (un format enregistré avant l'ajout
 * d'un nouvel élément — ex. Localisation 2 — reste valide, sans plantage).
 */
export function normalizeTemplateConfig(saved: Partial<LabelTemplateConfig> | null | undefined): LabelTemplateConfig {
  const def = defaultTemplateConfig();
  const savedEls = saved?.elements ?? [];
  return {
    ...def,
    ...(saved ?? {}),
    elements: ELEMENT_KEYS.map((key) => {
      const found = savedEls.find((e) => e.key === key);
      const defEl = def.elements.find((e) => e.key === key)!;
      return found ? { ...defEl, ...found } : defEl;
    }),
    barcode: { ...def.barcode, ...(saved?.barcode ?? {}) },
    image: { ...def.image, ...(saved?.image ?? {}) },
    freeTexts: { ...def.freeTexts, ...(saved?.freeTexts ?? {}) },
  };
}
