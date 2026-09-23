/**
 * Tests M5 / M14 — Import d'un inventaire G8 (décision M-44).
 *
 * L'outil est en Python (`tools/migration/import_inventaire_g8.py`, même famille que
 * `import_g8.py` : il lit le XML du .xlsx sans dépendance). On le pilote ici par ses
 * deux modes HORS LIGNE, qui n'ouvrent aucune connexion à la base :
 *   --lire    : lecture et analyse du fichier
 *   --deltas  : calcul des écarts d'inventaire contre un stock actuel donné
 *
 * La fixture est ANONYME (références et châssis inventés) : aucune donnée client
 * ne vit dans le dépôt.
 */
import { test, expect } from 'bun:test';

const TOOL = 'tools/migration/import_inventaire_g8.py';
const XLSX = 'tests/fixtures/inventaire-g8/inventaire-exemple.xlsx';
const STOCK = 'tests/fixtures/inventaire-g8/stock-actuel-exemple.json';

function python(args: string[]): unknown {
  for (const exe of ['python', 'python3', 'py']) {
    try {
      const r = Bun.spawnSync([exe, ...args], { stdout: 'pipe', stderr: 'pipe' });
      if (r.exitCode === 0) return JSON.parse(new TextDecoder().decode(r.stdout));
      // Un exécutable absent sort en 1 sans rien écrire : on tente le suivant.
      const err = new TextDecoder().decode(r.stderr);
      if (err.trim()) throw new Error(`${exe} ${args.join(' ')} :\n${err}`);
    } catch (e) {
      if (e instanceof Error && e.message.includes(':\n')) throw e;
    }
  }
  throw new Error('Python 3 introuvable (python / python3 / py).');
}

type Ligne = {
  line_no: number; reference: string; reference_norm: string; designation: string | null;
  vin: string | null; real_qty: number; pamp: number | null; stock_value: number | null;
  bin_location: string | null; rayon: string | null; last_in: string | null; last_out: string | null;
};
type Lecture = {
  ignorees: { sans_reference: number; sans_quantite: number; vides: number };
  diagnostic: Record<string, number | Record<string, number>>;
  lignes: Ligne[];
};
type Delta = {
  line_no: number; cle: string; stock_actuel: number; stock_cible: number;
  delta: number; mouvement: boolean; cout_unitaire: number | null;
};

const lu = python([TOOL, XLSX, '--lire']) as Lecture;
const deltas = python([TOOL, XLSX, '--deltas', STOCK]) as Delta[];
const par = (n: number) => deltas.find((d) => d.line_no === n)!;

// ---------------------------------------------------------------- lecture

test('lecture — ne retient que les lignes utiles et compte ce qu\'elle écarte', () => {
  expect(lu.lignes.length).toBe(7);
  expect(lu.ignorees.sans_reference).toBe(1); // ligne de sous-total sans référence
  expect(lu.ignorees.sans_quantite).toBe(1);  // quantité illisible
  expect(lu.ignorees.vides).toBe(1);
  expect(lu.diagnostic.lignes_utiles).toBe(7);
});

test('lecture — la référence est normalisée (majuscules, sans espace ni ponctuation)', () => {
  const l = lu.lignes.find((x) => x.line_no === 3)!;
  expect(l.reference).toBe('pie ce.002');     // telle quelle dans le fichier
  expect(l.reference_norm).toBe('PIECE002');  // forme de rapprochement
});

test('lecture — les dates Excel deviennent des dates ISO', () => {
  const l = lu.lignes.find((x) => x.line_no === 2)!;
  expect(l.last_in).toBe('2026-02-17');
  expect(l.last_out).toBe('2023-05-12');
  expect(lu.lignes.find((x) => x.line_no === 3)!.last_out).toBeNull();
});

test('lecture — quantités négatives et décimales conservées telles quelles', () => {
  expect(lu.lignes.find((x) => x.line_no === 5)!.real_qty).toBe(-2);
  expect(lu.lignes.find((x) => x.line_no === 6)!.real_qty).toBe(2.5);
  expect(lu.diagnostic.lignes_negatives).toBe(1);
});

test('lecture — une ligne à châssis est une moto ; deux motos peuvent partager la référence', () => {
  const motos = lu.lignes.filter((x) => x.vin);
  expect(motos.length).toBe(2);
  expect(motos[0].reference_norm).toBe(motos[1].reference_norm);
  expect(motos[0].vin).not.toBe(motos[1].vin);
  expect(lu.diagnostic.vin_en_double).toBe(0);
  expect(lu.diagnostic.doublons_hors_motos).toBe(0);
});

test('lecture — la valeur du fichier est bien quantité × PAMP', () => {
  expect(lu.diagnostic.valeur_totale).toBe(lu.diagnostic.valeur_recalculee as number);
});

// ---------------------------------------------------------------- deltas

test('delta — la cible est atteinte par un seul écart (cible − stock calculé)', () => {
  expect(par(2)).toMatchObject({ stock_actuel: 1, stock_cible: 3, delta: 2, mouvement: true });
  expect(par(3)).toMatchObject({ delta: 22, mouvement: true });
});

test('delta — stock déjà juste : aucun mouvement (une relance reste silencieuse)', () => {
  expect(par(6).delta).toBe(0);
  expect(par(6).mouvement).toBe(false);
  expect(par(8).mouvement).toBe(false);
});

test('delta — une cible négative produit une sortie, jamais un blocage', () => {
  expect(par(5)).toMatchObject({ stock_cible: -2, delta: -2, mouvement: true });
});

test('B5 — le coût n\'est porté que là où le PAMP repart juste (entrée sur stock ≤ 0)', () => {
  expect(par(3).cout_unitaire).toBe(0.16);    // stock 0 → le PAMP repart du coût
  expect(par(7).cout_unitaire).toBe(10000);   // moto entrée sur stock 0
  expect(par(2).cout_unitaire).toBeNull();    // stock > 0 : la moyenne fausserait le PAMP
  expect(par(4).cout_unitaire).toBeNull();    // PAMP absent du fichier
  expect(par(5).cout_unitaire).toBeNull();    // sortie
});

test('delta — une moto est rapprochée par son châssis, pas par sa référence', () => {
  expect(par(7).cle).toBe('WZZ0000AA0B000001');
  expect(par(8).cle).toBe('WZZ0000AA0B000002');
  expect(par(2).cle).toBe('PIECE001');
});
