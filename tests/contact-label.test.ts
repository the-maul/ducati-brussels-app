/**
 * Tests de l'étiquette client + impression rapide (M1/M2, B12) — CLAUDE.md règle 7.
 * Exécution : `bun test`.
 */
import { test, expect } from 'bun:test';
import {
  vinLast6, buildContactLabelLines, LABEL_LOCATIONS, LOCATION_FREE, type ContactLabelSelection,
} from '../src/modules/contacts/contact-label-data';
import { renderFreeTextLabelSvg, DEFAULT_QUICK_STYLE } from '../src/modules/articles/labels/render';

const base: ContactLabelSelection = {
  includeName: false, nameLine: 'Gelya Dupont',
  includeCompany: false, companyLine: 'PCB Construct',
  includeModel: false, modelLine: 'Ducati Multistrada V4 S',
  includeVin6: false, vin: 'ZDMDLKKD1000616',
  includeDoc: false, docNumber: 'FAC-2026-00042',
  includeLocation: false, location: LABEL_LOCATIONS[0], freeLocation: '',
};

test('vinLast6 : 6 derniers caractères en majuscules, préfixés *', () => {
  expect(vinLast6('ZDMDLKKD1000616')).toBe('*000616');
  expect(vinLast6('zdm abc 123')).toBe('*ABC123');
  expect(vinLast6('')).toBe('');
  expect(vinLast6(null)).toBe('');
});

test('buildContactLabelLines : style P-touch (nom, modèle, châssis)', () => {
  const lines = buildContactLabelLines({ ...base, includeName: true, includeModel: true, includeVin6: true });
  expect(lines).toEqual(['GELYA DUPONT', 'DUCATI MULTISTRADA V4 S', '*000616']);
});

test('buildContactLabelLines : localisation liste et texte libre', () => {
  expect(buildContactLabelLines({ ...base, includeLocation: true, location: 'G.ET.C' })).toEqual(['G.ET.C']);
  expect(buildContactLabelLines({ ...base, includeLocation: true, location: LOCATION_FREE, freeLocation: 'Rayon 4' })).toEqual(['RAYON 4']);
  expect(buildContactLabelLines({ ...base, includeLocation: true, location: LOCATION_FREE, freeLocation: '  ' })).toEqual([]);
});

test('buildContactLabelLines : lignes vides/décochées exclues', () => {
  expect(buildContactLabelLines(base)).toEqual([]);
  expect(buildContactLabelLines({ ...base, includeDoc: true, docNumber: '' })).toEqual([]);
  expect(buildContactLabelLines({ ...base, includeVin6: true, vin: null })).toEqual([]);
});

test('renderFreeTextLabelSvg : italique/souligné/proportions dans le SVG', () => {
  const svg = renderFreeTextLabelSvg({ widthMm: 62, heightMm: 29 }, ['GELYA', 'MTS V4S'],
    { ...DEFAULT_QUICK_STYLE, italic: true, underline: true, scaleX: 120, scaleY: 90, align: 'center' });
  expect(svg).toContain('font-style="italic"');
  expect(svg).toContain('text-decoration="underline"');
  expect(svg).toContain('scale(1.2 0.9)');
  expect(svg).toContain('text-anchor="middle"');
  expect((svg.match(/<text /g) ?? []).length).toBe(2);
});

test('renderFreeTextLabelSvg : lignes vides ignorées, texte échappé', () => {
  const svg = renderFreeTextLabelSvg({ widthMm: 62, heightMm: 29 }, ['A<B>', '', '&C'], DEFAULT_QUICK_STYLE);
  expect((svg.match(/<text /g) ?? []).length).toBe(2);
  expect(svg).toContain('A&lt;B&gt;');
  expect(svg).toContain('&amp;C');
});
