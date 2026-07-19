/**
 * Tests du prix souhaité + visibilité PDF (M7) — CLAUDE.md règle 7.
 * Exécution : `bun test`.
 */
import { test, expect } from 'bun:test';
import { parseWishedPrice, stripRepriseMarkers } from '../src/modules/tradein/sheet-builder';

test('parseWishedPrice : montant + visibilité (défaut visible)', () => {
  expect(parseWishedPrice('Carburant : Essence\nPrix souhaité : 5000 €\nPrix souhaité visible PDF : Oui'))
    .toEqual({ amount: '5000', visible: true });
  expect(parseWishedPrice('Prix souhaité : 4500 €\nPrix souhaité visible PDF : Non'))
    .toEqual({ amount: '4500', visible: false });
  // Marqueur de visibilité absent → visible par défaut
  expect(parseWishedPrice('Prix souhaité : 3000 €')).toEqual({ amount: '3000', visible: true });
  expect(parseWishedPrice('Remarques : rien')).toBeNull();
  expect(parseWishedPrice(null)).toBeNull();
});

test('parseWishedPrice : ne confond pas la ligne de visibilité avec la valeur', () => {
  // La valeur est lue avant le marqueur ; le marqueur seul ne fait pas un montant
  const r = parseWishedPrice('Prix souhaité visible PDF : Non\nPrix souhaité : 8000 €');
  expect(r?.amount).toBe('8000');
});

test('stripRepriseMarkers : retire les deux lignes-marqueurs des remarques', () => {
  const notes = 'Carburant : Essence\nPrix souhaité : 5000 €\nPrix souhaité visible PDF : Non\nRemarques : nickel';
  const out = stripRepriseMarkers(notes);
  expect(out).not.toContain('Prix souhaité');
  expect(out).toContain('Carburant : Essence');
  expect(out).toContain('Remarques : nickel');
});
