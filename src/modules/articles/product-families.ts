/**
 * M2 — Référentiel des FAMILLES de produits (Ducati Bruxelles) :
 * hiérarchie à 3 niveaux Rayon > Sous-rayon > Catégorie, avec codes officiels.
 * Source : « Spécification de Mapping ERP / Arborescence Produits » (19/07/2026).
 * UID d'un article = concaténation « Rayon-Sous-rayon-Catégorie » (ex. 01-01-01
 * = Monster neuf, 04-12-03 = Shell 10W60). Stocké dans articles.category_path.
 * Données générées depuis le document source (fidélité garantie).
 * Logique pure testée dans tests/product-families.test.ts.
 */
export type FamilyNode = { code: string; label: string };
export type SousRayon = FamilyNode & { categories: FamilyNode[] };
export type Rayon = FamilyNode & { sousRayons: SousRayon[] };
export const PRODUCT_FAMILIES: Rayon[] = [
  { code: "01", label: "PRODUITS FINIS NEUFS", sousRayons: [
    { code: "01", label: "MOTOS", categories: [{ code: "99", label: "DIVERS" }, { code: "06", label: "SUPERBIKE" }, { code: "01", label: "MONSTER" }, { code: "11", label: "XDIAVEL" }, { code: "05", label: "MULTISTRADA" }, { code: "04", label: "SUPERSPORT" }, { code: "03", label: "STREETFIGHTER" }, { code: "02", label: "HYPERMOTARD" }, { code: "09", label: "DESERTX" }, { code: "08", label: "DIAVEL" }, { code: "07", label: "SCRAMBLER" }, { code: "10", label: "HERITAGE" }] },
    { code: "02", label: "E-BIKE / TROTTINETTE", categories: [{ code: "02", label: "-125 CC" }, { code: "01", label: "125 CC ET +" }, { code: "99", label: "DIVERS" }, { code: "03", label: "ELECTRIQUE" }] },
    { code: "03", label: "SCOOTERS", categories: [{ code: "01", label: "125 CC ET +" }, { code: "02", label: "-125 CC" }, { code: "99", label: "DIVERS" }] },
    { code: "04", label: "OFF ROAD", categories: [{ code: "01", label: "ENDURO" }, { code: "02", label: "CROSS" }, { code: "99", label: "DIVERS" }] },
    { code: "05", label: "QUADS", categories: [{ code: "01", label: "UTILITAIRES" }, { code: "99", label: "DIVERS" }, { code: "02", label: "SPORT LOISIRS" }] },
    { code: "99", label: "DIVERS", categories: [{ code: "99", label: "DIVERS" }] },
  ] },
  { code: "02", label: "PIECES DE RECHANGE", sousRayons: [
    { code: "06", label: "PIE SKF", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "99", label: "DIVERS", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "05", label: "PIE MOTORIA", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "04", label: "PIE MOSA FREIN", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "03", label: "PIE BREMBO", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "07", label: "PIE OHLINS", categories: [{ code: "01", label: "DIVERS" }] },
    { code: "01", label: "PIE BIHR", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "02", label: "PIE DUCATI", categories: [{ code: "99", label: "DIVERS" }] },
  ] },
  { code: "03", label: "ACCESSOIRES ET EQUIPEMENTS", sousRayons: [
    { code: "84", label: "ACC THOK", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "83", label: "ACC X-LITE", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "82", label: "ACC WEEK KEND PRODUCT", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "81", label: "ACC VULTUBIKE", categories: [{ code: "99", label: "DEVIS" }] },
    { code: "80", label: "ACC VALTER MOTO", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "79", label: "ACC ULTMATEADDONS", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "78", label: "ACC TERMIGNONI", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "77", label: "ACC TECH RACE", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "76", label: "ACC SW MOTECH", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "75", label: "ACC STOMGRIP", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "74", label: "ACC STM", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "73", label: "ACC SP CONNECT", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "72", label: "ACC SKYRICH", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "71", label: "ACC SITTA", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "69", label: "ACC REVIT", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "68", label: "ACC RED FOX", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "99", label: "DIVERS", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "67", label: "ACC RECUPEL", categories: [{ code: "01", label: "PILE" }] },
    { code: "66", label: "ACC RAD", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "65", label: "ACC RACESEATS", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "64", label: "ACC RG", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "63", label: "ACC PIEROBON", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "62", label: "ACC PERFORMANCE TECHNOLOGY", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "61", label: "ACC PEGASE", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "60", label: "ACC BIHR", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "59", label: "ACC OPTIMATE", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "58", label: "ACC NUMERO UNO SPRL", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "57", label: "ACC NR BIKE", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "56", label: "ACC N COM", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "55", label: "ACC MOTORIA", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "54", label: "ACC MOTOHOLDERS", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "53", label: "ACC MELOTTI", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "52", label: "ACC MARCHESINI", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "51", label: "ACC LIGHTECH", categories: [{ code: "99", label: "DEVIS" }] },
    { code: "50", label: "ACC LEOVINCI", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "49", label: "ACC LED PERF", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "48", label: "ACC KOVIX", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "47", label: "ACC KIT CROSS", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "46", label: "ACC KAOKO", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "45", label: "ACC KAMELEON", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "44", label: "ACC JT", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "43", label: "ACC JS PRODUCT", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "42", label: "ACC JOFRY SPORT", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "41", label: "ACC JETPRIME", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "40", label: "ACC IXON", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "39", label: "ACC IMA", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "38", label: "ACC HPX", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "37", label: "ACC HP CORSE", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "36", label: "ACC HOCOPARTS", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "35", label: "ACC HEPCO BEKKER", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "34", label: "ACC GUBELLINI", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "33", label: "ACC GSG MOTO", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "32", label: "ACC GEOTRACER", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "31", label: "ACC SCORPION", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "30", label: "ACC EVOTECH", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "29", label: "ACC EVO XRACING", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "28", label: "ACC DUCABIKE", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "27", label: "ACC COYOTE", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "26", label: "ACC CNC", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "25", label: "ACC CARDO", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "24", label: "ACC CARBONAVI", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "23", label: "ACC CARBON 4 US", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "22", label: "ACC BWT", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "21", label: "ACC TECNOGLOBE", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "20", label: "ACC BONAMICI", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "19", label: "ACC BIKE DESIGN", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "18", label: "ACC BELL", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "17", label: "ACC BARRACUDA", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "16", label: "ACC SC PROJECT", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "15", label: "ACC STM", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "14", label: "ACC ARROW", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "13", label: "ACC AMAZON", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "12", label: "ACC AGV", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "11", label: "ACC AEM", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "10", label: "ACC ACCESS BIKE", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "09", label: "ACC ABUS", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "08", label: "ACC 13.8 COMPOSITE", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "07", label: "ACC DUCATI OLD", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "06", label: "ACC ACERBIS", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "05", label: "ACC ALPINESTAR", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "9B", label: "ACC CHIGEE", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "9A", label: "ACC GILLES TOOLING", categories: [{ code: "01", label: "DIVERS" }] },
    { code: "98", label: "ACC GBRACING", categories: [{ code: "01", label: "DIVERS" }] },
    { code: "97", label: "ACC SMART MOTO", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "96", label: "ACC NOLAN", categories: [{ code: "01", label: "VISIERE" }] },
    { code: "95", label: "ACC SPARK", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "94", label: "ACC MOTO-MASTER", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "93", label: "ACC OZ", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "92", label: "ACC OHLINS", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "91", label: "ACC SENA", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "90", label: "ACC IRC", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "89", label: "ACC BREMBO", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "88", label: "ACC BEEPINGS", categories: [{ code: "01", label: "TRACKER GPS ZEN L" }] },
    { code: "87", label: "ACC GB RACING", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "86", label: "ACC HEALTECH", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "85", label: "ACC GARMIN", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "01", label: "ACC SUOMY", categories: [{ code: "01", label: "DIVERS" }] },
    { code: "02", label: "ACC DUCATI", categories: [{ code: "03", label: "MARCHANDISING" }, { code: "02", label: "VETEMENTS" }, { code: "01", label: "ACC MOTO" }, { code: "99", label: "DIVERS" }] },
    { code: "03", label: "ACC RIZOMA", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "04", label: "ACC AKRAPOVIC", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "9C", label: "ACC LEKTRONIS", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "9D", label: "ACC IMBERGER", categories: [{ code: "99", label: "DIVERS" }] },
  ] },
  { code: "04", label: "LUBRIFIANTS / NETTOYANTS", sousRayons: [
    { code: "01", label: "4 TEMPS", categories: [{ code: "01", label: "SYNTHESE" }, { code: "02", label: "SEMI SYNTHESE" }, { code: "03", label: "MINERALE" }, { code: "99", label: "DIVERS" }] },
    { code: "02", label: "2 TEMPS", categories: [{ code: "01", label: "SYNTHESE" }, { code: "02", label: "SEMI SYNTHESE" }, { code: "99", label: "DIVERS" }] },
    { code: "03", label: "OHLINS", categories: [{ code: "03", label: "HUILE OHLINS" }, { code: "99", label: "DIVERS" }] },
    { code: "09", label: "TOTAL", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "06", label: "AEROSOLE", categories: [{ code: "01", label: "CHAINE" }, { code: "99", label: "DIVERS" }] },
    { code: "07", label: "CARBURANT", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "99", label: "DIVERS", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "08", label: "IPONE", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "12", label: "SHELL", categories: [{ code: "03", label: "10W60" }, { code: "02", label: "15W50" }, { code: "01", label: "DUCATI CORSE PERFORMANCE OIL" }] },
    { code: "11", label: "BARDAHL", categories: [{ code: "02", label: "NETTOYANT CARBURATEURS" }, { code: "01", label: "NETTOYANT INJECTEURS" }, { code: "99", label: "DIVERS" }] },
    { code: "10", label: "MOTUL", categories: [{ code: "01", label: "DIVERS" }] },
  ] },
  { code: "05", label: "MAIN D'OEUVRE ET FORFAITS", sousRayons: [
    { code: "99", label: "DIVERS", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "01", label: "MAIN D'OEUVRE", categories: [{ code: "01", label: "MAIN D'OEUVRE" }] },
    { code: "02", label: "FORFAITS", categories: [{ code: "01", label: "FORFAITS" }, { code: "05", label: "CERAMIQUE / DETAILING" }, { code: "04", label: "SUSPENSIONS" }, { code: "03", label: "TEST BATTERIE" }, { code: "02", label: "CONTROLE TECHNIQUE" }] },
  ] },
  { code: "06", label: "DEPOTS VENTES", sousRayons: [
    { code: "01", label: "DEPOTS VENTES", categories: [{ code: "01", label: "DEPOTS VENTES PARTICULIERS" }, { code: "02", label: "DEPOTS VENTES PROS" }, { code: "99", label: "DIVERS" }] },
    { code: "02", label: "PRESTATIONS", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "99", label: "DIVERS", categories: [{ code: "99", label: "DIVERS" }] },
  ] },
  { code: "07", label: "REPRISES OCCASIONS", sousRayons: [
    { code: "02", label: "REPRISES PROS", categories: [{ code: "01", label: "REPRISES PROS" }] },
    { code: "01", label: "REPRISES PARTICULIERS", categories: [{ code: "01", label: "REPRISES PARTICULIERS" }] },
    { code: "99", label: "DIVERS", categories: [{ code: "99", label: "DIVERS" }] },
  ] },
  { code: "08", label: "OCCASIONS", sousRayons: [
    { code: "01", label: "OCCASIONS PARTICULIERS", categories: [{ code: "01", label: "OCCASIONS PARTICULIERS" }] },
    { code: "02", label: "OCCASIONS PROS", categories: [{ code: "01", label: "OCCASIONS PROS" }] },
    { code: "99", label: "DIVERS", categories: [{ code: "99", label: "DIVERS" }] },
  ] },
  { code: "09", label: "PNEUMATIQUES", sousRayons: [
    { code: "01", label: "PIRELLI", categories: [{ code: "01", label: "SLICK" }, { code: "02", label: "ROAD" }, { code: "03", label: "OFF-ROAD" }, { code: "99", label: "DIVERS" }] },
    { code: "02", label: "CHAMBRES", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "08", label: "METZELER", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "07", label: "CONTINENTAL", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "06", label: "UNIROYAL", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "05", label: "BRIDGESTONE", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "04", label: "DUNLOP", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "03", label: "MICHELIN", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "09", label: "MITAS", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "99", label: "DIVERS", categories: [{ code: "99", label: "DIVERS" }] },
  ] },
  { code: "10", label: "ADMINISTRATIF", sousRayons: [
    { code: "02", label: "DEMANDE COC", categories: [{ code: "01", label: "COC" }, { code: "99", label: "DIVERS" }] },
    { code: "04", label: "GARANTIE", categories: [{ code: "01", label: "GARANTIE FACTORY" }, { code: "02", label: "GARANTIE SAV" }, { code: "99", label: "DIVERS" }] },
    { code: "03", label: "FRAIS DE PORT", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "99", label: "DIVERS", categories: [{ code: "99", label: "DIVERS" }] },
  ] },
  { code: "11", label: "COURTOISIE / LOCATION", sousRayons: [
    { code: "02", label: "LOCATION", categories: [{ code: "99", label: "DIVERS" }] },
    { code: "01", label: "MOTO COURTOISIE", categories: [{ code: "99", label: "DIVERS" }] },
  ] },
  { code: "99", label: "DIVERS", sousRayons: [
    { code: "99", label: "DIVERS", categories: [{ code: "99", label: "DIVERS" }] },
  ] },
];

/** Ordre d'affichage : codes numériques croissants, alphanumériques ensuite,
 *  99 (DIVERS / DEVIS) toujours en dernier. */
export function sortByCode<T extends FamilyNode>(nodes: T[]): T[] {
  const key = (c: string) =>
    c === '99' ? 1e9 : /^\d+$/.test(c) ? parseInt(c, 10) : 1e6 + c.charCodeAt(0) * 100 + (c.charCodeAt(1) || 0);
  return [...nodes].sort((a, b) => key(a.code) - key(b.code));
}

export const RAYONS_SORTED: Rayon[] = sortByCode(PRODUCT_FAMILIES);

export function rayonByCode(code: string): Rayon | undefined {
  return PRODUCT_FAMILIES.find((r) => r.code === code);
}
export function sousRayonsFor(rayonCode: string): SousRayon[] {
  return sortByCode(rayonByCode(rayonCode)?.sousRayons ?? []);
}
export function categoriesFor(rayonCode: string, sousRayonCode: string): FamilyNode[] {
  const sr = rayonByCode(rayonCode)?.sousRayons.find((s) => s.code === sousRayonCode);
  return sortByCode(sr?.categories ?? []);
}

/** UID « RR-SS-CC » (concaténation Rayon-Sous-rayon-Catégorie). Vide si incomplet. */
export function buildFamilyCode(rayon: string, sousRayon: string, cat: string): string {
  return rayon && sousRayon && cat ? rayon + '-' + sousRayon + '-' + cat : '';
}

/** Découpe un UID « RR-SS-CC » ; null si le format est invalide (ancien code type « R11 »). */
export function parseFamilyCode(code: string | null | undefined): { rayon: string; sousRayon: string; cat: string } | null {
  const m = (code ?? '').match(/^([0-9A-Za-z]{1,2})-([0-9A-Za-z]{1,2})-([0-9A-Za-z]{1,2})$/);
  if (!m) return null;
  return { rayon: m[1].toUpperCase(), sousRayon: m[2].toUpperCase(), cat: m[3].toUpperCase() };
}

/** Libellés lisibles (Rayon / Sous-rayon / Catégorie) ; null si UID invalide ou inconnu. */
export function familyLabels(code: string | null | undefined): { rayon: string; sousRayon: string; cat: string } | null {
  const p = parseFamilyCode(code);
  if (!p) return null;
  const r = rayonByCode(p.rayon);
  const s = r?.sousRayons.find((x) => x.code === p.sousRayon);
  const c = s?.categories.find((x) => x.code === p.cat);
  return r && s && c ? { rayon: r.label, sousRayon: s.label, cat: c.label } : null;
}