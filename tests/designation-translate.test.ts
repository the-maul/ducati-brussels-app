/**
 * Tests du moteur de traduction des designations (M2, I18N002) — CLAUDE.md regle 7.
 * Etage 1 (glossaire mecanique, detection de langue, couverture) et logique de
 * partition de la memoire de traduction (etage 2, sans reseau). Execution : `bun test`.
 */
import { test, expect } from 'bun:test';
import {
  translateWithGlossary, detectLanguage, isCoveredByGlossary, partitionByMemory, memoryRowsFor, type MemoryRow,
} from '../src/modules/articles/translate/engine';
import { designationFields } from '../src/modules/articles/translate/api';
import { diffRow, type ExistingArticle } from '../src/modules/articles/import/rules';

// Dix designations reelles des tarifs et du catalogue Ducati, IT et EN, et le FR attendu.
const CAS: [string, string][] = [
  ['SUPPORTO SERBATOIO', 'SUPPORT DE RESERVOIR'],
  ['FRONT BRAKE LINE', 'DURITE DE FREIN AVANT'],
  ['VITE TCEIF M6X20', 'VIS TCEIF M6X20'],
  ['KIT PASTIGLIE FRENO ANTERIORE', 'KIT PLAQUETTES DE FREIN AVANT'],
  ['COMPLETE FRONT FORK', 'FOURCHE AVANT COMPLETE'],
  ['SELLA COMPLETA', 'SELLE COMPLETE'],
  ['PARAFANGO ANTERIORE CARBONIO', 'GARDE-BOUE AVANT CARBONE'],
  ['REAR WHEEL ASSY', 'ENSEMBLE DE ROUE ARRIERE'],
  ['GUARNIZIONE COPERCHIO FRIZIONE', 'JOINT DE COUVERCLE D\'EMBRAYAGE'],
  ['STEERING DAMPER', 'AMORTISSEUR DE DIRECTION'],
];

test('glossaire : dix designations reelles IT / EN donnent le FR attendu', () => {
  for (const [source, fr] of CAS) {
    const r = translateWithGlossary(source);
    expect(r.covered).toBe(true);
    expect(r.i18n.fr).toBe(fr);
  }
});

test('glossaire : les quatre langues sont renseignees et la langue source garde son texte', () => {
  const r = translateWithGlossary('SUPPORTO SERBATOIO');
  expect(r.lang).toBe('it');
  expect(r.i18n).toEqual({ fr: 'SUPPORT DE RESERVOIR', nl: 'TANKSTEUN', en: 'TANK SUPPORT', it: 'SUPPORTO SERBATOIO' });
  const en = translateWithGlossary('FRONT BRAKE LINE');
  expect(en.i18n.en).toBe('FRONT BRAKE LINE');
  expect(en.i18n.it).toBe('TUBAZIONE FRENO ANTERIORE');
  expect(en.i18n.nl).toBe('REMLEIDING VOOR');
});

test('glossaire : codes, dimensions et invariants sont gardes tels quels', () => {
  const r = translateWithGlossary('VITE TCEIF M6X20');
  expect(r.i18n.en).toBe('SCREW TCEIF M6X20');
  expect(r.i18n.nl).toBe('SCHROEF TCEIF M6X20');
  const kit = translateWithGlossary('KIT ABS');
  expect(kit.covered).toBe(true);
  expect(kit.i18n.fr).toBe('KIT ABS');
  // Casse et accents de la source normalises
  expect(translateWithGlossary('Supporto serbatoio').i18n.fr).toBe('SUPPORT DE RESERVOIR');
});

test('detection de langue : vote des mots connus', () => {
  expect(detectLanguage('SUPPORTO SERBATOIO').lang).toBe('it');
  expect(detectLanguage('FRONT BRAKE LINE').lang).toBe('en');
  expect(detectLanguage('SUPPORT DE RESERVOIR').lang).toBe('fr');
  expect(detectLanguage('REMLEIDING VOOR').lang).toBe('nl');
  // Egalite (SUPPORT existe en FR et en EN) : langue inconnue, pas de pari
  expect(detectLanguage('SUPPORT').lang).toBe('?');
  // Rien de connu : inconnue
  expect(detectLanguage('XYZZY 123').lang).toBe('?');
});

test('couverture : un mot inconnu laisse la designation a l etage 2', () => {
  const r = translateWithGlossary('CAPPELLINO NERO CHILI');
  expect(r.covered).toBe(false);
  expect(r.unknown).toEqual(['CHILI']);
  // La traduction partielle existe quand meme, pour information
  expect(r.i18n.fr).toBe('CASQUETTE NOIRE CHILI');
  expect(isCoveredByGlossary('SUPPORTO SERBATOIO')).toBe(true);
  expect(isCoveredByGlossary('SUPPORTO PIPPO')).toBe(false);
  // Langue indeterminee = pas couverte (on ne reordonne pas a l aveugle)
  expect(isCoveredByGlossary('SUPPORT')).toBe(false);
});

test('glossaire : un libelle deja en FR reste tel quel et donne les autres langues', () => {
  const r = translateWithGlossary('SUPPORT DE RESERVOIR');
  expect(r.lang).toBe('fr');
  expect(r.i18n.fr).toBe('SUPPORT DE RESERVOIR');
  expect(r.i18n.it).toBe('SUPPORTO SERBATOIO');
  expect(r.i18n.en).toBe('TANK SUPPORT');
});

test('memoire : un texte deja traduit ne repart pas vers Claude', () => {
  const rows: MemoryRow[] = [
    ...memoryRowsFor('MOLLA PIPPO', 'it', { fr: 'RESSORT PIPPO', nl: 'VEER PIPPO', en: 'PIPPO SPRING', it: 'MOLLA PIPPO' }, 'claude'),
    // Incomplet : il manque le NL
    { source_text: 'DADO ZORRO', source_lang: 'it', target_lang: 'fr', target_text: 'ECROU ZORRO' },
    { source_text: 'DADO ZORRO', source_lang: 'it', target_lang: 'en', target_text: 'ZORRO NUT' },
  ];
  const { ready, missing } = partitionByMemory(
    [{ text: 'MOLLA PIPPO', lang: 'it' }, { text: 'DADO ZORRO', lang: 'it' }, { text: 'JAMAIS VU' }],
    rows,
  );
  expect(ready.map((r) => r.text)).toEqual(['MOLLA PIPPO']);
  expect(ready[0].i18n).toEqual({ fr: 'RESSORT PIPPO', nl: 'VEER PIPPO', en: 'PIPPO SPRING', it: 'MOLLA PIPPO' });
  expect(missing.map((m) => m.text)).toEqual(['DADO ZORRO', 'JAMAIS VU']);
  // Langue source inconnue cote demande : n importe quelle langue source complete convient
  expect(partitionByMemory([{ text: 'MOLLA PIPPO' }], rows).ready).toHaveLength(1);
  // Langue source contradictoire : pas de correspondance
  expect(partitionByMemory([{ text: 'MOLLA PIPPO', lang: 'en' }], rows).ready).toHaveLength(0);
});

test('memoire : les lignes a enregistrer excluent la langue source', () => {
  const rows = memoryRowsFor('SUPPORTO SERBATOIO', 'it', { fr: 'SUPPORT DE RESERVOIR', nl: 'TANKSTEUN', en: 'TANK SUPPORT', it: 'SUPPORTO SERBATOIO' }, 'glossaire');
  expect(rows.map((r) => r.target_lang).sort()).toEqual(['en', 'fr', 'nl']);
  expect(rows.every((r) => r.engine === 'glossaire' && r.source_lang === 'it')).toBe(true);
});

test('champs article : FR affiche, original garde, date posee ; sans traduction, a relancer', () => {
  const r = translateWithGlossary('SUPPORTO SERBATOIO');
  const f = designationFields('SUPPORTO  SERBATOIO ', { lang: r.lang as 'it', i18n: r.i18n, from: 'glossaire' }, '2026-10-30T10:00:00.000Z');
  expect(f.designation).toBe('SUPPORT DE RESERVOIR');
  expect(f.designation_source).toBe('SUPPORTO SERBATOIO');
  expect(f.designation_source_lang).toBe('it');
  expect(f.designation_translated_at).toBe('2026-10-30T10:00:00.000Z');
  const none = designationFields('SUPPORTO PIPPO', null);
  expect(none.designation).toBe('SUPPORTO PIPPO');
  expect(none.designation_source).toBe('SUPPORTO PIPPO');
  expect(none.designation_translated_at).toBeNull();
  expect(none.designation_i18n).toEqual({});
});

test('import : le tarif se compare a l original fournisseur, pas a la version FR', () => {
  const existing: ExistingArticle = {
    id: 'a1', reference: 'R1', designation: 'SUPPORT DE RESERVOIR', brand: null, category_path: null, supplier_ref: null,
    purchase_price: 0, sale_price_ttc: 0, coefficient: null, superseded_by_id: null, is_library: false,
    designation_source: 'SUPPORTO SERBATOIO',
  };
  // Meme original : rien ne change
  expect(diffRow({ reference: 'R1', designation: 'SUPPORTO SERBATOIO', rowIndex: 1 }, existing).changes).toHaveLength(0);
  // Original modifie chez Ducati : le patch porte le nouvel original (traduit ensuite)
  const d = diffRow({ reference: 'R1', designation: 'SUPPORTO SERBATOIO CARBONIO', rowIndex: 1 }, existing);
  expect(d.patch.designation).toBe('SUPPORTO SERBATOIO CARBONIO');
});
