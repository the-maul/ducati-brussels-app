/**
 * Rattrapage G8 (18/11/2026, lot parc) — affichette moto et article (« Edition d'affichette » G8).
 * Logique PURE (balises, remplissage, mise en page), testee dans tests/parc-affichette.test.ts.
 *
 * Un modele d'affichette est un texte ligne par ligne avec des BALISES entre crochets, comme G8 :
 *   [REFERENCE] [MODELE] [MARQUE] [PRIXTTC] [KILOMETRAGE] [MISEENCIRCULATION] [CYLINDREE]
 *   [COULEUR] [N° LIVRE DE POLICE]...
 * Mise en forme simple, sans editeur graphique : une ligne qui commence par « # » est un titre
 * (tres grand), « ## » un sous-titre (grand), « > » le prix (grand, gras) ; les autres lignes sont
 * du texte. Une ligne dont TOUTES les balises sont vides disparait (pas de « Km : » tout seul).
 * Les codes de balises sont ceux de G8 (identiques en FR / NL : on ne les traduit pas).
 */

export type PosterKind = 'vehicle' | 'article';

/** Balises reconnues, par type d'affichette. L'ordre est celui de la palette a l'ecran. */
export const VEHICLE_TAGS = [
  'REFERENCE', 'MARQUE', 'MODELE', 'NUMSERIE', 'PRIXTTC', 'PRIXHT', 'KILOMETRAGE', 'MISEENCIRCULATION',
  'ANNEEMODELE', 'CYLINDREE', 'PUISSANCEKW', 'PUISSANCECV', 'COULEUR', 'CODECOULEUR', 'ENERGIE',
  'NORMEANTIPOLLUTION', 'NBCYLINDRE', 'CATEGORIE', 'IMMATRICULATION', 'NUMMOTEUR', 'TYPEMINE', 'GENRE',
  'PUISSANCEFISCALE', 'NUMLIVREPOLICE', 'CODEEXPOSITION', 'GARANTIE', 'NOMMAGASIN',
] as const;
export const ARTICLE_TAGS = ['REFERENCE', 'DESIGNATION', 'MARQUE', 'PRIXTTC', 'PRIXHT', 'CODEBARRE', 'NOMMAGASIN'] as const;

/** Variantes ecrites a la G8, ramenees au code canonique. */
const ALIASES: Record<string, string> = {
  'N° LIVRE DE POLICE': 'NUMLIVREPOLICE',
  'N LIVRE DE POLICE': 'NUMLIVREPOLICE',
  'LIVREPOLICE': 'NUMLIVREPOLICE',
  'IMMAT': 'IMMATRICULATION',
  'KM': 'KILOMETRAGE',
  'PRIX': 'PRIXTTC',
};

export function canonicalTag(raw: string): string {
  const up = raw.trim().toUpperCase();
  return ALIASES[up] ?? up;
}

export type PosterData = Record<string, string | null | undefined>;

const TAG_RE = /\[([^\]\[]{1,40})\]/g;

/** Remplace les balises d'UNE ligne ; `empty` = la ligne avait des balises et toutes sont vides. */
export function fillLine(line: string, data: PosterData): { text: string; empty: boolean } {
  let tags = 0, filled = 0;
  const text = line.replace(TAG_RE, (_m, raw: string) => {
    tags += 1;
    const v = data[canonicalTag(raw)];
    const s = v == null ? '' : String(v).trim();
    if (s) filled += 1;
    return s;
  });
  return { text: text.replace(/\s{2,}/g, ' ').trim(), empty: tags > 0 && filled === 0 };
}

export type PosterLine = { style: 'title' | 'subtitle' | 'price' | 'text'; text: string };

/** Le modele rempli, ligne par ligne, avec son style. Les lignes vides du modele font un espace. */
export function fillTemplate(body: string, data: PosterData): PosterLine[] {
  const out: PosterLine[] = [];
  for (const raw of body.replace(/\r\n/g, '\n').split('\n')) {
    let style: PosterLine['style'] = 'text';
    let line = raw;
    if (line.startsWith('## ')) { style = 'subtitle'; line = line.slice(3); }
    else if (line.startsWith('# ')) { style = 'title'; line = line.slice(2); }
    else if (line.startsWith('> ')) { style = 'price'; line = line.slice(2); }
    const { text, empty } = fillLine(line, data);
    if (empty) continue;
    out.push({ style, text });
  }
  // pas de blancs en tete ni en fin
  while (out.length && !out[0].text) out.shift();
  while (out.length && !out[out.length - 1].text) out.pop();
  return out;
}

/** Balises du modele qui ne sont pas connues (faute de frappe) : signalees a l'ecran. */
export function unknownTags(body: string, kind: PosterKind): string[] {
  const known = new Set<string>(kind === 'vehicle' ? VEHICLE_TAGS : ARTICLE_TAGS);
  const out = new Set<string>();
  for (const m of body.matchAll(TAG_RE)) {
    const c = canonicalTag(m[1]);
    if (!known.has(c)) out.add(m[1]);
  }
  return [...out];
}

/** Pages du PDF : 1 ou 2 affichettes par page A4. */
export function paginate<T>(items: ReadonlyArray<T>, perPage: 1 | 2): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += perPage) pages.push(items.slice(i, i + perPage));
  return pages;
}

const eur = (n: number | null | undefined): string => {
  if (n == null || !Number.isFinite(Number(n))) return '';
  const fixed = (Math.round(Number(n) * 100) / 100).toFixed(2);
  const [int, dec] = fixed.split('.');
  return `${int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${dec} €`;
};
const frDate = (iso: string | null | undefined): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
};
const numFr = (n: number | null | undefined, unit = ''): string => {
  if (n == null || !Number.isFinite(Number(n))) return '';
  const s = String(Math.round(Number(n) * 100) / 100).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return unit ? `${s} ${unit}` : s;
};

export type PosterVehicle = {
  reference?: string | null; brand?: string | null; model?: string | null; vin?: string | null;
  display_price?: number | null; mileage?: number | null; first_registration_date?: string | null;
  model_year?: number | null; displacement?: number | null; power_kw?: number | null; power_cv?: number | null;
  color?: string | null; color_code?: string | null; energy?: string | null; antipollution?: string | null;
  cylinders?: number | null; category?: string | null; plate?: string | null; engine_number?: string | null;
  type_mine?: string | null; genre?: string | null; fiscal_power?: number | null; police_book_number?: string | null;
  exposition_code?: string | null; warranty_type?: string | null; warranty_months?: number | null;
};

/** Donnees d'une moto pour les balises (montants et dates au format belge). */
export function vehiclePosterData(v: PosterVehicle, opts: { shopName?: string | null; vatRate?: number; marge?: boolean; monthsLabel?: string } = {}): PosterData {
  const ttc = v.display_price ?? null;
  const rate = opts.vatRate ?? 21;
  // TVA marge (occasion particulier) : pas de prix HT affiche (la TVA ne porte que sur la marge).
  const ht = ttc == null || opts.marge ? null : Math.round((ttc / (1 + rate / 100)) * 100) / 100;
  const garantie = [v.warranty_type, v.warranty_months ? `${v.warranty_months} ${opts.monthsLabel ?? ''}`.trim() : null].filter(Boolean).join(' - ');
  return {
    REFERENCE: v.reference ?? '', MARQUE: v.brand ?? '', MODELE: v.model ?? '', NUMSERIE: v.vin ?? '',
    PRIXTTC: eur(ttc), PRIXHT: eur(ht), KILOMETRAGE: numFr(v.mileage, 'km'),
    MISEENCIRCULATION: frDate(v.first_registration_date), ANNEEMODELE: v.model_year ? String(v.model_year) : '',
    CYLINDREE: numFr(v.displacement, 'cm3'), PUISSANCEKW: numFr(v.power_kw, 'kW'), PUISSANCECV: numFr(v.power_cv, 'ch'),
    COULEUR: v.color ?? '', CODECOULEUR: v.color_code ?? '', ENERGIE: v.energy ?? '',
    NORMEANTIPOLLUTION: v.antipollution ?? '', NBCYLINDRE: v.cylinders ? String(v.cylinders) : '',
    CATEGORIE: v.category ?? '', IMMATRICULATION: v.plate ?? '', NUMMOTEUR: v.engine_number ?? '',
    TYPEMINE: v.type_mine ?? '', GENRE: v.genre ?? '', PUISSANCEFISCALE: numFr(v.fiscal_power),
    NUMLIVREPOLICE: v.police_book_number ?? '', CODEEXPOSITION: v.exposition_code ?? '',
    GARANTIE: garantie, NOMMAGASIN: opts.shopName ?? '',
  };
}

export type PosterArticle = {
  reference: string; designation: string; brand?: string | null; sale_price_ttc?: number | null;
  sale_price_ht?: number | null; vat_rate?: number | null; barcode?: string | null;
};

export function articlePosterData(a: PosterArticle, opts: { shopName?: string | null } = {}): PosterData {
  const ttc = a.sale_price_ttc ?? null;
  const rate = a.vat_rate ?? 21;
  const ht = a.sale_price_ht && a.sale_price_ht > 0 ? a.sale_price_ht : ttc == null ? null : Math.round((ttc / (1 + rate / 100)) * 100) / 100;
  return {
    REFERENCE: a.reference, DESIGNATION: a.designation, MARQUE: a.brand ?? '', PRIXTTC: eur(ttc), PRIXHT: eur(ht),
    CODEBARRE: a.barcode ?? '', NOMMAGASIN: opts.shopName ?? '',
  };
}

/** Libelles du modele propose d'office (viennent du dictionnaire i18n, langue de l'utilisateur). */
export type DefaultPosterLabels = {
  firstRegistration: string; mileage: string; displacement: string; color: string; warranty: string;
  reference: string; policeBook: string;
};

const NL = String.fromCharCode(10);

/** Modele propose d'office (avant tout modele enregistre par la concession). */
export function defaultPosterBody(kind: PosterKind, L: DefaultPosterLabels): string {
  if (kind === 'article') {
    return ['## [MARQUE]', '# [DESIGNATION]', '', '> [PRIXTTC]', '', `${L.reference} [REFERENCE]`, '[NOMMAGASIN]'].join(NL);
  }
  return [
    '## [MARQUE]',
    '# [MODELE]',
    '',
    `${L.firstRegistration} : [MISEENCIRCULATION]`,
    `${L.mileage} : [KILOMETRAGE]`,
    `${L.displacement} : [CYLINDREE] [PUISSANCEKW]`,
    `${L.color} : [COULEUR]`,
    `${L.warranty} : [GARANTIE]`,
    '',
    '> [PRIXTTC]',
    '',
    `${L.reference} [REFERENCE] - ${L.policeBook} [N° LIVRE DE POLICE]`,
    '[NOMMAGASIN]',
  ].join(NL);
}
