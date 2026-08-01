/**
 * M7 — Données et helpers de l'assistant de reprise moto (parcours client
 * tablette/smartphone). Listes d'options (marques, transmissions, accessoires…),
 * générateurs de plages (années, km, puissance, cylindrée) et conversions.
 * Fonctions pures — testées dans tests/reprise-wizard.test.ts.
 */

export const MOTO_BRANDS = [
  'Ducati', 'Aprilia', 'BMW', 'Harley-Davidson', 'Honda', 'Husqvarna', 'Indian',
  'Kawasaki', 'KTM', 'Moto Guzzi', 'MV Agusta', 'Piaggio', 'Royal Enfield',
  'Suzuki', 'Triumph', 'Vespa', 'Yamaha', 'Zero', 'Autre',
];

/** Suggestions de modèles Ducati (datalist) — saisie libre conservée pour les autres marques. */
export const DUCATI_MODELS = [
  'Panigale V2', 'Panigale V4', 'Panigale V4 S', 'Panigale V4 R',
  'Streetfighter V2', 'Streetfighter V4', 'Streetfighter V4 S',
  'Monster', 'Monster +', 'Monster SP',
  'Multistrada V2', 'Multistrada V4', 'Multistrada V4 S', 'Multistrada V4 Rally',
  'Diavel V4', 'XDiavel V4', 'DesertX', 'Hypermotard 698 Mono', 'Hypermotard 950',
  'SuperSport 950', 'Scrambler Icon', 'Scrambler Full Throttle', 'Scrambler Nightshift',
  '1199 Panigale', '1299 Panigale', '959 Panigale', '899 Panigale',
  'Monster 696', 'Monster 796', 'Monster 821', 'Monster 1200',
  'Multistrada 1200', 'Multistrada 1260', 'Multistrada 950', 'Diavel', 'XDiavel',
  'Hypermotard 796', 'Hypermotard 1100', '848', '1098', '1198',
];

/** Options à choix fixe (data — libellés FR de saisie). */
export const FUELS = ['Essence', 'Électrique'];
export const TRANSMISSIONS = ['Boîte manuelle', 'Quick shifter up', 'Quick shifter up/down', 'Automatique'];
export const OWNER_COUNTS = ['1', '2', '3', '4+'];
export const TECH_STATES = ['Comme Neuf', "Traces d'usure", 'Défaut à réparer', 'Accidenté'];
/** États techniques qui ouvrent le champ « description des dommages ». */
export const TECH_STATES_WITH_DESC = ['Défaut à réparer', 'Accidenté'];
export const WEAR_STATES = ['Neuf', 'Moyen', 'A remplacer', 'Je ne sais pas'];

/**
 * Pièces d'usure évaluées une par une (un menu déroulant par élément).
 * Remplace l'ancien couple « État pièces d'usure » + « Pneus » (qui faisait doublon).
 */
export type WearItem = { key: string; label: string };
export const WEAR_ITEMS: WearItem[] = [
  { key: 'brake_front', label: 'Plaquettes avant' },
  { key: 'brake_rear', label: 'Plaquettes arrière' },
  { key: 'tyre_front', label: 'Pneu avant' },
  { key: 'tyre_rear', label: 'Pneu arrière' },
  { key: 'chain_kit', label: 'Kit pignons/chaîne' },
];

export const ACCESSORIES = [
  'ABS', 'Anti-démarrage', 'Pare-chute', 'Phares LED', 'Bulle', 'Poignées chauffantes',
  'Sièges chauffants', 'Valises latérales', 'Top Case', 'Alarme', 'Anti-patinage',
  'Bluetooth', 'Pot catalytique (origine)', 'Pot performance (libre)', 'Radars',
  'Régulateur de vitesse', 'Suspensions actives', 'Support plaque court',
  'Grilles de protection radiateurs',
];

/** Années : de l'année courante à 1970. */
export function years(): number[] {
  const now = new Date().getFullYear();
  const out: number[] = [];
  for (let y = now; y >= 1970; y--) out.push(y);
  return out;
}

/** Suggestions de kilométrage (datalist) : 0, 1000, …, 100000 (saisie exacte possible). */
export function kmSuggestions(): number[] {
  const out: number[] = [];
  for (let k = 0; k <= 100000; k += 1000) out.push(k);
  return out;
}

/** Suggestions de cylindrée (datalist) : 0 → 2000 par pas de 50 (saisie exacte possible). */
export function ccSuggestions(): number[] {
  const out: number[] = [];
  for (let c = 0; c <= 2000; c += 50) out.push(c);
  return out;
}

// ── Conversions puissance ─────────────────────────────────────────────────────
export type PowerUnit = 'ch' | 'kw';
const KW_PER_CH = 0.735498750;

/** Convertit une valeur vers l'autre unité, arrondie à l'entier. */
export function convertPower(value: number, from: PowerUnit): { ch: number; kw: number } {
  if (from === 'ch') return { ch: Math.round(value), kw: Math.round(value * KW_PER_CH) };
  return { kw: Math.round(value), ch: Math.round(value / KW_PER_CH) };
}

/** Libellé de conversion « (≈ 83 kW) » ou « (≈ 113 ch) » selon l'unité saisie. */
export function powerConversionLabel(value: number, unit: PowerUnit): string {
  if (!(value > 0)) return '';
  const c = convertPower(value, unit);
  return unit === 'ch' ? `≈ ${c.kw} kW` : `≈ ${c.ch} ch`;
}

// ── N° TVA ────────────────────────────────────────────────────────────────────
/** Normalise un n° TVA : majuscules, sans espaces ni caractères spéciaux. */
export function normalizeVat(s: string): string {
  return (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// ── Pays + préfixes téléphoniques ─────────────────────────────────────────────
export const COUNTRIES: { code: string; label: string; phonePrefix: string }[] = [
  { code: 'BE', label: 'Belgique', phonePrefix: '+32' },
  { code: 'FR', label: 'France', phonePrefix: '+33' },
  { code: 'NL', label: 'Pays-Bas', phonePrefix: '+31' },
  { code: 'LU', label: 'Luxembourg', phonePrefix: '+352' },
  { code: 'DE', label: 'Allemagne', phonePrefix: '+49' },
  { code: 'IT', label: 'Italie', phonePrefix: '+39' },
  { code: 'ES', label: 'Espagne', phonePrefix: '+34' },
  { code: 'GB', label: 'Royaume-Uni', phonePrefix: '+44' },
  { code: 'CH', label: 'Suisse', phonePrefix: '+41' },
  { code: 'AT', label: 'Autriche', phonePrefix: '+43' },
  { code: 'PT', label: 'Portugal', phonePrefix: '+351' },
  { code: 'PL', label: 'Pologne', phonePrefix: '+48' },
];

export function phonePrefixFor(countryCode: string): string {
  return COUNTRIES.find((c) => c.code === countryCode)?.phonePrefix ?? '+32';
}

// ── Cases photos (guide photos) ───────────────────────────────────────────────
export type PhotoSlot = { key: string; label: string; free?: boolean };

/**
 * Photos du véhicule (étape Photos) — l'ORDRE FAIT FOI : il est repris tel quel
 * dans la fiche PDF (documents à la fin). La 1re photo (côté droit) sert
 * d'aperçu en tête du PDF.
 */
export const PHOTO_SLOTS: PhotoSlot[] = [
  { key: 'cote_droit', label: 'Côté droit' },
  { key: 'cote_gauche', label: 'Côté gauche' },
  { key: 'face_avant', label: 'Face avant' },
  { key: 'face_arriere', label: 'Face arrière' },
  { key: 'compteur', label: 'Compteur avec km' },
  { key: 'chassis', label: 'Numéro de châssis' },
  { key: 'moteur', label: 'Numéro du moteur' },
  { key: 'pneu_avant', label: 'Pneu avant' },
  { key: 'plaquettes_avant', label: 'Plaquettes avant' },
  { key: 'pneu_arriere', label: 'Pneu arrière' },
  { key: 'plaquettes_arriere', label: 'Plaquettes arrière' },
];

/** Clé de la photo mise en avant (aperçu en tête de la fiche PDF). */
export const HERO_PHOTO_KEY = 'cote_droit';

/** Ordre d'affichage/impression d'une photo d'après son libellé (999 = inconnu). */
export function photoOrderIndex(label: string): number {
  const i = PHOTO_SLOTS.findIndex((s) => s.label.toLowerCase() === label.trim().toLowerCase());
  if (i >= 0) return i;
  const f = FREE_PHOTO_SLOTS.findIndex((s) => s.label.toLowerCase() === label.trim().toLowerCase());
  return f >= 0 ? PHOTO_SLOTS.length + f : 999;
}

/** Documents à préparer (module « préparez vos documents » — bouton rouge). */
export const DOC_SLOTS: PhotoSlot[] = [
  { key: 'doc_facture_1', label: 'Facture 1' },
  { key: 'doc_facture_2', label: 'Facture 2' },
  { key: 'doc_facture_3', label: 'Facture 3' },
  { key: 'doc_facture_4', label: 'Facture 4' },
  { key: 'doc_facture_5', label: 'Facture 5' },
  { key: 'doc_immat_recto', label: 'Certificat immatriculation — recto' },
  { key: 'doc_immat_verso', label: 'Certificat immatriculation — verso' },
  { key: 'doc_coc_recto', label: 'Certificat de conformité — recto' },
  { key: 'doc_coc_verso', label: 'Certificat de conformité — verso' },
];

/** Cases libres (options / dommages) — 10 emplacements. */
export const FREE_PHOTO_SLOTS: PhotoSlot[] = Array.from({ length: 10 }, (_, i) => ({
  key: `libre_${i + 1}`, label: `Photo libre ${i + 1}`, free: true,
}));
