/**
 * Vérif écrans du 20/11/2026 — régressions trouvées à l'écran (ItalTest) :
 *  - le ticket de caisse imprimait une colonne RÉFÉRENCE vide : la référence doit suivre la ligne ;
 *  - une ligne sans référence (main-d'œuvre libre) reste sans clé `reference` (pas de « null » imprimé).
 */
import { test, expect, describe } from 'bun:test';
import { posTicketLines } from '../src/modules/sales/pos-rules';

const line = (p: Record<string, unknown> = {}) => ({
  article_id: 'a1', designation: 'FILTRE A HUILE', quantity: 1, unit_price_ht: 22.31, vat_rate: 21, ...p,
});

describe('posTicketLines — référence article sur le ticket', () => {
  test('la référence du panier part sur la ligne du ticket', () => {
    const [l] = posTicketLines([line({ reference: '44440031C' })]);
    expect(l.reference).toBe('44440031C');
  });

  test('sans référence : pas de clé reference', () => {
    const [l] = posTicketLines([line()]);
    expect('reference' in l).toBe(false);
  });

  test('référence vide ou nulle : ignorée', () => {
    const [a, b] = posTicketLines([line({ reference: '' }), line({ reference: null })]);
    expect('reference' in a).toBe(false);
    expect('reference' in b).toBe(false);
  });
});
