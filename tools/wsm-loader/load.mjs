#!/usr/bin/env node
/**
 * Mission 07, carte 3 — chargeur des manuels d'atelier Ducati.
 *
 * Lit l'extraction locale (entretien\*, parcours\*) en flux, fichier par fichier, et la pousse en
 * base par les fonctions idempotentes wsm_ingest_procedures / wsm_ingest_manuals /
 * wsm_ingest_images. Relançable à volonté : un modèle-année ou une procédure dont l'empreinte n'a
 * pas changé n'est pas réécrit, aucune ligne n'est dupliquée.
 *
 * Ordre imposé : les procédures d'abord (elles sont dédupliquées et partagées), les modèles-années
 * ensuite (leurs usages pointent vers les procédures).
 *
 * TROIS GARDE-FOUS, appris du chargement raté du 23/09 :
 *   1. PostgREST coupe toute requête à 8 s (`statement_timeout` du rôle `authenticator`, même avec
 *      la clé de service). Les lots sont donc bornés en NOMBRE, en OCTETS et en ÉTAPES, et un lot
 *      trop lent est automatiquement COUPÉ EN DEUX puis réessayé (jusqu'à l'unité).
 *   2. Chaque requête a un délai de 60 s, 4 réessais avec attente doublée, et une erreur complète
 *      (statut HTTP + corps + code réseau) — plus de « fetch failed » sec.
 *   3. Un JOURNAL sur disque retient ce qui est confirmé écrit : une relance après coupure
 *      reprend où elle s'était arrêtée au lieu de tout renvoyer.
 *
 * Usage (depuis le dossier du dépôt) :
 *   node tools/wsm-loader/load.mjs --dry-run         # compte tout, n'écrit rien  <- à faire d'abord
 *   node tools/wsm-loader/load.mjs                   # dossier par défaut : ..\manuels-extraits
 *   node tools/wsm-loader/load.mjs --dir "D:\x"      # autre dossier
 *   node tools/wsm-loader/load.mjs --only procedures # ou --only manuals, --only images
 *   node tools/wsm-loader/load.mjs --force           # réécrit aussi ce qui n'a pas changé
 *   node tools/wsm-loader/load.mjs --reset-journal   # oublie le journal et renvoie tout
 *   node tools/wsm-loader/load.mjs --stats           # affiche seulement ce qui est en base
 *   node tools/wsm-loader/load.mjs --links --company <uuid>   # rattachements au catalogue
 *   node tools/wsm-loader/load.mjs --limit 20        # n'envoie que les 20 premiers (essai réel)
 *
 * Accès base : clé de service lue dans SUPABASE_SERVICE_ROLE_KEY (sous Windows, aussi dans les
 * variables « Utilisateur »). Elle n'est jamais écrite ni affichée. URL : SUPABASE_URL, sinon le
 * projet ujmrosbgkvgvwfnuryna.
 */
import { readFileSync, writeFileSync, existsSync, statSync, renameSync } from 'node:fs';
import { join, relative } from 'node:path';
import { homedir } from 'node:os';
import { buildManual, buildProcedure, procedureImages, chunk } from './transform.mjs';
import { rpc, select } from './env.mjs';

const args = process.argv.slice(2);
const flag = (k) => args.includes(k);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

const DIR = opt('--dir', join(homedir(), 'Desktop', 'ducati', 'manuels-extraits'));
const DRY = flag('--dry-run');
const FORCE = flag('--force');
const ONLY = opt('--only', null);
const LIMIT = Number(opt('--limit', 0)) || 0;
const NO_JOURNAL = flag('--no-journal');
const RESET_JOURNAL = flag('--reset-journal');

// Bornes d'un appel : assez petites pour rester loin des 8 s, assez grandes pour ne pas faire
// 3 336 allers-retours. Mesurées sur les vrais fichiers le 23/09.
const MAX_PROCEDURES = Number(opt('--chunk-procedures', 12));
const MAX_STEPS = Number(opt('--max-steps', 300));
const MAX_MANUALS = Number(opt('--chunk-manuals', 2));
const MAX_BYTES = Number(opt('--max-bytes', 600_000));
const IMG_PER_CALL = Number(opt('--chunk-images', 1000));

const log = (...m) => console.log(...m);
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));
const fmt = (n) => Number(n).toLocaleString('fr-BE');
const bytesOf = (v) => Buffer.byteLength(JSON.stringify(v));

// ---------------------------------------------------------------------
// Journal de reprise : ce qui est confirmé écrit, par empreinte de contenu.
// Il vit à côté de l'extraction (hors du dépôt), comme les données qu'il décrit.
// ---------------------------------------------------------------------
const JOURNAL = join(DIR, '.wsm-loader-journal.json');
let journal = { version: 1, procedures: {}, manuals: {}, images: {} };

function loadJournal() {
  if (NO_JOURNAL || RESET_JOURNAL || !existsSync(JOURNAL)) return;
  try {
    const j = readJson(JOURNAL);
    if (j && j.version === 1) journal = { version: 1, procedures: j.procedures || {}, manuals: j.manuals || {}, images: j.images || {} };
    const n = Object.keys(journal.procedures).length + Object.keys(journal.manuals).length;
    if (n) log(`Journal de reprise : ${fmt(n)} élément(s) déjà confirmés (--reset-journal pour tout renvoyer).`);
  } catch (e) {
    log(`Journal illisible, ignoré : ${e.message}`);
  }
}

let journalDirty = false;
function markDone(kind, items) {
  if (NO_JOURNAL) return;
  for (const it of items) journal[kind][it.id] = it.content_hash;
  journalDirty = true;
}
function saveJournal() {
  if (NO_JOURNAL || !journalDirty) return;
  try {
    writeFileSync(JOURNAL + '.tmp', JSON.stringify(journal), 'utf8');
    renameSync(JOURNAL + '.tmp', JOURNAL);
    journalDirty = false;
  } catch (e) {
    log(`! Journal non enregistré : ${e.message}`);
  }
}
/** Déjà confirmé écrit, à l'identique ? (le --force passe outre) */
const alreadyDone = (kind, it) => !FORCE && !NO_JOURNAL && journal[kind][it.id] === it.content_hash;

/**
 * Le journal le plus fiable, c'est la base elle-même : on relit les empreintes déjà écrites et on
 * les fusionne dans le journal local. Un chargement coupé en plein vol reprend donc exactement là
 * où il en était, même si le fichier de journal a été perdu.
 */
async function syncJournalFromDb() {
  if (NO_JOURNAL || RESET_JOURNAL || FORCE) return;
  for (const [kind, table] of [['procedures', 'wsm_procedures'], ['manuals', 'wsm_manuals']]) {
    let from = 0, got = 0;
    for (;;) {
      const rows = await select(`${table}?select=id,content_hash&order=id&limit=1000&offset=${from}`);
      for (const r of rows) journal[kind][r.id] = r.content_hash;
      got += rows.length;
      if (rows.length < 1000) break;
      from += 1000;
    }
    if (got) log(`Déjà en base : ${fmt(got)} ${kind === 'procedures' ? 'procédures' : 'modèles-années'} (empreintes relues).`);
  }
  journalDirty = true;
  saveJournal();
}

// ---------------------------------------------------------------------
// Envoi d'un lot, coupé en deux tant que la base le trouve trop long.
// ---------------------------------------------------------------------
/** Additionne les compteurs renvoyés par une fonction d'ingestion. */
function add(total, r) {
  if (!r) return total;
  for (const [k, v] of Object.entries(r)) if (typeof v === 'number') total[k] = (total[k] || 0) + v;
  return total;
}

async function sendBatch(fn, key, items, total, kind) {
  if (!items.length) return;
  try {
    add(total, await rpc(fn, { _payload: { run: RUN, [key]: items }, _force: FORCE }));
    markDone(kind, items);
    saveJournal();
    return;
  } catch (e) {
    if (!e.tooSlow || items.length === 1) {
      // Un seul élément et toujours trop long : on le nomme, il faudra le regarder de près.
      if (items.length === 1) console.error(`\n! ${kind} « ${items[0].id} » refusé : ${e.message}`);
      throw e;
    }
    const half = Math.ceil(items.length / 2);
    process.stdout.write(`\r  lot trop long (${items.length}) -> coupé en deux            \n`);
    await sendBatch(fn, key, items.slice(0, half), total, kind);
    await sendBatch(fn, key, items.slice(half), total, kind);
  }
}

/** Le lot courant est-il plein ? (nombre, octets, étapes) */
function batchFull(batch, bytes, steps, maxCount, maxSteps) {
  return batch.length >= maxCount || bytes >= MAX_BYTES || steps >= maxSteps;
}

const RUN = `wsm-${new Date().toISOString()}`;

// ---------------------------------------------------------------------
// Lecture en flux : un fichier à la fois, jamais tout en mémoire.
// ---------------------------------------------------------------------
function* readProcedures(dir, images) {
  const index = readJson(join(dir, 'parcours', 'index.json'));
  for (const e of index) {
    const j = readJson(join(dir, 'parcours', `${e.id}.json`));
    if (images) for (const [path, kind] of procedureImages(j)) {
      const cur = images.get(path);
      if (cur) cur.used_count += 1; else images.set(path, { path, kind, used_count: 1 });
    }
    yield buildProcedure(j);
  }
}

/**
 * Un manuel par FICHIER, pas par entrée d'index : Ducati publie parfois un seul manuel pour deux
 * versions (Monster 797 et 797 +, Monster 937 et 937 +), et l'index liste alors 469 modèles-années
 * pour 461 fichiers. Le manuel est chargé une fois, avec la liste des modèles-années qu'il couvre.
 */
function* readManuals(dir) {
  const index = readJson(join(dir, 'entretien', 'index.json'));
  const byFile = new Map();
  for (const e of index.modelesAnnees) {
    if (!byFile.has(e.fichier)) byFile.set(e.fichier, []);
    byFile.get(e.fichier).push(String(e.myId));
  }
  for (const [fichier, coversModelYearIds] of byFile) {
    const file = join(dir, fichier);
    const j = readJson(file);
    yield buildManual(j, {
      sourceFile: relative(dir, file).replace(/\\/g, '/'),
      extractedAt: index.genereLe,
      coversModelYearIds,
    });
  }
}

// ---------------------------------------------------------------------
async function main() {
  if (flag('--stats')) { log(JSON.stringify(await rpc('wsm_stats', {}), null, 1)); return; }
  if (flag('--links')) {
    const company = opt('--company', null);
    if (!company) throw new Error('--links demande --company <uuid de la société>');
    log(JSON.stringify(await rpc('wsm_propose_catalog_links', { _company: company }), null, 1));
    return;
  }

  for (const f of [join('entretien', 'index.json'), join('parcours', 'index.json')]) {
    if (!existsSync(join(DIR, f))) throw new Error(`Fichier introuvable : ${join(DIR, f)}`);
  }
  log(`Dossier : ${DIR}`);
  if (!DRY) { loadJournal(); await syncJournalFromDb(); }
  const doProc = !ONLY || ONLY === 'procedures';
  const doMan = !ONLY || ONLY === 'manuals';
  const doImg = !ONLY || ONLY === 'images';
  const images = doImg ? new Map() : null;

  // 1) Procédures dédupliquées
  if (doProc || doImg) {
    const total = {};
    let n = 0, steps = 0, torques = 0, skipped = 0;
    let batch = [], bBytes = 0, bSteps = 0;
    const t0 = Date.now();
    for (const p of readProcedures(DIR, images)) {
      n += 1; steps += p.steps_count; torques += p.torques.length;
      if (LIMIT && n > LIMIT) break;
      if (!doProc) continue;
      if (alreadyDone('procedures', p)) { skipped += 1; continue; }
      batch.push(p); bBytes += bytesOf(p); bSteps += p.steps_count;
      if (batchFull(batch, bBytes, bSteps, MAX_PROCEDURES, MAX_STEPS)) {
        if (!DRY) await sendBatch('wsm_ingest_procedures', 'procedures', batch, total, 'procedures');
        batch = []; bBytes = 0; bSteps = 0;
        process.stdout.write(`\rProcédures : ${fmt(n)}          `);
      }
    }
    if (batch.length && doProc && !DRY) await sendBatch('wsm_ingest_procedures', 'procedures', batch, total, 'procedures');
    process.stdout.write('\r                                        \r');
    log(`Procédures : ${fmt(n)} · étapes : ${fmt(steps)} · couples : ${fmt(torques)} · lu en ${Math.round((Date.now() - t0) / 1000)} s`);
    if (skipped) log(`  ${fmt(skipped)} déjà confirmées par le journal, non renvoyées`);
    if (doProc && !DRY) log(`  -> ${JSON.stringify(total)}`);
  }

  // 2) Modèles-années
  if (doMan) {
    const total = {};
    const c = { manuals: 0, services: 0, operations: 0, usages: 0, serviceProcedures: 0, torqueTables: 0,
      torqueLines: 0, toolSets: 0, tools: 0, fluidTables: 0, fluidLines: 0, productTables: 0, products: 0, times: 0, gaps: 0 };
    let skipped = 0, batch = [], bBytes = 0;
    const t0 = Date.now();
    for (const m of readManuals(DIR)) {
      c.manuals += 1;
      c.services += m.services.length; c.operations += m.operations.length; c.usages += m.usages.length;
      c.serviceProcedures += m.service_procedures.length;
      c.torqueTables += m.torque_tables.length; c.torqueLines += m.torque_tables.reduce((s, t) => s + t.lines.length, 0);
      c.toolSets += m.tool_sets.length; c.tools += m.tool_sets.reduce((s, t) => s + t.tools.length, 0);
      c.fluidTables += m.fluid_tables.length; c.fluidLines += m.fluid_tables.reduce((s, t) => s + t.lines.length, 0);
      c.productTables += m.product_tables.length; c.products += m.product_tables.reduce((s, t) => s + t.products.length, 0);
      c.times += m.times.length; c.gaps += m.gaps.length;
      if (LIMIT && c.manuals > LIMIT) break;
      if (alreadyDone('manuals', m)) { skipped += 1; continue; }
      batch.push(m); bBytes += bytesOf(m);
      if (batchFull(batch, bBytes, 0, MAX_MANUALS, Infinity)) {
        if (!DRY) await sendBatch('wsm_ingest_manuals', 'manuals', batch, total, 'manuals');
        batch = []; bBytes = 0;
        process.stdout.write(`\rModèles-années : ${fmt(c.manuals)}          `);
      }
    }
    if (batch.length && !DRY) await sendBatch('wsm_ingest_manuals', 'manuals', batch, total, 'manuals');
    process.stdout.write('\r                                        \r');
    log(`Modèles-années : ${fmt(c.manuals)} · échéances : ${fmt(c.services)} · opérations : ${fmt(c.operations)}`);
    log(`  usages de procédures : ${fmt(c.usages)} · procédures par échéance : ${fmt(c.serviceProcedures)} · temps (UT) : ${fmt(c.times)}`);
    log(`  couples généraux : ${fmt(c.torqueTables)} tableaux / ${fmt(c.torqueLines)} lignes · outils : ${fmt(c.toolSets)} jeux / ${fmt(c.tools)} lignes`);
    log(`  ravitaillements : ${fmt(c.fluidTables)} tableaux / ${fmt(c.fluidLines)} lignes · produits : ${fmt(c.productTables)} tableaux / ${fmt(c.products)} lignes`);
    if (c.gaps) log(`  ! ${fmt(c.gaps)} manque(s) signalé(s) par l'extraction (colonne gaps)`);
    if (skipped) log(`  ${fmt(skipped)} déjà confirmés par le journal, non renvoyés`);
    log(`  lu en ${Math.round((Date.now() - t0) / 1000)} s`);
    if (!DRY) log(`  -> ${JSON.stringify(total)}`);
  }

  // 3) Inventaire des images (les fichiers partent séparément : tools/wsm-loader/images.mjs)
  if (doImg && images) {
    const list = [...images.values()];
    let bytes = 0, missing = 0;
    for (const im of list) {
      try { bytes += statSync(join(DIR, im.path)).size; } catch { missing += 1; }
    }
    const figures = list.filter((i) => i.kind === 'figure').length;
    log(`Images citées par les procédures : ${fmt(list.length)} (${fmt(figures)} figures, ${fmt(list.length - figures)} miniatures)`
      + ` · ${(bytes / 1024 ** 3).toFixed(2)} Go` + (missing ? ` · ${fmt(missing)} fichier(s) absent(s)` : ''));
    if (!DRY) {
      const total = {};
      for (const part of chunk(list, IMG_PER_CALL)) add(total, await rpc('wsm_ingest_images', { _payload: { run: RUN, images: part } }));
      log(`  -> ${JSON.stringify(total)}`);
    }
  }

  if (DRY) log('\nEssai à blanc : rien n’a été écrit.');
  else log('\nTerminé. Rattachements au catalogue : relancer avec --links --company <uuid>.');
}

main().catch((e) => {
  saveJournal();
  console.error('\nERREUR : ' + (e && e.message ? e.message : e));
  if (e && e.stack && process.env.WSM_DEBUG) console.error(e.stack);
  console.error('Relancer la même commande : le journal reprend où le chargement s’est arrêté.');
  process.exit(1);
});
