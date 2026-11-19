/**
 * M8 / M5 — Lot B (19/11/2026) : ecran du magasin « Pieces des RDV a venir » (ATE015 INV006).
 * Par jour puis par RDV d'entretien : chaque piece du kit avec son etat (couleur + icone + libelle) :
 * reservee en stock / au panier (urgente ou standard, libelle du panier) / commandee (n° DCS) /
 * manquante (raison : fin de serie, remplacee, panier annule...) / hors stock (non stockee).
 * Actions quand l'automatisme n'a pas pu : « Reserver » (stock libre), « Commander en urgente »
 * (bascule le panier standard ouvert, commande le manque non couvert). Picking list : ouvrir, ou
 * « Preparer maintenant » avant la veille. Avant la migration 20261119250000 : un message.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, CalendarDays, ClipboardList, Clock, Loader2, PackageCheck, PackageX, RefreshCw, ShoppingCart, Truck, Zap,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge, type StatusTone } from '@/components/status-badge';
import { t, fillVars } from '@/lib/i18n';
import { syncReservations } from './api';
import { serviceLabel } from './reserved-parts-block';
import {
  brusselsParts, groupUpcoming, missingCount, type UpcomingAppointment, type UpcomingPartRow, type UpcomingPartState,
} from './parts-flow';
import { listUpcomingParts, openPickingForAppointment, openPickingForRepairOrder, orderReservationUrgent } from './upcoming-api';

export const PART_STATE_META: Record<UpcomingPartState, { tone: StatusTone; icon: LucideIcon }> = {
  reservee: { tone: 'success', icon: PackageCheck },
  au_panier: { tone: 'info', icon: ShoppingCart },
  commandee: { tone: 'info', icon: Truck },
  manquante: { tone: 'danger', icon: AlertTriangle },
  hors_stock: { tone: 'neutral', icon: PackageX },
};

export function PartStateBadge({ state }: { state: UpcomingPartState }) {
  const meta = PART_STATE_META[state] ?? PART_STATE_META.manquante;
  return <StatusBadge tone={meta.tone} icon={meta.icon} label={t(`upcomingParts.state_${state}`)} />;
}

function KindBadge({ kind }: { kind: string | null }) {
  if (kind !== 'urgente' && kind !== 'standard') return null;
  return kind === 'urgente'
    ? <StatusBadge tone="warning" icon={Zap} label={t('upcomingParts.kind_urgente')} />
    : <StatusBadge tone="neutral" icon={Clock} label={t('upcomingParts.kind_standard')} />;
}

const fmtQty = (n: number) => (Math.round(n * 1000) / 1000).toString().replace('.', ',');
const addDays = (iso: string, d: number) => {
  const x = new Date(`${iso}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + d);
  return x.toISOString().slice(0, 10);
};
const fmtDay = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-BE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' });

export function UpcomingPartsScreen({ companyId, readOnly = false }: { companyId: string; readOnly?: boolean }) {
  const today = brusselsParts(new Date()).date;
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(addDays(today, 7));
  const key = ['upcoming-parts', companyId, from, to];
  const list = useQuery({ queryKey: key, queryFn: () => listUpcomingParts(companyId, from, to), enabled: !!companyId && from <= to });
  const groups = useMemo(() => groupUpcoming(list.data ?? []), [list.data]);
  const totalMissing = useMemo(() => (list.data ?? []).filter((r) => r.state === 'manquante').length, [list.data]);

  const preset = (days: number, start = 0) => { setFrom(addDays(today, start)); setTo(addDays(today, start + days)); };

  return (
    <div className="space-y-4">
      <section className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-card p-3">
        <div className="space-y-1">
          <label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('upcomingParts.from')}</label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        </div>
        <div className="space-y-1">
          <label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('upcomingParts.to')}</label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => preset(0)}>{t('upcomingParts.today')}</Button>
          <Button size="sm" variant="outline" onClick={() => preset(0, 1)}>{t('upcomingParts.tomorrow')}</Button>
          <Button size="sm" variant="outline" onClick={() => preset(7)}>{t('upcomingParts.next7')}</Button>
          <Button size="sm" variant="outline" onClick={() => preset(14)}>{t('upcomingParts.next14')}</Button>
        </div>
        <Button size="sm" variant="outline" className="ml-auto" onClick={() => list.refetch()} disabled={list.isFetching}>
          {list.isFetching ? <Loader2 className="animate-spin" /> : <RefreshCw />} {t('upcomingParts.refresh')}
        </Button>
      </section>

      {list.data === null && <p className="rounded-md bg-info-bg px-3 py-2 text-[13px] text-info">{t('upcomingParts.migrationMissing')}</p>}
      {list.error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{(list.error as Error).message}</p>}
      {list.isLoading && <Loader2 className="size-5 animate-spin text-muted-foreground" />}

      {list.data && (
        <p className="text-[13px] text-muted-foreground">
          {fillVars(t('upcomingParts.summary'), { rdv: groups.reduce((s, g) => s + g.appointments.length, 0), missing: totalMissing })}
        </p>
      )}
      {list.data && list.data.length === 0 && <p className="text-[13px] text-muted-foreground">{t('upcomingParts.empty')}</p>}

      {groups.map((g) => (
        <section key={g.day} className="space-y-3">
          <h2 className="flex items-center gap-2 text-[15px] font-bold capitalize">
            <CalendarDays className="size-4 text-muted-foreground" aria-hidden /> {fmtDay(g.day)}
          </h2>
          {g.appointments.map((a) => (
            <AppointmentCard key={a.appointmentId} a={a} readOnly={readOnly} onChanged={() => list.refetch()} />
          ))}
        </section>
      ))}
    </div>
  );
}

function AppointmentCard({ a, readOnly, onChanged }: { a: UpcomingAppointment; readOnly: boolean; onChanged: () => void }) {
  const qc = useQueryClient();
  const done = (msg: string) => {
    toast.success(msg);
    onChanged();
    qc.invalidateQueries({ queryKey: ['reserved-parts'] });
  };
  const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));
  const reserve = useMutation({
    mutationFn: () => syncReservations({ appointmentId: a.repairOrderId ? null : a.appointmentId, orId: a.repairOrderId }),
    meta: { success: false },
    onSuccess: (r) => done(fillVars(t('upcomingParts.reserved'), { moves: r.moves, basket: r.basketLines })),
    onError: fail,
  });
  const prepare = useMutation({
    mutationFn: () => (a.repairOrderId ? openPickingForRepairOrder(a.repairOrderId) : openPickingForAppointment(a.appointmentId)),
    meta: { success: false },
    onSuccess: () => done(t('upcomingParts.pickingCreated')),
    onError: fail,
  });
  const label = serviceLabel(a.serviceCode);
  const missing = missingCount(a);

  return (
    <article className="rounded-md border border-border bg-card p-3 shadow-[var(--shadow-card)]">
      <header className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
        <span className="font-data text-[15px] font-bold tabular-nums">{fmtTime(a.startsAt)}</span>
        <span className="font-semibold">{a.contactName ?? t('upcomingParts.noClient')}</span>
        <span className="text-muted-foreground">{[a.vehicleLabel, a.plate].filter(Boolean).join(' · ')}</span>
        {label && <span className="text-muted-foreground">· {label}</span>}
        {a.mechanicName && <span className="text-muted-foreground">· {a.mechanicName}</span>}
        {a.repairOrderId && a.orNumber && (
          <Link to="/workshop/$orId" params={{ orId: a.repairOrderId }} className="font-medium underline">{a.orNumber}</Link>
        )}
        {missing > 0 && <StatusBadge tone="danger" icon={AlertTriangle} label={fillVars(t('upcomingParts.missingCount'), { n: missing })} />}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {a.pickingId ? (
            <Link to="/preparation/$pickingId" params={{ pickingId: a.pickingId }}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[13px] font-medium hover:bg-muted">
              <ClipboardList className="size-4" aria-hidden /> {t('upcomingParts.openPicking')}
            </Link>
          ) : (
            <>
              <StatusBadge tone="neutral" icon={ClipboardList} label={t('upcomingParts.noPicking')} />
              {!readOnly && (
                <Button size="sm" variant="outline" onClick={() => prepare.mutate()} disabled={prepare.isPending}>
                  {prepare.isPending ? <Loader2 className="animate-spin" /> : <ClipboardList />} {t('upcomingParts.prepareNow')}
                </Button>
              )}
            </>
          )}
          {!readOnly && a.parts.some((p) => p.canReserve) && (
            <Button size="sm" variant="outline" onClick={() => reserve.mutate()} disabled={reserve.isPending}>
              {reserve.isPending ? <Loader2 className="animate-spin" /> : <PackageCheck />} {t('upcomingParts.reserve')}
            </Button>
          )}
        </div>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted">
            <tr>
              <Th>{t('upcomingParts.colRef')}</Th><Th>{t('upcomingParts.colDesignation')}</Th><Th>{t('upcomingParts.colBin')}</Th>
              <Th right>{t('upcomingParts.colNeeded')}</Th><Th right>{t('upcomingParts.colReserved')}</Th>
              <Th right>{t('upcomingParts.colMissing')}</Th><Th>{t('upcomingParts.colState')}</Th><Th>{''}</Th>
            </tr>
          </thead>
          <tbody>
            {a.parts.map((p, i) => <PartRow key={p.reservationId ?? `${p.articleId}-${i}`} p={p} readOnly={readOnly} onDone={done} onFail={fail} />)}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function PartRow({ p, readOnly, onDone, onFail }: {
  p: UpcomingPartRow; readOnly: boolean; onDone: (msg: string) => void; onFail: (e: unknown) => void;
}) {
  const urgent = useMutation({
    mutationFn: () => orderReservationUrgent(p.reservationId as string),
    meta: { success: false },
    onSuccess: (r) => {
      if (r.moved > 0 || r.added > 0) onDone(fillVars(t('upcomingParts.urgentDone'), { moved: fmtQty(r.moved), added: fmtQty(r.added) }));
      else onDone(t(`upcomingParts.urgent_${r.reason ?? 'already_ordered'}`));
    },
    onError: onFail,
  });
  const switchOnly = p.canOrderUrgent && p.qtyOnOrder >= p.qtyMissing && p.basketKind === 'standard';
  return (
    <tr className="border-b border-border last:border-0 align-top">
      <td className="px-3 py-1.5 tabular-nums">{p.reference}</td>
      <td className="px-3 py-1.5">{p.designation}</td>
      <td className="px-3 py-1.5">{p.bin ?? ''}</td>
      <td className="px-3 py-1.5 text-right tabular-nums">{fmtQty(p.qtyNeeded)}</td>
      <td className="px-3 py-1.5 text-right tabular-nums">{p.state === 'hors_stock' ? '' : fmtQty(p.qtyReserved)}</td>
      <td className="px-3 py-1.5 text-right tabular-nums">{p.qtyMissing > 0 && p.state !== 'hors_stock' ? fmtQty(p.qtyMissing) : ''}</td>
      <td className="px-3 py-1.5">
        <div className="flex flex-wrap items-center gap-1">
          <PartStateBadge state={p.state} />
          {(p.state === 'au_panier' || p.state === 'commandee') && <KindBadge kind={p.basketKind} />}
        </div>
        <PartHint p={p} />
      </td>
      <td className="px-3 py-1.5 text-right">
        {!readOnly && p.canOrderUrgent && p.reservationId && (
          <Button size="sm" variant={switchOnly ? 'outline' : 'default'} onClick={() => urgent.mutate()} disabled={urgent.isPending}>
            {urgent.isPending ? <Loader2 className="animate-spin" /> : <Zap />} {t(switchOnly ? 'upcomingParts.switchUrgent' : 'upcomingParts.orderUrgent')}
          </Button>
        )}
      </td>
    </tr>
  );
}

function PartHint({ p }: { p: UpcomingPartRow }) {
  const lines: ReactNode[] = [];
  if ((p.state === 'au_panier' || p.state === 'commandee') && p.basketLabel) {
    lines.push(p.dcsOrderNumber
      ? fillVars(t('upcomingParts.orderedDcs'), { label: p.basketLabel, number: p.dcsOrderNumber })
      : fillVars(t('upcomingParts.inBasket'), { label: p.basketLabel }));
  }
  if (p.state === 'manquante') {
    if (p.availability === 'red') lines.push(t('upcomingParts.why_red'));
    else if (p.availability === 'yellow') lines.push(p.replacementReference
      ? fillVars(t('upcomingParts.why_yellow_ref'), { ref: p.replacementReference })
      : t('upcomingParts.why_yellow'));
    else if (p.freeQty > 0) lines.push(fillVars(t('upcomingParts.why_free'), { n: fmtQty(p.freeQty) }));
    else lines.push(t('upcomingParts.why_none'));
  }
  if (p.state === 'hors_stock') lines.push(t('upcomingParts.why_outside'));
  if (!lines.length) return null;
  return <>{lines.map((l, i) => <p key={i} className="mt-0.5 text-[11px] text-muted-foreground">{l}</p>)}</>;
}

function Th({ children, right = false }: { children: ReactNode; right?: boolean }) {
  return <th className={`px-3 py-2 font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${right ? 'text-right' : 'text-left'}`}>{children}</th>;
}
