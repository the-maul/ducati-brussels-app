/**
 * M8 — Parcours d'entretien (mission 07, carte « Parcours d'entretien pas à pas »).
 *
 * Fabrique les DONNÉES DE DÉMONSTRATION de l'écran technicien depuis l'extraction locale des
 * manuels d'atelier Ducati (`Desktop/ducati/manuels-extraits`, produite par `tools-manuels/`).
 *
 * Rien n'est inventé : chaque procédure garde sa source (manuel, code, version, date). Ces données
 * sont un DÉPANNAGE en attendant les tables du lot `lot-manuels` ; voir
 * `src/modules/workshop/journey/source.ts` (bascule démo ↔ base).
 *
 *   node tools/journey-demo/build.mjs [--racine <dossier manuels-extraits>]
 *
 * Sort : public/demo/parcours-entretien.json (chargé par fetch, pas embarqué dans le bundle).
 * Les FIGURES ne sont pas copiées ici (300 Mo) : voir tools/journey-demo/copy-images.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const argRoot = process.argv.indexOf('--racine');
const ROOT = argRoot > -1 ? process.argv[argRoot + 1] : path.resolve(REPO, '..', 'manuels-extraits');
const OUT = path.join(REPO, 'public', 'demo', 'parcours-entretien.json');

/** Motos de démonstration : id modèle-année du catalogue Ducati (`myId`) → fichier d'entretien. */
const BIKES = [
  { file: 'entretien/desert-x/desertx-2023.json', services: null },              // tous les services (a les temps UT)
  { file: 'entretien/superbike/panigale-v4-s-2024.json', services: ['DESMO Service'] }, // Desmo seulement
];

const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const clean = (o) => (o === undefined || o === null || (Array.isArray(o) && !o.length) ? undefined : o);

/** Figure : on ne garde que les chemins relatifs (résolus à l'écran sur la base des figures). */
const fig = (f) => (f && f.localMiniature ? { src: f.localMiniature, zoom: f.local || f.localMiniature } : null);
const figs = (list) => (list || []).map(fig).filter(Boolean);

const src = (s) => (s ? clean({ manualRoot: s.manualRoot, code: s.code, version: s.version, updateDate: s.updateDate, titre: s.titre }) : undefined);

function compactProcedure(p) {
  return {
    id: p.id,
    titre: p.titre,
    source: src(p.source),
    intervention: p.intervention ? clean({ operation: p.intervention.operation, services: clean(p.intervention.services) }) : undefined,
    outils: clean((p.outilsSpecifiques || []).map((o) => clean({ reference: o.reference, description: o.description, image: fig(o.image) || undefined }))),
    produits: clean(p.produits),
    couples: clean((p.couples || []).map((c) => clean({ etape: c.etape, valeurNm: c.valeurNm, min: c.min, max: c.max, tolerance: c.tolerance, reperes: clean(c.reperes), texte: c.texte }))),
    avertissements: clean((p.avertissementsGeneraux || []).map((a) => ({ type: a.type, titre: a.titre, texte: a.texte }))),
    figuresIntro: clean(figs(p.figuresIntroduction)),
    etapes: (p.etapes || []).map((e) => clean({
      n: e.n,
      phase: e.phase || undefined,
      sousPhase: e.sousPhase || undefined,
      texte: e.texte || '',
      sousEtapes: clean((e.sousEtapes || []).map((s) => ({ n: s.n, texte: s.texte }))),
      figures: clean(figs(e.figures)),
      outils: clean(e.outils),
      produits: clean(e.produits),
      couples: clean((e.couples || []).map((c) => clean({ valeurNm: c.valeurNm, min: c.min, max: c.max, tolerance: c.tolerance, reperes: clean(c.reperes), texte: c.texte }))),
      reperes: clean(e.reperes),
      avertissements: clean((e.avertissements || []).map((a) => ({ type: a.type, titre: a.titre, texte: a.texte }))),
      liens: clean((e.liens || []).map((l) => ({ parcoursId: l.parcoursId, titre: l.titre }))),
    })),
  };
}

const bikes = [];
const procedures = {};
let skipped = 0;

for (const b of BIKES) {
  const j = read(b.file);
  const wanted = b.services;
  const byService = {};
  for (const [service, list] of Object.entries(j.proceduresParService || {})) {
    if (wanted && !wanted.includes(service)) continue;
    byService[service] = list.map((p) => ({ parcoursId: p.parcoursId, titre: p.titre, operation: p.operation }));
    for (const p of list) {
      if (procedures[p.parcoursId]) continue;
      const f = path.join(ROOT, 'parcours', p.parcoursId + '.json');
      if (!fs.existsSync(f)) { skipped++; continue; }
      procedures[p.parcoursId] = compactProcedure(JSON.parse(fs.readFileSync(f, 'utf8')));
    }
  }
  bikes.push({
    modelYearId: j.modele.myId,
    famille: j.modele.famille,
    modele: j.modele.modele,
    annee: j.modele.annee,
    manualRoot: j.modele.manualRoot,
    services: (j.programme.services || []).map((s) => clean({ service: s.service, km: s.km, mois: s.mois, texte: s.texte, premiereEcheance: s.premiereEcheance || undefined })),
    echeances: (j.programme.echeances || [])
      .filter((e) => !wanted || wanted.some((w) => w.toLowerCase().includes(e.echeance.toLowerCase().split(' ')[0])))
      .map((e) => clean({ echeance: e.echeance, km: e.km, mois: e.mois, definition: e.definition, operations: e.operations || [], source: src(e.source) })),
    proceduresParService: byService,
    temps: (j.temps || []).map((t) => clean({ intitule: t.intitule, minutes: t.minutes, ut: t.ut })),
  });
}

const out = {
  schema: 'ducati-parcours-demo/1',
  genereLe: new Date().toISOString(),
  avertissement: 'Données de démonstration extraites des manuels d’atelier Ducati. Remplacées par les tables du lot lot-manuels quand elles seront en base.',
  bikes,
  procedures,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out));
const ko = Math.round(fs.statSync(OUT).size / 1024);
const nEtapes = Object.values(procedures).reduce((n, p) => n + p.etapes.length, 0);
console.log(`Écrit ${path.relative(REPO, OUT)} — ${ko} Ko`);
console.log(`${bikes.length} moto(s), ${Object.keys(procedures).length} procédure(s), ${nEtapes} étape(s)${skipped ? `, ${skipped} procédure(s) absente(s)` : ''}`);
for (const b of bikes) console.log(`  · ${b.modele} ${b.annee} (modèle-année ${b.modelYearId}) — ${Object.keys(b.proceduresParService).join(', ')}`);
