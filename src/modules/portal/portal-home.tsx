/**
 * Accueil du portail : bonjour, prochaine visite, raccourcis, et « complétez votre
 * profil » en étapes avec une barre de progression (décision P-4).
 */
import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Bike, CalendarClock, CheckCircle2, ChevronRight, Circle, FileText, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { getHome, type CompletionStep } from './api';
import {
  AppointmentStatus, Card, ErrorBox, Loading, ProgressBar, SectionTitle, dateLongFr, progressTone, timeFr,
  type ProgressTone,
} from './ui';

/** Statut de la complétion : couleur + icône (le libellé est le pourcentage). */
const TONE_TEXT: Record<ProgressTone, string> = { warning: 'text-warning', info: 'text-info', success: 'text-success' };
const TONE_ICON = { warning: AlertTriangle, info: TrendingUp, success: CheckCircle2 } as const;

/** Où mène chaque étape. */
function stepLink(s: CompletionStep): { to: string; params?: Record<string, string>; hash?: string } {
  switch (s.key) {
    case 'coordonnees': return { to: '/mon-espace/profil', hash: 'coordonnees' };
    case 'avatar': return { to: '/mon-espace/profil', hash: 'photo' };
    case 'preferences': return { to: '/mon-espace/profil', hash: 'preferences' };
    case 'permis': return { to: '/mon-espace/profil', hash: 'permis' };
    case 'societe': return { to: '/mon-espace/profil', hash: 'societe' };
    default: return { to: '/mon-espace/motos/$vehicleId', params: { vehicleId: s.vehicle_id ?? '' }, hash: s.key };
  }
}

function stepLabel(s: CompletionStep) {
  const base = t(`portal.steps.${s.key}`);
  return s.vehicle_label ? `${base} — ${s.vehicle_label}` : base;
}

export function PortalHomeView() {
  const { data, isLoading, error } = useQuery({ queryKey: ['portal', 'home'], queryFn: getHome });
  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorBox error={error} />;

  const todo = data.steps.filter((s) => !s.done);
  const done = data.steps.filter((s) => s.done);
  const complete = data.steps_total > 0 && todo.length === 0;
  const next = data.next_appointment;
  // Retour client du 21/09 : pourcentage + couleur de progression, et invitation à finaliser.
  const pct = complete ? 100 : Math.max(0, Math.min(99, Math.round(Number(data.progress) || 0)));
  const tone = progressTone(pct);
  const ToneIcon = TONE_ICON[tone];
  const firstTodo = todo[0] ? stepLink(todo[0]) : null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[22px] font-bold leading-7">
          {t('portal.home.hello').replace('{name}', data.first_name ? capitalize(data.first_name) : '')}
        </h1>
        <p className="text-[13px] text-muted-foreground">{t('portal.home.subtitle')}</p>
      </div>

      {/* Complétion du profil */}
      <Card>
        <SectionTitle>{t('portal.home.completeTitle')}</SectionTitle>
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <p className={cn('flex items-center gap-1.5 text-[15px] font-bold', TONE_TEXT[tone])}>
            <ToneIcon className="size-4 shrink-0 self-center" aria-hidden />
            <span className="font-data tabular-nums">{t('portal.home.percentDone').replace('{pct}', String(pct))}</span>
          </p>
          <span className="font-data text-[13px] tabular-nums text-muted-foreground">
            {t('portal.home.stepsCount').replace('{done}', String(data.steps_done)).replace('{total}', String(data.steps_total))}
          </span>
        </div>
        <ProgressBar value={pct} tone={tone} label={t('portal.home.completeTitle')} />
        <p className="mt-2 text-[14px] font-medium">
          {complete
            ? t('portal.home.completeDone')
            : todo.length === 1
              ? t('portal.home.finishOne')
              : t('portal.home.finishMany').replace('{n}', String(todo.length))}
        </p>
        {!complete && (
          <p className="mt-1 text-[12px] text-muted-foreground">{t('portal.home.completeWhy')}</p>
        )}
        {!complete && firstTodo && (
          <Button asChild variant="outline" className="mt-3 h-11 w-full sm:w-auto">
            <Link to={firstTodo.to} params={firstTodo.params as never} hash={firstTodo.hash}>
              {t('portal.home.finishCta')} <ArrowRight />
            </Link>
          </Button>
        )}
        <ul className="mt-3 divide-y divide-border">
          {[...todo, ...done].map((s) => {
            const link = stepLink(s);
            return (
              <li key={`${s.key}-${s.vehicle_id ?? ''}`}>
                <Link to={link.to} params={link.params as never} hash={link.hash}
                  className="flex items-center gap-3 py-3">
                  {s.done
                    ? <CheckCircle2 className="size-5 shrink-0 text-success" aria-hidden />
                    : <Circle className="size-5 shrink-0 text-muted-foreground" aria-hidden />}
                  <span className={cn('min-w-0 flex-1 text-[14px]', s.done && 'text-muted-foreground line-through')}>
                    {stepLabel(s)}
                  </span>
                  <span className="sr-only">{s.done ? t('portal.steps.done') : t('portal.steps.todo')}</span>
                  {!s.done && <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
                </Link>
              </li>
            );
          })}
        </ul>
      </Card>

      {/* Prochaine visite */}
      <Card>
        <SectionTitle>{t('portal.home.nextVisit')}</SectionTitle>
        {next ? (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[15px] font-medium first-letter:uppercase">{dateLongFr(next.starts_at)}</p>
              <p className="text-[13px] text-muted-foreground">
                {next.status === 'demande' ? t('portal.appointments.awaitingConfirmation') : timeFr(next.starts_at)}
                {next.vehicle_label ? ` · ${next.vehicle_label}` : ''}
              </p>
              {next.work_description && <p className="mt-1 truncate text-[13px]">{next.work_description}</p>}
            </div>
            <AppointmentStatus status={next.status} />
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-[13px] text-muted-foreground">{t('portal.home.noVisit')}</p>
            <Button asChild className="w-full sm:w-auto">
              <Link to="/mon-espace/rendez-vous" search={{ nouveau: true }}>
                <CalendarClock /> {t('portal.appointments.request')}
              </Link>
            </Button>
          </div>
        )}
      </Card>

      {/* Raccourcis */}
      <div className="grid grid-cols-2 gap-3">
        <Shortcut to="/mon-espace/motos" icon={<Bike className="size-5" />} label={t('portal.nav.vehicles')} count={data.vehicles_count} />
        <Shortcut to="/mon-espace/factures" icon={<FileText className="size-5" />} label={t('portal.nav.invoices')} count={data.invoices_count} />
      </div>
    </div>
  );
}

function Shortcut({ to, icon, label, count }: { to: string; icon: ReactNode; label: string; count: number }) {
  return (
    <Link to={to} className="flex items-center gap-3 rounded-md border border-border bg-card p-4">
      <span className="text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-medium">{label}</span>
        <span className="font-data text-[20px] font-bold tabular-nums">{count}</span>
      </span>
    </Link>
  );
}

function capitalize(s: string) {
  return s.toLowerCase().replace(/(^|[\s-])\p{L}/gu, (m) => m.toUpperCase());
}
