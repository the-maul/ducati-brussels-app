/**
 * Jauge d'occupation d'une journee du planning (revue UX/UI du 20/11/2026) : la couleur seule ne
 * suffit pas (charte : statut = couleur + icone + libelle). Affichage seulement : le pourcentage
 * vient de `dayLoad` et la tonalite de `occupancyTone` (rules.ts), inchanges.
 */
import { AlertTriangle, CheckCircle2, CircleAlert, Circle, type LucideIcon } from 'lucide-react';
import { fillVars, t } from '@/lib/i18n';
import { formatMinutes, occupancyTone, type DayLoad, type LoadTone } from './rules';

const META: Record<LoadTone, { icon: LucideIcon; key: string; text: string; bar: string }> = {
  success: { icon: CheckCircle2, key: 'designEcrans.occFree', text: 'text-success', bar: 'bg-success' },
  warning: { icon: CircleAlert, key: 'designEcrans.occBusy', text: 'text-warning', bar: 'bg-warning' },
  danger: { icon: AlertTriangle, key: 'designEcrans.occFull', text: 'text-danger', bar: 'bg-danger' },
  neutral: { icon: Circle, key: 'designEcrans.occFree', text: 'text-muted-foreground', bar: 'bg-muted-foreground' },
};

export function OccupancyGauge({ pct }: { pct: number }) {
  const meta = META[occupancyTone(pct)] ?? META.neutral;
  const Icon = meta.icon;
  const pctText = pct.toLocaleString('fr-BE', { maximumFractionDigits: 2 });
  const state = t(meta.key);
  return (
    <span className="mt-1 block" title={fillVars(t('designEcrans.occLabel'), { pct: pctText, state })}>
      <span className={`flex items-center gap-1 font-data text-[12px] font-bold tabular-nums ${meta.text}`}>
        <Icon className="size-3.5 shrink-0" aria-hidden />
        <span>{pctText} %</span>
        <span className="font-normal">· {state}</span>
      </span>
      <span className="mt-0.5 block h-1 w-full overflow-hidden rounded-[var(--radius-badge)] bg-muted" aria-hidden>
        <span className={`block h-full ${meta.bar}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      </span>
    </span>
  );
}

/** Remplissage compact d'un compagnon : pourcentage, temps prévu / disponible et barre. */
export function LoadChip({ load, prefix }: { load: DayLoad; prefix?: string }) {
  if (load.capacity <= 0 || load.pct === null) {
    return <span className="mt-0.5 block text-[11px] text-muted-foreground">{prefix ? `${prefix} : ` : ''}{t('dossier.planNoPresence')}</span>;
  }
  const meta = META[occupancyTone(load.pct)] ?? META.neutral;
  const Icon = meta.icon;
  const pct = Math.round(load.pct);
  return (
    <span className="mt-0.5 block" title={fillVars(t('designEcrans.occLabel'), { pct: String(pct), state: t(meta.key) })}>
      <span className="flex items-center gap-1 font-data text-[11px] tabular-nums">
        <Icon className={`size-3 shrink-0 ${meta.text}`} aria-hidden />
        {prefix && <span className="text-muted-foreground">{prefix}</span>}
        <span className={`font-bold ${meta.text}`}>{pct} %</span>
        <span className="truncate text-muted-foreground">{formatMinutes(load.planned)} / {formatMinutes(load.capacity)}</span>
      </span>
      <span className="mt-0.5 block h-1 w-full overflow-hidden rounded-[var(--radius-badge)] bg-muted" aria-hidden>
        <span className={`block h-full ${meta.bar}`} style={{ width: `${Math.min(100, Math.max(0, load.pct))}%` }} />
      </span>
    </span>
  );
}
