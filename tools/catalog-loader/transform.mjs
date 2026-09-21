/**
 * Chargeur du catalogue Ducati — transformations pures (testées par bun test,
 * tests/ducati-catalog-loader.test.ts).
 *
 * Fichiers produits par l'extraction depuis le Chrome de Simon (21/09), dans Téléchargements :
 *   catalogue-ducati-arbre.json        { families, superModels, models, modelYears } (listes à plat,
 *                                      Europe et millésimes ≥ 2000 uniquement)
 *   catalogue-ducati-groupes-NNN.json  [ { modelYear, groups: [ { id, code, description, drawings: [...] } ] } ]
 *   catalogue-ducati-planches-NNN.json [ { id, code, description, imageUrl, hotspots, parts: [...] } ]
 *                                      (chaque planche une seule fois ; lien au modèle-année = « groupes »)
 */
// catalog-core.js est un script classique (partagé avec l'extension) : il s'expose sur globalThis.
import '../myducati-extension/catalog-core.js';

const core = globalThis.DmsCatalogCore;

const s = (v) => (v == null ? '' : String(v));
const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : null; };

export const FILE_PATTERNS = {
  tree: /^catalogue-ducati-arbre\.json$/i,
  groups: /^catalogue-ducati-groupes-(\d+)\.json$/i,
  drawings: /^catalogue-ducati-planches-(\d+)\.json$/i,
};

/** Classe et trie les fichiers d'un dossier (noms seulement). */
export function classifyFiles(names) {
  const out = { tree: null, groups: [], drawings: [], other: [] };
  const num = (re, f) => Number((f.match(re) || [])[1] || 0);
  for (const f of names) {
    if (FILE_PATTERNS.tree.test(f)) out.tree = f;
    else if (FILE_PATTERNS.groups.test(f)) out.groups.push(f);
    else if (FILE_PATTERNS.drawings.test(f)) out.drawings.push(f);
    else if (/^catalogue-ducati-.*\.json$/i.test(f) && !/chargement/i.test(f)) out.other.push(f);
  }
  out.groups.sort((a, b) => num(FILE_PATTERNS.groups, a) - num(FILE_PATTERNS.groups, b));
  out.drawings.sort((a, b) => num(FILE_PATTERNS.drawings, a) - num(FILE_PATTERNS.drawings, b));
  return out;
}

/**
 * Arbre à plat → arbre imbriqué attendu par ducati_catalog_ingest_tree.
 * Renvoie { tree, warnings, counts }. Le marché est recalculé par le nom (règle M-15) :
 * un modèle hors Europe qui aurait glissé est gardé mais marqué is_europe = false.
 */
export function nestTree(flat) {
  const warnings = [];
  const fams = (flat && flat.families) || [];
  const sms = (flat && flat.superModels) || [];
  const models = (flat && flat.models) || [];
  const mys = (flat && flat.modelYears) || [];
  const famIds = new Set(fams.map((f) => s(f.id)));
  const smById = new Map(sms.map((x) => [s(x.id), x]));
  const modelById = new Map(models.map((m) => [s(m.id), m]));

  const mysByModel = new Map();
  for (const y of mys) {
    const mid = s(y.model);
    if (!modelById.has(mid)) { warnings.push(`Modèle-année ${s(y.id)} : modèle ${mid} absent de l'arbre (ignoré)`); continue; }
    if (!mysByModel.has(mid)) mysByModel.set(mid, []);
    mysByModel.get(mid).push({ id: s(y.id), code: y.code == null ? null : s(y.code), year: core.yearOf(y), path: y.path == null ? null : s(y.path), name: y.name == null ? null : s(y.name) });
  }
  const modelsBySm = new Map();
  let outside = 0;
  for (const m of models) {
    const smId = s(m.superModel);
    if (!smById.has(smId)) { warnings.push(`Modèle ${s(m.id)} : cylindrée ${smId} absente (ignoré)`); continue; }
    const market = core.marketOf(m.description);
    if (market !== 'EU') outside++;
    if (!modelsBySm.has(smId)) modelsBySm.set(smId, []);
    modelsBySm.get(smId).push({ id: s(m.id), description: s(m.description || m.id), order: n(m.order), market, isEurope: market === 'EU', modelYears: mysByModel.get(s(m.id)) || [] });
  }
  const smsByFam = new Map();
  for (const x of sms) {
    const fid = s(x.family);
    if (!famIds.has(fid)) { warnings.push(`Cylindrée ${s(x.id)} : famille ${fid} absente (ignorée)`); continue; }
    if (!smsByFam.has(fid)) smsByFam.set(fid, []);
    smsByFam.get(fid).push({ id: s(x.id), description: s(x.description || x.id), models: modelsBySm.get(s(x.id)) || [] });
  }
  if (outside) warnings.push(`${outside} modèle(s) au nom hors Europe : gardés mais marqués hors Europe`);
  const tree = { families: fams.map((f) => ({ id: s(f.id), description: s(f.description || f.id), superModels: smsByFam.get(s(f.id)) || [] })) };
  return { tree, warnings, counts: { families: fams.length, superModels: sms.length, models: models.length, modelYears: mys.length } };
}

/** Fichier « groupes » : garde { modelYear, groups } et seulement les champs utiles. */
export function slimGroupsFile(items) {
  return (Array.isArray(items) ? items : []).filter((it) => it && it.modelYear != null).map((it) => ({
    modelYear: s(it.modelYear),
    groups: (it.groups || []).map((g) => ({
      id: s(g.id), code: g.code == null ? null : s(g.code), description: g.description == null ? null : s(g.description),
      drawings: (g.drawings || []).map((d) => ({ id: s(d.id), code: d.code ?? null, description: d.description ?? null, imageUrl: d.imageUrl ?? null, originalImageUrl: d.originalImageUrl ?? null })),
    })),
  }));
}

const PART_FIELDS = ['code', 'description', 'position', 'quantity', 'notes', 'partNotes', 'price', 'vatPrice', 'discountGroup',
  'replaced', 'replacedPart', 'partReplacementTree', 'minQuantity', 'eanCode', 'startDate', 'endDate', 'validities', 'hasTempario', 'itemId'];

/** Fichier « planches » : dédoublonne par id (la dernière version gagne) et garde les champs utiles. */
export function slimDrawingsFile(list) {
  const byId = new Map();
  for (const d of Array.isArray(list) ? list : []) {
    if (!d || d.id == null) continue;
    byId.set(s(d.id), {
      id: s(d.id), code: d.code ?? null, description: d.description ?? null, imageUrl: d.imageUrl ?? null,
      originalImageUrl: d.originalImageUrl ?? null, hotspots: Array.isArray(d.hotspots) ? d.hotspots : [],
      validities: d.validities ?? null,
      parts: (d.parts || []).map((p) => Object.fromEntries(PART_FIELDS.filter((k) => p[k] !== undefined).map((k) => [k, p[k]]))),
    });
  }
  return [...byId.values()];
}

/** Découpe une liste en paquets. */
export function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Dollar-quote SQL sûr (étiquette absente du texte). */
export function dollarQuote(text) {
  let tag = 'j';
  while (text.includes('$' + tag + '$')) tag += 'x';
  return '$' + tag + '$' + text + '$' + tag + '$';
}

/** Un fichier déjà chargé (même taille, même date) est sauté, sauf --force. */
export function isAlreadyLoaded(ledger, name, stat) {
  const e = ledger && ledger[name];
  return !!e && e.size === stat.size && e.mtimeMs === stat.mtimeMs;
}
