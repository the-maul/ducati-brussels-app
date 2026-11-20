/**
 * Lot design « ecrans de travail » (20/11/2026) : formateur de montants (separateur de milliers)
 * et alerte d'affichage du stock (Rupture / Stock negatif). Aucune regle de calcul ne change :
 * on teste seulement l'affichage.
 */
import { describe, expect, test } from 'bun:test';
import { formatAmount, formatEur } from '../src/lib/format-eur';
import { stockAlert } from '../src/modules/stock/stock-alert';

const N = ' '; // espace fine insecable (milliers)
const S = ' '; // espace insecable (avant le symbole)

describe('formatEur — montants au format belge', () => {
  test('separateur de milliers et deux decimales', () => {
    expect(formatEur(1027)).toBe(`1${N}027,00${S}€`);
    expect(formatEur(801519.71)).toBe(`801${N}519,71${S}€`);
    expect(formatEur(1234567.5)).toBe(`1${N}234${N}567,50${S}€`);
  });
  test('petits montants, zero, arrondi au cent', () => {
    expect(formatEur(0)).toBe(`0,00${S}€`);
    expect(formatEur(9.999)).toBe(`10,00${S}€`);
    expect(formatEur(0.005)).toBe(`0,01${S}€`);
    expect(formatEur(-0.001)).toBe(`0,00${S}€`);
  });
  test('negatifs, chaines et valeurs absentes', () => {
    expect(formatAmount(-1027.4)).toBe(`-1${N}027,40`);
    expect(formatEur('12.5')).toBe(`12,50${S}€`);
    expect(formatEur(null)).toBe(`0,00${S}€`);
    expect(formatEur(Number.NaN)).toBe(`0,00${S}€`);
  });
});

describe('stockAlert — badge de l ecran Stock', () => {
  const row = (real_qty: number, reserved_qty: number, available_qty: number, stock_min = 0) => ({ real_qty, reserved_qty, available_qty, stock_min });
  test('stock negatif : reel ou disponible sous zero', () => {
    expect(stockAlert(row(-1, 0, -1))).toBe('negative');
    expect(stockAlert(row(2, 3, -1))).toBe('negative');
  });
  test('rupture : plus rien de disponible sur un article suivi ou attendu', () => {
    expect(stockAlert(row(0, 0, 0, 2))).toBe('out');
    expect(stockAlert(row(2, 2, 0))).toBe('out');
  });
  test('pas de badge : stock disponible, ou article simplement non stocke', () => {
    expect(stockAlert(row(5, 1, 4, 2))).toBeNull();
    expect(stockAlert(row(0, 0, 0))).toBeNull();
    expect(stockAlert(row(1, 0, 1, 3))).toBeNull();
  });
});
