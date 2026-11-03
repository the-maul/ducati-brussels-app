/**
 * Popup « pieces d'entretien manquantes » (mission 09, carte 3) :
 *   manquant = kit − stock libre − deja en commande ; pas de popup si rien ne manque ;
 *   standard / urgente selon la date du RDV (reglage N jours) ; jamais deux fois les memes
 *   pieces pour le meme OR / RDV (memoire) ; doublons d'article additionnes.
 * Execution : `bun test`.
 */
import { test, expect, describe } from 'bun:test';
import {
  missingKitParts, popupNeeded, suggestedKind, daysUntil, partKey, basketLines, promptLines, isMaintenanceReasonCode,
  DEFAULT_URGENT_WITHIN_DAYS, type KitStockLine,
} from '../src/modules/workshop/parts-popup-rules';

const line = (p: Partial<KitStockLine> & { reference: string }): KitStockLine => ({
  articleId: `art-${p.reference}`, designation: p.reference, quantity: 1, realQty: 0, reservedQty: 0, onOrderQty: 0, confidence: 'sur', ...p,
});

describe('pieces manquantes = kit − stock − en commande', () => {
  test('stock suffisant : rien ne manque, pas de popup', () => {
    const missing = missingKitParts([line({ reference: 'FILTRE', quantity: 1, realQty: 3 })]);
    expect(missing).toEqual([]);
    expect(popupNeeded(missing)).toBe(false);
  });
  test('stock reel moins reserve, puis en commande, puis le reste manque', () => {
    const missing = missingKitParts([
      line({ reference: 'HUILE', quantity: 4, realQty: 3, reservedQty: 2, onOrderQty: 1 }),   // libre 1 + 1 en cde → manque 2
      line({ reference: 'JOINT', quantity: 2, realQty: 0, onOrderQty: 2 }),                   // couvert par la commande
      line({ reference: 'BOUGIE', quantity: 2, realQty: 5, reservedQty: 9 }),                 // libre jamais negatif → manque 2
    ]);
    expect(missing.map((m) => [m.reference, m.qtyMissing])).toEqual([['BOUGIE', 2], ['HUILE', 2]]);
    expect(popupNeeded(missing)).toBe(true);
  });
  test('deux lignes du meme article : quantites additionnees, une seule ligne', () => {
    const missing = missingKitParts([line({ reference: 'VIS', quantity: 2, realQty: 1 }), line({ reference: 'VIS', quantity: 3 })]);
    expect(missing).toHaveLength(1);
    expect(missing[0].qtyNeeded).toBe(5);
    expect(missing[0].qtyMissing).toBe(4);
  });
  test('pieces « absentes » du catalogue ou sans article ni reference : pas proposees', () => {
    expect(missingKitParts([line({ reference: 'X', confidence: 'absent' }), { ...line({ reference: '' }), articleId: null }])).toEqual([]);
  });
  test('deux references pour la meme piece (« on garde les deux », M-90) : les deux sont proposees', () => {
    const missing = missingKitParts([
      line({ reference: '42710251A', quantity: 2, confidence: 'a_confirmer' }),
      line({ reference: '44440312B', quantity: 1, confidence: 'a_confirmer' }),
    ]);
    expect(missing.map((m) => [m.reference, m.qtyMissing])).toEqual([['42710251A', 2], ['44440312B', 1]]);
  });
});

describe('memoire : jamais redemander les memes pieces', () => {
  test('les pieces deja proposees pour cet OR sont ecartees', () => {
    const kit = [line({ reference: 'HUILE', quantity: 1 }), line({ reference: 'FILTRE', quantity: 1 })];
    const first = missingKitParts(kit);
    expect(first.map((m) => m.reference)).toEqual(['FILTRE', 'HUILE']);
    const asked = first.map(partKey);
    expect(missingKitParts(kit, asked)).toEqual([]);
    expect(popupNeeded(missingKitParts(kit, asked))).toBe(false);
  });
  test('cle = article, sinon reference', () => {
    expect(partKey({ articleId: 'a1', reference: 'R' })).toBe('a1');
    expect(partKey({ articleId: null, reference: ' r1 ' })).toBe('ref:R1');
  });
  test('une nouvelle piece du kit, elle, est proposee', () => {
    const asked = [partKey({ articleId: 'art-HUILE', reference: 'HUILE' })];
    const missing = missingKitParts([line({ reference: 'HUILE' }), line({ reference: 'COURROIE' })], asked);
    expect(missing.map((m) => m.reference)).toEqual(['COURROIE']);
  });
});

describe('standard ou urgente selon la date du rendez-vous', () => {
  const today = '2026-11-03';
  test('RDV a moins de N jours (defaut 5) → urgente ; sinon standard', () => {
    expect(DEFAULT_URGENT_WITHIN_DAYS).toBe(5);
    expect(daysUntil('2026-11-07', today)).toBe(4);
    expect(suggestedKind('2026-11-07', today)).toBe('urgente');
    expect(suggestedKind('2026-11-08', today)).toBe('standard');
    expect(suggestedKind('2026-11-20', today)).toBe('standard');
  });
  test('le reglage N est suivi', () => {
    expect(suggestedKind('2026-11-10', today, 10)).toBe('urgente');
    expect(suggestedKind('2026-11-10', today, 5)).toBe('standard');
    expect(suggestedKind('2026-11-04', today, 0)).toBe('standard');
  });
  test('sans date (ouverture d\'un OR, la moto est la) → urgente', () => {
    expect(suggestedKind(null, today)).toBe('urgente');
  });
});

describe('lignes pour le panier et la memoire', () => {
  test('basketLines / promptLines reprennent article, reference, quantite manquante', () => {
    const missing = missingKitParts([line({ reference: 'HUILE', quantity: 3, realQty: 1 })]);
    expect(basketLines(missing)).toEqual([{ article_id: 'art-HUILE', reference: 'HUILE', designation: 'HUILE', qty: 2 }]);
    expect(promptLines(missing)).toEqual([{ article_id: 'art-HUILE', reference: 'HUILE', designation: 'HUILE', qty_missing: 2 }]);
  });
  test('motif entretien : entretien_* ou vidange', () => {
    expect(isMaintenanceReasonCode('entretien_15000')).toBe(true);
    expect(isMaintenanceReasonCode('vidange')).toBe(true);
    expect(isMaintenanceReasonCode('pneus')).toBe(false);
    expect(isMaintenanceReasonCode(null)).toBe(false);
  });
});
