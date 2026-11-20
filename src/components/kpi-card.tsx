/**
 * KpiCard — carte d'indicateur de dashboard (charte §5.5).
 * Libellé en label UPPERCASE, valeur en Cond XBd (tabular-nums), delta optionnel.
 */
import { ArrowUp, ArrowDown, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export function KpiCard({
  label,
  value,
  delta,
  deltaTone = 'success',
  icon: Icon,
  detail,
  title,
}: {
  label: string;
  value: string;
  delta?: string;
  deltaTone?: 'success' | 'danger';
  icon?: LucideIcon;
  /** Ligne d'information neutre sous la valeur (ex. « y compris dépôt-vente : … », Q66). */
  detail?: string;
  /** Infobulle de la carte. */
  title?: string;
}) {
  const DeltaIcon = deltaTone === 'success' ? ArrowUp : ArrowDown;
  return (
    <div className="rounded-md border border-border bg-card p-4 shadow-[var(--shadow-card)]" title={title}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-ui text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">
          {label}
        </span>
        {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
      </div>
      <div className="mt-2 font-data text-[32px] font-extrabold leading-[36px] tabular-nums text-foreground">
        {value}
      </div>
      {detail && (
        <div className="mt-1 font-data text-[13px] font-medium tabular-nums text-muted-foreground">{detail}</div>
      )}
      {delta && (
        <div
          className={cn(
            'mt-1 flex items-center gap-1 text-[12px] font-medium',
            deltaTone === 'success' ? 'text-success' : 'text-danger',
          )}
        >
          <DeltaIcon className="size-3" aria-hidden />
          {delta}
        </div>
      )}
    </div>
  );
}
