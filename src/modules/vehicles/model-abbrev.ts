/**
 * M3 — Abréviation des modèles Ducati pour l'impression d'étiquettes.
 * Règle client : sur l'étiquette on retire la marque « Ducati » et on abrège la
 * famille (Streetfighter V4 S → SF V4 S), en gardant versions/cylindrées/suffixes.
 * Fonction PURE — testée (JScript + tests/model-abbrev.test.ts).
 *
 * Algorithme :
 *  1. MAJUSCULES, espaces normalisés, préfixe marque « DUCATI » retiré.
 *  2. Famille reconnue en tête (essai 2 mots puis 1 mot) → abréviation.
 *  3. Scrambler + nombre collé : SCR + 800 → SCR800.
 *  4. Superbikes « <cylindrée> <Famille> » : la famille placée APRÈS une cylindrée
 *     en tête est aussi abrégée (1199 Panigale S → 1199 PANI S ; 1299 Superleggera
 *     → 1299 SL).
 *  5. Sous-modèles connus abrégés (2 mots puis 1 mot), le reste gardé tel quel.
 *  6. Versions/cylindrées/suffixes toujours conservés (V4, S, 937, +, 2G…).
 *  7. Modèle dont le nom EST un nombre sans famille (916, 999 R, 916 SPS…) → tout gardé.
 */

// Familles → abréviation. Clés MAJUSCULES ; formes multi-mots (« DESERT X ») OK.
// (Complété via le workflow de couverture gamme 1990–2026.)
const FAMILY_ABBR: Record<string, string> = {
  STREETFIGHTER: 'SF',
  MULTISTRADA: 'MTS',
  DIAVEL: 'DVL',
  XDIAVEL: 'XDVL',
  PANIGALE: 'PANI',
  MONSTER: 'M',
  DESERTX: 'DSX',
  'DESERT X': 'DSX',
  SCRAMBLER: 'SCR',
  HYPERMOTARD: 'HM',
  HYPERSTRADA: 'HS',
  SUPERSPORT: 'SS',
  SUPERLEGGERA: 'SL',
  SPORTCLASSIC: 'SC',
  DESMOSEDICI: 'D16',
  'PAUL SMART': 'PS',
  PAULSMART: 'PS',
};

// Sous-modèles / variantes en plusieurs mots (ou très longs) → abréviation.
// Les finitions courtes lisibles restent VERBATIM (ICON, RALLY, MONO, SP, S, R…).
const SUBMODEL_ABBR: Record<string, string> = {
  NIGHTSHIFT: 'NS',
  'FULL THROTTLE': 'FT',
  'DESERT SLED': 'DS',
  'CAFE RACER': 'CR',
  'CAFÉ RACER': 'CR',
  'URBAN ENDURO': 'UE',
  'URBAN MOTARD': 'UM',
  'PIKES PEAK': 'PP',
  'GRAND TOUR': 'GT',
};

const SUBMODEL_MAX_WORDS = 2;

/** Un token est-il « purement numérique » (cylindrée / nom-nombre) ? */
function isNumberToken(tok: string): boolean {
  return /^\d{2,4}$/.test(tok);
}

/** Détecte une famille à partir de `start` (essai 2 mots puis 1 mot). */
function matchFamilyAt(tokens: string[], start: number): { abbr: string; len: number } | null {
  for (const len of [2, 1]) {
    if (start + len > tokens.length) continue;
    const key = tokens.slice(start, start + len).join(' ');
    if (FAMILY_ABBR[key]) return { abbr: FAMILY_ABBR[key], len };
  }
  return null;
}

/**
 * Abrège un modèle moto pour l'étiquette. Retourne le libellé abrégé en
 * MAJUSCULES ; les libellés inconnus sont simplement renvoyés en majuscules
 * (dégradation gracieuse — jamais d'erreur).
 */
export function abbreviateBikeModel(model: string | null | undefined): string {
  if (!model) return '';
  let s = String(model).toUpperCase().replace(/\s+/g, ' ').trim();
  s = s.replace(/^DUCATI\s+/, ''); // retirer la marque
  if (!s) return '';

  const tokens = s.split(' ');
  const out: string[] = [];
  let i = 0;

  // 1) Famille en tête (2 mots puis 1 mot)
  const head = matchFamilyAt(tokens, 0);
  if (head) {
    i = head.len;
    // 2) Scrambler + cylindrée collée (SCR800, SCR1100)
    if (head.abbr === 'SCR' && i < tokens.length && isNumberToken(tokens[i])) {
      out.push(head.abbr + tokens[i]);
      i += 1;
    } else {
      out.push(head.abbr);
    }
  } else if (tokens.length > 1 && isNumberToken(tokens[0])) {
    // 3) Superbikes « <cylindrée> <Famille> » (1199 Panigale S → 1199 PANI S)
    const afterNum = matchFamilyAt(tokens, 1);
    if (afterNum) {
      out.push(tokens[0]);
      out.push(afterNum.abbr);
      i = 1 + afterNum.len;
    }
  }

  // 4) Tokens restants : sous-modèles (locutions d'abord), sinon tel quel
  while (i < tokens.length) {
    let matched = false;
    for (let len = SUBMODEL_MAX_WORDS; len >= 1; len--) {
      if (i + len > tokens.length) continue;
      const key = tokens.slice(i, i + len).join(' ');
      if (SUBMODEL_ABBR[key]) { out.push(SUBMODEL_ABBR[key]); i += len; matched = true; break; }
    }
    if (!matched) { out.push(tokens[i]); i += 1; }
  }

  return out.join(' ').replace(/\s+/g, ' ').trim();
}
