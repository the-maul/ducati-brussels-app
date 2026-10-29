/**
 * Tests i18n — les quatre dictionnaires (FR référence, NL, EN, IT) ont exactement
 * les mêmes clés (profondeur comprise), aucune valeur vide, et les placeholders
 * `{n}`, `{name}`… du FR se retrouvent dans les trois autres langues.
 * Rappel : les fichiers NL/EN/IT ne contiennent aucun guillemet courbe.
 */
import { test, expect, describe } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fr } from '../src/lib/i18n/fr';
import { nl } from '../src/lib/i18n/nl';
import { en } from '../src/lib/i18n/en';
import { it } from '../src/lib/i18n/it';

type Dict = Record<string, unknown>;

function flatten(obj: Dict, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') {
      for (const [kk, vv] of flatten(v as Dict, key)) out.set(kk, vv);
    } else {
      out.set(key, String(v));
    }
  }
  return out;
}

const placeholders = (s: string) => (s.match(/\{[a-zA-Z0-9_]+\}/g) ?? []).sort();

const reference = flatten(fr as unknown as Dict);
const others: Record<string, Map<string, string>> = {
  nl: flatten(nl as unknown as Dict),
  en: flatten(en as unknown as Dict),
  it: flatten(it as unknown as Dict),
};

describe('i18n — dictionnaires FR / NL / EN / IT', () => {
  test('le FR a des clés et aucune valeur vide', () => {
    expect(reference.size).toBeGreaterThan(1000);
    const empty = [...reference].filter(([, v]) => v.trim() === '').map(([k]) => k);
    expect(empty).toEqual([]);
  });

  for (const [lang, dict] of Object.entries(others)) {
    describe(lang.toUpperCase(), () => {
      test('mêmes clés que le FR (profondeur comprise)', () => {
        const missing = [...reference.keys()].filter((k) => !dict.has(k));
        const extra = [...dict.keys()].filter((k) => !reference.has(k));
        expect({ manquantes: missing, enTrop: extra }).toEqual({ manquantes: [], enTrop: [] });
      });

      test('aucune valeur vide', () => {
        const empty = [...dict].filter(([, v]) => v.trim() === '').map(([k]) => k);
        expect(empty).toEqual([]);
      });

      test('mêmes placeholders {…} que le FR', () => {
        const diff: string[] = [];
        for (const [k, v] of reference) {
          const other = dict.get(k);
          if (other === undefined) continue; // déjà signalé par le test des clés
          if (placeholders(v).join(',') !== placeholders(other).join(',')) diff.push(k);
        }
        expect(diff).toEqual([]);
      });

      test('aucun guillemet courbe dans le fichier source', () => {
        const src = readFileSync(new URL(`../src/lib/i18n/${lang}.ts`, import.meta.url), 'utf8');
        expect(src.match(/[\u2018\u2019\u201C\u201D]/g) ?? []).toEqual([]);
      });
    });
  }
});
