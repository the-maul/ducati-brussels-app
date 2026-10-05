/**
 * M8 — Briques d'affichage partagées de « Prochain entretien » (mission 07, cartes 4, 6, 7) :
 * badge d'urgence, badge de certitude, libellé d'échéance, libellé de temps officiel.
 * Utilisées par la fiche moto, la fiche client et l'écran « Entretiens à venir ».
 *
 * Charte §9 : tout statut = couleur + icône + libellé ; `tabular-nums` sur les nombres ;
 * aucune couleur en dur (tokens uniquement) ; le rouge marque n'est jamais un statut.
 */
import { AlertTriangle, CalendarClock, CheckCircle2, Clock, Gauge, HelpCircle, Timer } from 'lucide-react';
import { StatusBadge, type StatusTone } from '@/components/status-badge';
import { t } from '@/lib/i18n';
import { fill, fmtInt } from '@/modules/catalog/format';
import { dueSeverity, fmtDate, fmtKm, fmtMinutes, utToMinutes, type DueConfidence } from './maintenance-due';

/** Ce qu'il faut pour afficher une échéance, quelle que soit sa provenance. */
export type DueLike = {
  confidence: DueConfidence;
  reached: boolean;
  reachedBy?: 'km' | 'mois' | null;
  firstTrigger?: 'km' | 'mois' | null;
  dueKm: number | null;
  dueDate: string | null;
  daysLeft: number | null;
  kmReachedOn?: string | null;
  kmPerDay?: number | null;
  ut?: number | null;
};

const SEVERITY: Record<string, { tone: StatusTone; icon: typeof AlertTriangle; key: string }> = {
  retard: { tone: 'danger', icon: AlertTriangle, key: 'maintenanceDue.stLate' },
  imminent: { tone: 'warning', icon: Clock, key: 'maintenanceDue.stImminent' },
  bientot: { tone: 'info', icon: CalendarClock, key: 'maintenanceDue.stSoon' },
  calme: { tone: 'neutral', icon: CheckCircle2, key: 'maintenanceDue.stCalm' },
};

/** Badge d'urgence : en retard / imminent / bientôt / à suivre. */
export function DueBadge({ due }: { due: DueLike }) {
  const m = SEVERITY[dueSeverity(due)] ?? SEVERITY.calme;
  return <StatusBadge tone={m.tone} icon={m.icon} label={t(m.key)} />;
}

/**
 * Badge de certitude. C'est l'information la plus importante de la carte :
 * une échéance « estimée » n'est pas un retard, c'est un client à appeler.
 */
export function ConfidenceBadge({ confidence }: { confidence: DueConfidence }) {
  return confidence === 'exact'
    ? <StatusBadge tone="success" icon={CheckCircle2} label={t('maintenanceDue.confExact')} />
    : <StatusBadge tone="info" icon={HelpCircle} label={t('maintenanceDue.confEstime')} />;
}

/** « à 30 000 km ou le 25/04/2027 ». */
export function dueLabel(due: Pick<DueLike, 'dueKm' | 'dueDate'>): string {
  const km = due.dueKm != null ? fmtKm(due.dueKm) : null;
  const date = due.dueDate ? fmtDate(due.dueDate) : null;
  if (km && date) return fill(t('maintenanceDue.dueBoth'), { km, date });
  if (km) return fill(t('maintenanceDue.dueKm'), { km });
  if (date) return fill(t('maintenanceDue.dueDate'), { date });
  return '—';
}

/** Ce qui arrive en premier, le rythme de roulage et les jours restants (M-16). */
export function DueDetail({ due }: { due: DueLike }) {
  const parts: string[] = [];
  if (due.reached) {
    parts.push(due.reachedBy === 'km' ? t('maintenanceDue.reachedByKm') : t('maintenanceDue.reachedByMonths'));
  } else {
    if (due.firstTrigger === 'km') parts.push(t('maintenanceDue.firstKm'));
    else if (due.firstTrigger === 'mois') parts.push(t('maintenanceDue.firstMonths'));
    if (due.daysLeft != null) parts.push(fill(t('maintenanceDue.daysLeft'), { n: fmtInt(due.daysLeft) }));
    if (due.kmReachedOn) parts.push(fill(t('maintenanceDue.kmReachedOn'), { date: fmtDate(due.kmReachedOn) }));
  }
  if (due.kmPerDay != null) {
    parts.push(fill(t('maintenanceDue.pace'), { n: due.kmPerDay.toLocaleString('fr-BE') }));
  }
  if (!parts.length) return null;
  return <span className="text-[12px] text-muted-foreground">{parts.join(' · ')}</span>;
}

/** « 1 h 42 (17 UT) » — temps officiel Ducati, 1 UT = 6 min (M-33). */
export function OfficialTime({ ut }: { ut: number | null | undefined }) {
  const min = utToMinutes(ut);
  if (min == null) {
    return <span className="text-[12px] text-muted-foreground">{t('maintenanceDue.noTime')}</span>;
  }
  return (
    <span className="inline-flex items-center gap-1 tabular-nums">
      <Timer className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      {fmtMinutes(min)}
      <span className="text-[12px] text-muted-foreground">({fill(t('maintenanceDue.estimateUt'), { ut: String(ut) })})</span>
    </span>
  );
}

/** Provenance du programme : manuel d'atelier ou plan d'entretien PDF. */
export function SourceLabel({ source }: { source: string | null | undefined }) {
  if (!source) return null;
  return (
    <span className="text-[12px] text-muted-foreground">
      {source === 'manuel' ? t('maintenanceDue.sourceManual') : t('maintenanceDue.sourcePlan')}
    </span>
  );
}

/** Kilométrage d'une moto, avec le repère « compteur inconnu ». */
export function MileageLabel({ km }: { km: number | null | undefined }) {
  if (km == null || km <= 0) {
    return (
      <span className="inline-flex items-center gap-1 text-[12px] text-warning">
        <Gauge className="size-3.5 shrink-0" aria-hidden /> {t('maintenanceDue.kpiMissingKm')}
      </span>
    );
  }
  return <span className="tabular-nums">{fmtKm(km)}</span>;
}
