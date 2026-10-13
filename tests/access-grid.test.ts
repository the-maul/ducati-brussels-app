/**
 * M0 — La grille des droits d'accès telle que le client l'a validée
 * (proposition du 06/10 annotée à la main par Domenico, reçue le 13/10).
 *
 * Le tableau ci-dessous est une TRANSCRIPTION INDÉPENDANTE du document signé :
 * si quelqu'un modifie `permissions.ts` sans passer par le client, ce test
 * tombe. Légende du document : ● = modifier, ○ = lecture seule, – = pas d'accès.
 */
import { describe, expect, it } from 'bun:test';
import { accessLevel, canSee, canWrite, PAGE_RULES } from '../src/lib/auth/permissions';
import type { AppRole } from '../src/lib/auth/auth-context';

const ROLES: AppRole[] = ['admin', 'vendeur', 'magasinier', 'mecanicien', 'chef_atelier', 'comptable', 'marketing'];

/** Une ligne du document : chemin, puis le niveau pour chacun des 7 rôles. */
const GRILLE: [string, string, string, string, string, string, string, string][] = [
  // page                 Adm  Vend Mag  Méca Chef Cpta Mkt
  ['/dashboard',          '●', '●', '●', '●', '●', '●', '●'],
  ['/vehicles',           '●', '●', '○', '○', '○', '○', '○'],
  ['/tradein',            '●', '●', '–', '–', '○', '○', '–'],
  ['/workshop',           '●', '○', '○', '●', '●', '○', '–'],
  ['/parts',              '●', '○', '●', '○', '●', '●', '○'],
  ['/parts/links',        '●', '–', '●', '○', '○', '–', '–'],
  ['/purchases',          '●', '–', '●', '●', '●', '○', '–'],
  ['/orders',             '●', '●', '●', '●', '●', '○', '–'],
  ['/stock',              '●', '○', '●', '●', '●', '○', '○'],
  ['/sales',              '●', '●', '○', '●', '●', '○', '–'],
  ['/sales/balances',     '●', '●', '●', '●', '●', '●', '–'],
  ['/sales/web-orders',   '●', '●', '●', '–', '–', '○', '○'],
  ['/picking',            '●', '●', '●', '●', '●', '–', '–'],
  ['/clients',            '●', '●', '○', '○', '●', '○', '●'],
  ['/crm',                '●', '●', '–', '–', '–', '–', '●'],
  ['/pos',                '●', '●', '●', '●', '●', '●', '–'],
  ['/reports',            '●', '○', '○', '–', '○', '●', '○'],
  ['/accounting',         '●', '–', '–', '–', '–', '●', '–'],
  ['/settings',           '●', '–', '–', '–', '–', '–', '–'],
];

const ATTENDU: Record<string, 'write' | 'read' | 'none'> = { '●': 'write', '○': 'read', '–': 'none' };

describe('grille des droits validée par le client', () => {
  for (const [page, ...cases] of GRILLE) {
    it(`${page} : chaque rôle a le niveau du document`, () => {
      cases.forEach((symbole, i) => {
        expect(`${ROLES[i]}=${accessLevel(page, [ROLES[i]])}`)
          .toBe(`${ROLES[i]}=${ATTENDU[symbole]}`);
      });
    });
  }

  it('la grille couvre toutes les entrées du menu, et rien de plus', () => {
    const codées = PAGE_RULES.map((r) => r.to).filter((to) => to !== '/demo').sort();
    expect(codées).toEqual(GRILLE.map(([p]) => p).sort());
  });
});

describe('résolution des droits', () => {
  it('une sous-page suit sa page (fiche client, nouvelle facture…)', () => {
    expect(accessLevel('/clients/abc-123', ['magasinier'])).toBe('read');
    expect(accessLevel('/sales/new', ['vendeur'])).toBe('write');
  });

  it('le prefixe le plus long gagne : /sales/balances nest pas /sales', () => {
    // Le magasinier consulte les ventes mais encaisse les soldes.
    expect(accessLevel('/sales', ['magasinier'])).toBe('read');
    expect(accessLevel('/sales/balances', ['magasinier'])).toBe('write');
    // Les rapprochements ne suivent pas Pièces & Accessoires.
    expect(accessLevel('/parts', ['comptable'])).toBe('write');
    expect(accessLevel('/parts/links', ['comptable'])).toBe('none');
  });

  it('plusieurs roles : le droit le plus large gagne', () => {
    // Demande de Domenico : un opérateur peut cumuler les rôles.
    expect(accessLevel('/sales', ['magasinier', 'vendeur'])).toBe('write');
    expect(accessLevel('/crm', ['magasinier', 'marketing'])).toBe('write');
    expect(accessLevel('/accounting', ['vendeur', 'magasinier'])).toBe('none');
    expect(accessLevel('/vehicles', ['magasinier', 'mecanicien'])).toBe('read');
  });

  it('ladministrateur a tout, meme en cumulant un role restreint', () => {
    for (const [page] of GRILLE) {
      expect(accessLevel(page, ['admin'])).toBe('write');
      expect(accessLevel(page, ['admin', 'mecanicien'])).toBe('write');
    }
  });

  it('sans aucun role, rien nest accessible', () => {
    for (const [page] of GRILLE) expect(accessLevel(page, [])).toBe('none');
  });

  it('une page hors grille reste ouverte (profil, recherche…)', () => {
    expect(accessLevel('/profil', ['mecanicien'])).toBe('write');
  });

  it('les raccourcis canSee / canWrite suivent la grille', () => {
    expect(canSee('/accounting', ['comptable'])).toBe(true);
    expect(canSee('/accounting', ['vendeur'])).toBe(false);
    expect(canWrite('/vehicles', ['vendeur'])).toBe(true);
    expect(canWrite('/vehicles', ['comptable'])).toBe(false);
    expect(canSee('/vehicles', ['comptable'])).toBe(true);
  });

  it('le marketing est le role le plus restreint, latelier a ete elargi', () => {
    // Deux reperes du document, pour que l intention reste lisible.
    const mkt = GRILLE.filter(([, , , , , , , m]) => m === '–').length;
    expect(mkt).toBeGreaterThan(8);
    expect(accessLevel('/pos', ['mecanicien'])).toBe('write');
    expect(accessLevel('/purchases', ['mecanicien'])).toBe('write');
  });
});
