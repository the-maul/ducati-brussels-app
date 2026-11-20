/**
 * Page bloquée après une mise en ligne (lot chunk-reload, 20/11/2026) : reconnaissance des
 * échecs de chargement de fichiers et garde anti-boucle du rechargement automatique
 * (`src/lib/chunk-reload.ts`).
 */
import { describe, expect, it } from 'bun:test';
import {
  CHUNK_RELOAD_KEY,
  CHUNK_RELOAD_WINDOW_MS,
  claimChunkReload,
  isChunkLoadError,
  recentlyReloaded,
  reloadOnceForChunkError,
} from '../src/lib/chunk-reload';
import { fr } from '../src/lib/i18n/fr';
import { en } from '../src/lib/i18n/en';
import { nl } from '../src/lib/i18n/nl';
import { it as itDict } from '../src/lib/i18n/it';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => void data.set(k, v),
    data,
  };
}

const CHROME = new TypeError('Failed to fetch dynamically imported module: https://dms.example/assets/_app.parts-AbC123.js');
const SAFARI = new TypeError('Importing a module script failed.');
const FIREFOX = new TypeError('error loading dynamically imported module: https://dms.example/assets/x.js');

describe('isChunkLoadError — échec de chargement d\'un fichier de page', () => {
  it('reconnaît les messages Chrome, Safari, Firefox, Vite et webpack', () => {
    expect(isChunkLoadError(CHROME)).toBe(true);
    expect(isChunkLoadError(SAFARI)).toBe(true);
    expect(isChunkLoadError(FIREFOX)).toBe(true);
    expect(isChunkLoadError(new Error('Unable to preload CSS for /assets/a.css'))).toBe(true);
    const webpack = new Error('Loading chunk 12 failed.');
    webpack.name = 'ChunkLoadError';
    expect(isChunkLoadError(webpack)).toBe(true);
    expect(isChunkLoadError({ name: 'ChunkLoadError', message: '' })).toBe(true);
    expect(isChunkLoadError('Failed to fetch dynamically imported module')).toBe(true);
  });

  it('ignore les autres erreurs', () => {
    expect(isChunkLoadError(new Error('permission denied for table repair_orders'))).toBe(false);
    expect(isChunkLoadError(new TypeError('Failed to fetch'))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
    expect(isChunkLoadError(42)).toBe(false);
  });
});

describe('claimChunkReload — garde anti-boucle (sessionStorage + horodatage)', () => {
  it('autorise le premier rechargement et note l\'heure', () => {
    const s = memoryStorage();
    expect(claimChunkReload(s, 1_000_000)).toBe(true);
    expect(s.data.get(CHUNK_RELOAD_KEY)).toBe('1000000');
  });

  it('refuse un deuxième rechargement dans la fenêtre', () => {
    const s = memoryStorage();
    expect(claimChunkReload(s, 1_000_000)).toBe(true);
    expect(claimChunkReload(s, 1_000_000 + 5_000)).toBe(false);
    expect(claimChunkReload(s, 1_000_000 + CHUNK_RELOAD_WINDOW_MS - 1)).toBe(false);
  });

  it('autorise à nouveau après la fenêtre (mise en ligne suivante)', () => {
    const s = memoryStorage({ [CHUNK_RELOAD_KEY]: '1000000' });
    expect(claimChunkReload(s, 1_000_000 + CHUNK_RELOAD_WINDOW_MS)).toBe(true);
  });

  it('ignore une valeur illisible ou dans le futur (horloge modifiée)', () => {
    expect(claimChunkReload(memoryStorage({ [CHUNK_RELOAD_KEY]: 'abc' }), 1_000_000)).toBe(true);
    expect(claimChunkReload(memoryStorage({ [CHUNK_RELOAD_KEY]: '9000000' }), 1_000_000)).toBe(true);
  });

  it('ne recharge pas sans stockage utilisable (pas de garde = pas de boucle possible)', () => {
    expect(claimChunkReload(null, 1_000_000)).toBe(false);
    const throwing = {
      getItem: () => { throw new Error('SecurityError'); },
      setItem: () => { throw new Error('SecurityError'); },
    };
    expect(claimChunkReload(throwing, 1_000_000)).toBe(false);
    const quotaFull = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } };
    expect(claimChunkReload(quotaFull, 1_000_000)).toBe(false);
    const ignoresWrites = { getItem: () => null, setItem: () => undefined };
    expect(claimChunkReload(ignoresWrites, 1_000_000)).toBe(false);
  });

  it('recentlyReloaded suit la même fenêtre', () => {
    const s = memoryStorage({ [CHUNK_RELOAD_KEY]: '1000000' });
    expect(recentlyReloaded(s, 1_000_000 + 1_000)).toBe(true);
    expect(recentlyReloaded(s, 1_000_000 + CHUNK_RELOAD_WINDOW_MS)).toBe(false);
    expect(recentlyReloaded(null, 1_000_000)).toBe(false);
  });
});

describe('reloadOnceForChunkError — un seul rechargement', () => {
  it('recharge une fois puis laisse l\'écran d\'erreur prendre le relais', () => {
    const s = memoryStorage();
    let reloads = 0;
    let now = 2_000_000;
    const deps = { storage: s, now: () => now, reload: () => void reloads++ };
    expect(reloadOnceForChunkError(CHROME, deps)).toBe(true);
    now += 3_000; // la page rechargée échoue encore
    expect(reloadOnceForChunkError(CHROME, deps)).toBe(false);
    expect(reloadOnceForChunkError(SAFARI, deps)).toBe(false);
    expect(reloads).toBe(1);
  });

  it('ne recharge jamais pour une erreur ordinaire', () => {
    let reloads = 0;
    const deps = { storage: memoryStorage(), now: () => 1, reload: () => void reloads++ };
    expect(reloadOnceForChunkError(new Error('boom'), deps)).toBe(false);
    expect(reloads).toBe(0);
  });

  it('un rechargement qui lève une exception ne casse rien', () => {
    const deps = { storage: memoryStorage(), now: () => 1, reload: () => { throw new Error('blocked'); } };
    expect(reloadOnceForChunkError(CHROME, deps)).toBe(false);
  });
});

describe('libellés de l\'écran de secours et titre de la pointeuse (4 langues)', () => {
  const KEYS = ['chunkErrorTitle', 'chunkErrorText', 'reload', 'pendingLoading', 'pendingSlowTitle', 'pendingSlowText'] as const;
  it('existent et ne sont pas vides', () => {
    for (const d of [fr, en, nl, itDict]) {
      for (const k of KEYS) expect(d.rootPage[k].trim().length).toBeGreaterThan(0);
    }
  });
  it('onglet /workshop/chrono : « Pointeuse atelier »', () => {
    expect(fr.pageTitles.workshopChrono).toBe('Pointeuse atelier');
    for (const d of [en, nl, itDict]) expect(d.pageTitles.workshopChrono).toBe(d.workshop.chronoTitle);
  });
});
