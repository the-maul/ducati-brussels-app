/**
 * i18n — point d'entrée (CLAUDE.md règle 10).
 * FR par défaut, structure prête pour le NL.
 *
 * Usage :
 *   import { t } from '@/lib/i18n';
 *   t('nav.dashboard')           // "Tableau de bord"
 *   t('search.empty')            // "Aucun résultat"
 *
 * Quand le NL sera ajouté : créer src/lib/i18n/nl.ts (mêmes clés),
 * exposer un état de locale et faire pointer `dict` dessus.
 */
import { fr } from './fr';

export type Locale = 'fr' | 'nl';

const dictionaries: Record<Locale, typeof fr> = { fr, nl: fr };

// Locale active. NL viendra plus tard (Bruxelles, charte §8).
let currentLocale: Locale = 'fr';

export function setLocale(locale: Locale) {
  currentLocale = locale;
}

export function getLocale(): Locale {
  return currentLocale;
}

/** Récupère une valeur imbriquée par chemin pointé ("a.b.c"). */
function resolve(obj: unknown, path: string): string | undefined {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj) as string | undefined;
}

/**
 * Traduit une clé. Retourne la clé elle-même si absente (visible en dev,
 * jamais de crash). On garde le FR comme filet de sécurité.
 */
export function t(key: string): string {
  const dict = dictionaries[currentLocale] ?? fr;
  const value = resolve(dict, key) ?? resolve(fr, key);
  if (value === undefined) {
    if (import.meta.env?.DEV) console.warn(`[i18n] clé manquante : ${key}`);
    return key;
  }
  return value;
}

/** Hook React (même fonction ; placeholder pour une future réactivité de locale). */
export function useT() {
  return t;
}

export { fr };
