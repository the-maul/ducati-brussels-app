/**
 * Indicatifs téléphoniques internationaux (préfixes pays).
 * Utilisé par le champ téléphone (fiche contact) : menu déroulant avec favoris
 * en tête, et découpage FIABLE d'un numéro stocké (« +32 471… ») en
 * préfixe + reste — par plus longue correspondance sur les indicatifs connus
 * (jamais glouton, corrige le bug « +3247 »).
 * Fonctions PURES — testées (JScript + tests/dial-codes.test.ts).
 */

/** Favoris affichés en tête du menu (marché principal de la concession). */
export const FAVORITE_DIAL_CODES = ['+32', '+33', '+31', '+352', '+49', '+39', '+34'];

export type DialCode = { code: string; name: string };

/** Liste des pays (nom FR + indicatif). Triée par nom pour le groupe « Tous ». */
export const DIAL_CODES: DialCode[] = [
  { code: '+27', name: 'Afrique du Sud' },
  { code: '+355', name: 'Albanie' },
  { code: '+213', name: 'Algérie' },
  { code: '+49', name: 'Allemagne' },
  { code: '+376', name: 'Andorre' },
  { code: '+244', name: 'Angola' },
  { code: '+966', name: 'Arabie saoudite' },
  { code: '+54', name: 'Argentine' },
  { code: '+374', name: 'Arménie' },
  { code: '+61', name: 'Australie' },
  { code: '+43', name: 'Autriche' },
  { code: '+994', name: 'Azerbaïdjan' },
  { code: '+973', name: 'Bahreïn' },
  { code: '+880', name: 'Bangladesh' },
  { code: '+32', name: 'Belgique' },
  { code: '+229', name: 'Bénin' },
  { code: '+375', name: 'Biélorussie' },
  { code: '+591', name: 'Bolivie' },
  { code: '+387', name: 'Bosnie-Herzégovine' },
  { code: '+267', name: 'Botswana' },
  { code: '+55', name: 'Brésil' },
  { code: '+359', name: 'Bulgarie' },
  { code: '+226', name: 'Burkina Faso' },
  { code: '+855', name: 'Cambodge' },
  { code: '+237', name: 'Cameroun' },
  { code: '+1', name: 'Canada / États-Unis' },
  { code: '+238', name: 'Cap-Vert' },
  { code: '+56', name: 'Chili' },
  { code: '+86', name: 'Chine' },
  { code: '+357', name: 'Chypre' },
  { code: '+57', name: 'Colombie' },
  { code: '+242', name: 'Congo' },
  { code: '+243', name: 'Congo (RDC)' },
  { code: '+82', name: 'Corée du Sud' },
  { code: '+506', name: 'Costa Rica' },
  { code: '+225', name: 'Côte d’Ivoire' },
  { code: '+385', name: 'Croatie' },
  { code: '+53', name: 'Cuba' },
  { code: '+45', name: 'Danemark' },
  { code: '+253', name: 'Djibouti' },
  { code: '+20', name: 'Égypte' },
  { code: '+971', name: 'Émirats arabes unis' },
  { code: '+593', name: 'Équateur' },
  { code: '+34', name: 'Espagne' },
  { code: '+372', name: 'Estonie' },
  { code: '+251', name: 'Éthiopie' },
  { code: '+358', name: 'Finlande' },
  { code: '+33', name: 'France' },
  { code: '+241', name: 'Gabon' },
  { code: '+995', name: 'Géorgie' },
  { code: '+233', name: 'Ghana' },
  { code: '+30', name: 'Grèce' },
  { code: '+502', name: 'Guatemala' },
  { code: '+224', name: 'Guinée' },
  { code: '+509', name: 'Haïti' },
  { code: '+504', name: 'Honduras' },
  { code: '+852', name: 'Hong Kong' },
  { code: '+36', name: 'Hongrie' },
  { code: '+91', name: 'Inde' },
  { code: '+62', name: 'Indonésie' },
  { code: '+964', name: 'Irak' },
  { code: '+98', name: 'Iran' },
  { code: '+353', name: 'Irlande' },
  { code: '+354', name: 'Islande' },
  { code: '+972', name: 'Israël' },
  { code: '+39', name: 'Italie' },
  { code: '+81', name: 'Japon' },
  { code: '+962', name: 'Jordanie' },
  { code: '+7', name: 'Kazakhstan / Russie' },
  { code: '+254', name: 'Kenya' },
  { code: '+965', name: 'Koweït' },
  { code: '+856', name: 'Laos' },
  { code: '+266', name: 'Lesotho' },
  { code: '+371', name: 'Lettonie' },
  { code: '+961', name: 'Liban' },
  { code: '+218', name: 'Libye' },
  { code: '+423', name: 'Liechtenstein' },
  { code: '+370', name: 'Lituanie' },
  { code: '+352', name: 'Luxembourg' },
  { code: '+389', name: 'Macédoine du Nord' },
  { code: '+261', name: 'Madagascar' },
  { code: '+60', name: 'Malaisie' },
  { code: '+265', name: 'Malawi' },
  { code: '+960', name: 'Maldives' },
  { code: '+223', name: 'Mali' },
  { code: '+356', name: 'Malte' },
  { code: '+212', name: 'Maroc' },
  { code: '+230', name: 'Maurice' },
  { code: '+222', name: 'Mauritanie' },
  { code: '+52', name: 'Mexique' },
  { code: '+373', name: 'Moldavie' },
  { code: '+377', name: 'Monaco' },
  { code: '+976', name: 'Mongolie' },
  { code: '+382', name: 'Monténégro' },
  { code: '+258', name: 'Mozambique' },
  { code: '+264', name: 'Namibie' },
  { code: '+977', name: 'Népal' },
  { code: '+505', name: 'Nicaragua' },
  { code: '+227', name: 'Niger' },
  { code: '+234', name: 'Nigeria' },
  { code: '+47', name: 'Norvège' },
  { code: '+64', name: 'Nouvelle-Zélande' },
  { code: '+968', name: 'Oman' },
  { code: '+256', name: 'Ouganda' },
  { code: '+998', name: 'Ouzbékistan' },
  { code: '+92', name: 'Pakistan' },
  { code: '+507', name: 'Panama' },
  { code: '+595', name: 'Paraguay' },
  { code: '+31', name: 'Pays-Bas' },
  { code: '+51', name: 'Pérou' },
  { code: '+63', name: 'Philippines' },
  { code: '+48', name: 'Pologne' },
  { code: '+351', name: 'Portugal' },
  { code: '+974', name: 'Qatar' },
  { code: '+40', name: 'Roumanie' },
  { code: '+44', name: 'Royaume-Uni' },
  { code: '+250', name: 'Rwanda' },
  { code: '+503', name: 'Salvador' },
  { code: '+378', name: 'Saint-Marin' },
  { code: '+221', name: 'Sénégal' },
  { code: '+381', name: 'Serbie' },
  { code: '+65', name: 'Singapour' },
  { code: '+421', name: 'Slovaquie' },
  { code: '+386', name: 'Slovénie' },
  { code: '+252', name: 'Somalie' },
  { code: '+249', name: 'Soudan' },
  { code: '+94', name: 'Sri Lanka' },
  { code: '+46', name: 'Suède' },
  { code: '+41', name: 'Suisse' },
  { code: '+597', name: 'Suriname' },
  { code: '+963', name: 'Syrie' },
  { code: '+992', name: 'Tadjikistan' },
  { code: '+886', name: 'Taïwan' },
  { code: '+255', name: 'Tanzanie' },
  { code: '+235', name: 'Tchad' },
  { code: '+420', name: 'Tchéquie' },
  { code: '+66', name: 'Thaïlande' },
  { code: '+228', name: 'Togo' },
  { code: '+216', name: 'Tunisie' },
  { code: '+993', name: 'Turkménistan' },
  { code: '+90', name: 'Turquie' },
  { code: '+380', name: 'Ukraine' },
  { code: '+598', name: 'Uruguay' },
  { code: '+58', name: 'Venezuela' },
  { code: '+84', name: 'Viêt Nam' },
  { code: '+967', name: 'Yémen' },
  { code: '+260', name: 'Zambie' },
  { code: '+263', name: 'Zimbabwe' },
];

/** Tous les indicatifs, triés du plus long au plus court (pour la correspondance). */
const CODES_BY_LENGTH = DIAL_CODES.map((d) => d.code).sort((a, b) => b.length - a.length);

const DEFAULT_PREFIX = '+32';

/** Nom d'un indicatif (pour l'affichage). */
export function dialCodeName(code: string): string {
  return DIAL_CODES.find((d) => d.code === code)?.name ?? '';
}

/**
 * Découpe un numéro stocké en { préfixe, reste } SANS gloutonnerie :
 * on retient le plus long indicatif CONNU par lequel le numéro commence.
 * Ex. « +32471722249 » → { prefix:'+32', local:'471722249' } (et pas « +3247 »).
 */
export function splitPhone(value: string | null | undefined): { prefix: string; local: string } {
  const s = (value ?? '').trim();
  if (!s) return { prefix: DEFAULT_PREFIX, local: '' };
  if (s[0] !== '+') return { prefix: DEFAULT_PREFIX, local: s };

  const compact = s.replace(/\s+/g, ''); // "+32471722249"
  for (const code of CODES_BY_LENGTH) {
    if (compact.indexOf(code) === 0) {
      return { prefix: code, local: stripLeadingDigits(s.slice(1), code.length - 1) };
    }
  }
  // Indicatif inconnu : on isole « + » suivi de 1 à 3 chiffres.
  const m = s.match(/^\+(\d{1,3})[\s]*(.*)$/s);
  if (m) return { prefix: '+' + m[1], local: m[2].trim() };
  return { prefix: DEFAULT_PREFIX, local: s };
}

/** Retire les `n` premiers chiffres de `str` (en sautant les espaces), garde le reste. */
function stripLeadingDigits(str: string, n: number): string {
  let removed = 0;
  let i = 0;
  while (i < str.length && removed < n) {
    if (/\d/.test(str[i])) removed++;
    i++;
  }
  return str.slice(i).trim();
}

/** Recompose « préfixe + reste » (reste vide → juste le préfixe). */
export function joinPhone(prefix: string, local: string): string {
  const l = (local ?? '').trim();
  return l ? `${prefix} ${l}` : prefix;
}
