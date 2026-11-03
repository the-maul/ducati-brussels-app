/**
 * Panier de commande Ducati — éléments d'interface partagés : statut (couleur + icône + libellé,
 * charte §5.4), type, origine des lignes, rappel des règles. Jamais le rouge Ducati pour un statut.
 */
import {
  Ban, CalendarDays, FileSpreadsheet, PackageCheck, ShoppingCart, Truck, Zap, type LucideIcon,
} from 'lucide-react';
import { StatusBadge, type StatusTone } from '@/components/status-badge';
import { t, fillVars } from '@/lib/i18n';
import type { OrderRule } from '@/modules/orders/thresholds';
import { eur } from '@/modules/orders/order-ui';
import { basketSurchargePct, ruleCodeFor, type BasketKind, type BasketOrigin, type BasketStatus } from './basket';

export { eur };

export const BASKET_STATUS_META: Record<BasketStatus, { tone: StatusTone; icon: LucideIcon }> = {
  ouvert: { tone: 'info', icon: ShoppingCart },
  commande: { tone: 'warning', icon: Truck },
  recu: { tone: 'success', icon: PackageCheck },
  annule: { tone: 'neutral', icon: Ban },
};

export function BasketStatusBadge({ status }: { status: BasketStatus }) {
  const meta = BASKET_STATUS_META[status] ?? BASKET_STATUS_META.ouvert;
  return <StatusBadge tone={meta.tone} icon={meta.icon} label={t(`basket.status_${status}`)} />;
}

const KIND_ICONS: Record<BasketKind, LucideIcon> = { standard: CalendarDays, urgente: Zap, demo: FileSpreadsheet };

export function basketKindIcon(kind: BasketKind): LucideIcon {
  return KIND_ICONS[kind] ?? ShoppingCart;
}

export function basketKindLabel(kind: BasketKind): string {
  return t(`basket.kind_${kind}`);
}

export function BasketKindBadge({ kind }: { kind: BasketKind }) {
  return <StatusBadge tone={kind === 'urgente' ? 'warning' : 'neutral'} icon={basketKindIcon(kind)} label={basketKindLabel(kind)} />;
}

export function originLabel(origin: BasketOrigin): string {
  return t(`basket.origin_${origin}`);
}

/** Phrases qui résument la règle du type de panier (valeurs de Paramètres). */
export function basketRuleSentences(kind: BasketKind, rules: OrderRule[]): string[] {
  const r = rules.find((x) => x.code.toLowerCase() === ruleCodeFor(kind));
  if (!r || !r.configured) return [t('orders.ruleNotConfigured')];
  if (!r.isActive) return [t('orders.ruleDisabled')];
  const out: string[] = [];
  if (kind !== 'demo' && r.minHt != null && r.minHt > 0) out.push(fillVars(t('basket.ruleMin'), { min: eur(r.minHt) }));
  else out.push(t('basket.ruleNoMin'));
  if (r.maxPerDay != null && r.maxPerDay > 0) out.push(fillVars(t('basket.ruleMaxPerDay'), { n: r.maxPerDay }));
  const pct = basketSurchargePct(kind, rules);
  if (pct > 0) out.push(fillVars(t('basket.ruleSurcharge'), { pct: String(pct).replace('.', ',') }));
  return out;
}

export const fmtDate = (iso: string | null | undefined) =>
  (iso ? new Date(iso).toLocaleDateString('fr-BE', { dateStyle: 'short' }) : '—');
export const fmtDateTime = (iso: string | null | undefined) =>
  (iso ? new Date(iso).toLocaleString('fr-BE', { dateStyle: 'short', timeStyle: 'short' }) : '—');
export const fmtQty = (n: number) => Number(n).toLocaleString('fr-BE', { maximumFractionDigits: 3 });
