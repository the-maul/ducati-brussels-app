/**
 * Page bloquée après une mise en ligne (lot chunk-reload, 20/11/2026).
 *
 * Quand une nouvelle version est publiée (Netlify ou Cloudflare Workers), les fichiers JS de
 * l'ancienne version (noms à empreinte, découpés par page) disparaissent. Un onglet resté ouvert
 * sur l'ancienne version qui ouvre une nouvelle page demande un fichier qui n'existe plus : le
 * navigateur lève « Failed to fetch dynamically imported module » (Chrome), « Importing a module
 * script failed » (Safari), « error loading dynamically imported module » (Firefox), et Vite émet
 * l'événement `vite:preloadError`.
 *
 * Réponse : recharger la page UNE seule fois (la nouvelle version arrive avec les bons fichiers).
 * Garde anti-boucle : l'heure du dernier rechargement automatique est notée dans sessionStorage ;
 * un deuxième échec dans la minute qui suit ne recharge plus, l'écran d'erreur s'affiche (message
 * clair + « Recharger » + accueil). Si sessionStorage est indisponible (navigation privée
 * stricte), on ne recharge pas automatiquement : impossible de garantir l'absence de boucle.
 */

export const CHUNK_RELOAD_KEY = 'dms:chunk-reload-at';
/** Fenêtre pendant laquelle un nouvel échec ne déclenche plus de rechargement automatique. */
export const CHUNK_RELOAD_WINDOW_MS = 60_000;

const CHUNK_ERROR_PATTERNS = [
  'failed to fetch dynamically imported module',
  'error loading dynamically imported module',
  'importing a module script failed',
  'unable to preload css',
  'loading chunk',
  'loading css chunk',
  'chunkloaderror',
  'expected a javascript-or-wasm module script',
  'expected a javascript module script',
];

/** Vrai si l'erreur est un échec de chargement d'un fichier JS/CSS de l'application. */
export function isChunkLoadError(error: unknown): boolean {
  if (error == null) return false;
  let name = '';
  let message = '';
  if (typeof error === 'string') {
    message = error;
  } else if (typeof error === 'object') {
    const e = error as { name?: unknown; message?: unknown };
    if (typeof e.name === 'string') name = e.name;
    if (typeof e.message === 'string') message = e.message;
  }
  if (name === 'ChunkLoadError') return true;
  const text = `${name} ${message}`.toLowerCase();
  return CHUNK_ERROR_PATTERNS.some((p) => text.includes(p));
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export type ChunkReloadDeps = {
  storage?: StorageLike | null;
  now?: () => number;
  reload?: () => void;
};

function defaultStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

/**
 * Décide s'il faut recharger et, si oui, note l'heure du rechargement.
 * Faux si un rechargement automatique a déjà eu lieu dans la fenêtre, ou si le stockage est
 * illisible / non inscriptible (pas de garde = pas de rechargement automatique).
 */
export function claimChunkReload(
  storage: StorageLike | null | undefined,
  now: number,
  windowMs: number = CHUNK_RELOAD_WINDOW_MS,
): boolean {
  if (!storage) return false;
  try {
    const last = Number(storage.getItem(CHUNK_RELOAD_KEY));
    if (Number.isFinite(last) && last > 0 && now - last >= 0 && now - last < windowMs) return false;
    storage.setItem(CHUNK_RELOAD_KEY, String(now));
    // Relecture : un setItem silencieusement ignoré ne doit pas ouvrir la porte à une boucle.
    return storage.getItem(CHUNK_RELOAD_KEY) === String(now);
  } catch {
    return false;
  }
}

/** Vrai si un rechargement automatique vient d'avoir lieu (l'écran d'erreur ne relance pas). */
export function recentlyReloaded(
  storage: StorageLike | null | undefined = defaultStorage(),
  now: number = Date.now(),
  windowMs: number = CHUNK_RELOAD_WINDOW_MS,
): boolean {
  if (!storage) return false;
  try {
    const last = Number(storage.getItem(CHUNK_RELOAD_KEY));
    return Number.isFinite(last) && last > 0 && now - last >= 0 && now - last < windowMs;
  } catch {
    return false;
  }
}

/**
 * Recharge la page une seule fois si `error` est un échec de chargement de fichier de
 * l'application. Renvoie vrai si un rechargement a été lancé.
 */
export function reloadOnceForChunkError(error: unknown, deps: ChunkReloadDeps = {}): boolean {
  if (!isChunkLoadError(error)) return false;
  const storage = deps.storage === undefined ? defaultStorage() : deps.storage;
  const now = (deps.now ?? Date.now)();
  if (!claimChunkReload(storage, now)) return false;
  try {
    (deps.reload ?? (() => window.location.reload()))();
    return true;
  } catch {
    return false;
  }
}

let installed = false;

/**
 * Écoute, côté navigateur, les échecs de chargement de fichiers (événement Vite et promesses
 * rejetées non traitées) et recharge une fois. Sans effet côté serveur ; idempotent.
 */
export function installChunkReloadHandlers(): void {
  if (installed || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  installed = true;
  try {
    window.addEventListener('vite:preloadError', (event) => {
      // Pas de preventDefault : l'erreur continue jusqu'à l'écran d'erreur si on ne recharge pas.
      reloadOnceForChunkError((event as Event & { payload?: unknown }).payload);
    });
    window.addEventListener('unhandledrejection', (event) => {
      reloadOnceForChunkError((event as PromiseRejectionEvent).reason);
    });
  } catch {
    // Navigateur exotique : l'écran d'erreur reste le filet de sécurité.
  }
}
