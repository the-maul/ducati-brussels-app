/**
 * Tests M8 — ATE-05 (26/11/2026, 2e et 3e retours de Simon) :
 *  - la vue éclatée s'ouvre aussi pour les CONTRÔLES / nettoyages / vidanges de liquide, zoomée sur
 *    l'élément, dès qu'il figure sur un dessin du modèle-année (table opération → composant) ;
 *  - les opérations « (si présent) » du plan générique ne s'affichent que si la moto a l'élément
 *    (catalogue du modèle-année) ; catalogue inconnu : opération gardée telle quelle.
 * Données : extraits réels du catalogue Monster 1100 S 2009 (modèle-année 1468).
 */
import { test, expect, describe } from 'bun:test';
import { operationTargets, type MyDrawing, type MyDrawingLine, type OperationPartsIndex } from '../src/modules/workshop/exploded/operation-parts';
import { componentsOf, locateComponent, normalizeText, OPERATION_COMPONENTS } from '../src/modules/workshop/exploded/operation-components';
import {
  conditionalOperation, applyBikePresence, isAbsentOnBike, hasConditionalOps, clutchCommand, liquidCooling, ABSENT_ON_BIKE_NOTE,
} from '../src/modules/workshop/exploded/operation-presence';

const monster: MyDrawing[] = [
  { drawing_id: 'ADM', group_sort: 1, sort: 13, code: '034', description: 'ADMISSION' },
  { drawing_id: 'F', group_sort: 3, sort: 1, code: '024', description: 'FOURCHE AVANT' },
  { drawing_id: 'AM', group_sort: 3, sort: 2, code: '033', description: 'AMORTISSEUR ARRIERE' },
  { drawing_id: 'EMB', group_sort: 3, sort: 3, code: '027', description: 'MAITRE-CYLINDRE EMBRAYAGE' },
  { drawing_id: 'FAV', group_sort: 3, sort: 4, code: '028', description: 'SYSTEME DE FREIN AVANT' },
  { drawing_id: 'FAR', group_sort: 3, sort: 5, code: '029', description: 'SYSTEME DE FREIN ARRIERE' },
  { drawing_id: 'RAD', group_sort: 3, sort: 6, code: '039', description: 'RADIATEUR A HUILE' },
  { drawing_id: 'TB', group_sort: 3, sort: 7, code: '002', description: 'TAMBOUR CHANGEMENT VITESSE - FOURCHETTE' },
  { drawing_id: 'OUT', group_sort: 9, sort: 1, code: '01B', description: 'INSTRUMENT DE DIAGNOSTIC DDS' },
];
const line = (drawing_id: string, line_no: number, reference: string, description: string): MyDrawingLine =>
  ({ drawing_id, line_no, position: String(line_no), reference, reference_norm: reference, description, replaced_part: null });
const monsterLines: MyDrawingLine[] = [
  line('ADM', 8, '42640171A', 'COUVERCLE BOITE FILTRE AIR'),
  line('ADM', 9, '42610251A', 'FILTRE A AIR'),
  line('F', 1, '34920571A', 'ENSEMBLE FOURCHE GAUCHE OHLINS'),
  line('F', 5, '34920581A', 'JEU JOINT FOURCHE AVANT'),
  line('AM', 1, '36520241A', 'AMORTISSEUR ARRIERE'),
  line('EMB', 1, '62740121A', 'MAITRE-CYLINDRE EMBRAYAGE'),
  line('EMB', 12, '62740131A', 'RESERVOIR HUILE'),
  line('FAV', 8, '61340381A', 'JEU PLAQUETTES FREIN AVANT'),
  line('FAV', 15, '62440261A', 'RESERVOIR LIQUIDE FREINS'),
  line('FAR', 9, '45610481A', 'PEDALE FREIN'),
  line('FAR', 23, '62440271A', 'RESERVOIR LIQUIDE FREINS'),
  line('FAR', 33, '61340391A', 'JEU PLAQUETTES FREIN ARRIERE'),
  line('RAD', 1, '54840111A', 'RADIATEUR A HUILE'),
  line('TB', 3, '17020011A', 'FOURCHETTE'),
  line('OUT', 1, '97900101A', 'FILTRE A AIR'),
];
const monsterIdx: OperationPartsIndex = { drawings: monster, lines: monsterLines, rules: [], kit: [] };
const at = (label: string, i: OperationPartsIndex = monsterIdx) =>
  operationTargets({ familyCodes: [], lines: [], label }, i).map((x) => `${x.drawingId}/${x.position}`);

describe('contrôles : le dessin de l\'élément, zoomé dessus', () => {
  test('contrôle et nettoyage du filtre à air → admission, repère du filtre (pas le couvercle, pas un outil)', () => {
    expect(at('Contrôle et nettoyage du filtre à air')).toEqual(['ADM/9']);
  });
  test('étanchéité fourche avant et amortisseur arrière → joints de fourche puis amortisseur (deux dessins)', () => {
    expect(at("Contrôle visuel des éléments d'étanchéité fourche avant et amortisseur arrière")).toEqual(['F/5', 'AM/1']);
  });
  test('niveau huile de freins et d\'embrayage → réservoirs avant, arrière, embrayage', () => {
    expect(at('Contrôle du niveau d\'huile de freins et d’embrayage (si présent)')).toEqual(['FAV/15', 'FAR/23', 'EMB/12']);
  });
  test('vidange liquide de refroidissement sur une moto à air : le radiateur à huile ne compte pas, pas de bouton', () => {
    expect(at('Vidange liquide de refroidissement (si présent)')).toEqual([]);
  });
  test('levier de frein arrière → pédale ; plaquettes → jeu de plaquettes avant et arrière', () => {
    expect(at('Contrôle de la course à vide du levier de frein arrière et graissage des leviers')).toEqual(['FAR/9']);
    expect(at("Contrôle de l'usure des plaquettes et des disques de frein avant et arrière")).toEqual(['FAV/8', 'FAR/33']);
  });
  test('rien à montrer : lecture DDS, nettoyage, essai sur route', () => {
    expect(at('Lecture de la mémoire pannes avec DDS 3.0')).toEqual([]);
    expect(at('Nettoyage doux du véhicule')).toEqual([]);
    expect(componentsOf('Test final et essai sur route')).toEqual([]);
  });
  test('la fourchette de boîte n\'est pas la fourche ; ordre des composants = ordre du texte', () => {
    expect(componentsOf('amortisseur arrière et étanchéité fourche avant').map((c) => c.key)).toEqual(['amortisseur', 'fourche_etancheite']);
    const fork = OPERATION_COMPONENTS.find((c) => c.key === 'fourche')!;
    expect(locateComponent(fork, monster, monsterLines).map((h) => h.drawingId)).toEqual(['F']);
  });
  test('texte normalisé : accents, apostrophes typographiques', () => {
    expect(normalizeText('  d’embrayage  Éléments ')).toBe("D'EMBRAYAGE ELEMENTS");
  });
});

describe('opérations « (si présent) » : seulement si la moto a l\'élément (catalogue)', () => {
  const liquid = { drawings: [{ drawing_id: 'R', description: "RADIATEUR D'EAU" }], lines: [{ drawing_id: 'R', description: "RADIATEUR D'EAU" }] };
  const cable = {
    drawings: [{ drawing_id: 'C', description: 'COMANDO FRIZIONE' }],
    lines: [
      { drawing_id: 'C', description: 'LEVIER EMBRAYAGE' }, { drawing_id: 'C', description: 'CABLE ELASTIQUE' },
      { drawing_id: 'C', description: 'CAVALIER POMPE EMBRAYAGE' },
    ],
  };
  test('Monster 1100 S (air, embrayage hydraulique) : refroidissement et câble masqués, freins + embrayage sans « (si présent) »', () => {
    expect(liquidCooling(monsterIdx)).toBe('absent');
    expect(clutchCommand(monsterIdx)).toBe('hydraulique');
    expect(conditionalOperation('Vidange liquide de refroidissement (si présent)', monsterIdx).visible).toBe(false);
    expect(conditionalOperation('Contrôle de la course à vide du levier commande embrayage avec câble (si présent)', monsterIdx).visible).toBe(false);
    expect(conditionalOperation('Vidange huile de freins et d’embrayage (si présent)', monsterIdx)).toMatchObject({ visible: true, label: 'Vidange huile de freins et d’embrayage' });
  });
  test('moto refroidie par liquide : opération affichée, libellé sans « (si présent) »', () => {
    expect(conditionalOperation('Vidange liquide de refroidissement (si présent)', liquid)).toMatchObject({ visible: true, label: 'Vidange liquide de refroidissement' });
  });
  test('embrayage à câble : la partie embrayage disparaît, les freins restent ; le contrôle du câble reste', () => {
    expect(clutchCommand(cable)).toBe('cable');
    expect(conditionalOperation("Contrôle du niveau d'huile de freins et d'embrayage (si présent)", cable).label).toBe("Contrôle du niveau d'huile de freins");
    expect(conditionalOperation('Contrôle de la course à vide du levier commande embrayage avec câble (si présent)', cable))
      .toMatchObject({ visible: true, label: 'Contrôle de la course à vide du levier commande embrayage avec câble' });
  });
  test('catalogue inconnu (pas de modèle-année, catalogue vide) : opération gardée telle quelle', () => {
    expect(conditionalOperation('Vidange liquide de refroidissement (si présent)', null)).toMatchObject({ visible: true, label: 'Vidange liquide de refroidissement (si présent)' });
    expect(conditionalOperation('Vidange liquide de refroidissement (si présent)', { drawings: [], lines: [] }).visible).toBe(true);
  });
  test('opération sans « (si présent) » : jamais touchée', () => {
    expect(conditionalOperation('Vidange liquide de refroidissement', monsterIdx)).toMatchObject({ visible: true, label: 'Vidange liquide de refroidissement' });
  });
  test('liste de l\'OR : absentes retirées, celles encore « à faire » à régler sans objet ; facture et impression les ignorent', () => {
    const ops = [
      { id: 'a', label: 'Vidange liquide de refroidissement (si présent)', status: 'a_faire', not_done_note: null },
      { id: 'b', label: "Contrôle du niveau d'huile de freins et d'embrayage (si présent)", status: 'fait', not_done_note: null },
      { id: 'c', label: 'Contrôle visuel du niveau du liquide de refroidissement (si présent)', status: 'non_fait', not_done_note: ABSENT_ON_BIKE_NOTE },
    ];
    expect(hasConditionalOps(ops)).toBe(true);
    expect(hasConditionalOps([{ label: 'Nettoyage doux du véhicule' }])).toBe(false);
    const r = applyBikePresence(ops, monsterIdx);
    expect(r.visible.map((o) => o.label)).toEqual(["Contrôle du niveau d'huile de freins et d'embrayage"]);
    expect(r.toSettle.map((o) => o.id)).toEqual(['a']);
    expect(isAbsentOnBike(ops[2])).toBe(true);
    expect(isAbsentOnBike({ status: 'non_fait', not_done_note: 'refus' })).toBe(false);
    expect(applyBikePresence(ops, null).visible).toHaveLength(3);
  });
});
