/**
 * Tests de l'éditeur d'étiquettes personnalisées (M2, B12) — CLAUDE.md règle 7.
 * Exécution : `bun test`.
 */
import { test, expect } from 'bun:test';
import {
  defaultTemplateConfig, normalizeTemplateConfig, sampleLabelData, sheetLayout, formatLabelDate, resolveElementText,
  ELEMENT_KEYS, makeCustomElement,
} from '../src/modules/articles/labels/template-types';
import { renderLabelSvg, buildPrintHtml } from '../src/modules/articles/labels/render';

test('defaultTemplateConfig : format 62×29, 14 éléments, code-barres masqué, cadre + logo', () => {
  const cfg = defaultTemplateConfig();
  expect(cfg.widthMm).toBe(62);
  expect(cfg.paperHeightMm).toBe(29);
  expect(cfg.elements.length).toBe(ELEMENT_KEYS.length);
  expect(cfg.barcode.visible).toBe(false);   // étiquette type sans code-barres
  expect(cfg.border.visible).toBe(true);      // cadre imprimé
  expect(cfg.image.visible).toBe(true);       // logo Ducati
  expect(cfg.image.dataUrl?.startsWith('data:image/svg+xml')).toBe(true);
  expect(cfg.elements.find((e) => e.key === 'reference')?.visible).toBe(true);
  expect(cfg.elements.find((e) => e.key === 'bin')?.visible).toBe(true); // CASIER
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

test('normalizeTemplateConfig : un format sauvegardé SANS bin2 est complété (pas de plantage)', () => {
  const old = defaultTemplateConfig();
  old.elements = old.elements.filter((e) => e.key !== 'bin2'); // format d'avant l'ajout
  const norm = normalizeTemplateConfig(old);
  expect(norm.elements.length).toBe(ELEMENT_KEYS.length);
  expect(norm.elements.find((e) => e.key === 'bin2')?.visible).toBe(false);
  // Les réglages existants sont conservés
  expect(norm.elements.find((e) => e.key === 'reference')?.visible).toBe(true);
});

test('normalizeTemplateConfig : config nulle → défauts complets', () => {
  const norm = normalizeTemplateConfig(null);
  expect(norm.widthMm).toBe(62);
  expect(norm.elements.length).toBe(ELEMENT_KEYS.length);
});

test('resolveElementText : bin2 (Localisation 2)', () => {
  const cfg = defaultTemplateConfig();
  const data = sampleLabelData('X');
  expect(resolveElementText('bin2', data, cfg, new Date())).toBe('LOCALISATION 2');
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
  expect(resolveElementText('price_ttc', data, cfg, now)).toBe('99 999,99 €');
  expect(resolveElementText('store_name', data, cfg, now)).toBe('DUCATI BRUXELLES');
  expect(resolveElementText('free1', data, cfg, now)).toBe('PROMO ÉTÉ');
  expect(resolveElementText('date', data, cfg, now)).toBe('17/07/2026');
});

test('renderLabelSvg : SVG en mm, textes échappés, cadre + logo ; code-barres imbriqué si activé', () => {
  const cfg = defaultTemplateConfig();
  cfg.barcode.visible = true; // on active pour vérifier le rendu du code-barres
  const data = { ...sampleLabelData('A<B&C'), designation: 'Levier "S" <embouts>' };
  const svg = renderLabelSvg(cfg, data, new Date(), false);
  expect(svg.startsWith('<svg')).toBe(true);
  expect(svg).toContain('viewBox="0 0 62 29"');
  expect(svg).toContain('&lt;embouts&gt;');       // échappement
  expect(svg).not.toContain('<embouts>');
  expect(svg).toContain('preserveAspectRatio="none"'); // code-barres imbriqué
  expect(svg).toContain('stroke="#000"');          // cadre imprimé
  expect(svg).toContain('data:image/svg+xml');     // logo Ducati
});

test('renderLabelSvg : lignes personnalisées (ajout) rendues, ligne masquée ou vide ignorée', () => {
  const cfg = defaultTemplateConfig();
  cfg.custom = [
    makeCustomElement({ text: 'MADE IN ITALY', xMm: 3, yMm: 15, bold: true }),
    makeCustomElement({ text: 'CACHÉ', visible: false }),
    makeCustomElement({ text: '', visible: true }),
  ];
  const svg = renderLabelSvg(cfg, sampleLabelData('X'), new Date(), false);
  expect(svg).toContain('MADE IN ITALY');
  expect(svg).not.toContain('CACHÉ');       // ligne non visible ignorée
});

test('normalizeTemplateConfig : lignes personnalisées conservées, défauts complétés', () => {
  const cfg = defaultTemplateConfig();
  cfg.custom = [makeCustomElement({ text: 'X', id: 'fixe-1' })];
  const norm = normalizeTemplateConfig(cfg);
  expect(norm.custom.length).toBe(1);
  expect(norm.custom[0].id).toBe('fixe-1');
  expect(norm.custom[0].text).toBe('X');
  // config sans custom (ancien enregistrement) → tableau vide, pas de plantage
  expect(normalizeTemplateConfig({ widthMm: 62 }).custom).toEqual([]);
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
