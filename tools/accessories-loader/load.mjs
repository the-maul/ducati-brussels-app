#!/usr/bin/env node
/**
 * Chargeur des catalogues ACCESSOIRES et VÊTEMENTS Ducati (mission 06, carte 7 ; décision M-25 « un seul catalogue »).
 *
 * 1. lit catalogue-ducati-accessoires.json et catalogue-ducati-vetements.json (Téléchargements de Simon),
 *    avec leur « …-arbre.json » (catégories, genres, familles, motos compatibles) ;
 * 2. les pousse dans le catalogue Ducati (ducati_catalog_ingest_products : upsert, relançable) ;
 * 3. crée les articles du DMS manquants (article_links_create_missing, portée « ducati_products ») ;
 * 4. complète les articles déjà créés (taille, couleur, version, note : ducati_products_repair_designations) ;
 * 5. relance le rapprochement (les articles du site reçoivent leur référence Ducati : badge « Ducati »).
 *
 * CHAQUE APPEL DOIT TENIR SOUS 8 SECONDES : PostgREST se connecte avec le rôle `authenticator`
 * (statement_timeout = 8 s), même avec la clé de service. Tout passe donc par petits lots, en boucle
 * jusqu'à épuisement, avec reprise : un lot déjà passé n'est pas refait (journal à côté des fichiers).
 *
 * Usage (depuis le dossier du dépôt) :
 *   node tools/accessories-loader/load.mjs --dry-run       # lit, résume, interroge la base ; n'écrit rien
 *   node tools/accessories-loader/load.mjs                 # charge, crée, complète, rapproche
 *   node tools/accessories-loader/load.mjs --dir "D:\export" --chunk 15 --no-articles --force
 *
 * Accès base : SUPABASE_SERVICE_ROLE_KEY (variable d'environnement ou variable « Utilisateur » Windows),
 * jamais affichée. URL : SUPABASE_URL, sinon le projet ujmrosbgkvgvwfnuryna.
 * Prix : HT = « price », TTC = « priceWithVAT » / « vatPrice » de l'e-catalog (rapport 1,21 vérifié).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { toProducts, treeIndex, apparelIndex } from './transform.mjs';

// Règle Europe du catalogue (décision M-15), la même que l'extension et les pièces.
const { isEuropeModel } = createRequire(import.meta.url)('../myducati-extension/catalog-core.js');

const args = process.argv.slice(2);
const flag = (k) => args.includes(k);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

const DIR = opt('--dir', join(homedir(), 'Downloads'));
const DRY = flag('--dry-run');
const FORCE = flag('--force');
const CHUNK = Math.max(1, Number(opt('--chunk', 25)));        // produits par appel d'import
const LOT_ARTICLES = Math.max(1, Number(opt('--lot', 300)));  // articles créés par appel
const LOT_DETAILS = Math.max(1, Number(opt('--lot-details', 500)));
const TIMEOUT_MS = Math.max(5000, Number(opt('--timeout', 60000)));
const RETRIES = Math.max(0, Number(opt('--retries', 4)));
const FILES = [
  { file: 'catalogue-ducati-accessoires.json', tree: 'catalogue-ducati-accessoires-arbre.json', kind: 'accessory' },
  { file: 'catalogue-ducati-vetements.json', tree: 'catalogue-ducati-vetements-arbre.json', kind: 'apparel' },
];
const LEDGER = join(DIR, 'catalogue-ducati-produits-chargement.json');
const PROJECT_URL = 'https://ujmrosbgkvgvwfnuryna.supabase.co';
const log = (...m) => console.log(...m);
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const secs = (t0) => ((Date.now() - t0) / 1000).toFixed(1) + ' s';

function serviceKey() {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return process.env.SUPABASE_SERVICE_ROLE_KEY.trim();
  if (process.platform === 'win32') {
    try {
      const v = execFileSync('powershell.exe', ['-NoProfile', '-Command', "[Environment]::GetEnvironmentVariable('SUPABASE_SERVICE_ROLE_KEY','User')"], { encoding: 'utf8' }).trim();
      if (v) return v;
    } catch { /* rien */ }
  }
  return null;
}

/** Détail lisible d'une erreur réseau (« fetch failed » ne dit rien tout seul). */
function netDetail(e) {
  const c = e?.cause;
  const parts = [e?.name, e?.message, c?.code, c?.message, c?.errno && `errno ${c.errno}`].filter(Boolean);
  return [...new Set(parts)].join(' · ');
}

function api() {
  const key = serviceKey();
  if (!key) throw new Error('Clé de service absente : définir SUPABASE_SERVICE_ROLE_KEY (elle ne sera pas affichée).');
  const url = (process.env.SUPABASE_URL || PROJECT_URL).replace(/\/$/, '');
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

  /** Un appel = un lot, avec délai maximum, réessais et message d'erreur complet (statut + corps). */
  async function call(path, init, label) {
    let last = null;
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(new Error(`délai dépassé (${TIMEOUT_MS} ms)`)), TIMEOUT_MS);
      try {
        const res = await fetch(`${url}${path}`, { ...init, headers, signal: ac.signal });
        const text = await res.text();
        if (res.ok) return text ? JSON.parse(text) : null;
        const body = text.slice(0, 500);
        const retryable = res.status >= 500 || res.status === 429 || /57014|timeout|deadlock/i.test(body);
        last = new Error(`${label} : HTTP ${res.status} ${res.statusText} — ${body}`);
        if (!retryable) throw last;
      } catch (e) {
        if (e === last) throw e;
        last = new Error(`${label} : ${netDetail(e)}`);
      } finally {
        clearTimeout(timer);
      }
      if (attempt < RETRIES) {
        const wait = 2000 * 2 ** attempt;
        log(`    ! ${last.message}`);
        log(`    nouvelle tentative dans ${wait / 1000} s (${attempt + 1}/${RETRIES})`);
        await sleep(wait);
      }
    }
    throw last;
  }

  return {
    rpc: (fn, body) => call(`/rest/v1/rpc/${fn}`, { method: 'POST', body: JSON.stringify(body) }, fn),
    companies: () => call('/rest/v1/companies?select=id,name', { method: 'GET' }, 'companies'),
  };
}

/** Journal de reprise : produits déjà importés, par fichier. */
function loadLedger() {
  if (!existsSync(LEDGER) || FORCE) return {};
  try { return readJson(LEDGER); } catch { return {}; }
}
function saveLedger(l) {
  try { writeFileSync(LEDGER, JSON.stringify(l, null, 1)); } catch (e) { log(`  (journal non écrit : ${e.message})`); }
}

/** Découpe en lots : au plus CHUNK produits et 1 Mo par appel (PostgREST + 8 s). */
function chunks(products) {
  const out = [];
  let cur = [], size = 0;
  for (const p of products) {
    const s = JSON.stringify(p).length;
    if (cur.length && (cur.length >= CHUNK || size + s > 1_000_000)) { out.push(cur); cur = []; size = 0; }
    cur.push(p); size += s;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Appelle une fonction par lots jusqu'à ce qu'elle ne rende plus rien (chaque appel sous 8 s). */
async function loop(db, fn, body, field, label, limitKey = '_limit', limit = LOT_ARTICLES) {
  let total = 0;
  for (let i = 0; i < 500; i++) {
    const t0 = Date.now();
    const r = await db.rpc(fn, { ...body, [limitKey]: limit });
    const n = Number(r?.[field] ?? 0);
    total += n;
    if (!n) break;
    log(`    ${label} : ${total} (lot de ${n} en ${secs(t0)})`);
  }
  return total;
}

async function main() {
  const loaded = [];
  for (const f of FILES) {
    const path = join(DIR, f.file);
    if (!existsSync(path)) { log(`- ${f.file} : absent (ignoré)`); continue; }
    const treePath = join(DIR, f.tree);
    const raw = existsSync(treePath) ? readJson(treePath) : null;
    // accessoires : arbre des modèles (paths) ; vêtements : catégories, genres, familles (appl)
    const tree = raw?.paths ? treeIndex(raw) : new Map();
    const info = raw?.appl ? apparelIndex(raw) : new Map();
    const r = toProducts(readJson(path), f.kind, { tree, info, isEurope: isEuropeModel });
    const applic = r.products.reduce((n, p) => n + p.variants.reduce((m, v) => m + v.applicabilities.length, 0), 0);
    log(`- ${f.file} : ${r.products.length} produits, ${r.variants} références vendables (${r.skus.size} distinctes, ` +
        `${r.live.size} encore au catalogue), ${applic} compatibilités moto, ${r.skipped} entrées inutilisables` +
        `${raw ? '' : ' (arbre absent : catégories et modèles non traduits)'}`);
    loaded.push({ ...f, ...r });
  }
  if (!loaded.length) { log('Aucun fichier à charger.'); return; }

  let db = null;
  try { db = api(); } catch (e) { log(`  (base non disponible : ${e.message})`); }

  if (DRY) {
    if (db) {
      try {
        for (const c of await db.companies()) {
          const p = await db.rpc('ducati_products_creation_preview', { _company: c.id });
          log(`  ${c.name} : ${p.articles_a_creer} article(s) à créer, ${p.articles_existants} déjà là, ` +
              `${p.archivees} référence(s) archivée(s) sans article, ${p.shopify_concernes} produit(s) du site concernés ` +
              `(${p.shopify_sans_lien_ducati} sans lien Ducati aujourd'hui).`);
        }
      } catch (e) { log(`  (aperçu base non disponible : ${e.message})`); }
    }
    log("Essai à blanc (--dry-run) : rien n'est écrit.");
    return;
  }
  if (!db) throw new Error('Chargement impossible sans la clé de service.');

  // 1. Import du catalogue, par petits lots, reprenable
  const ledger = loadLedger();
  for (const f of loaded) {
    const done = new Set(ledger[f.file] ?? []);
    const todo = f.products.filter((p) => !done.has(p.code));
    log(`- ${f.file} : ${todo.length} produit(s) à importer${done.size ? ` (${done.size} déjà fait)` : ''}`);
    if (!todo.length) continue;
    const lots = chunks(todo);
    // un seul lot d'import par fichier (écran « État de l'import »), même en plusieurs appels
    const batch = await db.rpc('ducati_catalog_batch_start_loader', { _scope: { source: 'accessoires-vetements', file: f.file }, _model_years_total: 0 });
    let n = 0;
    try {
    for (const [i, lot] of lots.entries()) {
      const t0 = Date.now();
      const r = await db.rpc('ducati_catalog_ingest_products', { _batch: batch, _products: lot });
      await db.rpc('ducati_catalog_batch_progress', { _batch: batch, _status: 'running', _position: { file: f.file, lot: i + 1, total: lots.length } }).catch(() => {});
      n += lot.length;
      for (const p of lot) done.add(p.code);
      ledger[f.file] = [...done];
      saveLedger(ledger);
      log(`  ${f.file} : ${n}/${todo.length} produits (${r.variants} réf., ${r.applicabilities} compat. — ${secs(t0)})`);
    }
    await db.rpc('ducati_catalog_batch_progress', { _batch: batch, _status: 'done', _position: { file: f.file, lots: lots.length } }).catch(() => {});
    } catch (e) {
      await db.rpc('ducati_catalog_batch_progress', { _batch: batch, _status: 'error', _error: String(e.message ?? e).slice(0, 1500) }).catch(() => {});
      throw e;
    }
  }

  if (flag('--no-articles')) { log('Catalogue chargé ; articles non créés (--no-articles).'); return; }

  // 2. Articles manquants, détails, rapprochement — par lots, chaque appel sous 8 s
  for (const c of await db.companies()) {
    log(`- ${c.name}`);
    const created = await loop(db, 'article_links_create_missing', { _company: c.id, _scope: 'ducati_products', _variant: null }, 'ducati_products', 'articles créés');
    log(`  articles créés (accessoires / vêtements) : ${created}`);
    const fixed = await loop(db, 'ducati_products_repair_designations', { _company: c.id }, 'completes', 'détails complétés', '_limit', LOT_DETAILS);
    log(`  articles complétés (taille, couleur, version, note) : ${fixed}`);
    const t0 = Date.now();
    const rf = await db.rpc('article_links_refresh', { _company: c.id });
    log(`  rapprochement (${secs(t0)}) : ${rf.ducati} articles reliés au catalogue Ducati, ${rf.shopify} au site, ${rf.new} liens nouveaux`);
    const p = await db.rpc('ducati_products_creation_preview', { _company: c.id });
    log(`  produits du site concernés : ${p.shopify_concernes} (${p.shopify_sans_lien_ducati} encore sans lien Ducati)`);
  }
  log('Terminé.');
}

main().catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
