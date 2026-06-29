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
  Store,
  BarChart3,
  Calculator,
  Settings,
  Palette,
  ListChecks,
  type LucideIcon,
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
};

export const mainNav: NavItem[] = [
  { labelKey: 'nav.dashboard', to: '/dashboard', icon: LayoutDashboard },
  { labelKey: 'nav.vehicles', to: '/vehicles', icon: Bike },
  { labelKey: 'nav.tradein', to: '/tradein', icon: Recycle },
  { labelKey: 'nav.workshop', to: '/workshop', icon: Wrench },
  { labelKey: 'nav.parts', to: '/parts', icon: Package },
  { labelKey: 'nav.purchases', to: '/purchases', icon: Truck },
  { labelKey: 'nav.stock', to: '/stock', icon: Boxes },
  { labelKey: 'nav.sales', to: '/sales', icon: FileText },
  { labelKey: 'nav.clients', to: '/clients', icon: Users },
  { labelKey: 'nav.crm', to: '/crm', icon: Target },
  { labelKey: 'nav.pos', to: '/pos', icon: CreditCard },
  { labelKey: 'nav.eshop', to: '/eshop', icon: Store },
  { labelKey: 'nav.reports', to: '/reports', icon: BarChart3 },
  { labelKey: 'nav.accounting', to: '/accounting', icon: Calculator, roles: ['admin', 'comptable'] },
  { labelKey: 'nav.improvements', to: '/improvements', icon: ListChecks, roles: ['admin'] },
  { labelKey: 'nav.settings', to: '/settings', icon: Settings, roles: ['admin'] },
  { labelKey: 'nav.demo', to: '/demo', icon: Palette, dev: true },
];
