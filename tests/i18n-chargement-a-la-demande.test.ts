/**
 * Perf (lot perf 2, 20/11/2026) — NL / EN / IT hors du paquet principal.
 *
 * Le FR (référence) reste chargé d'office ; les trois autres dictionnaires (~1,5 Mo de texte)
 * partent à la demande (`ensureLocale`) et en tâche de fond après l'ouverture. Ces essais
 * vérifient : aucun import direct de nl / en / it dans l'application (sinon Vite les remet dans
 * le paquet principal), tIn() rend bien la langue une fois chargée, et chaque endroit qui
 * fabrique un document / mail / SMS dans la langue du client attend son dictionnaire.
 */
import { test, expect, describe } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ensureLocale, ensureLocales, isLocaleLoaded, tIn, setLocale, getLocale, LOCALES } from '../src/lib/i18n';

const ROOT = join(import.meta.dir, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel);
  }
  return out;
}

describe('dictionnaires a la demande', () => {
  test('index.ts ne charge plus nl / en / it en import statique', () => {
    const src = read('src/lib/i18n/index.ts');
    expect(src).not.toMatch(/^import[^;]*from '\.\/(nl|en|it)';/m);
    expect(src).toContain("import('./nl')");
    expect(src).toContain("import('./en')");
    expect(src).toContain("import('./it')");
    expect(src).not.toMatch(/export \{[^}]*\b(nl|en|it)\b[^}]*\}/);
  });

  test("aucun fichier de l'application n'importe directement nl / en / it", () => {
    const offenders = walk('src')
      .filter((f) => !/src\/lib\/i18n\/(index|nl|en|it)\.ts$/.test(f))
      .filter((f) => /from ['"](@\/lib\/i18n\/|\.\/|\.\.\/)*(i18n\/)?(nl|en|it)['"]/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  test('les quatre langues sont chargees (prechargement des tests) et tIn les rend', async () => {
    await ensureLocales();
    for (const l of LOCALES) expect(isLocaleLoaded(l)).toBe(true);
    expect(tIn('nl', 'nav.dashboard')).not.toBe(tIn('fr', 'nav.dashboard'));
    expect(tIn('it', 'nav.dashboard')).not.toBe(tIn('fr', 'nav.dashboard'));
    // Langue inconnue ou vide : FR.
    expect(tIn('xx', 'nav.dashboard')).toBe(tIn('fr', 'nav.dashboard'));
    expect(tIn(null, 'nav.dashboard')).toBe(tIn('fr', 'nav.dashboard'));
  });

  test('ensureLocale ne rejette jamais, meme pour une langue inconnue', async () => {
    await expect(ensureLocale('xx')).resolves.toBeUndefined();
    await expect(ensureLocale(undefined)).resolves.toBeUndefined();
  });

  test('setLocale sur une langue chargee bascule tout de suite', () => {
    setLocale('nl');
    expect(getLocale()).toBe('nl');
    setLocale('fr');
    expect(getLocale()).toBe('fr');
  });

  // Chaque fabrique de document / message dans la langue du client attend son dictionnaire.
  const mustWait: [string, RegExp][] = [
    ['src/modules/sales/document-pdf.ts', /ensureLocale\(d\.locale\)/],
    ['src/modules/sales/document-pdf-data.ts', /await ensureLocale\(locale\)/],
    ['src/modules/sales/print-document.ts', /await ensureLocale\(locale\)/],
    ['src/modules/sales/receipt-print.ts', /await ensureLocale\(locale\)/],
    ['src/modules/sales/document-list-actions.tsx', /await ensureLocale\(locale\)/],
    ['src/modules/sales/document-mail-dialog.tsx', /useLocaleReady\(/],
    ['src/modules/sales/customer-screen-view.tsx', /useLocaleReady\(\.\.\.LOCALES\)/],
    ['src/modules/crm/matching-api.ts', /await ensureLocale\(locale\)/],
    ['src/modules/accounting/api.ts', /await ensureLocale\(contactLocale\(contact\)\)/],
    ['src/modules/documents/proposal-sign-screen.tsx', /useLocaleReady\(locale\)/],
    ['src/modules/workshop/or-base/print-dialog.tsx', /await ensureLocale\(locale\)/],
    ['src/modules/workshop/or-base/ready-mail-dialog.tsx', /await ensureLocale\(locale\)/],
    ['src/modules/workshop/loans/contract-dialog.tsx', /await ensureLocale\(locale\)/],
    ['src/routes/_app.workshop.$orId.tsx', /await ensureLocale\(locale\)/],
    ['src/routes/_app.sales.$documentId.tsx', /useLocaleReady\(contactLocale\(props\.contact\)\)/],
  ];
  for (const [file, re] of mustWait) {
    test(`${file} attend la langue du client`, () => { expect(read(file)).toMatch(re); });
  }

  test("tout fichier qui appelle tIn est dans la liste ci-dessus (ou n'en a pas besoin)", () => {
    const known = new Set(mustWait.map(([f]) => f));
    // Fonctions synchrones appelees uniquement depuis une fabrique deja couverte.
    const coveredByCaller = new Set([
      'src/modules/sales/invoice-legal.ts', // loadLegalMentions (attend ensureLocale)
      'src/modules/workshop/loans/contract-print.ts', // contract-dialog (attend ensureLocale)
      'src/modules/documents/proposal-sign.ts', // proposal-sign-screen (useLocaleReady)
      'src/modules/sales/customer-screen-device.tsx', // useLocaleReady dans Corner + CustomerScreenView
    ]);
    const callers = walk('src')
      .filter((f) => f !== 'src/lib/i18n/index.ts')
      .filter((f) => /\btIn\(/.test(read(f)));
    const missing = callers.filter((f) => !known.has(f) && !coveredByCaller.has(f));
    expect(missing).toEqual([]);
  });
});
