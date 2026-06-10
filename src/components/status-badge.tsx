/**
 * StatusBadge — badge de statut ERP (charte §5.4).
 * Règle d'or (charte §1, §8) : TOUJOURS couleur + icône + libellé.
 * Le rouge marque n'est jamais un statut (impayé = danger). Forme Cond Bd 12px UPPERCASE.
 */
import { cva, type VariantProps } from 'class-variance-authority';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Info,
  Circle,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const badge = cva(
  'inline-flex items-center gap-1 rounded-[var(--radius-badge)] px-2 py-0.5 font-data text-[12px] font-bold uppercase leading-none tracking-[0.02em] whitespace-nowrap',
  {
    variants: {
      tone: {
        success: 'bg-success-bg text-success',
        warning: 'bg-warning-bg text-warning',
        danger: 'bg-danger-bg text-danger',
        info: 'bg-info-bg text-info',
        neutral: 'bg-neutral-bg text-neutral-tag',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export type StatusTone = NonNullable<VariantProps<typeof badge>['tone']>;

const defaultIcon: Record<StatusTone, LucideIcon> = {
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
  info: Info,
  neutral: Circle,
};

export interface StatusBadgeProps extends VariantProps<typeof badge> {
  label: string;
  /** surcharge l'icône par défaut de la tonalité */
  icon?: LucideIcon;
  className?: string;
}

export function StatusBadge({ tone = 'neutral', label, icon, className }: StatusBadgeProps) {
  const Icon = icon ?? defaultIcon[tone ?? 'neutral'];
  return (
    <span className={cn(badge({ tone }), className)}>
      <Icon className="size-3 shrink-0" aria-hidden />
      {label}
    </span>
  );
}
