/**
 * Bouton Retour (UX010, 03/11/2026) — la logique pure, testee a part.
 *
 * Demande du client : « a chaque fois qu'on clique sur un bouton, on ne sait pas
 * revenir a la page d'avant et on doit repartir du menu de gauche ».
 *
 * Trois questions, trois fonctions sans React ni navigateur :
 * - `isRootPage`   : la page est une entree du menu de gauche → pas de bouton ;
 * - `parentPathOf` : la page « parente logique » (la liste de la rubrique) quand
 *                    l'historique ne sert a rien (arrivee par lien, rechargement) ;
 * - `decideBack`   : historique du navigateur ou page parente ?
 *
 * Le suivi des pages visitees (`recordVisit` / `previousVisit`) vit en memoire :
 * il se vide au rechargement, ce qui est voulu (on retombe alors sur le parent).
 */
import { mainNav } from './navigation';

/** Pages hors application du personnel : on n'y « revient » jamais depuis l'app. */
const OUTSIDE_PREFIXES = [
  '/login',
  '/inscription',
  '/reset-password',
  '/mon-espace',
  '/borne',
  '/signer',
  '/app-client',
  '/ecran-client',
];

/** Entrees du menu de gauche : la ou le bouton n'a pas de sens. */
const ROOT_PAGES = new Set(mainNav.map((item) => item.to));

/**
 * Pages dont le parent n'est pas simplement le chemin ampute de son dernier
 * segment. Petite table d'exceptions, a completer quand une route sort du schema
 * `/<rubrique>/<id>`.
 */
const PARENT_EXCEPTIONS: Array<{ test: RegExp; parent: (m: RegExpMatchArray) => string }> = [
  // Le parcours atelier (tablette) d'un OR ramene a la fiche de l'OR, pas a « /workshop/journey ».
  { test: /^\/workshop\/journey\/([^/]+)$/, parent: (m) => `/workshop/${m[1]}` },
  // La preparation d'une commande (tablette) ramene a la liste de picking.
  { test: /^\/preparation\/[^/]+$/, parent: () => '/picking' },
  // Ecrans comptables hors prefixe (cloture, SEPA).
  { test: /^\/accounting-(closure|sepa)$/, parent: () => '/accounting' },
  // Tarifs clients : ouvert depuis la liste des clients.
  { test: /^\/client-pricing$/, parent: () => '/clients' },
  // Depot-vente : rattache aux reprises / occasions (M7).
  { test: /^\/consignment$/, parent: () => '/tradein' },
];

/** Chemin seul (sans ?recherche ni #ancre), sans barre finale, toujours prefixe par `/`. */
export function normalizePath(path: string | null | undefined): string {
  let p = (path ?? '').split('?')[0].split('#')[0];
  if (!p.startsWith('/')) p = '/' + p;
  if (p.length > 1) p = p.replace(/\/+$/, '');
  return p || '/';
}

/** Le chemin appartient-il a l'application du personnel (`/_app/*`) ? */
export function isAppPath(path: string | null | undefined): boolean {
  const p = normalizePath(path);
  if (p === '/') return false;
  return !OUTSIDE_PREFIXES.some((prefix) => p === prefix || p.startsWith(prefix + '/'));
}

/** Entree du menu de gauche (tableau de bord, premiere page de chaque rubrique). */
export function isRootPage(path: string | null | undefined): boolean {
  return ROOT_PAGES.has(normalizePath(path));
}

/** Page de creation (`/<rubrique>/new`) : on n'y revient jamais par Retour une fois la fiche creee. */
export function isCreationPage(path: string | null | undefined): boolean {
  return /\/new$/.test(normalizePath(path));
}

/**
 * Page parente logique : la liste de la rubrique (`/parts/<id>` → `/parts`),
 * l'ecran d'origine (`/sales/<id>/edit` → `/sales/<id>`), le tableau de bord en
 * dernier recours.
 */
export function parentPathOf(path: string | null | undefined): string {
  const p = normalizePath(path);
  for (const ex of PARENT_EXCEPTIONS) {
    const m = p.match(ex.test);
    if (m) return ex.parent(m);
  }
  const cut = p.lastIndexOf('/');
  const parent = cut <= 0 ? '/' : p.slice(0, cut);
  return parent === '/' ? '/dashboard' : parent;
}

export type BackDecision = { kind: 'history' } | { kind: 'parent'; to: string };

/**
 * Historique ou parent ?
 * - pas de page precedente connue (lien direct, rechargement) → parent ;
 * - page precedente hors application (login, espace client) → parent ;
 * - meme page (autre recherche) → parent ;
 * - la precedente est le formulaire de creation qui a ouvert cette fiche
 *   (`/parts/new` → `/parts/<id>`) → parent, jamais le formulaire vide ;
 * - sinon → un pas en arriere dans l'historique du navigateur.
 */
export function decideBack(current: string, previous: string | null | undefined): BackDecision {
  const cur = normalizePath(current);
  const parent: BackDecision = { kind: 'parent', to: parentPathOf(cur) };
  if (!previous) return parent;
  const prev = normalizePath(previous);
  if (!isAppPath(prev) || prev === cur) return parent;
  if (isCreationPage(prev) && parentPathOf(prev) === parentPathOf(cur)) return parent;
  return { kind: 'history' };
}

// --- Suivi en memoire des pages visitees (index d'historique → chemin) -------------------
// TanStack Router numerote chaque entree de l'historique du navigateur (`__TSR_index`).
// On note le chemin vu a chaque index : un `replace` ecrase le meme index, un `push`
// en ouvre un nouveau, un retour arriere relit l'index precedent. Les pages publiques
// sont notees aussi (elles sont hors app → `decideBack` choisit le parent).

const visited = new Map<number, string>();

export function recordVisit(index: number | null | undefined, pathname: string): void {
  if (typeof index !== 'number' || !Number.isFinite(index)) return;
  visited.set(index, normalizePath(pathname));
}

/** Chemin note a l'index precedent, ou null si inconnu (rechargement, premiere page). */
export function previousVisit(index: number | null | undefined): string | null {
  if (typeof index !== 'number' || index <= 0) return null;
  return visited.get(index - 1) ?? null;
}

/** Reservee aux tests. */
export function resetVisits(): void {
  visited.clear();
}
