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
 *
 * Perf (20/11/2026, lot perf 2) : seul le FR est dans le paquet principal. NL, EN et IT
 * (~1,5 Mo de texte) sont chargés à la demande (`ensureLocale`), puis tous les trois en tâche
 * de fond quelques secondes après l'ouverture (`preloadLocalesWhenIdle`). `tIn()` reste
 * synchrone : un document ou un mail dans la langue du client attend `ensureLocale(langue)`
 * avant de se construire ; un écran qui affiche une autre langue utilise `useLocaleReady`.
 * Une langue pas encore chargée retombe sur le FR (jamais de clé brute, jamais de plantage).
 */
import { createContext, createElement, Fragment, useContext, useEffect, useState, type ReactNode } from 'react';
import { fr, type Dictionary, type DictionaryShape } from './fr';

export const LOCALES = ['fr', 'nl', 'en', 'it'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'fr';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

// FR toujours présent (référence + filet de sécurité) ; les trois autres langues à la demande.
const loaders: Record<Exclude<Locale, 'fr'>, () => Promise<DictionaryShape>> = {
  nl: () => import('./nl').then((m) => m.nl),
  en: () => import('./en').then((m) => m.en),
  it: () => import('./it').then((m) => m.it),
};
const dictionaries: Partial<Record<Locale, DictionaryShape>> = { fr };
const loading = new Map<Locale, Promise<void>>();
const readyListeners = new Set<(locale: Locale) => void>();

/** Vrai si le dictionnaire de cette langue est déjà en mémoire (`tIn` y répond tout de suite). */
export function isLocaleLoaded(locale: Locale | string | null | undefined): boolean {
  return !!dictionaries[isLocale(locale) ? locale : DEFAULT_LOCALE];
}

/**
 * Charge le dictionnaire d'une langue (une seule fois, appels simultanés partagés).
 * À attendre AVANT de construire un document, un mail ou un SMS dans la langue du client.
 * Ne rejette jamais : si le chargement échoue (réseau), le texte sortira en FR et un nouvel
 * essai partira au prochain appel.
 */
export function ensureLocale(locale: Locale | string | null | undefined): Promise<void> {
  const loc = isLocale(locale) ? locale : DEFAULT_LOCALE;
  if (dictionaries[loc]) return Promise.resolve();
  let p = loading.get(loc);
  if (!p) {
    p = loaders[loc as Exclude<Locale, 'fr'>]()
      .then((dict) => {
        dictionaries[loc] = dict;
        for (const fn of readyListeners) fn(loc);
      })
      .catch((e) => {
        loading.delete(loc);
        if (import.meta.env?.DEV) console.warn(`[i18n] chargement impossible : ${loc}`, e);
      });
    loading.set(loc, p);
  }
  return p;
}

/** Charge plusieurs langues (par défaut les quatre). */
export function ensureLocales(locales: readonly (Locale | string | null | undefined)[] = LOCALES): Promise<void> {
  return Promise.all(locales.map((l) => ensureLocale(l))).then(() => undefined);
}

/**
 * Précharge NL, EN et IT en tâche de fond, après l'ouverture de l'application : les écrans et
 * documents qui appellent `tIn` sans attendre trouvent leur langue prête. Navigateur seulement.
 */
export function preloadLocalesWhenIdle(delayMs = 4000): void {
  if (typeof window === 'undefined') return;
  const run = () => { void ensureLocales(); };
  const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  window.setTimeout(() => (idle ? idle(run, { timeout: 5000 }) : run()), delayMs);
}

// Locale active (module) + abonnés React.
let currentLocale: Locale = DEFAULT_LOCALE;
let requestedLocale: Locale = DEFAULT_LOCALE;
const listeners = new Set<(locale: Locale) => void>();
const HINT_KEY = 'ducati.i18n.locale';

function applyLocale(next: Locale) {
  if (next === currentLocale) return;
  currentLocale = next;
  for (const fn of listeners) fn(next);
}

/**
 * Change la langue de l'écran. Langue déjà chargée : bascule immédiate. Sinon la bascule a lieu
 * dès que son dictionnaire est arrivé (l'écran reste dans la langue précédente en attendant).
 */
export function setLocale(locale: Locale) {
  const next = isLocale(locale) ? locale : DEFAULT_LOCALE;
  requestedLocale = next;
  try { if (typeof window !== 'undefined') window.localStorage.setItem(HINT_KEY, next); } catch { /* stockage indisponible */ }
  if (dictionaries[next]) { applyLocale(next); return; }
  void ensureLocale(next).then(() => {
    if (requestedLocale === next && dictionaries[next]) applyLocale(next);
  });
}

export function getLocale(): Locale {
  return currentLocale;
}

// Dernière langue de l'utilisateur sur ce poste : son dictionnaire part dès le chargement du
// module, en parallèle de la session (le profil, lu ensuite, confirme ou corrige).
if (typeof window !== 'undefined') {
  try {
    const hint = window.localStorage.getItem(HINT_KEY);
    if (isLocale(hint) && hint !== DEFAULT_LOCALE) void ensureLocale(hint);
  } catch { /* stockage indisponible */ }
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
  const dict = dictionaries[loc];
  // Langue pas encore chargée (appelant qui n'a pas attendu `ensureLocale`) : FR pour cette fois,
  // et le dictionnaire part pour les appels suivants.
  if (!dict) {
    void ensureLocale(loc);
    if (import.meta.env?.DEV) console.warn(`[i18n] langue pas encore chargée (${loc}) pour : ${key}`);
  }
  const value = resolve(dict ?? fr, key) ?? resolve(fr, key);
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
    // Perf (lot perf 2) : NL / EN / IT hors du paquet principal, préchargés une fois l'écran prêt.
    preloadLocalesWhenIdle();
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

/**
 * Hook React : vrai quand les langues demandées sont chargées, et re-rend le composant à leur
 * arrivée. Pour un écran qui affiche une autre langue que celle de l'utilisateur (écran client
 * de la caisse, page de signature, fenêtre de mail pré-rempli dans la langue du client).
 */
export function useLocaleReady(...locales: (Locale | string | null | undefined)[]): boolean {
  const wanted = locales.map((l) => (isLocale(l) ? l : DEFAULT_LOCALE));
  const ready = wanted.every((l) => !!dictionaries[l]);
  const [, bump] = useState(0);
  const sig = wanted.join(',');
  useEffect(() => {
    if (ready) return;
    let alive = true;
    void ensureLocales(wanted).then(() => { if (alive) bump((n) => n + 1); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, ready]);
  return ready;
}

export { fr };
export type { Dictionary, DictionaryShape };
