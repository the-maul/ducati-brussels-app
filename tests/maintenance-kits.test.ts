/**
 * Tests M8 — kits de pièces d'entretien (mission 07, carte 2 ; décision M-20).
 *
 * Miroir des fonctions SQL `maintenance_deduce_parts`, `maintenance_kit_generate`,
 * `picking_open_for_repair_order`, `repair_order_order_needs` et `picking_order_needs`
 * (migrations 20260923160000 à 20260923163000). Les cas de référence viennent de vraies
 * données du catalogue Ducati, vérifiées à la main le 23/09 :
 *   - MONSTER 821 2016 (bicylindre Testastretta 11°, distribution à courroies) ;
 *   - MONSTER / MONSTER + 2027 (bicylindre 937) ;
 *   - PANIGALE V4 S 2024 (V4, distribution à chaîne : aucune courroie).
 *
 * Exécution : `bun test`.
 */
import { test, expect } from 'bun:test';
import {
  deduceFamilies, catalogLineMatches, resolveFamily, engineFamilyKey, kitSignature,
  buildPickingDraft, workshopMissingQty, dcsKindOfWorkshopOrder, kitToConfirmCount, kitIsReady,
  type NeedRule, type CatalogRule, type CatalogLine, type PartFamily, type KitItem,
} from '../src/modules/workshop/kits/rules';

// --- jeux de règles, identiques à ceux semés par la migration ---------------

const NEED_RULES: NeedRule[] = [
  { familyCode: 'filtre_huile', pattern: "(vidang\\w*\\s+(de\\s+l|d)'huile\\s+moteur|huile moteur\\s*-\\s*vidange).*(filtre|cartouche)|remplacement du filtre (à|a) huile" },
  { familyCode: 'bouchon_vidange', pattern: "(vidang\\w*\\s+(de\\s+l|d)'huile\\s+moteur|huile moteur\\s*-\\s*vidange)" },
  { familyCode: 'huile_moteur', pattern: "(vidang\\w*\\s+(de\\s+l|d)'huile\\s+moteur|huile moteur\\s*-\\s*vidange)" },
  { familyCode: 'filtre_air', pattern: 'remplacement du filtre (à|a) air|filtre (à|a) air\\s*-\\s*remplacement' },
  { familyCode: 'bougie', pattern: 'remplacement (de\\s+la\\s+bougie|des\\s+bougies)|bougie[^-]*-\\s*remplacement' },
  { familyCode: 'courroie_distribution', pattern: 'remplacement (des |de la )?courroies? (de (la )?)?distribution' },
  { familyCode: 'liquide_refroidissement', pattern: 'vidange du liquide de refroidissement|liquide de refroidissement\\s*-\\s*vidange' },
];

const fam = (code: string, p: Partial<PartFamily> = {}): PartFamily => ({
  code, label: code, kind: 'piece', optional: false, ...p,
});

const RULE: Record<string, CatalogRule> = {
  filtre_huile: { familyCode: 'filtre_huile', includeRe: '^FILTRE A HUILE$' },
  filtre_air: { familyCode: 'filtre_air', includeRe: '^FILTRE A AIR$', drawingExcludeRe: 'DISTRIBUTION' },
  bougie: { familyCode: 'bougie', includeRe: '^BOUGIE( |$)', excludeRe: '(CABLE|CABLAGE|GUIDE|JOINT|CAPUCHON|CLE |OUTIL|PROTECTION)' },
  joint_bougie: { familyCode: 'joint_bougie', includeRe: '^JOINT,? BOUGIE' },
  courroie_distribution: {
    familyCode: 'courroie_distribution', includeRe: 'COURROIE',
    excludeRe: '(COUVERCLE|TENDEUR|POULIE|SELLE|KIT MISE EN TENSION|GALET|PROTECTION|CARTER|POMPE)',
    takeAll: true,
  },
};

const line = (p: Partial<CatalogLine> & { reference: string; description: string }): CatalogLine => ({
  drawingId: 'd1', drawingDescription: 'MOTEUR', position: '1', quantity: 1, ...p,
});

// --- étage 1 : le libellé dit-il qu'il faut une pièce ? ---------------------

test('« Remplacement des bougies » réclame des bougies, « Contrôle » n\'en réclame pas', () => {
  expect(deduceFamilies(['Remplacement des bougies'], NEED_RULES)).toEqual(['bougie']);
  expect(deduceFamilies(['Contrôle et nettoyage du filtre à air'], NEED_RULES)).toEqual([]);
  expect(deduceFamilies(['Contrôle des plaquettes de frein. Les remplacer, si besoin est'], NEED_RULES)).toEqual([]);
});

test('la vidange moteur réclame le filtre, le bouchon et l\'huile — trois familles d\'un seul libellé', () => {
  const f = deduceFamilies(["Vidange de l'huile moteur et remplacement du filtre"], NEED_RULES).sort();
  expect(f).toEqual(['bouchon_vidange', 'filtre_huile', 'huile_moteur']);
});

test('l\'entretien des 1 000 km ne réclame ni bougie ni filtre à air', () => {
  const labels = [
    "Vidange de l'huile moteur et remplacement du filtre",
    'Contrôle et nettoyage du filtre à air',
    'Contrôle du niveau de liquide de refroidissement',
  ];
  const f = deduceFamilies(labels, NEED_RULES);
  expect(f).not.toContain('bougie');
  expect(f).not.toContain('filtre_air');
  expect(f).not.toContain('liquide_refroidissement');
});

test('les libellés du format « pièce - action » des vieux manuels sont reconnus aussi', () => {
  expect(deduceFamilies(["3,2. huile moteur - vidange de l'huile et remplacement du filtre à cartouche"], NEED_RULES))
    .toContain('filtre_huile');
  expect(deduceFamilies(['5,10. liquide de refroidissement - vidange'], NEED_RULES))
    .toContain('liquide_refroidissement');
});

test('une règle mal écrite ne casse pas la déduction', () => {
  expect(deduceFamilies(['Remplacement des bougies'], [{ familyCode: 'x', pattern: '([' }, ...NEED_RULES]))
    .toEqual(['bougie']);
});

// --- étage 2 : la ligne du catalogue est-elle la bonne ? -------------------

test('les vues d\'outillage ne fournissent jamais une pièce d\'entretien', () => {
  const l = line({ reference: '887132906', description: 'OUTIL FILTRE A HUILE', drawingDescription: 'OUTILS SPECIAUX POUR STATIONS-SERVICES (MOTEUR)' });
  expect(catalogLineMatches(l, RULE.filtre_huile)).toBe(false);
});

test('« FILTRE A HUILE A FILET » et « COUVERCLE FILTRE A HUILE » ne sont pas le filtre à huile', () => {
  expect(catalogLineMatches(line({ reference: '89420241A', description: 'FILTRE A HUILE A FILET' }), RULE.filtre_huile)).toBe(false);
  expect(catalogLineMatches(line({ reference: '247P7561A', description: 'COUVERCLE FILTRE A HUILE' }), RULE.filtre_huile)).toBe(false);
  expect(catalogLineMatches(line({ reference: '44440441A', description: 'FILTRE A HUILE' }), RULE.filtre_huile)).toBe(true);
});

test('un câble ou un joint de bougie n\'est pas une bougie', () => {
  expect(catalogLineMatches(line({ reference: 'x', description: 'CABLE BOUGIE TETE VERTICAL' }), RULE.bougie)).toBe(false);
  expect(catalogLineMatches(line({ reference: 'x', description: 'JOINT BOUGIE' }), RULE.bougie)).toBe(false);
  expect(catalogLineMatches(line({ reference: '67040581B', description: 'BOUGIE' }), RULE.bougie)).toBe(true);
  expect(catalogLineMatches(line({ reference: '67040451A', description: 'BOUGIE NGK MAR9A-J' }), RULE.bougie)).toBe(true);
});

test('un « FILTRE A AIR » rangé dans la vue DISTRIBUTION est un reniflard, pas le filtre à air', () => {
  expect(catalogLineMatches(line({ reference: '42710201A', description: 'FILTRE A AIR', drawingDescription: 'DISTRIBUTION' }), RULE.filtre_air)).toBe(false);
  expect(catalogLineMatches(line({ reference: '42610191A', description: 'FILTRE A AIR', drawingDescription: 'ADMISSION' }), RULE.filtre_air)).toBe(true);
});

// --- quantités : elles viennent du catalogue, jamais d'une supposition -----

test('MONSTER / MONSTER + 2027 : 2 bougies, une par culasse (2 vues, 1 unité chacune)', () => {
  const lines = [
    line({ reference: '67040581B', description: 'BOUGIE', drawingId: '11A', drawingDescription: 'CULASSE VERTICALE - DISTRIBUTION', quantity: 1 }),
    line({ reference: '67040581B', description: 'BOUGIE', drawingId: '11B', drawingDescription: 'CULASSE HORIZONTALE - DISTRIBUTION', quantity: 1 }),
  ];
  const [p] = resolveFamily(fam('bougie'), RULE.bougie, lines);
  expect(p.references).toEqual(['67040581B']);
  expect(p.quantity).toBe(2);
  expect(p.confidence).toBe('sur');
});

test('MONSTER 821 2016 : 2 bougies sur une seule vue (la quantité de la vue fait foi)', () => {
  const lines = [line({ reference: '67040451A', description: 'BOUGIE NGK MAR9A-J', drawingId: '022', drawingDescription: 'CADRE', quantity: 2 })];
  const [p] = resolveFamily(fam('bougie'), RULE.bougie, lines);
  expect(p.quantity).toBe(2);
});

test('PANIGALE V4 S 2024 : 4 bougies', () => {
  const lines = [line({ reference: '67040511A', description: 'BOUGIE', drawingId: 'x', quantity: 4 })];
  expect(resolveFamily(fam('bougie'), RULE.bougie, lines)[0].quantity).toBe(4);
});

test('une même référence sur la même vue et la même position ne compte qu\'une fois', () => {
  const l = line({ reference: '44440441A', description: 'FILTRE A HUILE', drawingId: '08A', position: '7', quantity: 1 });
  const [p] = resolveFamily(fam('filtre_huile'), RULE.filtre_huile, [l, { ...l }]);
  expect(p.quantity).toBe(1);
});

test('courroies de distribution : plusieurs références = plusieurs pièces, une ligne chacune', () => {
  const lines = [
    line({ reference: '73740252A', description: 'COURROIE DENTEE COMMANDE DISTRIBUTION', drawingId: '008', quantity: 2 }),
    line({ reference: '73740253A', description: 'COURROIE DISTRIBUTION', drawingId: '009', quantity: 1 }),
  ];
  const parts = resolveFamily(fam('courroie_distribution'), RULE.courroie_distribution, lines);
  expect(parts).toHaveLength(2);
  expect(parts.map((p) => p.quantity)).toEqual([2, 1]);
  expect(parts.every((p) => p.confidence === 'sur')).toBe(true);
});

test('filtre à air : plusieurs variantes = à confirmer par l\'atelier, on n\'en choisit aucune', () => {
  const lines = [
    line({ reference: '42610191A', description: 'FILTRE A AIR', drawingId: 'a', drawingDescription: 'ADMISSION' }),
    line({ reference: '42610491A', description: 'FILTRE A AIR', drawingId: 'b', drawingDescription: 'FILTRE A AIR' }),
  ];
  const [p] = resolveFamily(fam('filtre_air'), RULE.filtre_air, lines);
  expect(p.confidence).toBe('a_confirmer');
  expect(p.references).toEqual(['42610191A', '42610491A']);
});

test('une famille obligatoire absente du catalogue passe « à confirmer », une famille optionnelle « non applicable »', () => {
  expect(resolveFamily(fam('filtre_air'), RULE.filtre_air, [])[0].confidence).toBe('a_confirmer');
  expect(resolveFamily(fam('joint_bougie', { optional: true }), RULE.joint_bougie, [])[0].confidence).toBe('non_applicable');
});

test('sans règle de catalogue, rien n\'est inventé', () => {
  expect(resolveFamily(fam('filtre_huile'), undefined, [line({ reference: 'x', description: 'FILTRE A HUILE' })])[0].confidence)
    .toBe('a_confirmer');
});

// --- famille de moteur et signature de kit ---------------------------------

test('la famille de moteur ne retient que filtre à huile, bougie et courroie', () => {
  const parts = [
    { familyCode: 'filtre_huile', references: ['44440035A'] },
    { familyCode: 'bougie', references: ['67040451A'] },
    { familyCode: 'courroie_distribution', references: ['73740252A'] },
    { familyCode: 'filtre_air', references: ['42610191A'] },      // carrosserie : pas le moteur
    { familyCode: 'bouchon_vidange', references: ['89320062A'] },
  ];
  expect(engineFamilyKey(parts)).toBe('44440035A,67040451A,73740252A');
});

test('deux motos au même moteur partagent la clé, une moto sans pièce moteur reste « inconnu »', () => {
  const a = [{ familyCode: 'bougie', references: ['67040451A'] }, { familyCode: 'filtre_huile', references: ['44440035A'] }];
  const b = [{ familyCode: 'filtre_huile', references: ['44440035A'] }, { familyCode: 'bougie', references: ['67040451A'] }];
  expect(engineFamilyKey(a)).toBe(engineFamilyKey(b));
  expect(engineFamilyKey([{ familyCode: 'filtre_air', references: ['x'] }])).toBe('inconnu');
});

test('la signature du kit ne dépend pas de l\'ordre des lignes mais bien des quantités', () => {
  const a = [{ familyCode: 'bougie', references: ['A'], quantity: 2 }, { familyCode: 'filtre_huile', references: ['B'], quantity: 1 }];
  const b = [{ familyCode: 'filtre_huile', references: ['B'], quantity: 1 }, { familyCode: 'bougie', references: ['A'], quantity: 2 }];
  const c = [{ familyCode: 'bougie', references: ['A'], quantity: 4 }, { familyCode: 'filtre_huile', references: ['B'], quantity: 1 }];
  expect(kitSignature(a)).toBe(kitSignature(b));
  expect(kitSignature(a)).not.toBe(kitSignature(c));
});

// --- étage 3 : la picking list et le manquant ------------------------------

const kitItem = (p: Partial<KitItem> & { id: string; designation: string }): KitItem => ({
  familyCode: null, articleId: `art-${p.id}`, reference: null, quantity: 1,
  kind: 'piece', confidence: 'sur', origin: 'deduit', ...p,
});

test('la picking list reprend le kit puis les pièces du technicien, sans doublon', () => {
  const kit = [
    kitItem({ id: '1', designation: 'FILTRE A HUILE', articleId: 'a1', quantity: 1 }),
    kitItem({ id: '2', designation: 'Huile moteur', articleId: null, quantity: 3.8, kind: 'consommable', unit: 'l' }),
  ];
  const atelier = [
    { articleId: 'a1', designation: 'FILTRE A HUILE', quantity: 1 },   // déjà dans le kit
    { articleId: 'a9', designation: 'PLAQUETTES AVANT', quantity: 2 },
  ];
  const draft = buildPickingDraft(kit, atelier);
  expect(draft).toHaveLength(3);
  expect(draft.filter((l) => l.source === 'kit')).toHaveLength(2);
  expect(draft[2]).toMatchObject({ designation: 'PLAQUETTES AVANT', quantity: 2, source: 'atelier' });
});

test('la quantité d\'un consommable est rappelée dans le libellé de la ligne préparée', () => {
  const draft = buildPickingDraft(
    [kitItem({ id: '2', designation: 'Huile moteur', articleId: null, quantity: 3.8, kind: 'consommable', unit: 'l' })], []);
  expect(draft[0].designation).toBe('Huile moteur (3,8 l)');
});

test('une ligne d\'atelier à quantité nulle n\'entre pas dans la préparation', () => {
  expect(buildPickingDraft([], [{ articleId: 'a1', designation: 'x', quantity: 0 }])).toHaveLength(0);
});

test('manquant = besoin − libre − en commande − déjà en brouillon, jamais négatif', () => {
  const base = { mgmtType: 'A', qtyNeeded: 4, realQty: 3, reservedQty: 1, onOrderQty: 0, draftQty: 0 };
  expect(workshopMissingQty(base)).toBe(2);                                   // libre = 2
  expect(workshopMissingQty({ ...base, onOrderQty: 1 })).toBe(1);
  expect(workshopMissingQty({ ...base, onOrderQty: 1, draftQty: 1 })).toBe(0);
  expect(workshopMissingQty({ ...base, realQty: 10 })).toBe(0);
});

test('un stock négatif ne fabrique pas de besoin supplémentaire', () => {
  expect(workshopMissingQty({ mgmtType: 'A', qtyNeeded: 2, realQty: 0, reservedQty: 5, onOrderQty: 0, draftQty: 0 })).toBe(2);
});

test('seules les pièces (A) et les composants de kit (N) se commandent par ce chemin', () => {
  const n = { qtyNeeded: 3, realQty: 0, reservedQty: 0, onOrderQty: 0, draftQty: 0 };
  expect(workshopMissingQty({ ...n, mgmtType: 'A' })).toBe(3);
  expect(workshopMissingQty({ ...n, mgmtType: 'N' })).toBe(3);
  for (const mt of ['M', 'F', 'T', 'V', 'O', 'P', 'D', 'R', null]) {
    expect(workshopMissingQty({ ...n, mgmtType: mt })).toBe(0);
  }
});

// --- type de commande et fichier DCS ---------------------------------------

test('seule la commande urgente sort un fichier DCS URGENTE (ACH001)', () => {
  expect(dcsKindOfWorkshopOrder('urgente')).toBe('URGENTE');
  for (const k of ['standard', 'accident', 'excel']) expect(dcsKindOfWorkshopOrder(k)).toBe('STANDARD');
});

// --- état d'un kit ---------------------------------------------------------

test('un kit n\'est prêt que si chaque ligne a un article et est confirmée', () => {
  const ok = [kitItem({ id: '1', designation: 'A' }), kitItem({ id: '2', designation: 'B' })];
  expect(kitIsReady(ok)).toBe(true);
  expect(kitToConfirmCount(ok)).toBe(0);

  const doubt = [...ok, kitItem({ id: '3', designation: 'Huile', articleId: null, confidence: 'a_confirmer' })];
  expect(kitIsReady(doubt)).toBe(false);
  expect(kitToConfirmCount(doubt)).toBe(1);
  expect(kitIsReady([])).toBe(false);
});
