/**
 * M0 — Droits d'accès par rôle (grille validée par Domenico le 13/10/2026,
 * annotée à la main sur la proposition du 06/10).
 *
 * Trois niveaux par page :
 *   - `write` : la page s'ouvre et on peut y travailler ;
 *   - `read`  : la page s'ouvre en consultation, les actions d'écriture sont
 *               retirées et un bandeau le dit ;
 *   - `none`  : la page n'apparaît pas dans le menu et son adresse est refusée.
 *
 * Un opérateur peut porter PLUSIEURS rôles (demande de Domenico) : c'est le
 * droit le plus large qui s'applique. L'administrateur a tout en écriture.
 *
 * La grille est volontairement en clair ici, une ligne par page : c'est le
 * document que le client a signé, il doit rester lisible sans fouiller le code.
 */
import type { AppRole } from './auth-context';

export type AccessLevel = 'none' | 'read' | 'write';

/** Tous les rôles sauf l'administrateur (qui est ajouté d'office en écriture). */
const ALL: AppRole[] = ['vendeur', 'magasinier', 'mecanicien', 'chef_atelier', 'comptable', 'marketing'];

type PageRule = {
  /** Préfixe de route. Le préfixe le plus long l'emporte (/sales/balances avant /sales). */
  to: string;
  /** Rôles qui peuvent travailler sur la page. */
  write: AppRole[];
  /** Rôles qui peuvent seulement la consulter. */
  read: AppRole[];
};

/**
 * Grille validée. L'ordre n'a pas d'importance : la résolution prend le
 * préfixe le plus long.
 */
export const PAGE_RULES: PageRule[] = [
  { to: '/dashboard', write: ALL, read: [] },
  { to: '/vehicles', write: ['vendeur'], read: ['magasinier', 'mecanicien', 'chef_atelier', 'comptable', 'marketing'] },
  { to: '/tradein', write: ['vendeur'], read: ['chef_atelier', 'comptable'] },
  { to: '/workshop', write: ['mecanicien', 'chef_atelier'], read: ['vendeur', 'magasinier', 'comptable'] },
  // Rapprochements avant Pièces : préfixe plus long.
  { to: '/parts/links', write: ['magasinier'], read: ['mecanicien', 'chef_atelier'] },
  { to: '/parts', write: ['magasinier', 'chef_atelier', 'comptable'], read: ['vendeur', 'mecanicien', 'marketing'] },
  { to: '/purchases', write: ['magasinier', 'mecanicien', 'chef_atelier'], read: ['comptable'] },
  { to: '/orders', write: ['vendeur', 'magasinier', 'mecanicien', 'chef_atelier'], read: ['comptable'] },
  { to: '/stock', write: ['magasinier', 'mecanicien', 'chef_atelier'], read: ['vendeur', 'comptable', 'marketing'] },
  { to: '/sales/balances', write: ['vendeur', 'magasinier', 'mecanicien', 'chef_atelier', 'comptable'], read: [] },
  { to: '/sales/web-orders', write: ['vendeur', 'magasinier'], read: ['comptable', 'marketing'] },
  { to: '/sales', write: ['vendeur', 'mecanicien', 'chef_atelier'], read: ['magasinier', 'comptable'] },
  { to: '/picking', write: ['vendeur', 'magasinier', 'mecanicien', 'chef_atelier'], read: [] },
  { to: '/clients', write: ['vendeur', 'chef_atelier', 'marketing'], read: ['magasinier', 'mecanicien', 'comptable'] },
  { to: '/crm', write: ['vendeur', 'marketing'], read: [] },
  // Relances d'entretien par mail (31/10/2026, M-72) : sous le CRM, memes droits.
  { to: '/crm/relances', write: ['vendeur', 'marketing'], read: [] },
  { to: '/pos', write: ['vendeur', 'magasinier', 'mecanicien', 'chef_atelier', 'comptable'], read: [] },
  { to: '/reports', write: ['comptable'], read: ['vendeur', 'magasinier', 'chef_atelier', 'marketing'] },
  { to: '/accounting', write: ['comptable'], read: [] },
  { to: '/settings', write: [], read: [] },
  { to: '/demo', write: [], read: [] },

  // Écrans dont l'adresse ne commence PAS par celle de leur rubrique. Sans
  // ligne ici, ils seraient « hors grille », donc ouverts à tout le monde
  // (vérification du 30/10/2026 contre le scan signé) : ils prennent les
  // droits de la rubrique d'où on les ouvre. Un test vérifie l'égalité.
  // Comptabilité → clôture d'exercice et virements SEPA.
  { to: '/accounting-closure', write: ['comptable'], read: [] },
  { to: '/accounting-sepa', write: ['comptable'], read: [] },
  // Contacts → tarifs clients.
  { to: '/client-pricing', write: ['vendeur', 'chef_atelier', 'marketing'], read: ['magasinier', 'mecanicien', 'comptable'] },
  // Reprises motos clients → dépôt-vente.
  { to: '/consignment', write: ['vendeur'], read: ['chef_atelier', 'comptable'] },
  // Picking list → liste de préparation sur tablette.
  { to: '/preparation', write: ['vendeur', 'magasinier', 'mecanicien', 'chef_atelier'], read: [] },
];

/**
 * Écran → rubrique du document signé, pour les adresses qui ne partagent pas
 * son préfixe. Sert au test : chaque alias doit donner exactement les mêmes
 * droits que sa rubrique, rôle par rôle.
 */
export const PAGE_ALIASES: Record<string, string> = {
  '/accounting-closure': '/accounting',
  '/accounting-sepa': '/accounting',
  '/client-pricing': '/clients',
  '/consignment': '/tradein',
  '/preparation': '/picking',
  // Clients (CRM) -> relances d'entretien par mail (31/10/2026, M-72) : memes droits que le CRM.
  '/crm/relances': '/crm',
};

/** La règle qui gouverne un chemin : le préfixe le plus long qui corresponde. */
export function ruleFor(path: string): PageRule | null {
  let best: PageRule | null = null;
  for (const r of PAGE_RULES) {
    if (path === r.to || path.startsWith(r.to + '/')) {
      if (!best || r.to.length > best.to.length) best = r;
    }
  }
  return best;
}

/**
 * Niveau d'accès d'un porteur de rôles sur un chemin.
 * Une page inconnue de la grille (profil, recherche…) reste ouverte : on ne
 * ferme que ce qui est explicitement listé.
 */
export function accessLevel(path: string, roles: readonly AppRole[]): AccessLevel {
  if (roles.includes('admin')) return 'write';
  const rule = ruleFor(path);
  if (!rule) return 'write';
  if (rule.write.some((r) => roles.includes(r))) return 'write';
  if (rule.read.some((r) => roles.includes(r))) return 'read';
  return 'none';
}

/**
 * Pages qui CRÉENT quelque chose : s'y rendre est déjà une écriture.
 * Un rôle en lecture seule sur la rubrique ne doit pas pouvoir les ouvrir,
 * même en tapant l'adresse.
 */
const WRITE_SEGMENTS = new Set(['new', 'import', 'inventory']);

/** La page demande-t-elle le droit d'écrire pour simplement s'ouvrir ? */
export function needsWrite(path: string): boolean {
  return path.split('/').some((seg) => WRITE_SEGMENTS.has(seg));
}

/**
 * Niveau effectif : comme `accessLevel`, mais une page de création n'est pas
 * consultable à moitié — c'est écriture ou rien.
 */
export function effectiveLevel(path: string, roles: readonly AppRole[]): AccessLevel {
  const level = accessLevel(path, roles);
  if (level === 'read' && needsWrite(path)) return 'none';
  return level;
}

/** Raccourci : la page est-elle visible (menu, route) ? */
export const canSee = (path: string, roles: readonly AppRole[]) => accessLevel(path, roles) !== 'none';

/** Raccourci : peut-on y écrire ? */
export const canWrite = (path: string, roles: readonly AppRole[]) => accessLevel(path, roles) === 'write';
