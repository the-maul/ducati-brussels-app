/**
 * Generation ESC/POS (PDV030) : octets envoyes tels quels a une imprimante thermique (Epson TM,
 * Bixolon, Star en emulation ESC/POS, generiques). Utilises par les pilotes Epson ePOS (balise
 * <command> en hexadecimal), Web Serial et WebUSB. Pur : aucune E/S, tout est teste octet par octet.
 *
 * Commandes (manuel ESC/POS Epson) :
 *   ESC @            1B 40            initialisation
 *   ESC t 19         1B 74 13         table de caracteres PC858 (Europe de l'Ouest avec l'euro)
 *   ESC a n          1B 61 n          alignement 0 gauche / 1 centre / 2 droite
 *   ESC E n          1B 45 n          gras
 *   GS ! n           1D 21 n          taille (0x11 = double largeur + double hauteur)
 *   ESC d n          1B 64 n          avance de n lignes
 *   GS V 66 0        1D 56 42 00      avance puis coupe partielle
 *   ESC p m t1 t2    1B 70 m 19 FA    impulsion tiroir : m = 0 (broche 2) / 1 (broche 5), 50 ms / 500 ms
 *   GS k 73 n {B..   1D 6B 49 n ...   code-barres CODE128 (jeu B)
 */
import type { Align, ReceiptLine } from './receipt';

export const ESC = 0x1b;
export const GS = 0x1d;
export const LF = 0x0a;

export const CMD_INIT = [ESC, 0x40];
export const CMD_CODEPAGE_PC858 = [ESC, 0x74, 19];
export const CMD_CUT_PARTIAL = [GS, 0x56, 0x42, 0x00];
export const PULSE_ON_UNITS = 0x19;   // 25 x 2 ms = 50 ms
export const PULSE_OFF_UNITS = 0xfa;  // 250 x 2 ms = 500 ms

/** Impulsion d'ouverture du tiroir : broche 2 (m = 0, tiroir 1) ou broche 5 (m = 1, tiroir 2). */
export function cmdPulse(pin: 2 | 5 = 2): number[] {
  return [ESC, 0x70, pin === 5 ? 1 : 0, PULSE_ON_UNITS, PULSE_OFF_UNITS];
}
export const cmdAlign = (a: Align): number[] => [ESC, 0x61, a === 'center' ? 1 : a === 'right' ? 2 : 0];
export const cmdBold = (on: boolean): number[] => [ESC, 0x45, on ? 1 : 0];
export const cmdSize = (large: boolean): number[] => [GS, 0x21, large ? 0x11 : 0x00];
export const cmdFeed = (n: number): number[] => [ESC, 0x64, Math.max(0, Math.min(255, Math.round(n)))];

/** Caracteres hors ASCII de la table PC858 (Euro en D5) utiles en francais, neerlandais, italien. */
const PC858: Record<string, number> = {
  'Ç': 0x80, 'ü': 0x81, 'é': 0x82, 'â': 0x83, 'ä': 0x84, 'à': 0x85, 'å': 0x86, 'ç': 0x87,
  'ê': 0x88, 'ë': 0x89, 'è': 0x8a, 'ï': 0x8b, 'î': 0x8c, 'ì': 0x8d, 'Ä': 0x8e, 'Å': 0x8f,
  'É': 0x90, 'æ': 0x91, 'Æ': 0x92, 'ô': 0x93, 'ö': 0x94, 'ò': 0x95, 'û': 0x96, 'ù': 0x97,
  'ÿ': 0x98, 'Ö': 0x99, 'Ü': 0x9a, 'ø': 0x9b, '£': 0x9c, 'Ø': 0x9d, '×': 0x9e,
  'á': 0xa0, 'í': 0xa1, 'ó': 0xa2, 'ú': 0xa3, 'ñ': 0xa4, 'Ñ': 0xa5, 'ª': 0xa6, 'º': 0xa7,
  '¿': 0xa8, '®': 0xa9, '½': 0xab, '¼': 0xac, '¡': 0xad, '«': 0xae, '»': 0xaf,
  'Á': 0xb5, 'Â': 0xb6, 'À': 0xb7, '©': 0xb8, '¢': 0xbd, '¥': 0xbe, 'ã': 0xc6, 'Ã': 0xc7,
  'Ê': 0xd2, 'Ë': 0xd3, 'È': 0xd4, '€': 0xd5, 'Í': 0xd6, 'Î': 0xd7, 'Ï': 0xd8, 'Ì': 0xde,
  'Ó': 0xe0, 'ß': 0xe1, 'Ô': 0xe2, 'Ò': 0xe3, 'õ': 0xe4, 'Õ': 0xe5, 'µ': 0xe6,
  'Ú': 0xe9, 'Û': 0xea, 'Ù': 0xeb, 'ý': 0xec, 'Ý': 0xed, '±': 0xf1, '§': 0xf5, '÷': 0xf6,
  '°': 0xf8, '·': 0xfa, '³': 0xfc, '²': 0xfd,
};
const LIGATURES: Record<string, string> = { 'œ': 'oe', 'Œ': 'OE', 'ĳ': 'ij', 'Ĳ': 'IJ' };

/** Encode un texte en PC858 ; lettre inconnue : sans accent si possible, sinon « ? ». */
export function encodePc858(text: string): number[] {
  const out: number[] = [];
  for (const ch of String(text ?? '')) {
    const code = ch.codePointAt(0) ?? 0x3f;
    if (code >= 0x20 && code < 0x7f) { out.push(code); continue; }
    if (ch === '\n') { out.push(LF); continue; }
    const mapped = PC858[ch];
    if (mapped != null) { out.push(mapped); continue; }
    const lig = LIGATURES[ch];
    if (lig) { for (const c of lig) out.push(c.charCodeAt(0)); continue; }
    const base = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (base.length === 1 && base.charCodeAt(0) >= 0x20 && base.charCodeAt(0) < 0x7f) { out.push(base.charCodeAt(0)); continue; }
    if (/\s/.test(ch)) { out.push(0x20); continue; }
    out.push(0x3f);
  }
  return out;
}

/** Code-barres CODE128 jeu B, centre, hauteur 60 points, texte lisible dessous. */
export function cmdBarcode128(value: string): number[] {
  const data = encodePc858(value).filter((b) => b >= 0x20 && b < 0x7f).slice(0, 60);
  if (data.length === 0) return [];
  const payload = [0x7b, 0x42, ...data]; // « {B » puis les donnees
  return [
    ...cmdAlign('center'),
    GS, 0x68, 60,          // hauteur
    GS, 0x77, 2,           // largeur du module
    GS, 0x48, 2,           // texte lisible sous le code
    GS, 0x6b, 73, payload.length, ...payload,
    LF,
  ];
}

export type EscposJobOptions = {
  /** Coupe du papier en fin de ticket (defaut : oui). */
  cut?: boolean;
  /** Ouvrir le tiroir pendant l'impression (impulsion envoyee juste apres l'initialisation). */
  drawer?: boolean;
  drawerPin?: 2 | 5;
  /** Lignes d'avance avant la coupe (defaut 4 : le texte depasse la lame). */
  feedBeforeCut?: number;
};

/** Ticket complet : initialisation, table PC858, (tiroir), lignes, avance, coupe. */
export function escposReceipt(lines: ReceiptLine[], opts: EscposJobOptions = {}): Uint8Array {
  const out: number[] = [...CMD_INIT, ...CMD_CODEPAGE_PC858];
  if (opts.drawer) out.push(...cmdPulse(opts.drawerPin ?? 2));
  let align: Align | null = null; let bold: boolean | null = null; let large: boolean | null = null;
  for (const l of lines) {
    if (l.kind === 'barcode') {
      out.push(...cmdBarcode128(l.value));
      align = 'center';
      continue;
    }
    if (l.align !== align) { out.push(...cmdAlign(l.align)); align = l.align; }
    if (l.bold !== bold) { out.push(...cmdBold(l.bold)); bold = l.bold; }
    if (l.large !== large) { out.push(...cmdSize(l.large)); large = l.large; }
    out.push(...encodePc858(l.text), LF);
  }
  if (bold) out.push(...cmdBold(false));
  if (large) out.push(...cmdSize(false));
  if (opts.cut !== false) out.push(...cmdFeed(opts.feedBeforeCut ?? 4), ...CMD_CUT_PARTIAL);
  return Uint8Array.from(out);
}

/** Ouverture du tiroir seule (bouton « Ouvrir le tiroir », encaissement en especes). */
export function escposDrawerOnly(pin: 2 | 5 = 2): Uint8Array {
  return Uint8Array.from([...CMD_INIT, ...cmdPulse(pin)]);
}

/** Octets → hexadecimal en majuscules (balise <command> d'Epson ePOS-Print). */
export function toHex(bytes: Uint8Array | number[]): string {
  let s = '';
  for (const b of bytes) s += (b & 0xff).toString(16).padStart(2, '0');
  return s.toUpperCase();
}
