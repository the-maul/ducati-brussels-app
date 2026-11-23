/**
 * M4 — C2 (PIE-01) : la navigation entre les écrans de commande de pièces. Chacun garde sa route ; un
 * libellé dit ce qu'il fait, dans l'ordre du travail.
 */
import { Link } from '@tanstack/react-router';
import {
  CalendarClock, ClipboardList, FileSpreadsheet, PackageCheck, Route as RouteIcon, ShoppingBasket, ShoppingCart, Truck, type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

export type PartsFlowScreen = 'inProgress' | 'rdv' | 'orders' | 'toOrder' | 'restock' | 'baskets' | 'purchases' | 'excel';

const base = 'inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-md border px-3 text-[13px]';
const on = 'border-foreground bg-accent font-bold text-foreground';
const off = 'border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground';

function Item({ active, icon: Icon, label, hint, children }: { active: boolean; icon: LucideIcon; label: string; hint: string; children: (cls: string, inner: React.ReactNode) => React.ReactNode }) {
  return <>{children(cn(base, active ? on : off), <span className="inline-flex items-center gap-1.5" title={hint}><Icon className="size-4" aria-hidden /> {label}</span>)}</>;
}

export function PartsFlowNav({ current }: { current: PartsFlowScreen }) {
  const it = (k: PartsFlowScreen, icon: LucideIcon) => ({ active: current === k, icon, label: t(`partsFlow.${k}`), hint: t(`partsFlow.${k}Hint`) });
  const aria = (k: PartsFlowScreen) => (current === k ? ('page' as const) : undefined);
  return (
    <nav aria-label={t('partsFlow.aria')} className="mb-4 flex gap-1 overflow-x-auto pb-1">
      <Item {...it('inProgress', RouteIcon)}>{(c, i) => <Link to="/parts/upcoming" search={{ view: 'encours' }} aria-current={aria('inProgress')} className={c}>{i}</Link>}</Item>
      <Item {...it('rdv', CalendarClock)}>{(c, i) => <Link to="/parts/upcoming" search={{}} aria-current={aria('rdv')} className={c}>{i}</Link>}</Item>
      <Item {...it('orders', ClipboardList)}>{(c, i) => <Link to="/orders" aria-current={aria('orders')} className={c}>{i}</Link>}</Item>
      <Item {...it('toOrder', PackageCheck)}>{(c, i) => <Link to="/purchases/proposal" aria-current={aria('toOrder')} className={c}>{i}</Link>}</Item>
      <Item {...it('restock', ShoppingCart)}>{(c, i) => <Link to="/purchases/reorder" search={{ highlight: undefined }} aria-current={aria('restock')} className={c}>{i}</Link>}</Item>
      <Item {...it('baskets', ShoppingBasket)}>{(c, i) => <Link to="/purchases/baskets" aria-current={aria('baskets')} className={c}>{i}</Link>}</Item>
      <Item {...it('purchases', Truck)}>{(c, i) => <Link to="/purchases" aria-current={aria('purchases')} className={c}>{i}</Link>}</Item>
      <Item {...it('excel', FileSpreadsheet)}>{(c, i) => <Link to="/orders/excel" aria-current={aria('excel')} className={c}>{i}</Link>}</Item>
    </nav>
  );
}
