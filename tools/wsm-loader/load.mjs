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
 * Usage (depuis le dossier du dépôt) :
 *   node tools/wsm-loader/load.mjs --dry-run         # compte tout, n'écrit rien  <- à faire d'abord
 *   node tools/wsm-loader/load.mjs                   # dossier par défaut : ..\manuels-extraits
 *   node tools/wsm-loader/load.mjs --dir "D:\x"      # autre dossier
 *   node tools/wsm-loader/load.mjs --only procedures # ou --only manuals, --only images
 *   node tools/wsm-loader/load.mjs --force           # réécrit aussi ce qui n'a pas changé
 *   node tools/wsm-loader/load.mjs --stats           # affiche seulement ce qui est en base
 *   node tools/wsm-loader/load.mjs --links           # propose les rattachements au catalogue
 *   node tools/wsm-loader/load.mjs --limit 20        # n'envoie que les 20 premiers (essai réel)
 *
 * Accès base : clé de service lue dans SUPABASE_SERVICE_ROLE_KEY (sous Windows, aussi dans les
 * variables « Utilisateur »). Elle n'est jamais écrite ni affichée. URL : SUPABASE_URL, sinon le
 * projet ujmrosbgkvgvwfnuryna.
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { homedir } from 'node:os';
import { buildManual, buildProcedure, procedureImages, chunk } from './transform.mjs';
import { rpc } from './env.mjs';

const args = process.argv.slice(2);
const flag = (k) => args.includes(k);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

const DIR = opt('--dir', join(homedir(), 'Desktop', 'ducati', 'manuels-extraits'));
const DRY = flag('--dry-run');
const FORCE = flag('--force');
const ONLY = opt('--only', null);
const LIMIT = Number(opt('--limit', 0)) || 0;
const PROC_PER_CALL = Number(opt('--chunk-procedures', 25));
const MAN_PER_CALL = Number(opt('--chunk-manuals', 3));
const IMG_PER_CALL = Number(opt('--chunk-images', 2000));

const log = (...m) => console.log(...m);
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));
const fmt = (n) => Number(n).toLocaleString('fr-BE');

/** Additionne les compteurs renvoyés par une fonction d'ingestion. */
function add(total, r) {
  if (!r) return total;
  for (const [k, v] of Object.entries(r)) if (typeof v === 'number') total[k] = (total[k] || 0) + v;
  return total;
}

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

function* readManuals(dir) {
  const index = readJson(join(dir, 'entretien', 'index.json'));
  for (const e of index.modelesAnnees) {
    const file = join(dir, e.fichier);
    const j = readJson(file);
    yield buildManual(j, { sourceFile: relative(dir, file).replace(/\\/g, '/'), extractedAt: index.genereLe });
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
  const run = `wsm-${new Date().toISOString()}`;
  const doProc = !ONLY || ONLY === 'procedures';
  const doMan = !ONLY || ONLY === 'manuals';
  const doImg = !ONLY || ONLY === 'images';
  const images = doImg ? new Map() : null;

  // 1) Procédures dédupliquées
  if (doProc || doImg) {
    const total = {};
    let n = 0, steps = 0, torques = 0, batch = [];
    const t0 = Date.now();
    for (const p of readProcedures(DIR, images)) {
      n += 1; steps += p.steps_count; torques += p.torques.length;
      if (LIMIT && n > LIMIT) break;
      if (!doProc) continue;
      batch.push(p);
      if (batch.length >= PROC_PER_CALL) {
        if (!DRY) add(total, await rpc('wsm_ingest_procedures', { _payload: { run, procedures: batch }, _force: FORCE }));
        batch = [];
        process.stdout.write(`\rProcédures : ${fmt(n)}`);
      }
    }
    if (batch.length && doProc && !DRY) add(total, await rpc('wsm_ingest_procedures', { _payload: { run, procedures: batch }, _force: FORCE }));
    process.stdout.write('\r');
    log(`Procédures : ${fmt(n)} · étapes : ${fmt(steps)} · couples : ${fmt(torques)} · lu en ${Math.round((Date.now() - t0) / 1000)} s`);
    if (doProc && !DRY) log(`  -> ${JSON.stringify(total)}`);
  }

  // 2) Modèles-années
  if (doMan) {
    const total = {};
    const c = { manuals: 0, services: 0, operations: 0, usages: 0, serviceProcedures: 0, torqueTables: 0,
      torqueLines: 0, toolSets: 0, tools: 0, fluidTables: 0, fluidLines: 0, productTables: 0, products: 0, times: 0, gaps: 0 };
    let batch = [];
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
      batch.push(m);
      if (batch.length >= MAN_PER_CALL) {
        if (!DRY) add(total, await rpc('wsm_ingest_manuals', { _payload: { run, manuals: batch }, _force: FORCE }));
        batch = [];
        process.stdout.write(`\rModèles-années : ${fmt(c.manuals)}`);
      }
    }
    if (batch.length && !DRY) add(total, await rpc('wsm_ingest_manuals', { _payload: { run, manuals: batch }, _force: FORCE }));
    process.stdout.write('\r');
    log(`Modèles-années : ${fmt(c.manuals)} · échéances : ${fmt(c.services)} · opérations : ${fmt(c.operations)}`);
    log(`  usages de procédures : ${fmt(c.usages)} · procédures par échéance : ${fmt(c.serviceProcedures)} · temps (UT) : ${fmt(c.times)}`);
    log(`  couples généraux : ${fmt(c.torqueTables)} tableaux / ${fmt(c.torqueLines)} lignes · outils : ${fmt(c.toolSets)} jeux / ${fmt(c.tools)} lignes`);
    log(`  ravitaillements : ${fmt(c.fluidTables)} tableaux / ${fmt(c.fluidLines)} lignes · produits : ${fmt(c.productTables)} tableaux / ${fmt(c.products)} lignes`);
    if (c.gaps) log(`  ! ${fmt(c.gaps)} manque(s) signalé(s) par l'extraction (colonne gaps)`);
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
      for (const part of chunk(list, IMG_PER_CALL)) add(total, await rpc('wsm_ingest_images', { _payload: { run, images: part } }));
      log(`  -> ${JSON.stringify(total)}`);
    }
  }

  if (DRY) log('\nEssai à blanc : rien n’a été écrit.');
  else log('\nTerminé. Rattachements au catalogue : relancer avec --links --company <uuid>.');
}

main().catch((e) => { console.error('ERREUR : ' + (e && e.message ? e.message : e)); process.exit(1); });
