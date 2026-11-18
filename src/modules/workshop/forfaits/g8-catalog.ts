/**
 * Rattrapage G8 (19/11/2026, lot forfaits) — LES FORFAITS / NOMENCLATURES DE G8, telles quelles.
 *
 * Source : docs/g8-inventaire/nomenclatures-g8.md (36 nomenclatures de la base de formation, lues
 * ligne par ligne, + le forfait « DDS » de la vraie base = 37). Compositions confirmees identiques
 * dans la vraie base pour les 18 premiers ; la ligne « petites fournitures » y porte la reference
 * VISIERE ARAI ORIGINE : reprise ici sous le code PETITES FOURNITURES (voir « A trancher »).
 *
 * Ce fichier est la SOURCE des donnees : la migration 20261119140000 en est la copie SQL
 * (fonctions `_g8_service_catalog` et `_g8_forfaits_catalog`) ; `tests/forfaits-g8.test.ts`
 * verifie que les deux sont identiques et que les totaux recalcules redonnent les pieds de fiche
 * G8. Les PRIX ne sont pas ici : bloc separe (migration 20261119142000, « a confirmer »).
 *
 * Types de gestion (B1) :
 *  - T : main-d'oeuvre (quantite = heures) — l'article MO du DMS (G8 : MO_ATELIER, a 0 € dans les forfaits) ;
 *  - F : lignes de service non physiques (contribution, petites fournitures, appareil de
 *        diagnostic, controles a 0 €, prise en charge) : ni stock, ni preparation, ni commande ;
 *  - A : liquides, filtre et produits stockes (huile au litre, liquide de frein, chain cleaner...).
 */

export type G8ServiceArticle = {
  /** Code G8, repris tel quel comme reference de l'article du DMS. */
  reference: string;
  /** Designation affichee (orthographe corrigee quand G8 avait une faute : `g8Designation`). */
  designation: string;
  g8Designation: string;
  mgmtType: 'F' | 'T' | 'A';
  brand: string | null;
  measureUnit: string | null;
};

export const G8_SERVICE_ARTICLES: ReadonlyArray<G8ServiceArticle> = [
  { reference: 'CONTRI', designation: 'CONTRIBUTIONS ENVIRONNEMENTALES', g8Designation: 'CONTRIBUTIONS ENVIRONEMENTALES', mgmtType: 'F', brand: 'RECUPEL', measureUnit: null },
  { reference: 'PETITES FOURNITURES', designation: 'PETITES FOURNITURES', g8Designation: 'PETITES FOURNITURES', mgmtType: 'F', brand: null, measureUnit: null },
  { reference: 'APPAREIL DE DIAGNOTI', designation: 'APPAREIL DE DIAGNOSTIC DDS', g8Designation: 'APPAREIL DE DIAGNOTISC DDS', mgmtType: 'F', brand: null, measureUnit: null },
  { reference: 'PRISE EN CHARGE', designation: 'PRISE EN CHARGE VEHICULE', g8Designation: 'PRISE EN CHARGE VEHICULE', mgmtType: 'F', brand: null, measureUnit: null },
  // Produit stocke dans G8 (« PRODUITS MAXI POWER », stock 55, CANDICAR) : type A.
  { reference: 'PRODUITS NETTOYAGE MOT', designation: 'PRODUITS NETTOYAGE MOTO (MAXI POWER)', g8Designation: 'PRODUITS MAXI POWER', mgmtType: 'A', brand: 'CANDICAR', measureUnit: null },
  { reference: 'CONTROLE BATTERIE', designation: 'CONTROLE CHARGE BATTERIE', g8Designation: 'CONTROLE CHARGE BATTERIE', mgmtType: 'F', brand: null, measureUnit: null },
  { reference: 'CONTROLE DES FREINS', designation: 'CONTROLE DES FREINS', g8Designation: 'CONTROLE DES FREINS', mgmtType: 'F', brand: null, measureUnit: null },
  { reference: 'CONTROLE DES NIVEAUX', designation: 'CONTROLE DES NIVEAUX', g8Designation: 'CONTROLE DES NIVEAUX', mgmtType: 'F', brand: null, measureUnit: null },
  { reference: 'CONTROLE ECLAIRAGE', designation: 'CONTROLE ECLAIRAGE', g8Designation: 'CONTROLE ECLAIRAGE', mgmtType: 'F', brand: null, measureUnit: null },
  { reference: 'CONTROLE ET USURE PN', designation: 'CONTROLE ET USURE DES PNEUS', g8Designation: 'CONTROLE ET USURE DES PNEUS', mgmtType: 'F', brand: null, measureUnit: null },
  { reference: 'TENSION DE COURROIES', designation: 'CONTROLE DES COURROIES', g8Designation: 'CONTROLE DES COURROIES', mgmtType: 'F', brand: null, measureUnit: null },
  { reference: 'TENSION ET GRAISSAGE', designation: 'TENSION ET GRAISSAGE DE CHAINE', g8Designation: 'TENSION ET GRAISSAGE DE CHAINE', mgmtType: 'F', brand: null, measureUnit: null },
  { reference: 'REGLAGE SOUPAPES', designation: 'REGLAGE SOUPAPES', g8Designation: 'REGLAGE SOUPAPES', mgmtType: 'F', brand: null, measureUnit: null },
  { reference: 'TEST MOTO', designation: 'TEST MOTO', g8Designation: 'TEST MOTO', mgmtType: 'F', brand: null, measureUnit: null },
  // MO_ATELIER n'existe plus dans la vraie base G8 (la MO s'y facture a part, 0 € dans les forfaits).
  // Dans le DMS, la ligne de MO d'un forfait pointe vers l'article MO (type T) : sans prix force,
  // elle prend le taux horaire de l'atelier a l'insertion (reglage « Frais de devis atelier »).
  { reference: 'MO', designation: "Main d'oeuvre atelier (taux horaire)", g8Designation: 'MO_ATELIER', mgmtType: 'T', brand: null, measureUnit: 'h' },
  { reference: 'MOTO 4XT TECH EN FUT', designation: 'HUILE MOTEUR MOTO 4XT TECH EN FUT (AU LITRE)', g8Designation: 'MOTO 4XT TECH EN FUT', mgmtType: 'A', brand: 'TOTAL', measureUnit: 'L' },
  { reference: 'MOTO 4 ROAD 15W50', designation: 'MOTO 4 ROAD 15W50', g8Designation: 'MOTO 4 ROAD 15W50', mgmtType: 'A', brand: 'TOTAL', measureUnit: 'L' },
  { reference: 'HUILE DE FREIN DOT 5', designation: 'HUILE DE FREIN DOT 5.1', g8Designation: 'HUILE DE FREIN DOT 5.1', mgmtType: 'A', brand: 'TOTAL', measureUnit: null },
  { reference: 'HUILE DE FOURCHE ELF', designation: 'HUILE DE FOURCHE ELF', g8Designation: 'HUILE DE FOURCHE ELF', mgmtType: 'A', brand: 'TOTAL', measureUnit: null },
  { reference: 'COOLELF CLASSIC -26°', designation: 'COOLELF CLASSIC -26°', g8Designation: 'COOLELF CLASSIC -26°', mgmtType: 'A', brand: 'TOTAL', measureUnit: 'L' },
  { reference: 'FILTRE A HUILE 1199', designation: 'FILTRE A HUILE 1199 PANIGALE', g8Designation: 'FILTRE A HUILE 1199 PANIGALE', mgmtType: 'A', brand: 'DUCATI', measureUnit: null },
  { reference: 'CHAIN CLEANER', designation: 'CHAIN CLEANER', g8Designation: 'CHAIN CLEANER', mgmtType: 'A', brand: null, measureUnit: null },
];

export type G8Forfait = {
  /** Code G8 de la nomenclature = reference de l'article forfait (type N) du DMS. */
  code: string;
  designation: string;
  /** Lignes dans l'ordre de la fiche G8 : [reference, quantite]. */
  lines: ReadonlyArray<readonly [string, number]>;
};

// Blocs recurrents (ordre de la fiche G8, a l'identique).
const DDS = 'APPAREIL DE DIAGNOTI';
const FREINS = 'CONTROLE DES FREINS';
const ECL = 'CONTROLE ECLAIRAGE';
const PN = 'CONTROLE ET USURE PN';
const NIV = 'CONTROLE DES NIVEAUX';
const BAT = 'CONTROLE BATTERIE';
const COUR = 'TENSION DE COURROIES';
const TG = 'TENSION ET GRAISSAGE';
const SOUP = 'REGLAGE SOUPAPES';
const PF = 'PETITES FOURNITURES';
const CONTRI = 'CONTRI';
const OIL = 'MOTO 4XT TECH EN FUT';
const DOT = 'HUILE DE FREIN DOT 5';
const FORK = 'HUILE DE FOURCHE ELF';
/** G8 : MO_ATELIER ; DMS : l'article de main-d'oeuvre MO (type T). */
const MO = 'MO';

type L = readonly [string, number];
const one = (...refs: string[]): L[] => refs.map((r) => [r, 1] as const);

/** n° 19 (OIL SERVICE DIAVEL 12000KM), base de 21, 28, 30, 31, 33. */
const diavel12 = (oil: number): L[] => [
  [OIL, oil], ['44440035A', 1], ['85250261A', 1],
  ...one(DDS, FREINS, ECL, PN, NIV, BAT, COUR, TG, PF, CONTRI),
];
/** n° 22 (OIL SERVICE M1100 12000), base de 24, 26, 34. */
const m1100_12 = (oil: number): L[] => [
  [OIL, oil], ['44440035A', 1], ['85250261A', 1],
  ...one(SOUP, DDS, FREINS, ECL, PN, NIV, BAT, COUR, TG, PF, CONTRI),
];
/** n° 25 (OIL SERVICE M696 24000), base de 27 (sans TENSION ET GRAISSAGE). */
const m696_24 = (withTg: boolean): L[] => [
  [OIL, 3.1], ['44440035A', 1], ['85250261A', 1], ['67040351A', 2], ['42610191A', 1], ['73740242A', 2],
  ...one(SOUP, DDS, FREINS, ECL, PN, NIV, BAT, COUR), ...(withTg ? one(TG) : []), [PF, 2], [CONTRI, 2],
];
/** n° 32 (OIL SERVICE STREET 848 24000KM), base de 35. */
const street848_24: L[] = [
  [OIL, 3.4], ['44440035A', 1], ['85250261A', 1], ['42610201A', 1], ['67040381A', 2], ['73740251A', 2],
  ...one(SOUP, DDS, FREINS, ECL, PN, NIV, BAT, TG), [PF, 2], [CONTRI, 2],
];
/** n° 12 (OIL SERVICE 1000KM PANIGALE), base de 13. */
const pani1000: L[] = [
  [OIL, 3.4], ['FILTRE A HUILE 1199', 1], ['85250541A', 1],
  ...one(DDS, TG, BAT, NIV, PN, FREINS, ECL, PF, CONTRI),
];
/** n° 15 / 16 (OIL SERVICE 2 / 4 SOUPAPES) : pas de CONTROLE DES NIVEAUX dans G8. */
const oilSoupapes = (oil: number, mo: number): L[] => [
  [OIL, oil], ['44440035A', 1], ['85250261A', 1],
  ...one(DDS, FREINS, PN, ECL, BAT, TG), [MO, mo], ...one(PF, CONTRI),
];
/** n° 7 / 8 (ENTRETIEN ANNUEL 2 / 4 SOUPAPES). */
const annuelSoupapes = (oil: number, mo: number): L[] => [
  [OIL, oil], ['44440035A', 1], ['85250261A', 1],
  ...one(DDS, FREINS, ECL, PN, NIV, BAT, COUR, TG), [MO, mo], ...one(PF, CONTRI),
];
/** Insere des lignes apres les pieces (avant le premier code de service). */
const withParts = (base: L[], extra: L[]): L[] => {
  const i = base.findIndex(([r]) => r === DDS || r === SOUP);
  return [...base.slice(0, i), ...extra, ...base.slice(i)];
};

export const G8_FORFAITS: ReadonlyArray<G8Forfait> = [
  { code: 'CONTROLE', designation: 'CONTROLE', lines: one(TG, NIV, PN, ECL, FREINS, BAT) },
  { code: 'CONTROLEMOTO', designation: 'CONTROLE MOTO', lines: one(CONTRI, DDS, NIV, PN, TG, ECL, FREINS, BAT, PF) },
  { code: 'CONTROLEMOTOCOMPLET', designation: 'CONTROLE MOTO COMPLET', lines: one(PF, CONTRI, PN, BAT, NIV, COUR, FREINS, TG, SOUP, ECL, DDS) },
  { code: 'DIVERS', designation: 'DIVERS', lines: one(PF, CONTRI) },
  {
    code: 'ENT1200201424000KM', designation: 'ENT 1200 2014 24000KM',
    lines: [['78811211A', 2], ['81140012B', 2], ['42610201A', 1], ['67040381A', 4], ['66910011E', 16], ['88650511A', 8], ['78810931A', 2], ['73740252A', 2]],
  },
  {
    code: 'ENTRETIENANNUEL1199PANIGALE', designation: 'ENTRETIEN ANNUEL 1199 PANIGALE',
    lines: [[OIL, 3.4], ['FILTRE A HUILE 1199', 1], ...one(DDS, BAT, FREINS, ECL, PN, NIV, TG), [MO, 2], ...one(PF, CONTRI)],
  },
  { code: 'ENTRETIENANNUEL2SOUPAPES', designation: 'ENTRETIEN ANNUEL 2 SOUPAPES', lines: annuelSoupapes(3.1, 1.8) },
  { code: 'ENTRETIENANNUEL4SOUPAPES', designation: 'ENTRETIEN ANNUEL 4 SOUPAPES', lines: annuelSoupapes(3.4, 2) },
  { code: 'M696/M796/M110036000KM', designation: 'M696/M796/M1100 36000KM', lines: [[DOT, 1], [FORK, 2], [MO, 0.7]] },
  {
    code: 'MO600COUPONC', designation: 'MO 600 COUPON C',
    lines: [[OIL, 3.1], ['44440035A', 1], ['22032083A', 1], ['42610091A', 1], ['42510022A', 1], ['67090081A', 2], ['73710021A', 2],
      [DOT, 1], [FORK, 2], ...one(COUR, TG, FREINS, ECL, PN, NIV, BAT), [PF, 2], [CONTRI, 2]],
  },
  {
    code: 'MTS12002010/2012', designation: 'MTS 1200 2010/2012',
    lines: [['MOTO 4 ROAD 15W50', 4], ['44440035A', 1], ['85250261A', 1], ['73740251A', 2], ['78810941A', 2], ['66910011E', 16],
      ['42610201A', 1], ['67040451A', 2], ['78810931A', 2], ['88650511A', 8]],
  },
  { code: 'OILSERVICE1000KMPANIGALE', designation: 'OIL SERVICE 1000KM PANIGALE', lines: pani1000 },
  { code: 'OILSERVICE119912000KM', designation: 'OIL SERVICE 1199 12000KM', lines: pani1000 },
  {
    code: 'OILSERVICE119924000KM', designation: 'OIL SERVICE 1199 24000KM',
    lines: [[OIL, 3.4], ['FILTRE A HUILE 1199', 1], ['42610341B', 1], ['89420112B', 1], ['67040451A', 2],
      ...one(SOUP, DDS, FREINS, ECL, PN, NIV, BAT, TG), [PF, 2], [CONTRI, 2]],
  },
  { code: 'OILSERVICE2SOUPAPES', designation: 'OIL SERVICE 2 SOUPAPES', lines: oilSoupapes(3.1, 1) },
  { code: 'OILSERVICE4SOUPAPES', designation: 'OIL SERVICE 4 SOUPAPES', lines: oilSoupapes(3.4, 1.2) },
  {
    code: 'OILSERVICE749/99920000KM', designation: 'OIL SERVICE 749/999 20000KM',
    lines: [[OIL, 3.4], ['44440035A', 1], ['22032083A', 1], ['42620161A', 1], ['42620171A', 1], ['42540101A', 1], ['67090161B', 2],
      ['74140931A', 2], ['73740124A', 2], ['COOLELF CLASSIC -26°', 3], [FORK, 2], [DOT, 1],
      ...one(SOUP, DDS, FREINS, ECL, PN, NIV, BAT, TG), [PF, 2], [CONTRI, 2]],
  },
  {
    code: 'OILSERVICE99910000KM', designation: 'OIL SERVICE 999 10000KM',
    lines: [[OIL, 3.4], ['44440035A', 1], ['22032083A', 1], ['42620161A', 1], ['42620171A', 1], ['42540101A', 1], ['67090161B', 2],
      ['74140931A', 2], ...one(SOUP, DDS, FREINS, ECL, PN, NIV, BAT, COUR, TG, PF, CONTRI)],
  },
  { code: 'OILSERVICEDIAVEL12000KM', designation: 'OIL SERVICE DIAVEL 12000KM', lines: diavel12(3.4) },
  {
    code: 'OILSERVICEDIAVEL24000KM', designation: 'OIL SERVICE DIAVEL 24000KM',
    lines: [[OIL, 3.4], ['44440035A', 1], ['73740251A', 2], ['42610201A', 1], ['85250261A', 1], ['67040451A', 2],
      ...one(DDS, FREINS, ECL, PN, NIV, BAT, COUR, TG), [PF, 2], [CONTRI, 2]],
  },
  { code: 'OILSERVICEDIAVEL36000KM', designation: 'OIL SERVICE DIAVEL 36000KM', lines: withParts(diavel12(3.4), [[DOT, 1]]) },
  { code: 'OILSERVICEM110012000', designation: 'OIL SERVICE M1100 12000', lines: m1100_12(3.1) },
  {
    code: 'OILSERVICEM110024000', designation: 'OIL SERVICE M1100 24000',
    lines: [[OIL, 3.1], ['44440035A', 1], ['67040351A', 2], ['73740211A', 2], ['42610191A', 1], ['85250261A', 1],
      ...one(SOUP, DDS, FREINS, ECL, PN, NIV, BAT, COUR, TG), [PF, 2], [CONTRI, 2]],
  },
  { code: 'OILSERVICEM69612000', designation: 'OIL SERVICE M696 12000', lines: m1100_12(3.1) },
  { code: 'OILSERVICEM69624000', designation: 'OIL SERVICE M696 24000', lines: m696_24(true) },
  { code: 'OILSERVICEM79612000', designation: 'OIL SERVICE M796 12000', lines: m1100_12(3.1) },
  { code: 'OILSERVICEM79624000', designation: 'OIL SERVICE M796 24000', lines: m696_24(false) },
  { code: 'OILSERVICEMTS120012000KM', designation: 'OIL SERVICE MTS1200 12000KM', lines: diavel12(3.4) },
  {
    code: 'OILSERVICEMTS120024000KM', designation: 'OIL SERVICE MTS1200 24000KM',
    lines: [[OIL, 3.4], ['44440035A', 1], ['85250261A', 1], ['42610201A', 1], ['67040451A', 2], ['73740251A', 2],
      ...one(SOUP, DDS, FREINS, ECL, PN, NIV, BAT, COUR, TG), [PF, 2], [CONTRI, 2]],
  },
  { code: 'OILSERVICEMTS120036000KM', designation: 'OIL SERVICE MTS1200 36000KM', lines: withParts(diavel12(3.4), [[DOT, 1]]) },
  { code: 'OILSERVICESTREET84812000KM', designation: 'OIL SERVICE STREET 848 12000KM', lines: withParts(diavel12(3.4), [['67040381A', 2]]) },
  { code: 'OILSERVICESTREET84824000KM', designation: 'OIL SERVICE STREET 848 24000KM', lines: street848_24 },
  // « STRRET » : faute de frappe d'origine dans G8, gardee dans le code pour que l'atelier retrouve le forfait.
  { code: 'OILSERVICESTRRET84836000KM', designation: 'OIL SERVICE STREET 848 36000KM', lines: withParts(diavel12(3.4), [['67040381A', 2], [DOT, 1]]) },
  { code: 'SERVICE848/1098/119812000KM', designation: 'SERVICE 848/1098/1198 12000KM', lines: m1100_12(3.4) },
  { code: 'SERVICE848/1098/119824000KM', designation: 'SERVICE 848/1098/1198 24000KM', lines: street848_24 },
  {
    code: 'SERVICE848/1098/119836000KM', designation: 'SERVICE 848/1098/1198 36000KM',
    lines: [[OIL, 3.4], ['44440035A', 1], ['85250261A', 1], [DOT, 2], [FORK, 1],
      ...one(SOUP, DDS, FREINS, ECL, PN, NIV, BAT, COUR, TG, PF, CONTRI)],
  },
  // 37e forfait, vraie base seulement (designation vide dans G8).
  {
    code: 'DDS', designation: 'DDS - PRISE EN CHARGE ET DIAGNOSTIC',
    lines: [['PRISE EN CHARGE', 1], [PF, 1], ['PRODUITS NETTOYAGE MOT', 1], ['CHAIN CLEANER', 1], [CONTRI, 2], [DDS, 1]],
  },
];

/** Pied de fiche G8 de la base de FORMATION (TTC) : verifie la reprise ligne a ligne. */
export const G8_FORMATION_FOOTER_TTC: Readonly<Record<string, number>> = {
  CONTROLE: 0, CONTROLEMOTO: 40.2, CONTROLEMOTOCOMPLET: 40.2, DIVERS: 11.7,
  ENTRETIENANNUEL1199PANIGALE: 273.02, ENTRETIENANNUEL2SOUPAPES: 243.41, ENTRETIENANNUEL4SOUPAPES: 263.51,
  'M696/M796/M110036000KM': 84.56, OILSERVICE2SOUPAPES: 181.97, OILSERVICE4SOUPAPES: 202.07,
};

/** PV TTC de la base de formation (+ 85250261A deduit des pieds de fiche) : uniquement pour le test. */
export const G8_FORMATION_UNIT_TTC: Readonly<Record<string, number>> = {
  CONTRI: 2.9, 'PETITES FOURNITURES': 8.8, 'APPAREIL DE DIAGNOTI': 28.5, MO: 76.8, 'MOTO 4XT TECH EN FUT': 15.8,
  'HUILE DE FREIN DOT 5': 10.2, 'HUILE DE FOURCHE ELF': 10.3, 'FILTRE A HUILE 1199': 25.5, '44440035A': 15.7, '85250261A': 0.29,
};

/** Pied de fiche G8 de la VRAIE base (TTC). MO et petites fournitures a 0 € sauf dans DDS. */
export const G8_REAL_FOOTER_TTC: Readonly<Record<string, number>> = {
  CONTROLE: 0, CONTROLEMOTO: 36.4, CONTROLEMOTOCOMPLET: 36.4, DIVERS: 3.9, DDS: 103.66,
  ENTRETIENANNUEL1199PANIGALE: 117.15, ENTRETIENANNUEL2SOUPAPES: 105.15, ENTRETIENANNUEL4SOUPAPES: 109.89,
  'M696/M796/M110036000KM': 30.8, OILSERVICE2SOUPAPES: 105.15, OILSERVICE4SOUPAPES: 109.89,
  OILSERVICEDIAVEL12000KM: 109.89, OILSERVICEDIAVEL36000KM: 120.09, OILSERVICEM110012000: 105.15,
  OILSERVICEM69612000: 105.15, OILSERVICEM79612000: 105.15, OILSERVICEMTS120012000KM: 109.89,
  OILSERVICEMTS120036000KM: 120.09, 'SERVICE848/1098/119812000KM': 109.89, 'SERVICE848/1098/119836000KM': 140.59,
};

/** PV TTC unitaires de la VRAIE base G8 (pieces Ducati comprises : uniquement pour le test). */
export const G8_REAL_UNIT_TTC: Readonly<Record<string, number>> = {
  CONTRI: 3.9, 'PETITES FOURNITURES': 12.78, 'APPAREIL DE DIAGNOTI': 32.5, 'PRISE EN CHARGE': 8.78,
  'PRODUITS NETTOYAGE MOT': 14.6, 'CHAIN CLEANER': 27.2, 'MOTO 4XT TECH EN FUT': 15.8, 'MOTO 4 ROAD 15W50': 18.2,
  'HUILE DE FREIN DOT 5': 10.2, 'HUILE DE FOURCHE ELF': 10.3, 'COOLELF CLASSIC -26°': 5.9, 'FILTRE A HUILE 1199': 27.03,
  '44440035A': 17.52, '85250261A': 2.25,
};

/**
 * PRIX A IMPORTER (vraie base G8 relue le 18/11, + formation pour les liquides) : meme bloc que la
 * migration de donnees 20261119142000. Les pieces Ducati deja dans le DMS (44440035A, 85250261A...)
 * n'y sont PAS : leur prix vient du tarif Ducati.
 */
export const G8_PRICES: ReadonlyArray<{ reference: string; ht: number; ttc: number }> = [
  { reference: 'CONTRI', ht: 3.22, ttc: 3.90 },
  { reference: 'PETITES FOURNITURES', ht: 10.56, ttc: 12.78 },
  { reference: 'APPAREIL DE DIAGNOTI', ht: 26.86, ttc: 32.50 },
  { reference: 'PRISE EN CHARGE', ht: 7.26, ttc: 8.78 },
  { reference: 'PRODUITS NETTOYAGE MOT', ht: 12.07, ttc: 14.60 },
  { reference: 'CHAIN CLEANER', ht: 22.48, ttc: 27.20 },
  { reference: 'MOTO 4XT TECH EN FUT', ht: 13.06, ttc: 15.80 },
  { reference: 'MOTO 4 ROAD 15W50', ht: 15.04, ttc: 18.20 },
  { reference: 'HUILE DE FREIN DOT 5', ht: 8.43, ttc: 10.20 },
  { reference: 'HUILE DE FOURCHE ELF', ht: 8.51, ttc: 10.30 },
  { reference: 'COOLELF CLASSIC -26°', ht: 4.88, ttc: 5.90 },
  { reference: 'FILTRE A HUILE 1199', ht: 22.34, ttc: 27.03 },
];

/** Lignes ajoutees par defaut a chaque kit d'entretien (reglage, modifiable a l'ecran). */
export const DEFAULT_KIT_LINES: ReadonlyArray<readonly [string, number]> = [
  [DDS, 1], [FREINS, 1], [ECL, 1], [PN, 1], [NIV, 1], [BAT, 1], [COUR, 1], [TG, 1], [PF, 1], [CONTRI, 1],
];

/** Liquide -> article (reglage) : unite de vente, contenance d'une unite en litres, unite entiere. */
export const DEFAULT_FLUID_ARTICLES: ReadonlyArray<{
  family: string; reference: string; saleUnit: string; litersPerUnit: number | null; wholeUnits: boolean;
}> = [
  { family: 'huile_moteur', reference: OIL, saleUnit: 'l', litersPerUnit: 1, wholeUnits: false },
  { family: 'huile_fourche', reference: FORK, saleUnit: 'flacon', litersPerUnit: 0.5, wholeUnits: true },
  { family: 'liquide_frein', reference: DOT, saleUnit: 'flacon', litersPerUnit: 0.5, wholeUnits: true },
  { family: 'liquide_refroidissement', reference: 'COOLELF CLASSIC -26°', saleUnit: 'l', litersPerUnit: 1, wholeUnits: false },
];

/**
 * Quantite d'huile par defaut selon la famille moteur, reprise des forfaits G8 (reglage
 * « liquide -> article », modifiable a l'ecran). Sert quand la source (manuel / plan) ne donne pas
 * la quantite, pour un filtre a huile introuvable dans le catalogue, et pour remplir un kit
 * « vidange » vide (huile + filtre + joint de vidange, comme les OIL SERVICE de G8).
 *
 * Le motif est lu sur la « carte d'identite » du kit : son libelle de famille moteur puis, pour
 * chaque modele-annee rattache, « famille > sous-famille > modele » du catalogue Ducati, separes
 * par « | ». Premier profil qui correspond (priorite croissante) ; `exclude` ecarte (V4 : aucun
 * forfait G8, rien n'est invente). Syntaxe commune PostgreSQL (~*) et JavaScript (/i).
 */
export type EngineProfileSeed = {
  code: string; label: string; priority: number;
  pattern: string; exclude: string | null; yearFrom: number | null; yearTo: number | null;
  oilReference: string | null; oilQuantity: number;
  filterReference: string | null; washerReference: string | null;
  /** Forfait G8 d'ou viennent les valeurs (affiche en provenance). */
  g8Forfait: string;
};

const NOT_V4 = 'V4|DESMOSEDICI';
export const DEFAULT_ENGINE_PROFILES: ReadonlyArray<EngineProfileSeed> = [
  {
    code: 'panigale_1199', label: 'Panigale 1199 / 1299 / 899 / 959 (Superquadro)', priority: 10,
    pattern: '(1199|1299|899|959)[^|]*PANIGALE|PANIGALE[^|]*(1199|1299|899|959)', exclude: NOT_V4, yearFrom: null, yearTo: null,
    oilReference: null, oilQuantity: 3.4, filterReference: 'FILTRE A HUILE 1199', washerReference: '85250541A',
    g8Forfait: 'OIL SERVICE 1199 12000KM',
  },
  {
    code: 'mts1200_2010_2012', label: 'Multistrada 1200 2010 a 2012', priority: 20,
    pattern: 'MULTISTRADA > 1200', exclude: NOT_V4, yearFrom: 2010, yearTo: 2012,
    oilReference: 'MOTO 4 ROAD 15W50', oilQuantity: 4, filterReference: '44440035A', washerReference: '85250261A',
    g8Forfait: 'MTS 1200 2010/2012',
  },
  {
    code: 'superbike_749_999', label: '748 / 749 / 916 / 996 / 998 / 999', priority: 25,
    pattern: '(^|[^0-9])(748|749|916|996|998|999)([^0-9]|$)', exclude: NOT_V4, yearFrom: null, yearTo: null,
    oilReference: null, oilQuantity: 3.4, filterReference: '44440035A', washerReference: '22032083A',
    g8Forfait: 'OIL SERVICE 749/999 20000KM',
  },
  {
    code: 'quatre_soupapes', label: '4 soupapes / Testastretta (Diavel, Multistrada 1200, 848/1098/1198, Hypermotard 821/939/950...)', priority: 30,
    pattern: 'DIAVEL|MULTISTRADA > (1200|1260|950|MULTISTRADA V2)|STREETFIGHTER|HYPERSTRADA|DESERT X|PANIGALE|(^|[^0-9])(848|1098|1198|821|939|937|950|955|1200|1260)([^0-9]|$)|(^|[^A-Z0-9])(ST3|ST4|S4R|S4RS|S4)([^A-Z0-9]|$)|MONSTER (PLUS|SP|SENNA)|(^|[^A-Z0-9])V2([^A-Z0-9]|$)',
    exclude: NOT_V4, yearFrom: null, yearTo: null,
    oilReference: null, oilQuantity: 3.4, filterReference: '44440035A', washerReference: '85250261A',
    g8Forfait: 'OIL SERVICE 4 SOUPAPES',
  },
  {
    code: 'deux_soupapes', label: '2 soupapes (Monster M696/M796/M1100, SS, 1000 SS, Scrambler a air...)', priority: 40,
    pattern: '(^|[^0-9])(250|350|400|450|600|620|659|695|696|750|796|797|800|803|900|907|1000|1100)([^0-9]|$)|SCRAMBLER|SPORTCLASSIC|GT1000|ST2|MH900|S2R|SIXTY2|ICON|SUPERSPORT|MONSTER|HYPERMOTARD|MULTISTRADA',
    exclude: 'V4|DESMOSEDICI|698|MONO', yearFrom: null, yearTo: null,
    oilReference: null, oilQuantity: 3.1, filterReference: '44440035A', washerReference: '85250261A',
    g8Forfait: 'OIL SERVICE 2 SOUPAPES',
  },
];
