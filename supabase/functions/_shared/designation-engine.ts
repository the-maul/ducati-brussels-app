/**
 * M2 — Moteur de traduction des designations, etage 1 (glossaire mecanique).
 *
 * Pur TypeScript, sans reseau : utilise par l'application (analyse d'un import,
 * creation d'article) et par l'Edge Function translate-designations. L'etage 2
 * (memoire de traduction + Claude) ne recoit que ce que cet etage ne couvre pas.
 *
 * Ce que fait l'etage 1 :
 *   1. normalise le libelle (majuscules, accents retires, apostrophes droites) ;
 *   2. decoupe en jetons : mot connu du glossaire, invariant, code (chiffres,
 *      dimensions M6X20, sigles courts), mot inconnu, mot-outil (DE, DI, OF, AND...) ;
 *   3. detecte la langue source par VOTE des mots connus (chaque forme vote pour
 *      les langues ou elle existe ; egalite = langue inconnue) ;
 *   4. traduit segment par segment en respectant l'ordre des mots de chaque
 *      langue : FR / IT « tete puis complements » (SUPPORT DE RESERVOIR, SUPPORTO
 *      SERBATOIO), EN / NL « complements puis tete » (TANK SUPPORT, TANKSTEUN) ;
 *      les adjectifs s'accordent en FR et en IT avec la tete du segment.
 *
 * Une designation est COUVERTE quand tous ses mots (hors codes et invariants)
 * sont connus ET que la langue source est identifiee. Sinon elle part a l'etage 2.
 */
import { GLOSSARY, LANGS, type GlossaryEntry, type Lang } from './designation-glossary.ts';

export type { Lang } from './designation-glossary.ts';
export type I18n = Record<Lang, string>;

export type GlossaryResult = {
  /** Libelle d'origine, tel que recu (espaces reduits). */
  source: string;
  /** Langue detectee ; '?' si aucun mot connu ou egalite de votes. */
  lang: Lang | '?';
  /** Tout est connu et la langue est sure : les quatre versions sont fiables. */
  covered: boolean;
  /** Les quatre versions (toujours renseignees : les mots inconnus sont gardes tels quels). */
  i18n: I18n;
  /** Mots que le glossaire ne connait pas (vides quand covered). */
  unknown: string[];
};

// ─── Normalisation ───────────────────────────────────────────────────────────

/** Majuscules, accents retires, apostrophes et guillemets courbes remplaces par des droits. */
export function normalizeText(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Index du glossaire ──────────────────────────────────────────────────────

type Known = { entry: GlossaryEntry; langs: Lang[] };

/** Forme (normalisee) -> entree et langues ou cette forme existe. Premiere entree gagnante. */
const INDEX = new Map<string, Known>();
/** Formes composees (avec espace), les plus longues d'abord, pour le decoupage. */
const PHRASES: string[] = [];

function register(form: string, entry: GlossaryEntry, lang: Lang) {
  const f = normalizeText(form);
  if (!f) return;
  const k = INDEX.get(f);
  if (k) {
    if (k.entry === entry && !k.langs.includes(lang)) k.langs.push(lang);
    return;
  }
  INDEX.set(f, { entry, langs: entry.role === 'x' ? [] : [lang] });
  if (f.includes(' ') && !PHRASES.includes(f)) PHRASES.push(f);
}

for (const entry of GLOSSARY) {
  for (const lang of LANGS) {
    register(entry[lang], entry, lang);
    for (const alt of entry.alt?.[lang] ?? []) register(alt, entry, lang);
    if (lang === 'fr' && entry.frF) register(entry.frF, entry, 'fr');
    if (lang === 'it' && entry.itF) register(entry.itF, entry, 'it');
  }
}
PHRASES.sort((p, q) => q.length - p.length);

/** Mots-outils : votent pour leur langue, sont retires de la structure. */
type FunctionWord = { langs: Lang[]; kind: 'link' | 'and' | 'with' };
const FUNCTION_WORDS = new Map<string, FunctionWord>([
  ['DE', { langs: ['fr'], kind: 'link' }], ['DU', { langs: ['fr'], kind: 'link' }], ['DES', { langs: ['fr'], kind: 'link' }],
  ["D'", { langs: ['fr', 'it'], kind: 'link' }], ['LA', { langs: ['fr', 'it'], kind: 'link' }], ['LE', { langs: ['fr', 'it'], kind: 'link' }],
  ['LES', { langs: ['fr'], kind: 'link' }], ['POUR', { langs: ['fr'], kind: 'link' }], ['AU', { langs: ['fr'], kind: 'link' }],
  ['AUX', { langs: ['fr'], kind: 'link' }], ['ET', { langs: ['fr'], kind: 'and' }], ['AVEC', { langs: ['fr'], kind: 'with' }],
  ['DI', { langs: ['it'], kind: 'link' }], ['DEL', { langs: ['it'], kind: 'link' }], ['DELLA', { langs: ['it'], kind: 'link' }],
  ['DELLO', { langs: ['it'], kind: 'link' }], ['DELLE', { langs: ['it'], kind: 'link' }], ['DEI', { langs: ['it'], kind: 'link' }],
  ['DEGLI', { langs: ['it'], kind: 'link' }], ["DELL'", { langs: ['it'], kind: 'link' }], ['PER', { langs: ['it'], kind: 'link' }],
  ['AL', { langs: ['it'], kind: 'link' }], ['ALLA', { langs: ['it'], kind: 'link' }], ['DA', { langs: ['it'], kind: 'link' }],
  ['IL', { langs: ['it'], kind: 'link' }], ['E', { langs: ['it'], kind: 'and' }], ['ED', { langs: ['it'], kind: 'and' }],
  ['CON', { langs: ['it'], kind: 'with' }],
  ['OF', { langs: ['en'], kind: 'link' }], ['THE', { langs: ['en'], kind: 'link' }], ['FOR', { langs: ['en'], kind: 'link' }],
  ['TO', { langs: ['en'], kind: 'link' }], ['ON', { langs: ['en'], kind: 'link' }], ['AND', { langs: ['en'], kind: 'and' }],
  ['WITH', { langs: ['en'], kind: 'with' }], ['W/', { langs: ['en'], kind: 'with' }],
  ['VAN', { langs: ['nl'], kind: 'link' }], ['HET', { langs: ['nl'], kind: 'link' }], ['OP', { langs: ['nl'], kind: 'link' }],
  ['EN', { langs: ['nl', 'fr'], kind: 'and' }], ['MET', { langs: ['nl'], kind: 'with' }],
  ['A', { langs: ['fr', 'it'], kind: 'link' }], ['IN', { langs: ['it', 'en', 'nl'], kind: 'link' }],
]);

const CONJ: Record<FunctionWord['kind'], I18n> = {
  link: { fr: 'DE', nl: 'VAN', en: 'OF', it: 'DI' },
  and: { fr: 'ET', nl: 'EN', en: 'AND', it: 'E' },
  with: { fr: 'AVEC', nl: 'MET', en: 'WITH', it: 'CON' },
};

// ─── Decoupage ───────────────────────────────────────────────────────────────

export type Token =
  | { kind: 'word'; text: string; known: Known }
  | { kind: 'func'; text: string; fw: FunctionWord }
  | { kind: 'code'; text: string }
  | { kind: 'unknown'; text: string };

/** Un code : chiffres, dimensions (M6X20, 11.11X1.78), sigles de 1 a 2 lettres, ponctuation seule. */
export function isCodeToken(t: string): boolean {
  if (/\d/.test(t)) return true;
  if (/^[A-Z]{1,2}$/.test(t)) return true;
  if (!/[A-Z]/.test(t)) return true;
  return false;
}

/** Decoupe une designation normalisee en jetons (locutions du glossaire reconnues en premier). */
export function tokenize(text: string): Token[] {
  let s = normalizeText(text);
  // D'ECHAPPEMENT -> D' ECHAPPEMENT ; DELL'ACQUA -> DELL' ACQUA
  s = s.replace(/\b(D|L|DELL|ALL|NELL|DALL|SULL)'(?=[A-Z])/g, "$1' ");
  // Les locutions deviennent un seul jeton (espace -> \u0001) pour survivre au split.
  for (const p of PHRASES) {
    if (s.includes(p)) s = s.replace(new RegExp(`(^|[^A-Z])${p.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}(?![A-Z])`, 'g'), (_m, pre) => pre + p.replace(/ /g, '\u0001'));
  }
  const out: Token[] = [];
  for (const raw of s.split(' ')) {
    if (!raw) continue;
    const core = raw.replace(/\u0001/g, ' ').replace(/^[,.;:()[\]]+|[,.;:()[\]]+$/g, '');
    if (!core) { out.push({ kind: 'code', text: raw }); continue; }
    const known = INDEX.get(core);
    if (known) { out.push({ kind: 'word', text: core, known }); continue; }
    const fw = FUNCTION_WORDS.get(core);
    if (fw) { out.push({ kind: 'func', text: core, fw }); continue; }
    if (isCodeToken(core)) { out.push({ kind: 'code', text: core }); continue; }
    out.push({ kind: 'unknown', text: core });
  }
  return out;
}

// ─── Detection de la langue ──────────────────────────────────────────────────

export type Detection = { lang: Lang | '?'; votes: Record<Lang, number> };

/** Vote des mots connus et des mots-outils. Egalite entre deux langues = '?'. */
export function detectLanguage(text: string): Detection {
  const votes: Record<Lang, number> = { fr: 0, nl: 0, en: 0, it: 0 };
  for (const tok of tokenize(text)) {
    const langs = tok.kind === 'word' ? tok.known.langs : tok.kind === 'func' ? tok.fw.langs : [];
    for (const l of langs) votes[l] += 1;
  }
  let best: Lang | '?' = '?';
  let bestN = 0;
  let tie = false;
  for (const l of LANGS) {
    if (votes[l] > bestN) { best = l; bestN = votes[l]; tie = false; }
    else if (votes[l] === bestN && bestN > 0) tie = true;
  }
  return { lang: tie ? '?' : best, votes };
}

// ─── Traduction ──────────────────────────────────────────────────────────────

type Segment = { nouns: GlossaryEntry[]; adjs: GlossaryEntry[] };
type Chunk = { kind: 'seg'; seg: Segment } | { kind: 'lit'; text: string } | { kind: 'conj'; fw: FunctionWord };

const HEAD_FIRST: Record<Lang, boolean> = { fr: true, it: true, en: false, nl: false };

/** Construit la structure (segments de mots connus, litteraux, conjonctions) selon la langue source. */
function structure(tokens: Token[], src: Lang): Chunk[] {
  const chunks: Chunk[] = [];
  let seg: Segment | null = null;
  const flush = () => { if (seg) { chunks.push({ kind: 'seg', seg }); seg = null; } };
  for (const tok of tokens) {
    if (tok.kind === 'word') {
      const e = tok.known.entry;
      if (e.role === 'x') { flush(); chunks.push({ kind: 'lit', text: tok.text }); continue; }
      if (!seg) seg = { nouns: [], adjs: [] };
      (e.role === 'n' ? seg.nouns : seg.adjs).push(e);
    } else if (tok.kind === 'func') {
      if (tok.fw.kind === 'link') continue; // DE / DI / OF : regenere a la sortie
      flush();
      chunks.push({ kind: 'conj', fw: tok.fw });
    } else {
      flush();
      chunks.push({ kind: 'lit', text: tok.text });
    }
  }
  flush();
  // Les complements sont ranges « du plus proche de la tete au plus lointain » :
  // FR/IT : tete en premier, complements dans l'ordre ; EN/NL : tete en dernier, complements a rebours.
  if (!HEAD_FIRST[src]) {
    for (const c of chunks) {
      if (c.kind !== 'seg') continue;
      c.seg.nouns.reverse();
      c.seg.adjs.reverse();
    }
  }
  return chunks;
}

const VOWEL = /^[AEIOUYH]/;

function frAdj(e: GlossaryEntry, head: GlossaryEntry | undefined): string {
  let w = head?.g === 'f' && e.frF ? e.frF : e.fr;
  // Seuls les vrais adjectifs (ceux qui ont un feminin) prennent la marque du pluriel :
  // AVANT, CARBONE, HOMME... restent invariables.
  if (head?.pl && e.frF && !/[SX]$/.test(w) && !w.includes(' ')) w += 'S';
  return w;
}

function itAdj(e: GlossaryEntry, head: GlossaryEntry | undefined): string {
  // Le genre IT n'est pas porte par le glossaire : on reprend le genre FR comme approximation.
  return head?.g === 'f' && e.itF ? e.itF : e.it;
}

function renderSegment(seg: Segment, target: Lang): string {
  const [head, ...mods] = seg.nouns;
  const adjs = seg.adjs;
  if (target === 'fr') {
    const parts: string[] = [];
    if (head) parts.push(head.fr);
    for (const m of mods) parts.push((VOWEL.test(m.fr) ? "D'" : 'DE ') + m.fr);
    for (const ad of adjs) parts.push(frAdj(ad, head));
    return parts.join(' ').replace(/' /g, "'");
  }
  if (target === 'it') {
    const parts: string[] = [];
    if (head) parts.push(head.it);
    for (const m of mods) parts.push(m.it);
    for (const ad of adjs) parts.push(itAdj(ad, head));
    return parts.join(' ');
  }
  if (target === 'en') {
    const parts: string[] = [];
    for (const ad of [...adjs].reverse()) parts.push(ad.en);
    for (const m of [...mods].reverse()) parts.push(m.en);
    if (head) parts.push(head.en);
    return parts.join(' ');
  }
  // nl : les noms se soudent (TANK + STEUN = TANKSTEUN), les qualificatifs suivent.
  // Un complement deja contenu dans la tete n'est pas repete (REM + REMBLOKKEN = REMBLOKKEN).
  const compound = [...mods].reverse().map((m) => m.nl).filter((m) => !head || !head.nl.startsWith(m)).concat(head ? [head.nl] : []);
  const joined = compound.every((w) => !w.includes(' ') && !w.includes('-')) ? compound.join('') : compound.join(' ');
  const parts: string[] = [];
  if (joined) parts.push(joined);
  for (const ad of adjs) parts.push(ad.nl);
  return parts.join(' ');
}

function render(chunks: Chunk[], target: Lang): string {
  const parts: string[] = [];
  for (const c of chunks) {
    if (c.kind === 'lit') parts.push(c.text);
    else if (c.kind === 'conj') parts.push(CONJ[c.fw.kind][target]);
    else parts.push(renderSegment(c.seg, target));
  }
  return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Traduit une designation avec le glossaire seul. `hint` force la langue source
 * (ex. 'fr' pour un libelle saisi a la main) ; sinon elle est detectee par vote.
 */
export function translateWithGlossary(text: string, hint?: Lang | '?' | null): GlossaryResult {
  const source = (text ?? '').replace(/\s+/g, ' ').trim();
  const tokens = tokenize(source);
  const detected = detectLanguage(source);
  const unknown = tokens.filter((t): t is Extract<Token, { kind: 'unknown' }> => t.kind === 'unknown').map((t) => t.text);
  const hasWords = tokens.some((t) => t.kind === 'word' && t.known.entry.role !== 'x');
  let lang: Lang | '?' = hint && hint !== '?' ? hint : detected.lang;

  // Que des codes et invariants (« KIT ABS ») : identique partout, langue sans objet.
  if (!hasWords && unknown.length === 0) {
    const same = normalizeText(source);
    return { source, lang, covered: true, i18n: { fr: same, nl: same, en: same, it: same }, unknown: [] };
  }

  if (lang === '?') {
    // Sans langue sure, on ne reordonne rien : mot a mot, pour information seulement.
    const wordByWord = (target: Lang) => tokens.map((t) => (t.kind === 'word' ? t.known.entry[target] : t.text)).join(' ');
    return {
      source, lang: '?', covered: false,
      i18n: { fr: wordByWord('fr'), nl: wordByWord('nl'), en: wordByWord('en'), it: wordByWord('it') },
      unknown,
    };
  }

  const chunks = structure(tokens, lang);
  const i18n = { fr: '', nl: '', en: '', it: '' } as I18n;
  for (const target of LANGS) i18n[target] = target === lang ? normalizeText(source) : render(chunks, target);
  return { source, lang, covered: unknown.length === 0, i18n, unknown };
}

/** Raccourci : la designation est-elle entierement couverte par le glossaire ? */
export const isCoveredByGlossary = (text: string, hint?: Lang | '?' | null): boolean => translateWithGlossary(text, hint).covered;

// ─── Memoire de traduction (etage 2, partie deterministe) ───────────────────

export type MemoryRow = { source_text: string; source_lang: string; target_lang: string; target_text: string };
export type MemoryItem = { text: string; lang?: Lang | '?' | null };
export type MemoryHit = { text: string; lang: Lang; i18n: I18n };

/**
 * Separe les libelles deja connus de la memoire (toutes les langues cibles
 * presentes) de ceux qu'il faudra envoyer a Claude. Aucun reseau ici : c'est la
 * logique testee. Un libelle dont la langue source est donnee ne prend que les
 * lignes de cette langue ; sinon n'importe quelle langue source complete convient.
 */
export function partitionByMemory(items: MemoryItem[], rows: MemoryRow[]): { ready: MemoryHit[]; missing: MemoryItem[] } {
  const byText = new Map<string, Map<string, Map<string, string>>>(); // text -> source_lang -> target_lang -> target_text
  for (const r of rows) {
    const t = (r.source_text ?? '').trim();
    if (!t) continue;
    let bySrc = byText.get(t);
    if (!bySrc) { bySrc = new Map(); byText.set(t, bySrc); }
    let byTarget = bySrc.get(r.source_lang);
    if (!byTarget) { byTarget = new Map(); bySrc.set(r.source_lang, byTarget); }
    byTarget.set(r.target_lang, r.target_text);
  }
  const ready: MemoryHit[] = [];
  const missing: MemoryItem[] = [];
  for (const it of items) {
    const text = (it.text ?? '').trim();
    const bySrc = byText.get(text);
    let hit: MemoryHit | null = null;
    if (bySrc) {
      const candidates = it.lang && it.lang !== '?' ? [it.lang] : LANGS;
      for (const src of candidates) {
        const byTarget = bySrc.get(src);
        if (!byTarget) continue;
        const i18n = { fr: '', nl: '', en: '', it: '' } as I18n;
        let complete = true;
        for (const target of LANGS) {
          if (target === src) { i18n[target] = text; continue; }
          const v = byTarget.get(target);
          if (!v) { complete = false; break; }
          i18n[target] = v;
        }
        if (complete) { hit = { text, lang: src, i18n }; break; }
      }
    }
    if (hit) ready.push(hit); else missing.push(it);
  }
  return { ready, missing };
}

/** Lignes de memoire a enregistrer pour un libelle traduit (une par langue cible, hors langue source). */
export function memoryRowsFor(text: string, lang: Lang, i18n: I18n, engine: 'glossaire' | 'claude' | 'manuel'): (MemoryRow & { engine: string })[] {
  const out: (MemoryRow & { engine: string })[] = [];
  for (const target of LANGS) {
    if (target === lang) continue;
    const v = (i18n[target] ?? '').trim();
    if (!v) continue;
    out.push({ source_text: text.trim(), source_lang: lang, target_lang: target, target_text: v, engine });
  }
  return out;
}
