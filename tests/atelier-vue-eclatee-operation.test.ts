/**
 * Tests M8 — ATE-05 (26/11/2026) : « Voir sur la vue éclatée » d'une opération du parcours ouvre
 * le dessin de la pièce à changer, zoomé sur son repère (règle pure `operationTargets`).
 * Cas réel : Monster 1100 S 2009 (modèle-année 1468, pas de manuel d'atelier) — vidange + filtre
 * (filtre 44440035A, dessin 009 repère 20) et courroies (73740211A, dessin 008 repère 19).
 * Pas de référence devinée : OR → kit de la moto → règles de recherche des kits, et seulement
 * des références présentes sur un dessin du modèle-année. Sans cible : pas de bouton.
 */
import { test, expect, describe } from 'bun:test';
import {
  operationTargets, catalogRuleMatches, isSecondaryFamily,
  type CatalogRule, type MyDrawing, type MyDrawingLine, type OperationPartsIndex,
} from '../src/modules/workshop/exploded/operation-parts';

const drawings: MyDrawing[] = [
  { drawing_id: '19104', group_sort: 1, sort: 13, code: '034', description: 'ADMISSION' },
  { drawing_id: '19120', group_sort: 2, sort: 7, code: '008', description: 'COURROIE DISTRIBUTION' },
  { drawing_id: '19136', group_sort: 2, sort: 8, code: '009', description: 'POMPE A HUILE - FILTRE' },
  { drawing_id: '19152', group_sort: 2, sort: 9, code: '010', description: 'CARTER MOTEUR' },
  { drawing_id: '19999', group_sort: 9, sort: 1, code: '099', description: 'OUTILS SPECIAUX' },
];
const line = (drawing_id: string, line_no: number, position: string | null, reference: string, description: string, replaced_part: string | null = null): MyDrawingLine =>
  ({ drawing_id, line_no, position, reference, reference_norm: reference.replace(/[^A-Z0-9]/gi, '').toUpperCase(), description, replaced_part });
const lines: MyDrawingLine[] = [
  line('19104', 9, '9', '42610251A', 'FILTRE A AIR'),
  line('19120', 19, '19', '73740211A', 'COURROIE DENTEE COMMANDE DISTRIBUTION'),
  line('19120', 20, '20', '82910131A', 'TENDEUR COURROIE'),
  line('19136', 19, '19', '89420091A', 'CREPINE HUILE'),
  line('19136', 20, '20', '44440035A', 'FILTRE A HUILE'),
  line('19152', 45, '45', '89320062A', 'BOUCHON VIDANGE HUILE'),
  line('19999', 3, '3', '88713123A', 'OUTIL COURROIE DISTRIBUTION'),
];
const rules: CatalogRule[] = [
  { family_code: 'filtre_huile', include_re: '^FILTRE A HUILE$', exclude_re: null, drawing_re: null, drawing_exclude_re: null },
  { family_code: 'bouchon_vidange', include_re: '^JOINT,? (DE )?BOUCHON (DE )?VIDANGE', exclude_re: null, drawing_re: null, drawing_exclude_re: null },
  { family_code: 'courroie_distribution', include_re: 'COURROIE', exclude_re: '(COUVERCLE|TENDEUR|POULIE|SELLE|KIT MISE EN TENSION|GALET|PROTECTION|CARTER|POMPE)', drawing_re: 'DISTRIBUTION', drawing_exclude_re: null },
  { family_code: 'filtre_air', include_re: '^FILTRE A AIR$', exclude_re: null, drawing_re: null, drawing_exclude_re: 'DISTRIBUTION' },
];
const idx = (over: Partial<OperationPartsIndex> = {}): OperationPartsIndex => ({ drawings, lines, rules, kit: [], ...over });
const OIL = ['bouchon_vidange', 'filtre_huile', 'huile_moteur'];

describe('opération qui remplace des pièces : le bon dessin, le bon repère', () => {
  test('Monster 1100 S, vidange + filtre via le kit : filtre 44440035A, dessin 009 repère 20, en premier', () => {
    const r = operationTargets({ familyCodes: OIL, lines: [] }, idx({
      kit: [
        { family_code: 'filtre_huile', designation: 'FILTRE A HUILE', references: ['44440035A', '44440035A', null] },
        { family_code: 'bouchon_vidange', designation: 'JOINT DE BOUCHON DE VIDANGE', references: [null] },
        { family_code: 'huile_moteur', designation: 'HUILE', references: ['HUILE SHELL 15W50'] },
      ],
    }));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ familyCode: 'filtre_huile', reference: '44440035A', drawingId: '19136', position: '20', source: 'kit' });
    expect(r[0].drawingLabel).toBe('009 — POMPE A HUILE - FILTRE');
  });

  test('courroies sans ligne d\'OR ni kit : règle de recherche des kits sur le dessin de distribution (73740211A, repère 19)', () => {
    const r = operationTargets({ familyCodes: ['courroie_distribution'], lines: [] }, idx());
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ reference: '73740211A', drawingId: '19120', position: '19', source: 'catalogue' });
  });

  test('la ligne de l\'OR reliée à l\'opération passe avant le kit', () => {
    const r = operationTargets(
      { familyCodes: ['filtre_huile'], lines: [{ family_code: 'filtre_huile', designation: 'FILTRE OR', references: ['44440035A'] }] },
      idx({ kit: [{ family_code: 'filtre_huile', designation: 'KIT', references: ['42610251A'] }] }),
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ source: 'or_line', designation: 'FILTRE OR', position: '20' });
  });

  test('référence du kit absente du catalogue de ce modèle-année : on passe à la source suivante', () => {
    const r = operationTargets({ familyCodes: ['filtre_huile'], lines: [] }, idx({ kit: [{ family_code: 'filtre_huile', designation: 'X', references: ['44440031C'] }] }));
    expect(r[0]).toMatchObject({ reference: '44440035A', source: 'catalogue' });
  });

  test('ancienne référence : retrouvée par « remplacée par » sur le dessin', () => {
    const l2 = [...lines, line('19136', 21, '21', '44440099Z', 'FILTRE A HUILE NOUVEAU', '44440031C')];
    const r = operationTargets({ familyCodes: ['filtre_huile'], lines: [] }, idx({ lines: l2, kit: [{ family_code: 'filtre_huile', designation: 'X', references: ['44440031C'] }] }));
    expect(r[0]).toMatchObject({ position: '21', viaReplacement: true, source: 'kit' });
  });

  test('plusieurs pièces : pièce principale d\'abord, joints / bouchons ensuite, sans doublon de repère', () => {
    const r = operationTargets(
      { familyCodes: OIL, lines: [
        { family_code: 'bouchon_vidange', designation: 'BOUCHON', references: ['89320062A'] },
        { family_code: 'filtre_huile', designation: 'FILTRE', references: ['44440035A'] },
        { family_code: 'filtre_huile', designation: 'FILTRE bis', references: ['44440035A'] },
      ] },
      idx(),
    );
    expect(r.map((x) => `${x.drawingId}/${x.position}`)).toEqual(['19136/20', '19152/45']);
  });

  test('dessin hors modèle-année ignoré', () => {
    const r = operationTargets({ familyCodes: ['filtre_huile'], lines: [] }, idx({ lines: [line('77777', 1, '1', '44440035A', 'FILTRE A HUILE')] }));
    expect(r).toEqual([]);
  });
});

describe('pas de pièce situable : pas de bouton', () => {
  test('contrôle sans famille (lecture DDS, contrôle filtre à air)', () => {
    expect(operationTargets({ familyCodes: [], lines: [] }, idx())).toEqual([]);
  });
  test('liquide seul (huile moteur) : rien sur les dessins', () => {
    expect(operationTargets({ familyCodes: ['huile_moteur'], lines: [] }, idx({ kit: [{ family_code: 'huile_moteur', designation: 'HUILE', references: ['HUILE SHELL 15W50'] }] }))).toEqual([]);
  });
  test('joint de bouchon de vidange : la règle ne prend pas le bouchon lui-même', () => {
    expect(operationTargets({ familyCodes: ['bouchon_vidange'], lines: [] }, idx())).toEqual([]);
  });
  test('moto sans dessins (pas de modèle-année catalogue)', () => {
    expect(operationTargets({ familyCodes: OIL, lines: [] }, idx({ drawings: [] }))).toEqual([]);
  });
});

describe('règles de recherche des kits (même test que la base)', () => {
  const belt = rules[2];
  test('courroie de distribution uniquement sur un dessin de distribution, jamais le tendeur ni un outil', () => {
    expect(catalogRuleMatches(belt, 'COURROIE DENTEE COMMANDE DISTRIBUTION', 'COURROIE DISTRIBUTION')).toBe(true);
    expect(catalogRuleMatches(belt, 'TENDEUR COURROIE', 'COURROIE DISTRIBUTION')).toBe(false);
    expect(catalogRuleMatches(belt, 'COURROIE', 'SELLE')).toBe(false);
    expect(catalogRuleMatches(belt, 'OUTIL COURROIE DISTRIBUTION', 'OUTILS SPECIAUX')).toBe(false);
  });
  test('minuscules : comparées en majuscules ; expression invalide : aucune correspondance', () => {
    expect(catalogRuleMatches(rules[0], 'filtre a huile', 'pompe')).toBe(true);
    expect(catalogRuleMatches({ ...rules[0], include_re: '(' }, 'FILTRE A HUILE', 'X')).toBe(false);
  });
  test('familles secondaires', () => {
    expect(isSecondaryFamily('bouchon_vidange')).toBe(true);
    expect(isSecondaryFamily('joint_bougie')).toBe(true);
    expect(isSecondaryFamily('filtre_huile')).toBe(false);
  });
});
