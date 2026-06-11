/**
 * Tests B12 — Génération Code128 (SVG scannable).
 */
import { test, expect } from 'bun:test';
import { code128Svg } from '../src/modules/articles/barcode';

test('produit un SVG avec des barres', () => {
  const svg = code128Svg('REF-12345');
  expect(svg.startsWith('<svg')).toBe(true);
  expect(svg).toContain('<rect');
  expect(svg).toContain('width=');
});

test('largeur croît avec la longueur du code', () => {
  const w = (s: string) => Number(s.match(/width="(\d+)"/)?.[1] ?? '0');
  expect(w(code128Svg('AAAAAAA'))).toBeGreaterThan(w(code128Svg('A')));
});
