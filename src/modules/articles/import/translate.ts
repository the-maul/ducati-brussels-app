/**
 * M2 — Traduction FR des désignations d'articles importées (tarifs Ducati :
 * l'APPAREL arrive en italien — « CAPPELLINO NERO CHILI » —, certains libellés
 * en anglais). Glossaire métier curaté IT/EN → FR, mot à mot avec passes de
 * locutions ; les mots inconnus (noms de modèles, tailles, codes) sont conservés.
 * Fonction PURE (testée dans tests/import-ducati.test.ts).
 */

// Locutions (testées en premier, sur la chaîne entière)
const PHRASES: [RegExp, string][] = [
  [/\bMANICHE LUNGHE\b/g, 'MANCHES LONGUES'],
  [/\bMANICHE CORTE\b/g, 'MANCHES COURTES'],
  [/\bMANICA LUNGA\b/g, 'MANCHES LONGUES'],
  [/\bMANICA CORTA\b/g, 'MANCHES COURTES'],
  [/\bLONG SLEEVE\b/g, 'MANCHES LONGUES'],
  [/\bSHORT SLEEVE\b/g, 'MANCHES COURTES'],
  [/\bZAINO\b/g, 'SAC À DOS'],
  [/\bBACK PACK\b/g, 'SAC À DOS'],
  [/\bBACKPACK\b/g, 'SAC À DOS'],
  [/\bPORTA CHIAVI\b/g, 'PORTE-CLÉS'],
  [/\bKEY RING\b/g, 'PORTE-CLÉS'],
  [/\bKEYRING\b/g, 'PORTE-CLÉS'],
  [/\bPORTACHIAVI\b/g, 'PORTE-CLÉS'],
  [/\bPORTAFOGLIO\b/g, 'PORTEFEUILLE'],
  [/\bCOPRISERBATOIO\b/g, 'PROTÈGE-RÉSERVOIR'],
  [/\bPARASERBATOIO\b/g, 'PROTECTION RÉSERVOIR'],
  [/\bHOODIE\b/g, 'SWEAT À CAPUCHE'],
  [/\bFELPA CON CAPPUCCIO\b/g, 'SWEAT À CAPUCHE'],
];

// Mots isolés (IT et EN → FR) — vocabulaire des tarifs Ducati apparel/accessoires
const WORDS: Record<string, string> = {
  // Vêtements & équipement (IT)
  CAPPELLINO: 'CASQUETTE', CAPPELLO: 'CHAPEAU', BERRETTO: 'BONNET',
  MAGLIA: 'MAILLOT', MAGLIETTA: 'T-SHIRT', CAMICIA: 'CHEMISE',
  FELPA: 'SWEAT', GIACCA: 'BLOUSON', GIUBBINO: 'BLOUSON', GIUBBOTTO: 'BLOUSON',
  TUTA: 'COMBINAISON', PANTALONE: 'PANTALON', PANTALONI: 'PANTALON',
  GUANTI: 'GANTS', GUANTO: 'GANT', CASCO: 'CASQUE',
  STIVALI: 'BOTTES', STIVALE: 'BOTTE', SCARPE: 'CHAUSSURES', SCARPA: 'CHAUSSURE',
  CALZE: 'CHAUSSETTES', CINTURA: 'CEINTURE', SCIARPA: 'ÉCHARPE',
  OCCHIALI: 'LUNETTES', BORSA: 'SAC', MARSUPIO: 'SACOCHE',
  OMBRELLO: 'PARAPLUIE', TAZZA: 'MUG', BICCHIERE: 'VERRE',
  ADESIVO: 'AUTOCOLLANT', ADESIVI: 'AUTOCOLLANTS', TARGA: 'PLAQUE',
  MODELLINO: 'MINIATURE', PELUCHE: 'PELUCHE', BANDIERA: 'DRAPEAU',
  ACCAPPATOIO: 'PEIGNOIR', ASCIUGAMANO: 'SERVIETTE', TELO: 'DRAP',
  PROTEZIONE: 'PROTECTION', PROTEZIONI: 'PROTECTIONS', PARASCHIENA: 'DORSALE',
  IMPERMEABILE: 'IMPERMÉABLE', ANTIPIOGGIA: 'PLUIE', TERMICO: 'THERMIQUE', TERMICA: 'THERMIQUE',
  INVERNALE: 'HIVER', ESTIVO: 'ÉTÉ', ESTIVA: 'ÉTÉ',
  PELLE: 'CUIR', TESSUTO: 'TEXTILE', COTONE: 'COTON', LANA: 'LAINE',
  RICAMATO: 'BRODÉ', RICAMATA: 'BRODÉE', STAMPATO: 'IMPRIMÉ', STAMPATA: 'IMPRIMÉE',
  // Vêtements & équipement (EN)
  HELMET: 'CASQUE', GLOVES: 'GANTS', GLOVE: 'GANT', JACKET: 'BLOUSON',
  SWEATSHIRT: 'SWEAT', SHIRT: 'CHEMISE', PANTS: 'PANTALON', TROUSERS: 'PANTALON',
  BOOTS: 'BOTTES', SHOES: 'CHAUSSURES', SOCKS: 'CHAUSSETTES', BELT: 'CEINTURE',
  SCARF: 'ÉCHARPE', SUNGLASSES: 'LUNETTES', BAG: 'SAC', WALLET: 'PORTEFEUILLE',
  UMBRELLA: 'PARAPLUIE', STICKER: 'AUTOCOLLANT', STICKERS: 'AUTOCOLLANTS',
  FLAG: 'DRAPEAU', TOWEL: 'SERVIETTE', SUIT: 'COMBINAISON', VEST: 'GILET',
  CAP: 'CASQUETTE', BEANIE: 'BONNET', LANYARD: 'TOUR DE COU',
  // Couleurs (IT)
  NERO: 'NOIR', NERA: 'NOIRE', ROSSO: 'ROUGE', ROSSA: 'ROUGE',
  BIANCO: 'BLANC', BIANCA: 'BLANCHE', GRIGIO: 'GRIS', GRIGIA: 'GRISE',
  GIALLO: 'JAUNE', GIALLA: 'JAUNE', VERDE: 'VERT', AZZURRO: 'BLEU CLAIR',
  ARGENTO: 'ARGENT', MARRONE: 'MARRON', ROSA: 'ROSE', VIOLA: 'VIOLET',
  // Couleurs (EN)
  BLACK: 'NOIR', RED: 'ROUGE', WHITE: 'BLANC', GREY: 'GRIS', GRAY: 'GRIS',
  YELLOW: 'JAUNE', GREEN: 'VERT', BLUE: 'BLEU', SILVER: 'ARGENT', BROWN: 'MARRON', PINK: 'ROSE',
  // Personnes / tailles / divers
  UOMO: 'HOMME', DONNA: 'FEMME', BAMBINO: 'ENFANT', BIMBO: 'ENFANT', BIMBA: 'ENFANT',
  MAN: 'HOMME', MEN: 'HOMME', WOMAN: 'FEMME', WOMEN: 'FEMME', LADY: 'FEMME',
  KID: 'ENFANT', KIDS: 'ENFANT', BABY: 'BÉBÉ',
  TAGLIA: 'TAILLE', MISURA: 'TAILLE', COPPIA: 'PAIRE', PAIO: 'PAIRE',
  CHIAVE: 'CLÉ', ANELLO: 'ANNEAU', COPERCHIO: 'COUVERCLE',
  DESTRO: 'DROIT', DESTRA: 'DROITE', SINISTRO: 'GAUCHE', SINISTRA: 'GAUCHE',
  ANTERIORE: 'AVANT', POSTERIORE: 'ARRIÈRE', SUPERIORE: 'SUPÉRIEUR', INFERIORE: 'INFÉRIEUR',
};

/**
 * Traduit une désignation IT/EN vers le FR (majuscules conservées, mots
 * inconnus — noms de modèles, codes, tailles — laissés tels quels).
 */
export function translateDesignation(designation: string | null | undefined): string | null {
  if (designation == null) return null;
  let s = designation.toUpperCase();
  for (const [re, fr] of PHRASES) s = s.replace(re, fr);
  s = s.replace(/[A-ZÀ-Ü'-]+/g, (word) => WORDS[word] ?? word);
  return s;
}

/** Applique la traduction aux lignes importées ; retourne le nb de désignations modifiées. */
export function translateRows(rows: { designation?: string | null }[]): number {
  let n = 0;
  for (const row of rows) {
    if (!row.designation) continue;
    const fr = translateDesignation(row.designation);
    if (fr !== null && fr !== row.designation.toUpperCase()) {
      row.designation = fr;
      n++;
    } else {
      row.designation = fr ?? row.designation;
    }
  }
  return n;
}
