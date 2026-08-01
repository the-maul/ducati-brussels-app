/**
 * M7 — Notes structurées d'une reprise : parse ↔ re-sérialisation (édition d'un
 * dossier existant) + ordre des photos (formulaire = PDF). CLAUDE.md règle 7.
 * Exécution : `bun test`.
 */
import { test, expect } from 'bun:test';
import { parseRepriseNotes, buildRepriseNotes } from '../src/modules/tradein/reprise-notes';
import { photoOrderIndex, PHOTO_SLOTS, HERO_PHOTO_KEY } from '../src/modules/tradein/reprise-wizard-data';

const SRC = [
  'TVA déductible : Oui',
  'Carburant : Essence',
  'Transmission : Boîte manuelle',
  'Propriétaires : 2',
  "État technique : Traces d'usure — rayure reservoir",
  'Plaquettes avant : Neuf',
  'Plaquettes arrière : Moyen',
  'Pneu avant : A remplacer',
  'Pneu arrière : Je ne sais pas',
  'Kit pignons/chaîne : Moyen',
  "Peinture d'origine : Oui",
  'Véhicule importé : Non',
  'Papiers 100 CH : Oui',
  'Accessoires : ABS, Bulle, Top Case',
  'Prix souhaité : 5000 €',
  'Remarques : moto entretenue',
  'Prix souhaité visible PDF : Non',
].join('\n');

test('parse : toutes les réponses du formulaire sont relues', () => {
  const n = parseRepriseNotes(SRC);
  expect(n.vatDeductible).toBe(true);
  expect(n.fuel).toBe('Essence');
  expect(n.transmission).toBe('Boîte manuelle');
  expect(n.owners).toBe('2');
  expect(n.techState).toBe("Traces d'usure");
  expect(n.techDesc).toBe('rayure reservoir');
  expect(n.wear).toEqual({
    brake_front: 'Neuf', brake_rear: 'Moyen',
    tyre_front: 'A remplacer', tyre_rear: 'Je ne sais pas', chain_kit: 'Moyen',
  });
  expect(n.originalPaint).toBe(true);
  expect(n.imported).toBe(false);
  expect(n.papers100).toBe(true);
  expect(n.accessories).toEqual(['ABS', 'Bulle', 'Top Case']);
  expect(n.wishedPrice).toBe('5000');
  expect(n.wishedPriceVisible).toBe(false);
  expect(n.remarks).toBe('moto entretenue');
});

test('aller-retour parse → build : aucune perte', () => {
  expect(buildRepriseNotes(parseRepriseNotes(SRC), true)).toBe(SRC);
});

test('notes vides / nulles', () => {
  const e = parseRepriseNotes(null);
  expect(e.remarks).toBe('');
  expect(buildRepriseNotes(e, true)).toBe('');
});

test('lignes inconnues conservées (jamais de perte de donnée)', () => {
  const u = parseRepriseNotes('Bidule : machin\nligne libre');
  expect(u.remarks).toBe('Bidule : machin\nligne libre');
});

test('rétrocompatibilité : anciennes reprises (usure globale + pneus)', () => {
  const o = parseRepriseNotes("Pièces d'usure : Satisfaisant\nPneus : Neuf\nCarburant : Essence");
  // « Satisfaisant » (ancien libellé) devient « Moyen »
  expect(o.wear.brake_front).toBe('Moyen');
  expect(o.wear.brake_rear).toBe('Moyen');
  expect(o.wear.chain_kit).toBe('Moyen');
  expect(o.wear.tyre_front).toBe('Neuf');
  expect(o.wear.tyre_rear).toBe('Neuf');
  expect(o.fuel).toBe('Essence');
  expect(o.remarks).not.toContain("Pièces d'usure");
});

test('rétrocompatibilité : le format détaillé prime sur le format global', () => {
  const m = parseRepriseNotes("Plaquettes avant : Neuf\nPièces d'usure : Satisfaisant");
  expect(m.wear.brake_front).toBe('Neuf');   // valeur explicite conservée
  expect(m.wear.brake_rear).toBe('Moyen');   // complétée par l'ancien format
});

test('modification puis re-sérialisation', () => {
  const n = parseRepriseNotes(SRC);
  n.wear.tyre_front = 'Neuf';
  n.remarks = 'revise';
  const out = buildRepriseNotes(n, true);
  expect(out).toContain('Pneu avant : Neuf');
  expect(out).toContain('Remarques : revise');
  expect(out).not.toContain('Pneu avant : A remplacer');
});

test("ordre des photos : celui du formulaire (repris dans le PDF)", () => {
  expect(photoOrderIndex('Côté droit')).toBe(0);
  expect(photoOrderIndex('Côté gauche')).toBe(1);
  expect(photoOrderIndex('Face avant')).toBe(2);
  expect(photoOrderIndex('Face arrière')).toBe(3);
  expect(photoOrderIndex('Numéro de châssis')).toBe(5);
  expect(photoOrderIndex('Numéro du moteur')).toBe(6);
  expect(photoOrderIndex('Pneu avant')).toBe(7);
  expect(photoOrderIndex('Plaquettes avant')).toBe(8);
  expect(photoOrderIndex('Pneu arrière')).toBe(9);
  expect(photoOrderIndex('Plaquettes arrière')).toBe(10);
  expect(photoOrderIndex('Photo libre 1')).toBe(11);
  expect(photoOrderIndex('Truc inconnu')).toBe(999);
  expect(photoOrderIndex('  côté DROIT ')).toBe(0); // insensible casse/espaces
});

test('tri effectif d’une liste mélangée', () => {
  const arr = [
    { label: 'Photo libre 2' }, { label: 'Numéro du moteur' }, { label: 'Côté droit' },
    { label: 'Plaquettes arrière' }, { label: 'Face avant' }, { label: 'Côté gauche' },
  ];
  arr.sort((a, b) => photoOrderIndex(a.label) - photoOrderIndex(b.label));
  expect(arr.map((x) => x.label)).toEqual([
    'Côté droit', 'Côté gauche', 'Face avant', 'Numéro du moteur', 'Plaquettes arrière', 'Photo libre 2',
  ]);
});

test('la photo mise en avant sur le PDF est le côté droit (1re du formulaire)', () => {
  expect(PHOTO_SLOTS[0].key).toBe(HERO_PHOTO_KEY);
  expect(PHOTO_SLOTS[0].label).toBe('Côté droit');
});
