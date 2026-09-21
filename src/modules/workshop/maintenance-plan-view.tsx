/**
 * M8 — Plans d'entretien (mission 07) : affichage des échéances d'un plan (intervalle au premier
 * atteint, temps Ducati en vigueur, prix main-d'œuvre HT, opérations, historique).
 * Utilisé par l'écran Atelier → Plans d'entretien et par la fiche moto.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, History, Route as RouteIcon, Flag, Gauge, ChevronDown, ChevronRight } from 'lucide-react';
import { StatusBadge, type StatusTone } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';
import { fill, fmtMoney } from '@/modules/catalog/format';
import { getPlanServices, type MaintenanceInterval, type MaintenanceService, type MaintenanceTime } from './maintenance-api';
import { fmtKm, labourPriceHt, pickCurrent } from './maintenance-plans';

const USAGE_TONE: Record<string, { tone: StatusTone; icon: typeof RouteIcon }> = {
  route: { tone: 'info', icon: RouteIcon },
  piste_amateur: { tone: 'warning', icon: Gauge },
  racing: { tone: 'neutral', icon: Flag },
};

export function UsageBadge({ usage }: { usage: string }) {
  const m = USAGE_TONE[usage] ?? USAGE_TONE.route;
  return <StatusBadge tone={m.tone} icon={m.icon} label={t(`maintenance.usage_${usage}`)} />;
}

export function yearsLabel(from: number | null, to: number | null): string {
  if (from == null && to == null) return t('maintenance.yearsUnknown');
  if (to == null) return fill(t('maintenance.yearsOpen'), { from: String(from) });
  return fill(t('maintenance.years'), { from: String(from ?? to), to: String(to) });
}

/** Texte de l'intervalle : « tous les 15 000 km ou tous les 24 mois — le premier atteint ». */
export function intervalText(i: Pick<MaintenanceInterval, 'km_first' | 'km_interval' | 'months' | 'km_column'> | null): string {
  if (!i) return t('maintenance.noInterval');
  const parts: string[] = [];
  if (i.km_first != null) parts.push(fill(t('maintenance.kmFirst'), { km: fmtKm(i.km_first) }));
  if (i.km_interval != null) parts.push(fill(t('maintenance.kmEvery'), { km: fmtKm(i.km_interval) }));
  if (i.km_interval == null && i.km_first == null && i.km_column != null) parts.push(fill(t('maintenance.kmColumn'), { km: fmtKm(i.km_column) }));
  if (i.months != null) parts.push(fill(t('maintenance.monthsEvery'), { n: String(i.months) }));
  if (!parts.length) return t('maintenance.noInterval');
  const txt = parts.join(` ${t('maintenance.or')} `);
  return parts.length > 1 ? `${txt} — ${t('maintenance.firstReached')}` : txt;
}

const fmtHours = (h: number | null) => (h == null ? '' : fill(t('maintenance.hours'), { h: new Intl.NumberFormat('fr-BE', { maximumFractionDigits: 2 }).format(h) }));

function TimeText({ time }: { time: MaintenanceTime | null }) {
  if (!time) return <span className="text-muted-foreground">{t('maintenance.noTime')}</span>;
  return (
    <span className="tabular-nums">
      {fmtHours(time.hours)}
      {time.ut != null && <span className="ml-1 text-muted-foreground">({fill(t('maintenance.ut'), { n: String(time.ut) })})</span>}
    </span>
  );
}

function PriceText({ time, rate }: { time: MaintenanceTime | null; rate: number | null }) {
  if (!time || time.hours == null) return <span className="text-muted-foreground">—</span>;
  const p = labourPriceHt(time.hours, rate);
  return p == null
    ? <span className="text-muted-foreground">{t('maintenance.priceMissing')}</span>
    : <span className="tabular-nums">{fmtMoney(p)}</span>;
}

const sourceText = (r: { source_file: string | null; source_edition: string | null; source_page?: number | null }) =>
  [r.source_edition, r.source_file, r.source_page ? `p. ${r.source_page}` : null].filter(Boolean).join(' · ');

/** Une échéance : intervalle, temps, prix, opérations, historique. */
export function ServiceBlock({ service, rate, year, compact }: {
  service: MaintenanceService; rate: number | null; year?: number | null; compact?: boolean;
}) {
  const [showOps, setShowOps] = useState(false);
  const [showHist, setShowHist] = useState(false);
  const interval = pickCurrent(service.intervals, year);
  const time = pickCurrent(service.times, year);
  const history = [...service.intervals, ...service.times].filter((r) => r.status === 'historique');
  const extraCurrent = service.intervals.filter((r) => r.status === 'en_vigueur' && r !== interval);

  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-ui text-[14px] font-bold">{service.name}</div>
          <div className="text-[13px]">{intervalText(interval)}</div>
          {extraCurrent.map((x) => (
            <div key={x.id} className="text-[12px] text-muted-foreground">{intervalText(x)}{x.years_doc ? ` (${x.years_doc})` : ''}</div>
          ))}
          {interval && !compact && <div className="text-[12px] text-muted-foreground">{t('maintenance.source')} : {sourceText(interval)}</div>}
        </div>
        <div className="text-right text-[13px]">
          <div><TimeText time={time} /></div>
          <div className="font-semibold"><PriceText time={time} rate={rate} /></div>
          {time && !compact && <div className="text-[12px] text-muted-foreground">{sourceText(time)}</div>}
        </div>
      </div>
      {service.operations_note && <p className="mt-1 text-[12px] text-muted-foreground">{service.operations_note}</p>}

      <div className="mt-2 flex flex-wrap gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setShowOps((v) => !v)}>
          {showOps ? <ChevronDown /> : <ChevronRight />} {fill(t('maintenance.operations'), { n: String(service.operations.length) })}
        </Button>
        {!compact && history.length > 0 && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setShowHist((v) => !v)}>
            <History /> {showHist ? t('maintenance.hideHistory') : fill(t('maintenance.history'), { n: String(history.length) })}
          </Button>
        )}
      </div>

      {showOps && (
        service.operations.length === 0
          ? <p className="mt-1 text-[13px] text-muted-foreground">{t('maintenance.noOperation')}</p>
          : (
            <ol className="mt-1 space-y-1 text-[13px]">
              {service.operations.map((o) => (
                <li key={o.id} className="flex gap-2">
                  <span className="w-6 shrink-0 text-right tabular-nums text-muted-foreground">{o.n ?? ''}</span>
                  <span>
                    {o.text}
                    {o.periodicity_months != null && <span className="ml-1 text-muted-foreground">({fill(t('maintenance.monthsEvery'), { n: String(o.periodicity_months) })})</span>}
                    {o.remark && <span className="block text-[12px] text-muted-foreground">{o.remark}</span>}
                  </span>
                </li>
              ))}
              {!compact && service.operations[0] && <li className="text-[12px] text-muted-foreground">{t('maintenance.source')} : {sourceText(service.operations[0])}</li>}
            </ol>
          )
      )}

      {showHist && (
        <ul className="mt-2 space-y-1 border-t border-border pt-2 text-[12px]">
          {history.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2">
              <StatusBadge tone="neutral" icon={History} label={t('maintenance.historic')} />
              <span className="tabular-nums">{'hours' in r ? <TimeText time={r as MaintenanceTime} /> : intervalText(r as MaintenanceInterval)}</span>
              <span className="text-muted-foreground">{sourceText(r)}{r.years_doc ? ` · ${r.years_doc}` : ''}</span>
              {r.replaced_by && <span className="text-muted-foreground">— {r.replaced_by}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Toutes les échéances d'un plan. */
export function PlanServices({ planId, rate, year, compact }: { planId: string; rate: number | null; year?: number | null; compact?: boolean }) {
  const q = useQuery({ queryKey: ['maintenance', 'services', planId], queryFn: () => getPlanServices(planId) });
  if (q.isLoading) return <Loader2 className="size-5 animate-spin text-muted-foreground" />;
  if (q.error) return <p className="text-sm text-danger">{t('maintenance.loadErr')}</p>;
  return (
    <div className="space-y-2">
      {(q.data ?? []).map((s) => <ServiceBlock key={s.id} service={s} rate={rate} year={year} compact={compact} />)}
    </div>
  );
}
