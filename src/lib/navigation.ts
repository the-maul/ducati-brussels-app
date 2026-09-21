/**
 * Définition de la navigation principale (sidebar) — charte §4.1.
 * Regroupe les 14 modules en 10 entrées (cf. dossier-projet §5.5).
 * Les libellés viennent de l'i18n (clé), jamais en dur.
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
  type LucideIcon,
  Globe,
  BookOpen,
} from 'lucide-react';

export type NavItem = {
  /** clé i18n du libellé (nav.*) */
  labelKey: string;
  /** chemin de la route */
  to: string;
  icon: LucideIcon;
  /** visible seulement pour ces rôles (vide = tous) */
  roles?: string[];
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
  // Mission 06 : le catalogue Ducati, sous Pièces & Accessoires (mêmes rôles que l'entrée parente).
  { labelKey: 'nav.partsCatalog', to: '/parts/catalog', icon: BookOpen, child: true },
  { labelKey: 'nav.purchases', to: '/purchases', icon: Truck },
  { labelKey: 'nav.orders', to: '/orders', icon: ShoppingCart },
  { labelKey: 'nav.stock', to: '/stock', icon: Boxes },
  { labelKey: 'nav.sales', to: '/sales', icon: FileText },
  { labelKey: 'nav.balances', to: '/sales/balances', icon: Wallet },
  { labelKey: 'nav.webOrders', to: '/sales/web-orders', icon: Globe, roles: ['admin', 'vendeur'] },
  { labelKey: 'nav.picking', to: '/picking', icon: ClipboardCheck },
  { labelKey: 'nav.clients', to: '/clients', icon: Users },
  { labelKey: 'nav.crm', to: '/crm', icon: Target },
  { labelKey: 'nav.pos', to: '/pos', icon: CreditCard },
  { labelKey: 'nav.reports', to: '/reports', icon: BarChart3 },
  { labelKey: 'nav.accounting', to: '/accounting', icon: Calculator, roles: ['admin', 'comptable'] },
  { labelKey: 'nav.settings', to: '/settings', icon: Settings, roles: ['admin'] },
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
