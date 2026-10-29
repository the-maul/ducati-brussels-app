/**
 * i18n — point d'entrée (CLAUDE.md règle 10).
 * Quatre langues : FR (référence et défaut), NL, EN, IT. Chaque utilisateur
 * choisit la sienne (`profiles.locale`, menu du compte en haut à droite).
 *
 * Usage :
 *   import { t } from '@/lib/i18n';
 *   t('nav.dashboard')           // "Tableau de bord"
 *
 * Réactivité : `setLocale()` prévient le <LocaleProvider> (monté dans __root),
 * qui re-monte l'arbre de l'application sous lui (clé React = locale). Tous les
 * appels `t()` faits au rendu repartent donc dans la nouvelle langue, sans
 * rechargement de page. Côté serveur (SSR) la locale reste FR : le profil n'est
 * connu qu'au navigateur, qui bascule juste après le chargement de la session.
 */
import { createContext, createElement, Fragment, useContext, useEffect, useState, type ReactNode } from 'react';
import { fr, type Dictionary, type DictionaryShape } from './fr';
import { nl } from './nl';
import { en } from './en';
import { it } from './it';

export const LOCALES = ['fr', 'nl', 'en', 'it'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'fr';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

const dictionaries: Record<Locale, DictionaryShape> = { fr, nl, en, it };

// Locale active (module) + abonnés React.
let currentLocale: Locale = DEFAULT_LOCALE;
const listeners = new Set<(locale: Locale) => void>();

export function setLocale(locale: Locale) {
  const next = isLocale(locale) ? locale : DEFAULT_LOCALE;
  if (next === currentLocale) return;
  currentLocale = next;
  for (const fn of listeners) fn(next);
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
 * Traduit une clé dans la langue active. Retourne la clé elle-même si absente
 * (visible en dev, jamais de crash). Le FR reste le filet de sécurité.
 */
export function t(key: string): string {
  return tIn(currentLocale, key);
}

/**
 * Traduit une clé dans une langue DONNÉE, sans toucher à la langue active de l'écran.
 * Sert aux documents et messages adressés au client (I18N004, décision M-71) : le PDF du
 * devis, l'objet et le corps du mail, le SMS sortent dans la langue de la fiche du client
 * pendant que l'utilisateur garde la sienne. Repli : FR si la clé manque dans la langue.
 */
export function tIn(locale: Locale | string | null | undefined, key: string): string {
  const loc = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const dict = dictionaries[loc] ?? fr;
  const value = resolve(dict, key) ?? resolve(fr, key);
  if (value === undefined) {
    if (import.meta.env?.DEV) console.warn(`[i18n] clé manquante : ${key}`);
    return key;
  }
  return value;
}

/**
 * Titre d'onglet du navigateur pour une page (`head: () => ({ meta: [{ title: pageTitle('dashboard') }] })`).
 * `head` est evalue hors React par le routeur : on lit la locale courante du module
 * (FR au rendu serveur, puis la langue de l'utilisateur au navigateur). Le suffixe
 * « — Ducati Bruxelles » est un nom propre, identique dans les quatre langues.
 */
export function pageTitle(key: keyof DictionaryShape['pageTitles']): string {
  return `${t(`pageTitles.${key}`)} — ${t('app.name')}`;
}

/** Remplace les `{nom}` d'un libellé par les valeurs données (clé absente : laissée telle quelle). */
export function fillVars(text: string, vars: Record<string, string | number | null | undefined>): string {
  return Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(v == null ? '' : String(v)), text);
}

const LocaleCtx = createContext<Locale>(DEFAULT_LOCALE);

/**
 * Fournit la locale aux composants et re-monte ses enfants quand elle change.
 * À monter une seule fois, sous <AuthProvider> (qui lit `profiles.locale`).
 */
export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setState] = useState<Locale>(getLocale);

  useEffect(() => {
    listeners.add(setState);
    setState(getLocale()); // rattrape un setLocale() arrivé avant le montage
    return () => { listeners.delete(setState); };
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.lang = locale;
  }, [locale]);

  return createElement(
    LocaleCtx.Provider,
    { value: locale },
    createElement(Fragment, { key: locale }, children),
  );
}

/** Locale active, réactive (re-rend le composant au changement de langue). */
export function useLocale(): Locale {
  return useContext(LocaleCtx);
}

/** Hook React : même fonction `t`, mais le composant suit les changements de langue. */
export function useT() {
  useLocale();
  return t;
}

export { fr, nl, en, it };
export type { Dictionary, DictionaryShape };
