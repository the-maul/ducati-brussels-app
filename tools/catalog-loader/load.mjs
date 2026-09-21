#!/usr/bin/env node
/**
 * Chargeur du catalogue Ducati (mission 06) : lit les fichiers catalogue-ducati-*.json produits
 * par l'extraction (Téléchargements de Simon) et les pousse en base par les fonctions d'import
 * idempotentes (upsert par id Ducati ; relancer ne crée pas de doublon).
 *
 * Usage (depuis le dossier du dépôt) :
 *   node tools/catalog-loader/load.mjs                      # dossier par défaut : %USERPROFILE%\Downloads
 *   node tools/catalog-loader/load.mjs --dir "D:\export"    # autre dossier
 *   node tools/catalog-loader/load.mjs --dry-run            # vérifie les fichiers, n'écrit rien
 *   node tools/catalog-loader/load.mjs --force              # recharge aussi les fichiers déjà chargés
 *   node tools/catalog-loader/load.mjs --stats              # affiche seulement ce qui est en base
 *   node tools/catalog-loader/load.mjs --sql out.sql [--rollback]
 *        # écrit le SQL au lieu d'appeler l'API (à passer avec npx supabase db query -f) ;
 *        # --rollback : tout est annulé à la fin (essai)
 *
 * Accès base (mode normal) : clé de service lue dans la variable d'environnement
 * SUPABASE_SERVICE_ROLE_KEY (sous Windows, aussi dans les variables « Utilisateur »). Elle n'est
 * jamais écrite ni affichée. URL : SUPABASE_URL, sinon le projet ujmrosbgkvgvwfnuryna.
 *
 * Journal : catalogue-ducati-chargement.json dans le même dossier (fichiers déjà chargés,
 * taille et date) ; un fichier inchangé n'est pas rechargé.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { classifyFiles, nestTree, slimGroupsFile, slimDrawingsFile, chunk, dollarQuote, isAlreadyLoaded } from './transform.mjs';

const args = process.argv.slice(2);
const flag = (k) => args.includes(k);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

const DIR = opt('--dir', join(homedir(), 'Downloads'));
const DRY = flag('--dry-run');
const FORCE = flag('--force');
const SQL_OUT = opt('--sql', null);
const ROLLBACK = flag('--rollback');
const DRAWINGS_PER_CALL = Number(opt('--chunk', 25));
const MODEL_YEARS_PER_CALL = Number(opt('--items', 20));
const LEDGER = join(DIR, 'catalogue-ducati-chargement.json');
const PROJECT_URL = 'https://ujmrosbgkvgvwfnuryna.supabase.co';

const log = (...m) => console.log(...m);
const readJson = (f) => JSON.parse(readFileSync(join(DIR, f), 'utf8').replace(/^\uFEFF/, ''));

function serviceKey() {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (process.platform === 'win32') {
    try {
      const v = execFileSync('powershell.exe', ['-NoProfile', '-Command', "[Environment]::GetEnvironmentVariable('SUPABASE_SERVICE_ROLE_KEY','User')"], { encoding: 'utf8' }).trim();
      if (v) return v;
    } catch { /* rien */ }
  }
  return null;
}

// ------------------------------------------------------------------ cibles : API ou fichier SQL
function apiTarget() {
  const key = serviceKey();
  if (!key) throw new Error('Clé de service absente : définir la variable SUPABASE_SERVICE_ROLE_KEY (elle ne sera pas affichée).');
  const url = (process.env.SUPABASE_URL || PROJECT_URL).replace(/\/$/, '');
  return {
    async call(fn, body) {
      for (let attempt = 0; ; attempt++) {
        const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
          method: 'POST',
          headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const text = await res.text();
        if (res.ok) return text ? JSON.parse(text) : null;
        if (res.status >= 500 && attempt < 2) { await new Promise((r) => setTimeout(r, 5000 * (attempt + 1))); continue; }
        let msg = text;
        try { const j = JSON.parse(text); msg = j.message || text; } catch { /* texte brut */ }
        throw new Error(`${fn} : HTTP ${res.status} — ${String(msg).slice(0, 400)}`);
      }
    },
    async finish() {},
  };
}

function sqlTarget(file) {
  const parts = [];
  const arg = (v) => (v === null || v === undefined ? 'null' : typeof v === 'object' ? dollarQuote(JSON.stringify(v)) + '::jsonb' : typeof v === 'boolean' ? String(v) : typeof v === 'number' ? String(v) : dollarQuote(String(v)));
  parts.push('begin;');
  parts.push(`select set_config('request.jwt.claims', '{"role":"service_role"}', true);`);
  parts.push('create temp table _loader(n serial, fn text, r jsonb);');
  parts.push('create temp table _loader_batch(id uuid);');
  return {
    async call(fn, body) {
      const entries = Object.entries(body);
      const params = entries.map(([k, v]) => (k === '_batch' ? `${k} => (select id from _loader_batch)` : `${k} => ${arg(v)}`)).join(', ');
      if (fn === 'ducati_catalog_batch_start_loader') {
        parts.push(`insert into _loader_batch select public.${fn}(${params});`);
        return '00000000-0000-0000-0000-000000000000';
      }
      parts.push(`insert into _loader(fn, r) select '${fn}', to_jsonb(public.${fn}(${params}));`);
      return {};
    },
    async finish() {
      if (ROLLBACK) {
        parts.push(`do $r$ begin raise exception 'RESULTATS %', (select jsonb_build_object('calls', (select jsonb_agg(jsonb_build_object('fn', fn, 'r', r) order by n) from _loader), 'stats', public.ducati_catalog_stats())); end $r$;`);
      } else {
        parts.push('commit;');
      }
      writeFileSync(file, parts.join('\n') + '\n', 'utf8');
      log(`SQL écrit : ${file}${ROLLBACK ? ' (annulé à la fin : essai)' : ''}`);
    },
  };
}

// ------------------------------------------------------------------ déroulé
async function main() {
  if (flag('--stats')) { log(`Catalogue en base : ${JSON.stringify(await apiTarget().call('ducati_catalog_stats', {}))}`); return; }
  if (!existsSync(DIR)) throw new Error(`Dossier introuvable : ${DIR}`);
  const files = classifyFiles(readdirSync(DIR));
  const ledger = existsSync(LEDGER) && !SQL_OUT ? JSON.parse(readFileSync(LEDGER, 'utf8')) : {};
  const todo = (name) => FORCE || SQL_OUT || !isAlreadyLoaded(ledger, name, statSync(join(DIR, name)));

  log(`Dossier : ${DIR}`);
  log(`Fichiers : arbre ${files.tree ? 'oui' : 'NON'} · ${files.groups.length} fichier(s) groupes · ${files.drawings.length} fichier(s) planches`);
  if (files.other.length) log(`Non traités ici (format à venir) : ${files.other.join(', ')}`);
  if (!files.tree && !files.groups.length && !files.drawings.length) { log('Rien à charger.'); return; }

  // Lecture + contrôle de tous les fichiers à charger (avant toute écriture)
  let nested = null;
  if (files.tree && todo(files.tree)) {
    const r = nestTree(readJson(files.tree));
    nested = r.tree;
    log(`Arbre : ${r.counts.families} familles, ${r.counts.superModels} cylindrées, ${r.counts.models} modèles, ${r.counts.modelYears} modèles-années`);
    r.warnings.slice(0, 20).forEach((w) => log('  ! ' + w));
    if (r.warnings.length > 20) log(`  ! … ${r.warnings.length - 20} autre(s) avertissement(s)`);
  }
  const groupFiles = files.groups.filter(todo);
  const drawingFiles = files.drawings.filter(todo);
  let nGroups = 0, nDrawings = 0, nLines = 0;
  for (const f of groupFiles) nGroups += slimGroupsFile(readJson(f)).length;
  for (const f of drawingFiles) { const d = slimDrawingsFile(readJson(f)); nDrawings += d.length; nLines += d.reduce((a, x) => a + x.parts.length, 0); }
  log(`À charger : ${nGroups} modèles-années (groupes) dans ${groupFiles.length} fichier(s), ${nDrawings} planches / ${nLines} lignes dans ${drawingFiles.length} fichier(s)`);
  const skipped = files.groups.length - groupFiles.length + files.drawings.length - drawingFiles.length + (files.tree && !nested ? 1 : 0);
  if (skipped) log(`Déjà chargés (inchangés) : ${skipped} fichier(s) — --force pour les recharger`);
  if (DRY) { log('Essai à blanc : rien n’a été écrit.'); return; }
  if (!nested && !groupFiles.length && !drawingFiles.length) { log('Tout est déjà chargé.'); return; }

  const target = SQL_OUT ? sqlTarget(SQL_OUT) : apiTarget();
  const batchId = await target.call('ducati_catalog_batch_start_loader', {
    _scope: { europe: true, minYear: 2000, files: [files.tree, ...groupFiles, ...drawingFiles].filter(Boolean) },
    _model_years_total: nGroups,
  });
  const markLoaded = (name) => {
    if (SQL_OUT) return;
    const st = statSync(join(DIR, name));
    ledger[name] = { size: st.size, mtimeMs: st.mtimeMs, loadedAt: new Date().toISOString(), batchId };
    writeFileSync(LEDGER, JSON.stringify(ledger, null, 2), 'utf8');
  };

  try {
    if (nested) {
      const r = await target.call('ducati_catalog_ingest_tree', { _batch: batchId, _tree: nested });
      if (!SQL_OUT) log(`Arbre chargé : ${JSON.stringify(r)}`);
      markLoaded(files.tree);
    }
    for (const f of groupFiles) {
      const items = slimGroupsFile(readJson(f));
      const unknown = [];
      for (const part of chunk(items, MODEL_YEARS_PER_CALL)) {
        const r = await target.call('ducati_catalog_ingest_model_years', { _batch: batchId, _items: part });
        if (r && r.unknownModelYears) unknown.push(...r.unknownModelYears);
      }
      log(`${f} : ${items.length} modèles-années${unknown.length ? ` (${unknown.length} absents de l'arbre, ignorés : ${unknown.slice(0, 5).join(', ')}${unknown.length > 5 ? '…' : ''})` : ''}`);
      // un fichier avec des modèles-années inconnus n'est pas noté « chargé » : il sera repris
      // au prochain passage (par ex. après un arbre complété)
      if (!unknown.length) markLoaded(f);
    }
    for (const f of drawingFiles) {
      const list = slimDrawingsFile(readJson(f));
      let done = 0;
      for (const part of chunk(list, DRAWINGS_PER_CALL)) {
        await target.call('ducati_catalog_ingest_drawings', { _batch: batchId, _model_year_id: null, _drawings: part, _complete: false });
        done += part.length;
        if (!SQL_OUT) process.stdout.write(`\r${f} : ${done} / ${list.length} planches`);
      }
      if (!SQL_OUT) process.stdout.write('\n'); else log(`${f} : ${list.length} planches`);
      markLoaded(f);
    }
    const c = await target.call('ducati_catalog_refresh_completeness', { _batch: batchId });
    if (!SQL_OUT) log(`Modèles-années complets : ${JSON.stringify(c)}`);
    await target.call('ducati_catalog_batch_progress', { _batch: batchId, _status: 'done', _position: { files: 'all' } });
    if (!SQL_OUT) log(`Catalogue en base : ${JSON.stringify(await target.call('ducati_catalog_stats', {}))}`);
  } catch (e) {
    if (!SQL_OUT) await target.call('ducati_catalog_batch_progress', { _batch: batchId, _status: 'error', _error: String(e.message || e).slice(0, 1500) }).catch(() => {});
    throw e;
  } finally {
    await target.finish();
  }
  log('Terminé.');
}

main().catch((e) => { console.error('ERREUR : ' + (e && e.message ? e.message : e)); process.exit(1); });
