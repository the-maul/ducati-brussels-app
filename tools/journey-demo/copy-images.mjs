/**
 * M8 — Parcours d'entretien : copie les FIGURES d'un entretien de démonstration dans
 * `public/manuels/` pour qu'elles s'affichent dans l'écran technicien.
 *
 * Les figures des manuels pèsent ~300 Mo en tout : elles ne sont PAS dans le dépôt
 * (`public/manuels/` est ignoré par git). Cette commande copie seulement celles d'un service.
 * Sans figure, l'écran affiche « figure non disponible » et le parcours reste utilisable.
 *
 *   node tools/journey-demo/copy-images.mjs                      # Oil Service de la DesertX 2023
 *   node tools/journey-demo/copy-images.mjs --service "Desmo Service"
 *   node tools/journey-demo/copy-images.mjs --tout                # toutes les figures de la démo
 *   node tools/journey-demo/copy-images.mjs --racine <dossier manuels-extraits>
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const arg = (name, def) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : def; };
const ROOT = arg('--racine', path.resolve(REPO, '..', 'manuels-extraits'));
const ALL = process.argv.includes('--tout');
const SERVICE = arg('--service', 'Oil Service');
const DEMO = path.join(REPO, 'public', 'demo', 'parcours-entretien.json');
const DEST = path.join(REPO, 'public', 'manuels');

if (!fs.existsSync(DEMO)) { console.error('Lancez d’abord : node tools/journey-demo/build.mjs'); process.exit(1); }
const demo = JSON.parse(fs.readFileSync(DEMO, 'utf8'));

// Procédures à couvrir
const ids = new Set();
for (const b of demo.bikes) {
  for (const [service, list] of Object.entries(b.proceduresParService)) {
    if (!ALL && service.toLowerCase() !== SERVICE.toLowerCase()) continue;
    for (const p of list) ids.add(p.parcoursId);
  }
}
if (!ids.size) {
  console.error(`Aucune procédure pour le service « ${SERVICE} ». Services disponibles :`);
  for (const b of demo.bikes) console.error(`  ${b.modele} ${b.annee} : ${Object.keys(b.proceduresParService).join(' | ')}`);
  process.exit(1);
}

// Chemins de figures
const paths = new Set();
const push = (f) => { if (f) { if (f.src) paths.add(f.src); if (f.zoom) paths.add(f.zoom); } };
for (const id of ids) {
  const p = demo.procedures[id];
  if (!p) continue;
  for (const f of p.figuresIntro || []) push(f);
  for (const o of p.outils || []) push(o.image);
  for (const e of p.etapes) for (const f of e.figures || []) push(f);
}

let copied = 0, already = 0, missing = 0, bytes = 0;
for (const rel of paths) {
  const from = path.join(ROOT, rel);
  const to = path.join(DEST, rel);
  if (!fs.existsSync(from)) { missing++; continue; }
  if (fs.existsSync(to) && fs.statSync(to).size === fs.statSync(from).size) { already++; continue; }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  bytes += fs.statSync(to).size;
  copied++;
}
console.log(`${ALL ? 'toutes les figures' : `service « ${SERVICE} »`} — ${ids.size} procédure(s)`);
console.log(`copiées ${copied} (${(bytes / 1048576).toFixed(1)} Mo), déjà là ${already}, introuvables ${missing}`);
console.log(`destination : ${path.relative(REPO, DEST)} (ignoré par git)`);
