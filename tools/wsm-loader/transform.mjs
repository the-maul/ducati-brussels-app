/**
 * Mission 07, carte 3 — mise en forme des manuels d'atelier Ducati pour la base.
 *
 * Deux entrées, deux sorties :
 *   * buildProcedure(parcoursJson)  -> la procédure dédupliquée, ses étapes et ses couples ;
 *   * buildManual(entretienJson, …) -> le modèle-année, son programme officiel, ses usages de
 *     procédures et ses annexes (couples généraux, outils, ravitaillements, produits, temps).
 *
 * Fonctions pures, sans accès disque ni réseau : testées par tests/wsm-loader.test.ts.
 * Toutes les clés de contenu (row_key) et les empreintes (content_hash) sont calculées ici : c'est
 * ce qui rend le chargeur idempotent et relançable.
 */
import { createHash } from 'node:crypto';

/** Empreinte stable d'un objet (clés triées) : sert à ne pas réécrire ce qui n'a pas changé. */
export function contentHash(value) {
  return createHash('sha256').update(stableStringify(value)).digest('hex').slice(0, 32);
}

function stableStringify(v) {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  if (typeof v === 'object') {
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}

/** Clé de contenu courte et stable pour une ligne fille. */
export function rowKey(...parts) {
  return createHash('sha1').update(parts.map((p) => String(p ?? '')).join('')).digest('hex').slice(0, 20);
}

const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };

/**
 * Date de mise à jour d'un module du DM : « Tue Sep 16 00:00:00 CEST 2025 » -> « 2025-09-16 ».
 * Le fuseau imprimé est ignoré : la date du document est une date, pas un instant.
 */
export function parseDmDate(s) {
  if (!s) return null;
  const m = /^\w{3}\s+(\w{3})\s+(\d{1,2})\s+[\d:]+\s+\S+\s+(\d{4})$/.exec(String(s).trim());
  if (m && MONTHS[m[1]]) {
    return `${m[3]}-${String(MONTHS[m[1]]).padStart(2, '0')}-${String(Number(m[2])).padStart(2, '0')}`;
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s).trim());
  return iso ? iso[0] : null;
}

/** Texte normalisé : majuscules sans accents ni ponctuation (rapprochements et clés). */
export function norm(s) {
  return String(s ?? '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9+]+/g, ' ')
    .trim();
}

/** Code stable d'une échéance à partir de son nom imprimé (« Oil Service » -> « oil_service »). */
export function serviceCode(name) {
  const n = norm(name).replace(/\s+/g, '_').replace(/\+/g, 'plus').toLowerCase();
  return n || 'service';
}

/** Source d'un bloc du manuel, aplatie en colonnes. */
function source(src) {
  const s = src || {};
  return {
    source_manual_root: s.manualRoot ?? null,
    source_dm_path: s.dmPath ?? null,
    source_dm_id: s.dmId ?? null,
    source_code: s.code ?? null,
    source_version: s.version ?? null,
    source_updated_at: parseDmDate(s.updateDate),
  };
}

const arr = (v) => (Array.isArray(v) ? v : []);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const int = (v) => (num(v) === null ? null : Math.round(v));

// ---------------------------------------------------------------------
// Procédures (parcours\<id>.json)
// ---------------------------------------------------------------------
/**
 * Une procédure dédupliquée + ses étapes + ses couples.
 * Les figures gardent leur chemin local : les fichiers eux-mêmes partent dans Supabase Storage.
 */
export function buildProcedure(j) {
  if (!j || !j.id) throw new Error('Parcours sans identifiant');
  const steps = arr(j.etapes).map((e) => ({
    n: int(e.n),
    phase: e.phase ?? null,
    sub_phase: e.sousPhase ?? null,
    text: e.texte ?? null,
    sub_steps: arr(e.sousEtapes),
    figures: arr(e.figures),
    tools: arr(e.outils),
    products: arr(e.produits),
    torques: arr(e.couples),
    marks: arr(e.reperes),
    warnings: arr(e.avertissements),
    symbols: arr(e.symboles),
    tables: arr(e.tableaux),
    videos: arr(e.videos),
    links: arr(e.liens),
  })).filter((s) => s.n !== null);

  const torques = arr(j.couples).map((c, i) => ({
    row_key: rowKey(j.id, c.etape, c.valeurNm, c.texte, i),
    step_n: int(c.etape),
    value_nm: num(c.valeurNm),
    min_nm: num(c.min),
    max_nm: num(c.max),
    tolerance: c.tolerance ?? null,
    marks: arr(c.reperes).map(String),
    text: c.texte ?? null,
    sort: i,
  }));

  const figuresCount = steps.reduce(
    (n, s) => n + s.figures.length + s.sub_steps.reduce((m, ss) => m + arr(ss.figures).length, 0),
    arr(j.figuresIntroduction).length,
  );

  const body = {
    id: j.id,
    title: j.titre || j.id,
    roles: arr(j.roles).map(String),
    ...source(j.source),
    source_title: (j.source && j.source.titre) || null,
    intervention: j.intervention ?? null,
    tools: arr(j.outilsSpecifiques),
    products: arr(j.produits),
    warnings: arr(j.avertissementsGeneraux),
    intro_figures: arr(j.figuresIntroduction),
    times: arr(j.temps),
    steps_count: steps.length,
    figures_count: figuresCount,
    torques_count: torques.length,
    usages_count: int(j.nbModelesAnnees) ?? arr(j.utiliseDans).length,
    steps,
    torques,
  };
  return { ...body, content_hash: contentHash(body) };
}

/** Chemins d'images cités par une procédure, dédoublonnés (figure et miniature). */
export function procedureImages(j) {
  const out = new Map();
  const add = (f) => {
    if (!f) return;
    if (f.local) out.set(f.local, 'figure');
    if (f.localMiniature && f.localMiniature !== f.local) out.set(f.localMiniature, 'miniature');
  };
  arr(j.figuresIntroduction).forEach(add);
  for (const e of arr(j.etapes)) {
    arr(e.figures).forEach(add);
    for (const ss of arr(e.sousEtapes)) arr(ss.figures).forEach(add);
  }
  return out;
}

// ---------------------------------------------------------------------
// Manuels (entretien\<famille>\<modele>-<annee>.json)
// ---------------------------------------------------------------------
/**
 * Un modèle-année : identité, programme officiel (échéances + opérations), usages de procédures,
 * procédures par échéance, annexes et temps en UT.
 * @param j       contenu du fichier d'entretien
 * @param opts    { sourceFile, extractedAt, coversModelYearIds }
 *
 * `coversModelYearIds` : les modèles-années du DM que CE manuel couvre. Ducati publie parfois un
 * seul manuel pour deux versions (Monster 797 et 797 +, Monster 937 et 937 +) : l'index de
 * l'extraction liste alors 469 modèles-années pour 461 fichiers. Sans cette liste, les 8 versions
 * en double seraient perdues au lieu d'être rattachées au catalogue.
 */
export function buildManual(j, opts = {}) {
  const m = (j && j.modele) || {};
  if (!m.myId) throw new Error('Fichier d\'entretien sans identifiant de modèle-année (myId)');
  const p = (j && j.programme) || {};

  // Échéances : nom imprimé -> code stable.
  //
  // Deux formats dans les manuels : les récents nomment leurs révisions (Oil Service, Desmo
  // Service…) dans programme.services ; les plus anciens n'ont qu'une grille kilométrique, et les
  // échéances (« 1000 km », « 15000 km »…) ne sont que dans programme.echeances. On prend le
  // premier format quand il existe, la grille sinon : sans cela 235 des 469 modèles-années
  // n'auraient aucune échéance.
  const fromServices = arr(p.services).map((s, i) => ({
    code: serviceCode(s.service),
    name: s.service,
    km: int(s.km),
    mi: int(s.mi),
    months: int(s.mois),
    first_service: Boolean(s.premiereEcheance),
    definition: arr(p.echeances).find((e) => e.echeance === s.service)?.definition ?? null,
    text: s.texte ?? null,
    first_reached: true, // décision M-16 : le premier atteint (km ou mois)
    sort: i,
  }));
  const fromGrid = arr(p.echeances)
    .filter((e) => e.type === 'echeance' && e.echeance)
    .map((e, i) => ({
      code: serviceCode(e.echeance),
      name: e.echeance,
      km: int(e.km),
      mi: int(e.mi),
      months: int(e.mois),
      first_service: int(e.km) === 1000,
      definition: e.definition ?? null,
      text: null,
      first_reached: true,
      sort: i,
    }));
  const services = dedupeByKey(fromServices.length ? fromServices : fromGrid, 'code');
  const knownCodes = new Set(services.map((s) => s.code));
  const codeOf = (name) => {
    const c = serviceCode(name);
    if (knownCodes.has(c)) return c;
    // « Annual Service (24) » -> « annual_service » quand le suffixe n'est qu'une périodicité.
    const base = serviceCode(String(name).replace(/\s*\(\d+\)\s*$/, ''));
    return knownCodes.has(base) ? base : c;
  };

  const operations = [];
  // Opération du programme -> procédures d'atelier : c'est le lien le plus riche du manuel.
  // Il sert aussi à remplir « procédures d'une échéance » quand le manuel est en grille
  // kilométrique (ses en-têtes de colonne ne sont pas des noms d'échéance exploitables).
  const opProcedures = [];
  const pushOp = (scope, o, i, groupLabel) => {
    const label = typeof o === 'string' ? o : o.libelle;
    if (!label) return;
    const codes = typeof o === 'string' ? [] : arr(o.echeances).map(codeOf).filter((c) => knownCodes.has(c));
    if (typeof o !== 'string') {
      for (const pr of arr(o.proceduresLiees)) {
        if (!pr.parcoursId) continue;
        for (const c of codes) opProcedures.push({ service_code: c, procedure_id: pr.parcoursId, operation: label, sort: i });
      }
    }
    operations.push({
      row_key: rowKey(scope, label, groupLabel, codes.join('|'), i),
      scope,
      n: i + 1,
      label,
      group_label: groupLabel ?? (typeof o === 'string' ? null : o.groupe ?? null),
      service_codes: [...new Set(codes)],
      periodicity_km: typeof o === 'string' ? null : int(o.periodicite),
      periodicity_months: typeof o === 'string' ? null : int(o.periodiciteMois),
      sort: i,
    });
  };
  arr(p.operationsConcessionnaire).forEach((o, i) => pushOp('concessionnaire', o, i, null));
  arr(p.liste1000km).forEach((o, i) => pushOp('liste_1000', o, i, null));
  arr(p.pointsGraissage).forEach((o, i) => pushOp('graissage', o, i, null));
  for (const bloc of arr(p.client)) {
    for (const tab of arr(bloc.tableaux)) {
      const cols = new Map(arr(tab.colonnes).map((c) => [c.id, c.label]));
      arr(tab.operations).forEach((o, i) => {
        const label = o.libelle;
        if (!label) return;
        operations.push({
          row_key: rowKey('client', label, i),
          scope: 'client',
          n: i + 1,
          label,
          group_label: o.groupe ?? null,
          service_codes: [...new Set(arr(o.echeances).map((id) => codeOf(cols.get(id) || id)).filter((c) => knownCodes.has(c)))],
          periodicity_km: int(o.periodicite),
          periodicity_months: int(o.periodiciteMois),
          sort: i,
        });
      });
    }
  }
  const uniqueOperations = dedupeByRowKey(operations);

  // Usages de procédures : procédures d'entretien, procédures liées, pré-livraison.
  const usages = [];
  const seenUsage = new Set();
  const pushUsage = (pr, role, i) => {
    if (!pr || !pr.parcoursId) return;
    const k = pr.parcoursId + '|' + role;
    if (seenUsage.has(k)) return;
    seenUsage.add(k);
    const s = source(pr.source);
    usages.push({
      procedure_id: pr.parcoursId,
      role,
      operation: pr.operation ?? pr.intervention ?? null,
      dm_path: s.source_dm_path,
      dm_id: s.source_dm_id,
      version: s.source_version,
      source_updated_at: s.source_updated_at,
      sort: i,
    });
  };
  arr(j.procedures).forEach((pr, i) => pushUsage(pr, pr.role || 'procedure', i));
  arr(j.proceduresLiees).forEach((pr, i) => pushUsage(pr, 'liee', i));
  arr(p.preLivraison).forEach((pr, i) => pushUsage(pr, 'prelivraison', i));

  // Procédures à exécuter pour chaque échéance.
  const serviceProcedures = [];
  const seenSp = new Set();
  for (const [name, list] of Object.entries(j.proceduresParService || {})) {
    const code = codeOf(name);
    // Les manuels en grille kilométrique ont des en-têtes de colonne qui ne sont pas des échéances
    // (« km x 1000 », « Temps (mois) ») : on ne garde que ce qui correspond au programme.
    if (!knownCodes.has(code)) continue;
    arr(list).forEach((pr, i) => {
      if (!pr.parcoursId) return;
      const k = code + '|' + pr.parcoursId;
      if (seenSp.has(k)) return;
      seenSp.add(k);
      serviceProcedures.push({ service_code: code, procedure_id: pr.parcoursId, operation: pr.operation ?? null, sort: i });
    });
  }
  // Complément par les procédures citées dans les opérations du programme (manuels en grille).
  for (const sp of opProcedures) {
    const k = sp.service_code + '|' + sp.procedure_id;
    if (seenSp.has(k)) continue;
    seenSp.add(k);
    serviceProcedures.push(sp);
  }

  const torqueTables = arr(j.couplesSerrageGeneraux).map((t, i) => ({
    row_key: rowKey('couples', t.titre, (t.source || {}).dmId, i),
    title: t.titre || 'Couples de serrage',
    ...source(t.source),
    lines: arr(t.lignes),
    sort: i,
  }));
  const toolSets = arr(j.outilsService).map((t, i) => ({
    row_key: rowKey('outils', t.titre, (t.source || {}).dmId, i),
    title: t.titre || 'Outils',
    ...source(t.source),
    tools: arr(t.outils),
    sort: i,
  }));
  const fluidTables = arr(j.ravitaillements).map((t, i) => ({
    row_key: rowKey('ravitaillements', (t.source || {}).dmId, i),
    title: (t.source && t.source.titre) || 'Ravitaillements et lubrifiants',
    ...source(t.source),
    lines: arr(t.lignes),
    warnings: arr(t.avertissements),
    notes: arr(t.notes),
    sort: i,
  }));
  const productTables = arr(j.produitsCatalogue).map((t, i) => ({
    row_key: rowKey('produits', (t.source || {}).dmId, i),
    title: (t.source && t.source.titre) || 'Caractéristiques des produits',
    ...source(t.source),
    products: arr(t.produits),
    sort: i,
  }));

  const times = arr(j.temps).map((t, i) => {
    const code = codeOf(t.intitule);
    return {
      row_key: rowKey('temps', t.intitule, t.tempsTexte, i),
      label: t.intitule,
      service_code: knownCodes.has(code) ? code : null,
      time_text: t.tempsTexte ?? null,
      minutes: int(t.minutes),
      ut: int(t.ut),
      values_doc: arr(t.valeurs).map(String),
      ...source(t.source),
      sort: i,
    };
  }).filter((t) => t.label);

  const body = {
    id: String(m.myId),
    family: m.famille || '',
    supermodel: m.superModele || null,
    model: m.modele || '',
    model_year: int(Number(m.annee)),
    manual_root: m.manualRoot ?? null,
    section: m.sectionEntretien ?? null,
    dm_family_id: m.famId ?? null,
    dm_supermodel_id: m.smId ?? null,
    dm_model_id: m.modelId ?? null,
    nodes_count: int(m.nbNoeuds),
    gaps: arr(j.manques),
    source_file: opts.sourceFile ?? null,
    extracted_at: opts.extractedAt ?? j.genereLe ?? null,
    covers_model_year_ids: [...new Set([String(m.myId), ...arr(opts.coversModelYearIds).map(String)])].sort(),
    services,
    operations: uniqueOperations,
    usages,
    service_procedures: serviceProcedures,
    torque_tables: torqueTables,
    tool_sets: toolSets,
    fluid_tables: fluidTables,
    product_tables: productTables,
    times,
  };
  return { ...body, content_hash: contentHash(body) };
}

/** Deux opérations identiques dans la même portée : on garde la première, la clé reste unique. */
function dedupeByRowKey(rows) {
  return dedupeByKey(rows, 'row_key');
}

/** Garde la première ligne de chaque clé (les clés doivent être uniques en base). */
function dedupeByKey(rows, key) {
  const seen = new Set();
  return rows.filter((r) => (seen.has(r[key]) ? false : (seen.add(r[key]), true)));
}

/** Découpe une liste en paquets de n. */
export function chunk(list, n) {
  const out = [];
  for (let i = 0; i < list.length; i += Math.max(1, n)) out.push(list.slice(i, i + Math.max(1, n)));
  return out;
}

/** Littéral SQL en dollar-quoting, avec une balise qui n'apparaît pas dans le texte. */
export function dollarQuote(s) {
  let tag = 'w';
  while (s.includes(`$${tag}$`)) tag += 'w';
  return `$${tag}$${s}$${tag}$`;
}
