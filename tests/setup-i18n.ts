/**
 * Prechargement des tests (bunfig.toml [test] preload) : les dictionnaires NL / EN / IT ne sont
 * plus dans le paquet principal (lot perf 2, 20/11/2026) ; on les charge tous avant les tests,
 * comme l'application le fait avant un document dans la langue du client (`ensureLocale`).
 */
import { ensureLocales, isLocaleLoaded, LOCALES } from '../src/lib/i18n';

await ensureLocales();
for (const l of LOCALES) if (!isLocaleLoaded(l)) throw new Error(`dictionnaire ${l} non charge`);
