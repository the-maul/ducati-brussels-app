/**
 * M2/M5 (B12) — Formats d'étiquettes personnalisés (équivalent « Paramétrage
 * des étiquettes personnalisée » de G8). Un format = dimensions (rouleau ou
 * planche A4) + éléments positionnés en mm + code-barres + image importée.
 * Fonctions PURES (layout planche, données) — testées dans tests/label-templates.test.ts.
 */
import { DUCATI_LOGO_DATA_URL } from './ducati-logo';

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
/** Cadre (bordure) imprimé sur le pourtour de l'étiquette — imprimé ET à l'aperçu. */
export type LabelBorder = { visible: boolean; widthMm: number; insetMm: number };

/**
 * Ligne personnalisée (texte libre) ajoutable/supprimable par l'utilisateur, en
 * plus des 14 éléments data-liés. Chaque ligne porte son propre texte et son
 * style/position. `id` stable = clé React + suppression ciblée.
 */
export type LabelCustomElement = {
  id: string;
  text: string;
  visible: boolean;
  font: LabelFont;
  sizePt: number;
  bold: boolean;
  xMm: number;
  yMm: number;
  vertical: boolean;
};

export type LabelTemplateConfig = {
  widthMm: number;    // étiquette
  heightMm: number;
  sheetA4: boolean;   // planche A4 (sinon rouleau)
  paperWidthMm: number;  // rouleau : largeur/hauteur papier
  paperHeightMm: number;
  gapXMm: number;     // planche : espaces entre étiquettes
  gapYMm: number;
  elements: LabelElement[];
  /** Lignes de texte libre ajoutées par l'utilisateur (ajout/édition/suppression). */
  custom: LabelCustomElement[];
  barcode: LabelBarcode;
  image: LabelImage;
  border: LabelBorder;
  /** Textes libres (imprimés tels quels quand l'élément est visible). */
  freeTexts: { free1: string; free2: string; free3: string };
  dateFormat: string; // ex. JJ/MM/AAAA
};

/** Fabrique une ligne personnalisée avec des valeurs par défaut sûres. */
export function makeCustomElement(over: Partial<LabelCustomElement> = {}): LabelCustomElement {
  return {
    id: (globalThis.crypto?.randomUUID?.() ?? `c${Date.now()}${Math.random().toString(36).slice(2, 7)}`),
    text: 'Nouveau texte', visible: true, font: 'Arial', sizePt: 8, bold: false,
    xMm: 2.5, yMm: 12, vertical: false, ...over,
  };
}

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
  /** Rapprochement réception ↔ client (nom client + n° de document, ex. commande/OR). */
  customerName?: string;
  docNumber?: string;
};

export const eurLabel = (n: number) =>
  `${(Math.round(n * 100) / 100).toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\u202f|\u00a0/g, ' ')} €`;

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

/**
 * Format par défaut — étiquette standard « pièces / motos » Ducati Bruxelles
 * (62×29 rouleau) reproduisant l'étiquette type : cadre, REFERENCE en haut-gauche,
 * CASIER en haut-droite, DESIGNATION en ligne pleine, ligne INFOS COMMANDE CLIENT
 * au milieu, prix en bas-gauche, magasin au centre, logo Ducati en bas-droite.
 * Code-barres masqué par défaut (réactivable dans le paramétrage).
 */
export function defaultTemplateConfig(): LabelTemplateConfig {
  const el = (key: ElementKey, over: Partial<LabelElement> = {}): LabelElement => ({
    key, visible: false, font: 'Arial', sizePt: 8, bold: false, xMm: 1, yMm: 1, vertical: false, ...over,
  });
  return {
    widthMm: 62, heightMm: 29, sheetA4: false,
    paperWidthMm: 62, paperHeightMm: 29, gapXMm: 0, gapYMm: 0,
    elements: [
      // Ligne 1 : REFERENCE (gauche, gras) · CASIER (droite, gras)
      el('reference', { visible: true, sizePt: 9, bold: true, xMm: 2.5, yMm: 2 }),
      el('bin', { visible: true, sizePt: 9, bold: true, xMm: 40, yMm: 2 }),
      // Ligne 2 : DESIGNATION (pleine largeur)
      el('designation', { visible: true, sizePt: 7.5, xMm: 2.5, yMm: 7.5 }),
      // Ligne 4 : prix (gras, gauche) · magasin (centre)
      el('price_ttc', { visible: true, sizePt: 8.5, bold: true, xMm: 2.5, yMm: 20.5 }),
      el('price_ht'),
      el('price_promo'),
      el('discount'),
      el('date'),
      el('store_name', { visible: true, sizePt: 7, xMm: 19.5, yMm: 21.3 }),
      el('bin2'),
      el('pack_qty'),
      el('barcode_value'),
      el('free1'), el('free2'), el('free3'),
    ],
    custom: [],
    // Code-barres masqué par défaut (étiquette type sans code-barres).
    barcode: { visible: false, xMm: 13, yMm: 17.5, widthMm: 40, heightMm: 10, vertical: false },
    // Logo Ducati en bas-droite (remplace l'ancien pictogramme eShop).
    image: { visible: true, xMm: 47.5, yMm: 18.5, widthMm: 12, heightMm: 8, dataUrl: DUCATI_LOGO_DATA_URL },
    // Cadre noir sur tout le pourtour, imprimé (pas seulement aperçu).
    border: { visible: true, widthMm: 0.3, insetMm: 0.4 },
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
    border: { ...def.border, ...(saved?.border ?? {}) },
    // Lignes personnalisées : conservées telles quelles (chaque ligne complétée
    // avec les défauts manquants pour rester tolérant aux anciens enregistrements).
    custom: (saved?.custom ?? []).map((c) => ({ ...makeCustomElement(), ...c })),
    freeTexts: { ...def.freeTexts, ...(saved?.freeTexts ?? {}) },
  };
}
