/**
 * Tests de l'éditeur d'étiquettes personnalisées (M2, B12) — CLAUDE.md règle 7.
 * Exécution : `bun test`.
 */
import { test, expect } from 'bun:test';
import {
  defaultTemplateConfig, sampleLabelData, sheetLayout, formatLabelDate, resolveElementText,
  ELEMENT_KEYS,
} from '../src/modules/articles/labels/template-types';
import { renderLabelSvg, buildPrintHtml } from '../src/modules/articles/labels/render';

test('defaultTemplateConfig : format Brother 62×29, 14 éléments, code-barres visible', () => {
  const cfg = defaultTemplateConfig();
  expect(cfg.widthMm).toBe(62);
  expect(cfg.paperHeightMm).toBe(29);
  expect(cfg.elements.length).toBe(ELEMENT_KEYS.length);
  expect(cfg.barcode.visible).toBe(true);
  expect(cfg.elements.find((e) => e.key === 'reference')?.visible).toBe(true);
});

test('sheetLayout : planche A4 pour étiquettes 62×29 sans espaces', () => {
  const cfg = { ...defaultTemplateConfig(), sheetA4: true };
  const l = sheetLayout(cfg);
  expect(l.cols).toBe(3);   // (210-16)/62 = 3,1 → 3
  expect(l.rows).toBe(9);   // (297-16)/29 = 9,7 → 9
  expect(l.perSheet).toBe(27);
});

test('sheetLayout : jamais moins de 1 colonne/ligne', () => {
  const cfg = { ...defaultTemplateConfig(), sheetA4: true, widthMm: 500, heightMm: 500 };
  const l = sheetLayout(cfg);
  expect(l.cols).toBe(1);
  expect(l.rows).toBe(1);
});

test('sheetLayout : dimensions nulles (champ vidé) → pas de division par zéro ni Infinity', () => {
  const cfg = { ...defaultTemplateConfig(), sheetA4: true, widthMm: 0, gapXMm: 0 };
  const l = sheetLayout(cfg);
  expect(l.perSheet).toBe(1);
  expect(Number.isFinite(l.cols)).toBe(true);
});

test('le code-barres du format par défaut tient dans l’étiquette', () => {
  const cfg = defaultTemplateConfig();
  expect(cfg.barcode.yMm + cfg.barcode.heightMm).toBeLessThanOrEqual(cfg.heightMm);
});

test('formatLabelDate : JJ/MM/AAAA et variantes', () => {
  const d = new Date(2026, 6, 17); // 17 juillet 2026
  expect(formatLabelDate('JJ/MM/AAAA', d)).toBe('17/07/2026');
  expect(formatLabelDate('AAAA-MM-JJ', d)).toBe('2026-07-17');
  expect(formatLabelDate('', d)).toBe('17/07/2026'); // défaut
});

test('resolveElementText : mapping des données', () => {
  const cfg = defaultTemplateConfig();
  cfg.freeTexts.free1 = 'PROMO ÉTÉ';
  const data = sampleLabelData('DUCATI BRUXELLES');
  const now = new Date(2026, 6, 17);
  expect(resolveElementText('reference', data, cfg, now)).toBe('REFERENCE');
  expect(resolveElementText('price_ttc', data, cfg, now)).toBe('99999,99 €');
  expect(resolveElementText('store_name', data, cfg, now)).toBe('DUCATI BRUXELLES');
  expect(resolveElementText('free1', data, cfg, now)).toBe('PROMO ÉTÉ');
  expect(resolveElementText('date', data, cfg, now)).toBe('17/07/2026');
});

test('renderLabelSvg : SVG en mm, textes échappés, code-barres imbriqué', () => {
  const cfg = defaultTemplateConfig();
  const data = { ...sampleLabelData('A<B&C'), designation: 'Levier "S" <embouts>' };
  const svg = renderLabelSvg(cfg, data, new Date(), false);
  expect(svg.startsWith('<svg')).toBe(true);
  expect(svg).toContain('viewBox="0 0 62 29"');
  expect(svg).toContain('&lt;embouts&gt;');       // échappement
  expect(svg).not.toContain('<embouts>');
  expect(svg).toContain('preserveAspectRatio="none"'); // code-barres imbriqué
});

test('buildPrintHtml : rouleau = @page papier ; planche = @page A4', () => {
  const cfg = defaultTemplateConfig();
  const items = [{ data: sampleLabelData('X'), qty: 2 }];
  const roll = buildPrintHtml(cfg, items, new Date());
  expect(roll).toContain('@page { size: 62mm 29mm; margin: 0; }');
  expect((roll.match(/class="page"/g) ?? []).length).toBe(2); // qty 2
  const sheet = buildPrintHtml({ ...cfg, sheetA4: true }, items, new Date());
  expect(sheet).toContain('@page { size: A4;');
});
