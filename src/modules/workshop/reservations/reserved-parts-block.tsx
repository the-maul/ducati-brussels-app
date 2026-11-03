/**
 * Bloc « Pieces reservees » d'un RDV ou d'un OR (mission 10, carte 6, M-111) : les pieces du kit de
 * LA moto pour CET entretien, reservees des le RDV ; statut couleur + icone + libelle (reservee /
 * a commander / commandee / recue ; apres facture : sortie / liberee). « Reserver / mettre a jour »
 * relance le calcul (OR ouvert sans RDV, stock arrive, entretien change). Avant la migration : un
 * message, rien d'autre (l'ancien popup reste l'outil de commande).
 */
import type { ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, PackageCheck, ShoppingCart, Truck, Package, Receipt, Undo2, RefreshCw, Wrench, AlertTriangle, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { StatusBadge, type StatusTone } from '@/components/status-badge';
import { t, fillVars } from '@/lib/i18n';
import { isServiceCode, serviceLabelKey } from '../service-code';
import { listReservedParts, reservationSchemaReady, syncReservations } from './api';
import type { DisplayStatus } from './rules';

export const RESERVATION_STATUS_META: Record<DisplayStatus, { tone: StatusTone; icon: LucideIcon }> = {
  reservee: { tone: 'success', icon: PackageCheck },
  a_commander: { tone: 'warning', icon: ShoppingCart },
  commandee: { tone: 'info', icon: Truck },
  recue: { tone: 'info', icon: Package },
  sortie: { tone: 'neutral', icon: Receipt },
  liberee: { tone: 'neutral', icon: Undo2 },
};

const fmtQty = (n: number) => (Math.round(n * 1000) / 1000).toString().replace('.', ',');
export const fmtDateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

export function ReservationStatusBadge({ status }: { status: DisplayStatus }) {
  const meta = RESERVATION_STATUS_META[status] ?? RESERVATION_STATUS_META.a_commander;
  return <StatusBadge tone={meta.tone} icon={meta.icon} label={t(`reservation.status_${status}`)} />;
}

/** Libelle de l'entretien choisi (« Entretien annuel (Annual Service) »), ou null. */
export function serviceLabel(code: string | null | undefined): string | null {
  return isServiceCode(code) ? t(serviceLabelKey(code)) : null;
}

export function ReservedPartsBlock({ appointmentId = null, orId = null, serviceCode = null, readOnly = false }: {
  appointmentId?: string | null; orId?: string | null;
  /** Entretien choisi connu de l'appelant (affiche en tete). */
  serviceCode?: string | null;
  /** OR facture / annule : pas de bouton. */
  readOnly?: boolean;
}) {
  const qc = useQueryClient();
  const key = ['reserved-parts', appointmentId, orId];
  const schema = useQuery({ queryKey: ['reservation-schema'], queryFn: reservationSchemaReady, staleTime: Infinity });
  const list = useQuery({ queryKey: key, queryFn: () => listReservedParts({ appointmentId, orId }), enabled: schema.data === true });
  const sync = useMutation({
    mutationFn: () => syncReservations({ appointmentId: orId ? null : appointmentId, orId }),
    meta: { success: false },
    onSuccess: (r) => {
      toast.success(fillVars(t('reservation.synced'), { moves: r.moves, basket: r.basketLines, minimax: r.minimax }));
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ['ro-order-needs'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const label = serviceLabel(serviceCode);
  const rows = list.data ?? [];

  return (
    <section className="rounded-md border border-border bg-card p-4 shadow-[var(--shadow-card)]">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Wrench className="size-4 text-muted-foreground" aria-hidden />
        <h3 className="text-[14px] font-bold">{t('reservation.title')}</h3>
        {label && <span className="text-[13px] text-muted-foreground">· {t('reservation.serviceLabel')} : <b className="text-foreground">{label}</b></span>}
        {schema.data === true && !readOnly && (
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => sync.mutate()} disabled={sync.isPending}>
            {sync.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />} {t('reservation.sync')}
          </Button>
        )}
      </div>

      {schema.data === false && <p className="rounded-md bg-info-bg px-3 py-2 text-[13px] text-info">{t('reservation.migrationMissing')}</p>}
      {schema.data === true && !label && rows.length === 0 && <p className="text-[13px] text-muted-foreground">{t('reservation.serviceNone')}</p>}
      {schema.data === true && label && <p className="mb-2 text-[12px] text-muted-foreground">{t('reservation.intro')}</p>}
      {list.isLoading && schema.data === true && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      {list.error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{(list.error as Error).message}</p>}

      {schema.data === true && label && rows.length === 0 && !list.isLoading && (
        <p className="text-[13px] text-muted-foreground">{t('reservation.empty')} {t('reservation.emptyHint')}</p>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse font-data text-[13px]">
            <thead className="bg-muted">
              <tr>
                <Th>{t('reservation.colRef')}</Th><Th>{t('reservation.colDesignation')}</Th>
                <Th right>{t('reservation.colNeeded')}</Th><Th right>{t('reservation.colReserved')}</Th>
                <Th right>{t('reservation.colMissing')}</Th><Th>{t('reservation.colBin')}</Th><Th>{t('reservation.colStatus')}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0 align-top">
                  <td className="px-3 py-1.5 tabular-nums">{r.reference}</td>
                  <td className="px-3 py-1.5">
                    {r.designation}
                    {orId && r.status === 'active' && !r.onOrLines && (
                      <p className="mt-0.5 flex items-start gap-1 text-[12px] text-warning"><AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />{t('reservation.notOnOr')}</p>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmtQty(r.qtyNeeded)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmtQty(r.status === 'consommee' ? r.qtyConsumed : r.qtyReserved)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.status === 'active' ? fmtQty(r.qtyMissing) : ''}</td>
                  <td className="px-3 py-1.5">{r.bin ?? ''}</td>
                  <td className="px-3 py-1.5">
                    <ReservationStatusBadge status={r.displayStatus} />
                    {r.basketLabel && r.status === 'active' && r.qtyMissing > 0 && (
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{fillVars(t('reservation.basketIn'), { label: r.basketLabel })}</p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Th({ children, right = false }: { children: ReactNode; right?: boolean }) {
  return <th className={`px-3 py-2 font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${right ? 'text-right' : 'text-left'}`}>{children}</th>;
}
