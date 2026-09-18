/**
 * Commandes de pièces — éléments d'interface partagés (libellés de type, icônes, rappel des règles).
 * Les valeurs des règles viennent de Paramètres (getOrderRules), jamais du code.
 */
import { Zap, CalendarDays, FileSpreadsheet, AlertTriangle, Package, type LucideIcon } from 'lucide-react';
import { t } from '@/lib/i18n';
import type { OrderKind } from './api';
import { ruleFor, type OrderRule } from './thresholds';

export const eur = (n: number) =>
  `${(Math.round(Number(n) * 100) / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} €`;

const KIND_ICONS: Record<string, LucideIcon> = {
  urgente: Zap,
  standard: CalendarDays,
  excel: FileSpreadsheet,
  accident: AlertTriangle,
};

/** Icône d'un type (type ajouté plus tard : icône générique). */
export function kindIcon(kind: OrderKind): LucideIcon {
  return KIND_ICONS[kind] ?? Package;
}

/** Libellé d'un type : dictionnaire FR, sinon libellé réglé dans Paramètres, sinon le code. */
export function kindLabel(kind: OrderKind, rules?: OrderRule[]): string {
  const key = `orders.kind_${kind}`;
  const v = t(key);
  if (v !== key) return v;
  return (rules && ruleFor(rules, kind)?.label) || kind;
}

/** Phrases qui résument la règle d'un type (rappel à l'écran). */
export function ruleSentences(rule: OrderRule | undefined, rules: OrderRule[]): string[] {
  if (!rule || !rule.configured) return [t('orders.ruleNotConfigured')];
  if (!rule.isActive) return [t('orders.ruleDisabled')];
  const out: string[] = [];
  if (rule.minHt != null && rule.minHt > 0) out.push(t('orders.ruleMin').replace('{min}', eur(rule.minHt)));
  else if (rule.minHtPerTab == null) out.push(t('orders.ruleNoMin'));
  if (rule.fallback) out.push(t('orders.ruleFallback').replace('{kind}', kindLabel(rule.fallback, rules)));
  if (rule.surchargePct > 0) out.push(t('orders.ruleSurcharge').replace('{pct}', String(rule.surchargePct).replace('.', ',')));
  if (rule.maxPerDay != null && rule.maxPerDay > 0) out.push(t('orders.ruleMaxPerDay').replace('{n}', String(rule.maxPerDay)));
  if (rule.minHtPerTab != null && rule.minHtPerTab > 0) out.push(t('orders.ruleMinPerTab').replace('{min}', eur(rule.minHtPerTab)));
  return out;
}
