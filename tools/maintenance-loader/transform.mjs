/**
 * Chargeur des plans d'entretien Ducati (mission 07, carte 1) — transformations pures
 * (testées par bun test, tests/maintenance-loader.test.ts).
 *
 * Entrée : les fichiers de l'extraction des documents d'entretien
 * (C:\Users\simon\Desktop\ducati\entretiens-extraits\) :
 *   plans.json  { meta: { sources }, listes_controles: [...], plans: [ { id, famille, modele, annees,
 *                 usage, liste_controles_id, echeances: [ { code, nom, intervalles, temps, operations } ] } ] }
 *   temps.json  { temps: [ { plan_id, echeance, heures, ut, source, statut, remplace_par… } ] }
 * Sortie : la charge attendue par la fonction maintenance_ingest (noms de colonnes de la base).
 *
 * Rien n'est inventé : chaque valeur vient du fichier, avec sa source ; les corrections décidées
 * par Simon (corrections.mjs) sont appliquées au chargement et notées dans le plan. Les temps viennent de
 * temps.json (la même liste est recopiée dans plans.json : on contrôle qu'elles concordent).
 */
import { createHash } from 'node:crypto';
import { applyPlanCorrections, PLAN_CORRECTIONS } from './corrections.mjs';

const STATUS = { 'en vigueur': 'en_vigueur', historique: 'historique' };
const USAGE = { route: 'route', 'piste amateur': 'piste_amateur', racing: 'racing' };

const str = (v) => (v == null || v === '' ? null : String(v));
const int = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)));
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const bool = (v) => (v == null ? null : !!v);

/** JSON à clés triées : même contenu = même texte = même empreinte. */
export function stableJson(v) {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v === undefined ? null : v);
}

export const hash = (v, len = 20) => createHash('sha1').update(stableJson(v)).digest('hex').slice(0, len);

export function mapStatus(s, where) {
  const v = STATUS[String(s ?? '').trim()];
  if (!v) throw new Error(`Statut inconnu « ${s} » (${where})`);
  return v;
}

export function mapUsage(u, where) {
  const v = USAGE[String(u ?? '').trim()];
  if (!v) throw new Error(`Usage inconnu « ${u} » (${where})`);
  return v;
}

/** Même normalisation que public._mp_norm (comparaison avec le catalogue). */
export function normName(s) {
  return String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}

/**
 * Noms de modèles d'un plan pour le rattachement au catalogue Ducati, déduits du texte du
 * document (« Multistrada 1200 / 1200 S (Testastretta 11°) » → Multistrada 1200, Multistrada 1200 S)
 * et des variantes citées. Correspondance prudente : ces noms servent à PROPOSER, la base ne
 * rattache d'office que sur un nom exact.
 */
export function matchNames(modele, variantes = []) {
  const clean = String(modele ?? '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  const pieces = clean.split(/\s+\/\s+|\s+-\s+|\s*\/\s*/).map((x) => x.trim()).filter(Boolean)
    .filter((p) => !/^\d+\s*cc$/i.test(p));
  const out = [];
  if (pieces.length) {
    const hasDigit = (t) => /\d/.test(t);
    const isNum = (t) => /^\d/.test(t);
    let p0 = pieces[0].split(' ');
    const last = pieces[pieces.length - 1].split(' ');
    // « Hypermotard / Hyperstrada 821 » : le numéro du dernier morceau vaut pour le premier.
    if (!p0.some(hasDigit) && pieces.length > 1 && last.some(isNum)) {
      p0 = [...p0, ...last.slice(last.findIndex(isNum))];
    }
    // « 899 / 959 / 1199 / 1299 Panigale » : les numéros seuls prennent les mots du dernier.
    const bareFirst = p0.every(isNum);
    const suffix = isNum(last[0]) ? last.slice(1) : [];
    const firstNum = p0.findIndex(isNum);
    out.push((bareFirst && suffix.length && pieces.length > 1 ? [...p0, ...suffix] : p0).join(' '));
    for (const piece of pieces.slice(1)) {
      const t = piece.split(' ');
      const k = p0.indexOf(t[0]);
      if (k > 0) out.push([...p0.slice(0, k), ...t].join(' '));            // « 1200 S » → Multistrada 1200 S
      else if (t.length === 1 && t[0].length <= 2 && !isNum(t[0])) out.push([...p0, ...t].join(' ')); // « S »
      else if (isNum(t[0])) {
        const base = firstNum >= 0 ? p0.slice(0, firstNum) : p0;             // « 796 » → Monster 796
        const words = bareFirst && t.length === 1 ? suffix : [];
        out.push([...base, ...t, ...words].join(' '));
      } else if (!t.some(hasDigit) && p0.some(hasDigit)) out.push([...p0, ...t].join(' ')); // « Sport »
      else out.push(t.join(' '));
    }
  }
  // Variantes citées : sans les commentaires entre parenthèses ; « 1200 S » → Multistrada 1200 S ;
  // « Café Racer » (sans chiffre) → Scrambler Café Racer.
  const head = pieces.length ? pieces[0].split(' ') : [];
  const headBase = head.slice(0, Math.max(0, head.findIndex((x) => /^\d/.test(x))));
  for (const v of variantes || []) {
    if (typeof v !== 'string') continue;
    const t = v.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    if (!t.length) continue;
    if (/^\d/.test(t[0]) && headBase.length) out.push([...headBase, ...t].join(' '));
    else if (head.length && !/\d/.test(t.join(' ')) && normName(t[0]) !== normName(head[0])) out.push([head[0], ...t].join(' '));
    else out.push(t.join(' '));
  }
  const seen = new Set();
  return out.filter((n) => { const k = normName(n); if (!k || seen.has(k)) return false; seen.add(k); return true; });
}

/** Clés de contenu : un même contenu répété reçoit un suffixe d'occurrence (#2, #3…). */
function withRowKeys(rows) {
  const seen = new Map();
  return rows.map((r) => {
    const base = hash(r, 16);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { ...r, row_key: n === 1 ? base : `${base}#${n}` };
  });
}

const src = (s) => ({ source_file: str(s?.fichier), source_page: int(s?.page), source_edition: str(s?.edition) });

export function slimSources(meta) {
  return ((meta && meta.sources) || []).map((s) => ({
    id: str(s.id), file_name: str(s.fichier), title: str(s.titre), edition: str(s.edition),
    pages: int(s.pages), sort_key: str(s.date_tri),
  })).filter((s) => s.id && s.file_name);
}

export function slimChecklists(lists) {
  return (lists || []).map((l) => ({
    id: str(l.id), title: str(l.titre) ?? str(l.id), ...src(l.source),
    columns: (l.colonnes || []).map((c) => ({ code: str(c.echeance), name: str(c.nom_doc) })),
    footnotes: Array.isArray(l.notes_bas_de_page) ? l.notes_bas_de_page : [],
    note: str(l.note),
  })).filter((l) => l.id);
}

/** Ordre chronologique d'une source (meta.sources[].date_tri), par nom de fichier. */
export function sourceSortIndex(meta) {
  const m = new Map();
  for (const s of (meta && meta.sources) || []) if (s.fichier) m.set(s.fichier, str(s.date_tri));
  return m;
}

/**
 * plans.json + temps.json → { plans, warnings, counts } au format de maintenance_ingest.
 */
export function buildPlans(plansJson, tempsJson, corrections = PLAN_CORRECTIONS) {
  const warnings = [];
  const sortOf = sourceSortIndex(plansJson.meta);
  const checklistIds = new Set((plansJson.listes_controles || []).map((l) => l.id));
  const timesByKey = new Map();
  for (const t of (tempsJson && tempsJson.temps) || []) {
    const k = `${t.plan_id}|${t.echeance}`;
    if (!timesByKey.has(k)) timesByKey.set(k, []);
    timesByKey.get(k).push(t);
  }
  const usedTimeKeys = new Set();
  const counts = { plans: 0, services: 0, intervals: 0, intervalsCurrent: 0, operations: 0, times: 0, timesCurrent: 0 };

  const plans = (plansJson.plans || []).map((raw) => applyPlanCorrections(raw, corrections)).map((p) => {
    const where = `plan ${p.id}`;
    const files = new Set();
    const note = (s) => { if (s?.fichier) files.add(s.fichier); };
    const services = (p.echeances || []).map((e, idx) => {
      const k = `${p.id}|${e.code}`;
      usedTimeKeys.add(k);
      const intervals = withRowKeys((e.intervalles || []).map((i, j) => {
        note(i.source);
        return {
          km_first: int(i.km_premier), km_interval: int(i.km_intervalle), months: int(i.mois),
          first_reached: i.premier_atteint !== false, first_reached_origin: str(i.premier_atteint_origine),
          text: str(i.texte), years_doc: str(i.annees), km_column: int(i.km_colonne), deduced: str(i.deduit),
          ...src(i.source), source_sort: sortOf.get(i.source?.fichier) ?? null,
          status: mapStatus(i.statut, `${where}, intervalle ${e.code}`), replaced_by: str(i.remplace_par),
          same_value: bool(i.meme_valeur), sort: j,
        };
      }));
      const operations = withRowKeys((e.operations || []).map((o, j) => {
        note(o.source);
        return {
          n: int(o.n), text: str(o.texte) ?? '', periodicity_months: int(o.periodicite_mois),
          periodicity_deduced: str(o.periodicite_mois_deduit),
          parts_cited: (o.pieces_citees || []).map((x) => ({ designation: str(x.designation), reference: str(x.reference), quantity: num(x.quantite) })),
          remark: str(o.remarque), reference_mark: str(o.renvoi), ...src(o.source), sort: j,
        };
      }));
      const rawTimes = timesByKey.get(k) ?? [];
      if (rawTimes.length !== (e.temps || []).length) {
        warnings.push(`${where}, ${e.code} : ${rawTimes.length} temps dans temps.json, ${(e.temps || []).length} dans plans.json`);
      }
      const times = withRowKeys(rawTimes.map((t, j) => {
        note(t.source);
        return {
          model_doc: str(t.modele_doc ?? t.modele), years_doc: str(t.annees_doc), service_doc: str(t.echeance_doc),
          time_text: str(t.temps_texte), hours: num(t.heures), ut: int(t.ut), interval_doc: str(t.intervalle_doc),
          note: str(t.note), deduced: str(t.deduit), ...src(t.source), source_sort: sortOf.get(t.source?.fichier) ?? null,
          status: mapStatus(t.statut, `${where}, temps ${e.code}`), replaced_by: str(t.remplace_par),
          same_value: bool(t.meme_valeur), sort: j,
        };
      }));
      counts.services++;
      counts.intervals += intervals.length; counts.intervalsCurrent += intervals.filter((x) => x.status === 'en_vigueur').length;
      counts.operations += operations.length;
      counts.times += times.length; counts.timesCurrent += times.filter((x) => x.status === 'en_vigueur').length;
      return {
        code: str(e.code), name: str(e.nom) ?? str(e.code),
        doc_names: (e.noms_dans_les_documents || []).map(String), sort: idx,
        operations_note: str(e.operations_note), intervals, operations, times,
      };
    });
    let checklist = str(p.liste_controles_id);
    if (checklist && !checklistIds.has(checklist)) {
      warnings.push(`${where} : liste des contrôles ${checklist} absente de listes_controles (lien ignoré)`);
      checklist = null;
    }
    const body = {
      id: str(p.id), family: str(p.famille), model_text: str(p.modele),
      year_from: int(p.annees?.de), year_to: int(p.annees?.a), usage: mapUsage(p.usage, where),
      checklist_id: checklist, checklist_history: p.listes_controles_historique || [],
      variants: (p.variantes_citees || []).map(String), match_names: matchNames(p.modele, p.variantes_citees),
      notes: p.notes || [], own_interval_operations: p.operations_a_intervalle_propre || [],
      source_files: [...files].sort(), services,
    };
    if (!body.id || !body.family || !body.model_text) throw new Error(`Plan incomplet (${where})`);
    counts.plans++;
    return { ...body, content_hash: hash(body, 40) };
  });

  for (const k of timesByKey.keys()) if (!usedTimeKeys.has(k)) warnings.push(`temps.json : ${timesByKey.get(k).length} temps pour ${k}, échéance absente de plans.json (ignorés)`);
  return { plans, warnings, counts };
}

/** Découpe en paquets. */
export function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += Math.max(1, size)) out.push(list.slice(i, i + Math.max(1, size)));
  return out;
}

/** Littéral SQL sûr pour un texte (dollar-quoting avec une étiquette absente du texte). */
export function dollarQuote(s) {
  let tag = 'j';
  while (s.includes(`$${tag}$`)) tag += 'x';
  return `$${tag}$${s}$${tag}$`;
}
