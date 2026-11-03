/**
 * UX010 — bouton Retour sur toutes les pages (demande client du 03/11/2026).
 * Logique pure de `src/lib/back-navigation.ts` : page parente, pages racines,
 * decision « historique ou parent », suivi des pages visitees.
 */
import { describe, expect, it, beforeEach } from 'bun:test';
import {
  decideBack,
  isAppPath,
  isCreationPage,
  isRootPage,
  normalizePath,
  parentPathOf,
  previousVisit,
  previousVisits,
  recordVisit,
  resetVisits,
  safeReturnPath,
  withSearchParams,
} from '../src/lib/back-navigation';
import { mainNav } from '../src/lib/navigation';

describe('parentPathOf — la page parente logique', () => {
  const CAS: [string, string][] = [
    ['/parts/abc-123', '/parts'],
    ['/parts/new', '/parts'],
    ['/clients/42', '/clients'],
    ['/vehicles/ZDM1234', '/vehicles'],
    ['/workshop/or-9', '/workshop'],
    ['/workshop/new', '/workshop'],
    ['/sales/doc-1/edit', '/sales/doc-1'],
    ['/sales/doc-1', '/sales'],
    ['/orders/o-7', '/orders'],
    ['/tradein/oro-3', '/tradein'],
    ['/purchases/suppliers/s-1', '/purchases/suppliers'],
    ['/purchases/suppliers', '/purchases'],
    ['/purchases/baskets/b-2', '/purchases/baskets'],
    ['/settings/tables/vat', '/settings/tables'],
    ['/settings/users', '/settings'],
    ['/workshop/accidents/f-1', '/workshop/accidents'],
    ['/stock/cessions', '/stock'],
    ['/crm/relances', '/crm'],
    // Exceptions de la table
    ['/workshop/journey/or-9', '/workshop/or-9'],
    ['/preparation/p-5', '/picking'],
    ['/accounting-closure', '/accounting'],
    ['/accounting-sepa', '/accounting'],
    ['/client-pricing', '/clients'],
    ['/consignment', '/tradein'],
    // Dernier recours : le tableau de bord
    ['/demo', '/dashboard'],
    ['/', '/dashboard'],
  ];
  for (const [page, parent] of CAS) {
    it(`${page} → ${parent}`, () => {
      expect(parentPathOf(page)).toBe(parent);
    });
  }

  it('ignore la recherche, l ancre et la barre finale', () => {
    expect(parentPathOf('/parts/abc?ancienne=1')).toBe('/parts');
    expect(parentPathOf('/parts/abc/#haut')).toBe('/parts');
    expect(normalizePath('/parts/')).toBe('/parts');
    expect(normalizePath('parts')).toBe('/parts');
    expect(normalizePath('')).toBe('/');
  });

  it('les exceptions pointent vers des pages qui existent', () => {
    const routes = new Set(['/workshop/$orId', '/picking', '/accounting', '/clients', '/tradein']);
    expect(routes.has('/picking')).toBe(true);
    expect(parentPathOf('/workshop/journey/x')).toBe('/workshop/x');
  });
});

describe('isRootPage — les entrees du menu de gauche n ont pas de bouton Retour', () => {
  it('toutes les entrees du menu sont racines', () => {
    for (const item of mainNav) expect(isRootPage(item.to)).toBe(true);
  });
  it('tableau de bord, listes, sous-entrees du menu', () => {
    expect(isRootPage('/dashboard')).toBe(true);
    expect(isRootPage('/parts')).toBe(true);
    expect(isRootPage('/purchases/baskets')).toBe(true);
    expect(isRootPage('/crm/relances')).toBe(true);
    expect(isRootPage('/parts/')).toBe(true);
    expect(isRootPage('/parts?q=frein')).toBe(true);
  });
  it('une fiche, un formulaire, une sous-page hors menu ne le sont pas', () => {
    expect(isRootPage('/parts/abc')).toBe(false);
    expect(isRootPage('/parts/new')).toBe(false);
    expect(isRootPage('/purchases/suppliers')).toBe(false);
    expect(isRootPage('/workshop/accidents')).toBe(false);
    expect(isRootPage('/accounting-closure')).toBe(false);
  });
});

describe('isAppPath / isCreationPage', () => {
  it('reconnait les pages hors application', () => {
    for (const p of ['/login', '/inscription', '/reset-password', '/mon-espace', '/mon-espace/motos/x', '/borne', '/signer/tok', '/app-client', '/ecran-client', '/']) {
      expect(isAppPath(p)).toBe(false);
    }
    expect(isAppPath('/dashboard')).toBe(true);
    expect(isAppPath('/parts/abc')).toBe(true);
    // « /signer... » n'est pas « /signer/... » : seuls les prefixes exacts comptent.
    expect(isAppPath('/signerie')).toBe(true);
  });
  it('page de creation', () => {
    expect(isCreationPage('/parts/new')).toBe(true);
    expect(isCreationPage('/purchases/suppliers/new')).toBe(true);
    expect(isCreationPage('/parts/newsletter')).toBe(false);
    expect(isCreationPage('/parts/abc')).toBe(false);
  });
});

describe('decideBack — historique du navigateur ou page parente ?', () => {
  it('page precedente dans l app → historique', () => {
    expect(decideBack('/parts/abc', '/parts')).toEqual({ kind: 'history', steps: 1 });
    expect(decideBack('/clients/42', '/sales/doc-1')).toEqual({ kind: 'history', steps: 1 });
    expect(decideBack('/workshop/journey/or-9', '/workshop/or-9')).toEqual({ kind: 'history', steps: 1 });
  });
  it('pas de page precedente (lien direct, rechargement) → parent', () => {
    expect(decideBack('/parts/abc', null)).toEqual({ kind: 'parent', to: '/parts' });
    expect(decideBack('/parts/abc', undefined)).toEqual({ kind: 'parent', to: '/parts' });
    expect(decideBack('/sales/doc-1/edit', '')).toEqual({ kind: 'parent', to: '/sales/doc-1' });
  });
  it('page precedente hors application (login, espace client) → parent', () => {
    expect(decideBack('/parts/abc', '/login')).toEqual({ kind: 'parent', to: '/parts' });
    expect(decideBack('/workshop/or-9', '/mon-espace')).toEqual({ kind: 'parent', to: '/workshop' });
    expect(decideBack('/workshop/or-9', '/')).toEqual({ kind: 'parent', to: '/workshop' });
  });
  it('meme page (autre recherche) → parent', () => {
    expect(decideBack('/parts/abc?ancienne=1', '/parts/abc')).toEqual({ kind: 'parent', to: '/parts' });
  });
  it('apres une creation, Retour ne renvoie jamais vers le formulaire vide', () => {
    expect(decideBack('/parts/abc', '/parts/new')).toEqual({ kind: 'parent', to: '/parts' });
    expect(decideBack('/purchases/suppliers/s-1', '/purchases/suppliers/new')).toEqual({ kind: 'parent', to: '/purchases/suppliers' });
    expect(decideBack('/workshop/or-9', '/workshop/new')).toEqual({ kind: 'parent', to: '/workshop' });
  });
  it('mais un formulaire de creation ouvert avant une AUTRE rubrique reste joignable', () => {
    // Depuis « nouvelle vente », on ouvre une fiche client pour verifier : Retour revient a la vente.
    expect(decideBack('/clients/42', '/sales/new')).toEqual({ kind: 'history', steps: 1 });
  });
});

describe('UX011 — Retour revient exactement ou on etait', () => {
  it('fiche creee : on saute le formulaire de creation et on revient a la page d avant lui', () => {
    // Liste filtree → nouvel article → fiche : Retour = la liste (2 pas), avec ses filtres.
    expect(decideBack('/parts/abc', ['/parts/new', '/parts'])).toEqual({ kind: 'history', steps: 2 });
    // Fiche client → « Ajouter une moto » → fiche moto : Retour = la fiche client, pas la liste des motos.
    expect(decideBack('/vehicles/v-1', ['/vehicles/new', '/clients/42'])).toEqual({ kind: 'history', steps: 2 });
    // Nouvel OR enregistre : Retour = la liste de l'atelier telle qu'on l'a laissee.
    expect(decideBack('/workshop/or-9', ['/workshop/new', '/workshop'])).toEqual({ kind: 'history', steps: 2 });
  });
  it('fiche ouverte depuis le formulaire Nouvel OR : Retour = le formulaire (sa saisie est restauree)', () => {
    expect(decideBack('/vehicles/v-1', ['/workshop/new', '/workshop'])).toEqual({ kind: 'history', steps: 1 });
  });
  it('retour du formulaire avec ?retour= (meme page) : on saute le doublon', () => {
    // /workshop/new → /vehicles/new remplace par /workshop/new?vehicleId=… : deux entrees « Nouvel OR ».
    expect(decideBack('/workshop/new', ['/workshop/new', '/workshop'])).toEqual({ kind: 'history', steps: 2 });
  });
  it('un trou ou une page publique arrete la remontee → parent', () => {
    expect(decideBack('/parts/abc', ['/parts/new'])).toEqual({ kind: 'parent', to: '/parts' });
    expect(decideBack('/parts/abc', ['/parts/new', null, '/parts'])).toEqual({ kind: 'parent', to: '/parts' });
    expect(decideBack('/parts/abc', ['/parts/new', '/login'])).toEqual({ kind: 'parent', to: '/parts' });
    expect(decideBack('/parts/abc', [])).toEqual({ kind: 'parent', to: '/parts' });
  });
});

describe('parametre de retour (?retour=)', () => {
  it('accepte un chemin de l application, avec sa recherche', () => {
    expect(safeReturnPath('/workshop/new')).toBe('/workshop/new');
    expect(safeReturnPath('/sales/new?contactId=abc')).toBe('/sales/new?contactId=abc');
  });
  it('refuse un autre site, une page publique, du vide', () => {
    for (const bad of ['https://evil.example', '//evil.example', '/\\evil', 'workshop/new', '', '/login', '/mon-espace/x', 42, null, undefined]) {
      expect(safeReturnPath(bad)).toBeUndefined();
    }
  });
  it('ajoute la moto creee sans perdre les autres parametres', () => {
    expect(withSearchParams('/workshop/new', { vehicleId: 'v-1' })).toBe('/workshop/new?vehicleId=v-1');
    expect(withSearchParams('/workshop/new?contactId=c-1', { vehicleId: 'v-1' })).toBe('/workshop/new?contactId=c-1&vehicleId=v-1');
    expect(withSearchParams('/sales/new?vehicleId=old#lignes', { vehicleId: 'v-2' })).toBe('/sales/new?vehicleId=v-2#lignes');
    expect(withSearchParams('/sales/new?vehicleId=old', { vehicleId: null })).toBe('/sales/new');
  });
});

describe('suivi des pages visitees (index d historique → chemin)', () => {
  beforeEach(() => resetVisits());

  it('push : la precedente est l index juste avant', () => {
    recordVisit(0, '/dashboard');
    recordVisit(1, '/parts');
    recordVisit(2, '/parts/abc');
    expect(previousVisit(2)).toBe('/parts');
    expect(previousVisit(1)).toBe('/dashboard');
    expect(previousVisit(0)).toBeNull();
  });

  it('replace apres creation : /parts/new ecrase par /parts/abc, la precedente reste la liste', () => {
    recordVisit(0, '/parts');
    recordVisit(1, '/parts/new');
    recordVisit(1, '/parts/abc');
    expect(previousVisit(1)).toBe('/parts');
    expect(decideBack('/parts/abc', previousVisit(1))).toEqual({ kind: 'history', steps: 1 });
  });

  it('push apres creation : seule la precedente connue (formulaire) → parent ; avec la suite → 2 pas', () => {
    recordVisit(0, '/parts');
    recordVisit(1, '/parts/new');
    recordVisit(2, '/parts/abc');
    expect(decideBack('/parts/abc', previousVisit(2))).toEqual({ kind: 'parent', to: '/parts' });
    expect(previousVisits(2)).toEqual(['/parts/new', '/parts']);
    expect(decideBack('/parts/abc', previousVisits(2))).toEqual({ kind: 'history', steps: 2 });
  });

  it('previousVisits s arrete au premier trou et respecte le maximum', () => {
    recordVisit(3, '/clients');
    recordVisit(4, '/clients/42');
    recordVisit(5, '/vehicles/v-1');
    expect(previousVisits(5)).toEqual(['/clients/42', '/clients']);
    expect(previousVisits(5, 1)).toEqual(['/clients/42']);
    expect(previousVisits(0)).toEqual([]);
    expect(previousVisits(null)).toEqual([]);
  });

  it('rechargement (memoire vide) ou index inconnu → rien de connu → parent', () => {
    expect(previousVisit(5)).toBeNull();
    expect(previousVisit(null)).toBeNull();
    recordVisit(null, '/parts');
    expect(previousVisit(1)).toBeNull();
    expect(decideBack('/parts/abc', previousVisit(5))).toEqual({ kind: 'parent', to: '/parts' });
  });

  it('page publique entre deux pages de l app : on ne revient pas dessus', () => {
    recordVisit(0, '/parts/abc');
    recordVisit(1, '/login');
    recordVisit(2, '/clients/42');
    expect(decideBack('/clients/42', previousVisit(2))).toEqual({ kind: 'parent', to: '/clients' });
  });
});
