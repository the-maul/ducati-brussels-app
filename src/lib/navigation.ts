/**
 * Définition de la navigation principale (sidebar) — charte §4.1.
 * Regroupe les 14 modules en 10 entrées (cf. dossier-projet §5.5).
 * Les libellés viennent de l'i18n (clé), jamais en dur.
 * Qui voit quelle entrée : c'est la grille des droits (lib/auth/permissions.ts)
 * qui tranche, pas ce fichier — une seule source de vérité.
 */
import {
  LayoutDashboard,
  Bike,
  Recycle,
  Wrench,
  Package,
  Boxes,
  Truck,
  FileText,
  Users,
  Target,
  CreditCard,
  BarChart3,
  Calculator,
  Settings,
  Palette,
  ClipboardCheck,
  ShoppingCart,
  Wallet,
  BellRing,
  type LucideIcon,
  Globe,
} from 'lucide-react';

export type NavItem = {
  /** clé i18n du libellé (nav.*) */
  labelKey: string;
  /** chemin de la route */
  to: string;
  icon: LucideIcon;
  /** entrée de développement (démo charte) */
  dev?: boolean;
  /** sous-entrée (affichée en retrait sous l'entrée qui la précède, mêmes droits) */
  child?: boolean;
};

export const mainNav: NavItem[] = [
  { labelKey: 'nav.dashboard', to: '/dashboard', icon: LayoutDashboard },
  { labelKey: 'nav.vehicles', to: '/vehicles', icon: Bike },
  { labelKey: 'nav.tradein', to: '/tradein', icon: Recycle },
  { labelKey: 'nav.workshop', to: '/workshop', icon: Wrench },
  { labelKey: 'nav.parts', to: '/parts', icon: Package },
  // Un seul catalogue (décision M-25) : les articles du DMS. Les vues éclatées Ducati s'ouvrent depuis la fiche
  // article ou la fiche moto.
  // « Rapprochements » a quitté le menu principal le 28/10/2026 : la file est tombée à 8 cas sur
  // 145 232 liens, le travail quotidien n'existe plus. L'outil vit dans Paramètres, où une pastille
  // signale les cas en attente. Il porte aussi les liens Shopify et la création des articles manquants,
  // c'est pourquoi on ne le supprime pas.
  { labelKey: 'nav.purchases', to: '/purchases', icon: Truck },
  { labelKey: 'nav.orders', to: '/orders', icon: ShoppingCart },
  { labelKey: 'nav.stock', to: '/stock', icon: Boxes },
  { labelKey: 'nav.sales', to: '/sales', icon: FileText },
  { labelKey: 'nav.balances', to: '/sales/balances', icon: Wallet },
  { labelKey: 'nav.webOrders', to: '/sales/web-orders', icon: Globe },
  { labelKey: 'nav.picking', to: '/picking', icon: ClipboardCheck },
  { labelKey: 'nav.clients', to: '/clients', icon: Users },
  { labelKey: 'nav.crm', to: '/crm', icon: Target },
  // Relances d'entretien par mail (marketing), J+5 sans reponse → CRM commercial (M-72, 31/10/2026).
  // Sous /crm : memes droits que le CRM (vendeur, marketing, admin).
  { labelKey: 'nav.crmFollowups', to: '/crm/relances', icon: BellRing, child: true },
  { labelKey: 'nav.pos', to: '/pos', icon: CreditCard },
  { labelKey: 'nav.reports', to: '/reports', icon: BarChart3 },
  { labelKey: 'nav.accounting', to: '/accounting', icon: Calculator },
  { labelKey: 'nav.settings', to: '/settings', icon: Settings },
  { labelKey: 'nav.demo', to: '/demo', icon: Palette, dev: true },
];

/**
 * Entrée active = celle dont le chemin correspond le plus précisément (évite que
 * « Pièces & Accessoires » reste allumé quand on est dans « Catalogue Ducati »).
 */
export function activeNavTo(pathname: string, items: NavItem[]): string | null {
  let best: string | null = null;
  for (const it of items) {
    if ((pathname === it.to || pathname.startsWith(it.to + '/')) && (!best || it.to.length > best.length)) best = it.to;
  }
  return best;
}
