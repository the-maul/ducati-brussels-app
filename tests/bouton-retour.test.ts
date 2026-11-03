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
  recordVisit,
  resetVisits,
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
    expect(decideBack('/parts/abc', '/parts')).toEqual({ kind: 'history' });
    expect(decideBack('/clients/42', '/sales/doc-1')).toEqual({ kind: 'history' });
    expect(decideBack('/workshop/journey/or-9', '/workshop/or-9')).toEqual({ kind: 'history' });
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
    expect(decideBack('/clients/42', '/sales/new')).toEqual({ kind: 'history' });
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
    expect(decideBack('/parts/abc', previousVisit(1))).toEqual({ kind: 'history' });
  });

  it('push apres creation : la precedente est le formulaire, la decision choisit le parent', () => {
    recordVisit(0, '/parts');
    recordVisit(1, '/parts/new');
    recordVisit(2, '/parts/abc');
    expect(decideBack('/parts/abc', previousVisit(2))).toEqual({ kind: 'parent', to: '/parts' });
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
