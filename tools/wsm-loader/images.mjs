#!/usr/bin/env node
/**
 * Mission 07, carte 3 — envoi des images des manuels d'atelier dans Supabase Storage.
 *
 * Les fichiers ne sont JAMAIS dans le dépôt (105 436 images, 52 Go au total ; 26 402 citées par les
 * procédures d'entretien, 12,75 Go). Ce script les envoie dans le bucket « wsm-images » (privé :
 * lecture par compte authentifié, par URL signée) et tient l'état dans public.wsm_images.
 *
 * Reprise : une image déjà marquée envoyée en base est sautée ; on peut couper et relancer.
 * Dédoublonnage par nom de fichier : le chemin dans le bucket est le chemin local sans le préfixe
 * « images/ », et les noms de l'extraction sont des empreintes du contenu — deux procédures qui
 * citent la même figure n'envoient qu'un seul objet.
 *
 * Usage (depuis le dossier du dépôt) :
 *   node tools/wsm-loader/images.mjs --measure 200   # mesure sur 200 images, N'ENVOIE RIEN
 *   node tools/wsm-loader/images.mjs --create-bucket # crée le bucket privé (une seule fois)
 *   node tools/wsm-loader/images.mjs --sample 200    # envoie 200 images (essai réel, mesuré)
 *   node tools/wsm-loader/images.mjs --figures-only  # sans les miniatures (13 207 images)
 *   node tools/wsm-loader/images.mjs                 # envoie tout ce qui reste
 *   node tools/wsm-loader/images.mjs --concurrency 8 # envois en parallèle (défaut 6)
 *
 * Accès base : SUPABASE_SERVICE_ROLE_KEY (jamais affichée). URL : SUPABASE_URL.
 */
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { procedureImages, chunk } from './transform.mjs';
import { rpc, select, putObject, baseUrl, serviceKey } from './env.mjs';

const args = process.argv.slice(2);
const flag = (k) => args.includes(k);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

const DIR = opt('--dir', join(homedir(), 'Desktop', 'ducati', 'manuels-extraits'));
const BUCKET = opt('--bucket', 'wsm-images');
const MEASURE = Number(opt('--measure', 0)) || 0;
const SAMPLE = Number(opt('--sample', 0)) || 0;
const FIGURES_ONLY = flag('--figures-only');
const CONCURRENCY = Math.max(1, Math.min(16, Number(opt('--concurrency', 6)) || 6));

const log = (...m) => console.log(...m);
const fmt = (n) => Number(n).toLocaleString('fr-BE');
const go = (b) => (b / 1024 ** 3).toFixed(2) + ' Go';
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8').replace(/^﻿/, ''));

const CT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp' };
const contentType = (p) => CT[(p.split('.').pop() || '').toLowerCase()] || 'application/octet-stream';

/** Chemin dans le bucket : le chemin local sans « images/ » (déjà unique par empreinte de contenu). */
export function objectPath(localPath) {
  return String(localPath).replace(/\\/g, '/').replace(/^images\//, '');
}

/** Inventaire des images citées par les procédures (lecture en flux, un fichier à la fois). */
export function inventory(dir) {
  const index = readJson(join(dir, 'parcours', 'index.json'));
  const out = new Map();
  for (const e of index) {
    const j = readJson(join(dir, 'parcours', `${e.id}.json`));
    for (const [path, kind] of procedureImages(j)) {
      const cur = out.get(path);
      if (cur) cur.used_count += 1;
      else out.set(path, { path, kind, used_count: 1 });
    }
  }
  return out;
}

async function uploadOne(im) {
  const abs = join(DIR, im.path);
  const st = statSync(abs);
  const buf = readFileSync(abs);
  await putObject(BUCKET, objectPath(im.path), buf, contentType(im.path));
  return {
    path: im.path, kind: im.kind, used_count: im.used_count,
    bytes: st.size, sha256: createHash('sha256').update(buf).digest('hex'),
    storage_path: objectPath(im.path), uploaded_at: new Date().toISOString(),
  };
}

/** Exécute des tâches avec une limite de parallélisme. */
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; await fn(items[k]); }
  }));
}

async function main() {
  if (flag('--create-bucket')) {
    const key = serviceKey();
    if (!key) throw new Error('Clé de service absente : définir la variable SUPABASE_SERVICE_ROLE_KEY.');
    const res = await fetch(`${baseUrl()}/storage/v1/bucket`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: BUCKET, id: BUCKET, public: false, file_size_limit: 20971520,
        allowed_mime_types: ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'] }),
    });
    log(`Bucket « ${BUCKET} » : HTTP ${res.status} — ${(await res.text()).slice(0, 200)}`);
    log('Bucket privé : la lecture se fera par URL signée, délivrée aux comptes de l’équipe.');
    return;
  }
  if (flag('--stats')) { log(JSON.stringify(await rpc('wsm_stats', {}), null, 1)); return; }

  log(`Dossier : ${DIR}`);
  const t0 = Date.now();
  let all = [...inventory(DIR).values()];
  if (FIGURES_ONLY) all = all.filter((i) => i.kind === 'figure');
  let bytes = 0, missing = 0;
  for (const im of all) {
    try { im.bytes = statSync(join(DIR, im.path)).size; bytes += im.bytes; }
    catch { im.missing = true; missing += 1; }
  }
  all = all.filter((i) => !i.missing);
  const figures = all.filter((i) => i.kind === 'figure').length;
  log(`Inventaire : ${fmt(all.length)} images (${fmt(figures)} figures, ${fmt(all.length - figures)} miniatures)`
    + ` · ${go(bytes)} · ${fmt(missing)} fichier(s) absent(s) · lu en ${Math.round((Date.now() - t0) / 1000)} s`);

  // --- Mesure : lecture + empreinte d'un échantillon, aucun envoi. ---
  if (MEASURE) {
    const sample = all.slice(0, MEASURE);
    const t = Date.now();
    let read = 0;
    for (const im of sample) {
      const b = readFileSync(join(DIR, im.path));
      read += b.length;
      createHash('sha256').update(b).digest('hex');
    }
    const secs = Math.max((Date.now() - t) / 1000, 0.001);
    const avg = read / sample.length;
    log('');
    log(`Mesure sur ${fmt(sample.length)} images (lecture disque + empreinte, aucun envoi) :`);
    log(`  taille          : ${(read / 1024 ** 2).toFixed(1)} Mo · moyenne ${(avg / 1024).toFixed(0)} Ko par image`);
    log(`  durée           : ${secs.toFixed(2)} s · ${(sample.length / secs).toFixed(0)} images/s en lecture`);
    log(`  toutes          : ${fmt(all.length)} images · ${go(bytes)} dans le bucket (taille exacte, mesurée sur tout l’inventaire)`);
    log(`  figures seules  : ${fmt(figures)} images ≈ ${go(all.filter((i) => i.kind === 'figure').reduce((s, i) => s + i.bytes, 0))}`);
    log(`  miniatures      : ${fmt(all.length - figures)} images ≈ ${go(all.filter((i) => i.kind !== 'figure').reduce((s, i) => s + i.bytes, 0))}`);
    log(`  (le débit d’envoi dépend de la liaison montante ; à mesurer avec --sample 200)`);
    return;
  }

  const target = SAMPLE ? all.slice(0, SAMPLE) : all;
  const done = new Set((await select('wsm_images?select=path&uploaded_at=not.is.null&limit=200000')).map((r) => r.path));
  const todo = target.filter((im) => !done.has(im.path));
  log(`À envoyer : ${fmt(todo.length)} (${fmt(target.length - todo.length)} déjà en place)`);
  if (!todo.length) return;

  const t1 = Date.now();
  let ok = 0, ko = 0, sent = 0;
  for (const part of chunk(todo, 500)) {
    const rows = [];
    await pool(part, CONCURRENCY, async (im) => {
      try { const r = await uploadOne(im); rows.push(r); sent += r.bytes; ok += 1; }
      catch (e) { ko += 1; if (ko <= 10) console.error(`  ! ${im.path} : ${e.message}`); }
    });
    if (rows.length) await rpc('wsm_ingest_images', { _payload: { run: `wsm-images-${new Date().toISOString()}`, images: rows } });
    const s = Math.max((Date.now() - t1) / 1000, 0.001);
    process.stdout.write(`\rEnvoyées : ${fmt(ok)} / ${fmt(todo.length)} · ${go(sent)} · ${(ok / s).toFixed(1)} img/s`);
  }
  const secs = Math.max((Date.now() - t1) / 1000, 0.001);
  log('');
  log(`Terminé : ${fmt(ok)} envoyées · ${fmt(ko)} en échec · ${go(sent)} · ${secs.toFixed(0)} s · ${(ok / secs).toFixed(1)} images/s`);
  if (ok) log(`  projection pour ${fmt(all.length)} images : ${(all.length / (ok / secs) / 3600).toFixed(1)} h et ${go(bytes)}`);
}

main().catch((e) => { console.error('ERREUR : ' + (e && e.message ? e.message : e)); process.exit(1); });
