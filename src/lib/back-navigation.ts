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
 * Le suivi des pages visitees (`recordVisit` / `previousVisits`) vit en memoire et dans
 * `sessionStorage` (UX011) : il survit a un rechargement de l'onglet, comme l'historique.
 * L'etat des pages (recherche, filtres, saisie en cours) : `list-search.ts` et `form-draft.ts`.
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

export type BackDecision = { kind: 'history'; steps: number } | { kind: 'parent'; to: string };

/**
 * Historique ou parent ? (UX010, revu par UX011 le 03/11/2026 : « Retour revient exactement
 * ou on etait »). `previous` : les pages notees juste avant la page courante, de la plus
 * recente a la plus ancienne (index -1, -2...), ou une seule page.
 *
 * On remonte l'historique en sautant les entrees qui ne sont pas « la page d'avant » :
 * - la meme page (autre recherche, retour d'un formulaire avec `?retour=`) ;
 * - le formulaire de creation qui a ouvert cette fiche (`/vehicles/new` → `/vehicles/<id>`) :
 *   on ne revient jamais sur un formulaire deja utilise, on va a la page d'avant lui
 *   (l'OR qui a fait « Ajouter une moto », la fiche client...). Avant UX011 on remontait
 *   alors a la liste de la rubrique : c'etait le « retour a la liste » vecu par le client.
 * Premiere entree restante dans l'application → `history.go(-steps)` (cas normal : 1 pas).
 * Page hors application (login, espace client) ou trou (lien direct, page jamais vue)
 * → la page parente logique.
 */
export function decideBack(
  current: string,
  previous: string | readonly (string | null | undefined)[] | null | undefined,
): BackDecision {
  const cur = normalizePath(current);
  const parent: BackDecision = { kind: 'parent', to: parentPathOf(cur) };
  const list: readonly (string | null | undefined)[] = Array.isArray(previous) ? previous : [previous as string | null | undefined];
  for (let i = 0; i < list.length; i += 1) {
    const raw = list[i];
    if (!raw) return parent;
    const prev = normalizePath(raw);
    if (!isAppPath(prev)) return parent;
    if (prev === cur) continue;
    if (isCreationPage(prev) && parentPathOf(prev) === parentPathOf(cur)) continue;
    return { kind: 'history', steps: i + 1 };
  }
  return parent;
}

// --- Parametre de retour (`?retour=`, UX011) ---------------------------------------------
// Un formulaire qui ouvre un autre ecran pour creer quelque chose (« Ajouter une moto » depuis
// l'OR) lui passe son adresse ; l'ecran de creation y revient avec l'element cree selectionne.

/** Adresse de retour sure : un chemin de l'application, jamais un autre site ni une page publique. */
export function safeReturnPath(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const v = raw.trim();
  if (!v || v.length > 600 || !v.startsWith('/') || v.startsWith('//') || v.includes('\\')) return undefined;
  if (/[\u0000-\u001f]/.test(v)) return undefined;
  return isAppPath(v) ? v : undefined;
}

/** Ajoute (ou remplace, ou retire si vide) des parametres de recherche dans une adresse. */
export function withSearchParams(href: string, params: Record<string, string | null | undefined>): string {
  const hashAt = href.indexOf('#');
  const hash = hashAt >= 0 ? href.slice(hashAt) : '';
  const noHash = hashAt >= 0 ? href.slice(0, hashAt) : href;
  const qAt = noHash.indexOf('?');
  const path = qAt >= 0 ? noHash.slice(0, qAt) : noHash;
  const sp = new URLSearchParams(qAt >= 0 ? noHash.slice(qAt + 1) : '');
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === '') sp.delete(k);
    else sp.set(k, v);
  }
  const qs = sp.toString();
  return `${path}${qs ? `?${qs}` : ''}${hash}`;
}

// --- Suivi des pages visitees (index d'historique → chemin) ------------------------------
// TanStack Router numerote chaque entree de l'historique du navigateur (`__TSR_index`).
// On note le chemin vu a chaque index : un `replace` ecrase le meme index, un `push`
// en ouvre un nouveau, un retour arriere relit l'index precedent. Les pages publiques
// sont notees aussi (elles sont hors app → `decideBack` choisit le parent).
// Depuis UX011 le suivi est aussi garde dans `sessionStorage` (propre a l'onglet, comme
// l'historique du navigateur lui-meme) : apres un rechargement (F5), Retour revient encore
// a la page d'avant au lieu de remonter a la liste.

const VISITS_KEY = 'dms-back-visits-v1';
const MAX_VISITS = 200;
const visited = new Map<number, string>();
let visitsLoaded = false;

function visitsStorage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

function loadVisits(): void {
  if (visitsLoaded) return;
  visitsLoaded = true;
  try {
    const raw = visitsStorage()?.getItem(VISITS_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw) as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) {
      const i = Number(k);
      if (Number.isInteger(i) && i >= 0 && typeof v === 'string' && !visited.has(i)) visited.set(i, v);
    }
  } catch {
    /* stockage illisible : on repart de zero */
  }
}

function persistVisits(): void {
  try {
    const keys = [...visited.keys()].sort((a, b) => a - b).slice(-MAX_VISITS);
    const obj: Record<string, string> = {};
    for (const k of keys) obj[k] = visited.get(k) as string;
    visitsStorage()?.setItem(VISITS_KEY, JSON.stringify(obj));
  } catch {
    /* navigation privee, quota plein : le suivi reste en memoire */
  }
}

export function recordVisit(index: number | null | undefined, pathname: string): void {
  if (typeof index !== 'number' || !Number.isFinite(index)) return;
  loadVisits();
  const p = normalizePath(pathname);
  if (visited.get(index) === p) return;
  visited.set(index, p);
  persistVisits();
}

/** Chemin note a l'index precedent, ou null si inconnu (premiere page, lien direct). */
export function previousVisit(index: number | null | undefined): string | null {
  if (typeof index !== 'number' || index <= 0) return null;
  loadVisits();
  return visited.get(index - 1) ?? null;
}

/** Pages notees avant l'index courant, de la plus recente a la plus ancienne, jusqu'au premier trou. */
export function previousVisits(index: number | null | undefined, max = 20): string[] {
  if (typeof index !== 'number' || index <= 0) return [];
  loadVisits();
  const out: string[] = [];
  for (let i = index - 1; i >= 0 && out.length < max; i -= 1) {
    const p = visited.get(i);
    if (!p) break;
    out.push(p);
  }
  return out;
}

/** Reservee aux tests. */
export function resetVisits(): void {
  visited.clear();
  visitsLoaded = true;
}
