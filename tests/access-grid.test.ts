/**
 * M0 — La grille des droits d'accès telle que le client l'a validée
 * (proposition du 06/10 annotée à la main par Domenico, reçue le 13/10 ;
 * relue case par case contre le scan le 30/10/2026, M0-RBAC003).
 *
 * Le tableau ci-dessous est une TRANSCRIPTION INDÉPENDANTE du document signé :
 * si quelqu'un modifie `permissions.ts` sans passer par le client, ce test
 * tombe. Légende du document : ● = modifier, ○ = lecture seule, – = pas d'accès.
 * Les corrections au stylo violet du client l'emportent sur l'impression :
 * un point ajouté = modifier, un cercle ajouté sur un tiret = lecture seule.
 * Note manuscrite : un opérateur peut porter plusieurs rôles (le plus large gagne).
 */
import { describe, expect, it } from 'bun:test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { accessLevel, canSee, canWrite, PAGE_ALIASES, PAGE_RULES, ruleFor } from '../src/lib/auth/permissions';
import type { AppRole } from '../src/lib/auth/auth-context';
import { mainNav } from '../src/lib/navigation';

const ROLES: AppRole[] = ['admin', 'vendeur', 'magasinier', 'mecanicien', 'chef_atelier', 'comptable', 'marketing'];

/** Une ligne du document : libellé du scan, chemin, puis le niveau pour chacun des 7 rôles. */
const GRILLE: [string, string, string, string, string, string, string, string, string][] = [
  // libellé du scan            page                 Adm  Vend Mag  Méca Chef Cpta Mkt
  ['Tableau de bord',           '/dashboard',        '●', '●', '●', '●', '●', '●', '●'],
  ['Véhicules',                 '/vehicles',         '●', '●', '○', '○', '○', '○', '○'],
  ['Reprises motos clients',    '/tradein',          '●', '●', '–', '–', '○', '○', '–'],
  ['Atelier & SAV',             '/workshop',         '●', '○', '○', '●', '●', '○', '–'],
  ['Pièces & Accessoires',      '/parts',            '●', '○', '●', '○', '●', '●', '○'],
  // Méca et Chef : tiret imprimé, cercle violet ajouté → lecture seule.
  ['Rapprochements',            '/parts/links',      '●', '–', '●', '○', '○', '–', '–'],
  // Méca : point violet ajouté ; Chef : cercle imprimé + point violet → modifier.
  ['Achats & réceptions',       '/purchases',        '●', '–', '●', '●', '●', '○', '–'],
  // Méca : point violet ajouté sur un tiret.
  ['Commandes de pièces',       '/orders',           '●', '●', '●', '●', '●', '○', '–'],
  // Méca et Chef : cercle imprimé + point violet → modifier.
  ['Stock & inventaire',        '/stock',            '●', '○', '●', '●', '●', '○', '○'],
  // Méca : point violet sur un tiret ; Chef : cercle + point violet.
  ['Ventes & Facturation',      '/sales',            '●', '●', '○', '●', '●', '○', '–'],
  // Mag, Méca, Chef : point violet ajouté sur un tiret.
  ['Soldes à encaisser',        '/sales/balances',   '●', '●', '●', '●', '●', '●', '–'],
  ['Commandes du site',         '/sales/web-orders', '●', '●', '●', '–', '–', '○', '○'],
  // Vend : cercle imprimé + point violet → modifier.
  ['Picking list',              '/picking',          '●', '●', '●', '●', '●', '–', '–'],
  ['Contacts',                  '/clients',          '●', '●', '○', '○', '●', '○', '●'],
  ['CRM',                       '/crm',              '●', '●', '–', '–', '–', '–', '●'],
  // Méca, Chef : point violet sur un tiret ; Cpta : cercle + point violet.
  ['Caisse',                    '/pos',              '●', '●', '●', '●', '●', '●', '–'],
  ['Rapports',                  '/reports',          '●', '○', '○', '–', '○', '●', '○'],
  ['Comptabilité',              '/accounting',       '●', '–', '–', '–', '–', '●', '–'],
  ['Paramètres',                '/settings',         '●', '–', '–', '–', '–', '–', '–'],
];

const ATTENDU: Record<string, 'write' | 'read' | 'none'> = { '●': 'write', '○': 'read', '–': 'none' };

/** Niveau attendu par le document pour (page, rôle). */
function attendu(page: string, role: AppRole): 'write' | 'read' | 'none' {
  const ligne = GRILLE.find(([, p]) => p === page);
  if (!ligne) throw new Error(`page absente de la grille : ${page}`);
  return ATTENDU[ligne[2 + ROLES.indexOf(role)]];
}

const PAGES = GRILLE.map(([, p]) => p);

describe('grille des droits validee par le client : un test par role', () => {
  for (const role of ROLES) {
    it(`${role} : le niveau du document sur chacune des ${PAGES.length} pages`, () => {
      const obtenu = PAGES.map((p) => `${p}=${accessLevel(p, [role])}`);
      const voulu = PAGES.map((p) => `${p}=${attendu(p, role)}`);
      expect(obtenu).toEqual(voulu);
    });
  }

  it('la grille codee a exactement les pages du document, plus les alias et la demo', () => {
    const codees = PAGE_RULES.map((r) => r.to).filter((to) => to !== '/demo' && !(to in PAGE_ALIASES)).sort();
    expect(codees).toEqual([...PAGES].sort());
  });

  it('chaque alias donne les memes droits que sa rubrique, role par role', () => {
    for (const [alias, page] of Object.entries(PAGE_ALIASES)) {
      expect(PAGES).toContain(page);
      for (const role of ROLES) {
        expect(`${alias}:${role}=${accessLevel(alias, [role])}`).toBe(`${alias}:${role}=${accessLevel(page, [role])}`);
      }
    }
  });
});

describe('couverture du menu et des routes', () => {
  it('chaque entree du menu a une regle de la grille', () => {
    for (const item of mainNav) {
      const rule = ruleFor(item.to);
      expect(`${item.to} -> ${rule?.to ?? 'AUCUNE REGLE'}`).toBe(`${item.to} -> ${item.to}`);
    }
  });

  const ROUTES_DIR = join(import.meta.dir, '..', 'src', 'routes');
  const appRoutes = readdirSync(ROUTES_DIR).filter((f) => f.startsWith('_app.') && f !== '_app.tsx');

  it('chaque prefixe de la grille correspond a une vraie route', () => {
    for (const r of PAGE_RULES) {
      const prefix = '_app' + r.to.replace(/\//g, '.') + '.';
      const found = appRoutes.some((f) => f.startsWith(prefix));
      expect(`${r.to}: ${found ? 'route' : 'AUCUNE ROUTE'}`).toBe(`${r.to}: route`);
    }
  });

  it('chaque route de premier niveau est couverte par la grille (rien n ouvre sans regle)', () => {
    const firstSegments = new Set(appRoutes.map((f) => f.split('.')[1]));
    for (const seg of firstSegments) {
      const rule = ruleFor('/' + seg);
      expect(`/${seg} -> ${rule ? 'regle' : 'HORS GRILLE'}`).toBe(`/${seg} -> regle`);
    }
  });
});

describe('resolution des droits', () => {
  it('une sous-page suit sa page (fiche client, nouvelle facture...)', () => {
    expect(accessLevel('/clients/abc-123', ['magasinier'])).toBe('read');
    expect(accessLevel('/sales/new', ['vendeur'])).toBe('write');
    expect(accessLevel('/preparation/pick-42', ['mecanicien'])).toBe('write');
    expect(accessLevel('/preparation/pick-42', ['comptable'])).toBe('none');
  });

  it('le prefixe le plus long gagne : /sales/balances n est pas /sales', () => {
    // Le magasinier consulte les ventes mais encaisse les soldes.
    expect(accessLevel('/sales', ['magasinier'])).toBe('read');
    expect(accessLevel('/sales/balances', ['magasinier'])).toBe('write');
    // Les rapprochements ne suivent pas Pièces & Accessoires.
    expect(accessLevel('/parts', ['comptable'])).toBe('write');
    expect(accessLevel('/parts/links', ['comptable'])).toBe('none');
    // La cloture comptable ne suit pas /accounting par prefixe, mais par alias.
    expect(accessLevel('/accounting-closure', ['vendeur'])).toBe('none');
    expect(accessLevel('/accounting-closure', ['comptable'])).toBe('write');
  });

  it('plusieurs roles : le droit le plus large gagne, sur toute la grille', () => {
    // Note manuscrite de Domenico : possibilite d attribuer plusieurs roles.
    const ORDRE = { none: 0, read: 1, write: 2 } as const;
    const operateurs: AppRole[][] = ROLES.filter((r) => r !== 'admin').flatMap((a, i, all) =>
      all.slice(i + 1).map((b) => [a, b]),
    );
    for (const roles of operateurs) {
      for (const page of PAGES) {
        const plusLarge = roles.map((r) => attendu(page, r)).sort((x, y) => ORDRE[y] - ORDRE[x])[0];
        expect(`${page} [${roles.join('+')}] = ${accessLevel(page, roles)}`).toBe(`${page} [${roles.join('+')}] = ${plusLarge}`);
      }
    }
    // Quelques cas lisibles.
    expect(accessLevel('/sales', ['magasinier', 'vendeur'])).toBe('write');
    expect(accessLevel('/crm', ['magasinier', 'marketing'])).toBe('write');
    expect(accessLevel('/accounting', ['vendeur', 'magasinier'])).toBe('none');
    expect(accessLevel('/vehicles', ['magasinier', 'mecanicien'])).toBe('read');
  });

  it('l administrateur a tout, meme en cumulant un role restreint', () => {
    for (const page of [...PAGES, ...Object.keys(PAGE_ALIASES), '/demo']) {
      expect(accessLevel(page, ['admin'])).toBe('write');
      expect(accessLevel(page, ['admin', 'mecanicien'])).toBe('write');
      expect(accessLevel(page, ['marketing', 'admin'])).toBe('write');
    }
  });

  it('sans aucun role, rien n est accessible', () => {
    for (const page of PAGES) expect(accessLevel(page, [])).toBe('none');
  });

  it('une page hors grille reste ouverte (profil, recherche...)', () => {
    expect(ruleFor('/profil')).toBeNull();
    expect(accessLevel('/profil', ['mecanicien'])).toBe('write');
    expect(accessLevel('/profil', ['marketing'])).toBe('write');
  });

  it('les raccourcis canSee / canWrite suivent la grille', () => {
    expect(canSee('/accounting', ['comptable'])).toBe(true);
    expect(canSee('/accounting', ['vendeur'])).toBe(false);
    expect(canWrite('/vehicles', ['vendeur'])).toBe(true);
    expect(canWrite('/vehicles', ['comptable'])).toBe(false);
    expect(canSee('/vehicles', ['comptable'])).toBe(true);
  });

  it('le marketing est le role le plus restreint, l atelier a ete elargi', () => {
    // Deux reperes du document, pour que l intention reste lisible.
    const mkt = GRILLE.filter((ligne) => ligne[8] === '–').length;
    expect(mkt).toBeGreaterThan(8);
    expect(accessLevel('/pos', ['mecanicien'])).toBe('write');
    expect(accessLevel('/purchases', ['mecanicien'])).toBe('write');
  });
});
