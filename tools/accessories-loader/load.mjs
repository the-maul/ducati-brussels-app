#!/usr/bin/env node
/**
 * Chargeur des catalogues ACCESSOIRES et VÊTEMENTS Ducati (mission 06, carte 7 ; décision M-25 « un seul catalogue »).
 *
 * 1. lit catalogue-ducati-accessoires.json et catalogue-ducati-vetements.json (Téléchargements de Simon),
 *    avec leur « …-arbre.json » (hierarchyPath → modèle, millésime : motos compatibles) ;
 * 2. les pousse dans le catalogue Ducati (ducati_catalog_ingest_products : upsert, relançable) ;
 * 3. crée les articles du DMS manquants (article_links_create_missing, portée « ducati_products » : une
 *    référence par taille / couleur, en librairie, prix public Ducati tracé dans price_changes) ;
 * 4. relance le rapprochement : les articles existants (ex. accessoires « 96… / 97… » créés depuis Shopify)
 *    sont reliés à leur référence Ducati (badge « Ducati »).
 *
 * Usage (depuis le dossier du dépôt) :
 *   node tools/accessories-loader/load.mjs --dry-run          # lit et résume, n'écrit rien
 *   node tools/accessories-loader/load.mjs                    # charge (clé de service requise)
 *   node tools/accessories-loader/load.mjs --dir "D:\export" --no-articles
 *
 * Accès base : SUPABASE_SERVICE_ROLE_KEY (variable d'environnement ou variable « Utilisateur » Windows),
 * jamais affichée. URL : SUPABASE_URL, sinon le projet ujmrosbgkvgvwfnuryna.
 * Prix : HT = « price », TTC = « priceWithVAT » / « vatPrice » de l'e-catalog (ratio 1,21 vérifié le 22/09).
 * NE PAS LANCER sans l'accord de Simon (écrit en base).
 */
import { readFileSync, existsSync } from 'node:fs';
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
const CHUNK = Number(opt('--chunk', 50));
const FILES = [
  { file: 'catalogue-ducati-accessoires.json', tree: 'catalogue-ducati-accessoires-arbre.json', kind: 'accessory' },
  { file: 'catalogue-ducati-vetements.json', tree: 'catalogue-ducati-vetements-arbre.json', kind: 'apparel' },
];
const PROJECT_URL = 'https://ujmrosbgkvgvwfnuryna.supabase.co';
const log = (...m) => console.log(...m);
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));

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

function api() {
  const key = serviceKey();
  if (!key) throw new Error('Clé de service absente : définir SUPABASE_SERVICE_ROLE_KEY (elle ne sera pas affichée).');
  const url = (process.env.SUPABASE_URL || PROJECT_URL).replace(/\/$/, '');
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  return {
    async rpc(fn, body) {
      const res = await fetch(`${url}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(body) });
      const text = await res.text();
      if (!res.ok) throw new Error(`${fn} : HTTP ${res.status} — ${text.slice(0, 400)}`);
      return text ? JSON.parse(text) : null;
    },
    async companies() {
      const res = await fetch(`${url}/rest/v1/companies?select=id,name`, { headers });
      if (!res.ok) throw new Error(`companies : HTTP ${res.status}`);
      return res.json();
    },
  };
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
    for (const p of r.products.slice(0, 3)) log(`    ${p.code} ${p.name} — ${p.variants.length} réf., ${p.priceHt ?? '?'} HT / ${p.priceTtc ?? '?'} TTC`);
    loaded.push({ ...f, ...r });
  }
  if (!loaded.length) { log('Aucun fichier à charger.'); return; }
  if (DRY) {
    // Si la clé de service est là, on dit aussi ce que la base ferait (lecture seule).
    try {
      const db = api();
      for (const c of await db.companies()) {
        const p = await db.rpc('ducati_products_creation_preview', { _company: c.id });
        log(`  ${c.name} : ${p.articles_a_creer} article(s) à créer, ${p.articles_existants} déjà là, ` +
            `${p.archivees} référence(s) archivée(s) sans article, ${p.shopify_concernes} produit(s) du site concernés ` +
            `(${p.shopify_sans_lien_ducati} sans lien Ducati aujourd'hui).`);
      }
    } catch (e) { log(`  (aperçu base non disponible : ${e.message ?? e})`); }
    log("Essai à blanc (--dry-run) : rien n'est écrit.");
    return;
  }

  const db = api();
  const batch = await db.rpc('ducati_catalog_batch_start_loader', { _scope: { source: 'accessoires-vetements' }, _model_years_total: 0 });
  try {
    for (const f of loaded) {
      for (let i = 0; i < f.products.length; i += CHUNK) {
        await db.rpc('ducati_catalog_ingest_products', { _batch: batch, _products: f.products.slice(i, i + CHUNK) });
        log(`  ${f.file} : ${Math.min(i + CHUNK, f.products.length)} / ${f.products.length}`);
      }
    }
    await db.rpc('ducati_catalog_batch_progress', { _batch: batch, _status: 'done', _position: { files: loaded.map((f) => f.file) } });
  } catch (e) {
    await db.rpc('ducati_catalog_batch_progress', { _batch: batch, _status: 'error', _error: String(e.message || e).slice(0, 1500) }).catch(() => {});
    throw e;
  }
  if (flag('--no-articles')) { log('Catalogue chargé ; articles non créés (--no-articles).'); return; }
  for (const c of await db.companies()) {
    const r = await db.rpc('article_links_create_missing', { _company: c.id, _scope: 'ducati_products', _limit: null, _variant: null });
    log(`Société ${c.name} : ${r.ducati_products} articles créés (accessoires / vêtements), ${r.prix} prix posés.`);
    // Articles créés avant ce chargeur : taille, couleur, version, catégorie et genre complétés.
    const fix = await db.rpc('ducati_products_repair_designations', { _company: c.id, _limit: 20000 });
    log(`  détails complétés sur ${fix.completes} article(s) déjà créé(s).`);
    const rf = await db.rpc('article_links_refresh', { _company: c.id });
    log(`  rapprochement : ${rf.ducati} articles reliés au catalogue Ducati, ${rf.new} liens nouveaux.`);
  }
  log('Terminé.');
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
