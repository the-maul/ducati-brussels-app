/**
 * Comptoir / vente : avertissement « piece reservee pour le RDV de X le ... » (mission 10, carte 6).
 * Appele quand on ajoute une piece a un ticket ou a un document de vente : si la quantite depasse le
 * libre (reel - reserve) et qu'une reservation atelier est en cours, un avertissement clair s'affiche.
 * La vente n'est pas bloquee (decision de l'atelier au comptoir) ; migration absente : rien.
 */
import { toast } from 'sonner';
import { t, fillVars } from '@/lib/i18n';
import { listArticleReservations } from './api';
import { reservedSaleWarning } from './rules';

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';

export async function warnIfReservedForWorkshop(a: { id: string; real_qty?: number | null; reserved_qty?: number | null } | null | undefined, qty = 1): Promise<void> {
  if (!a?.id) return;
  const real = Number(a.real_qty ?? 0);
  const reserved = Number(a.reserved_qty ?? 0);
  if (!(reserved > 0) || qty <= real - reserved) return;
  try {
    const rows = await listArticleReservations(a.id);
    const hit = reservedSaleWarning({ qty, real, reserved, reservations: rows });
    if (!hit) return;
    const first = hit[0];
    toast.warning(t('reservation.saleWarningTitle'), {
      description: fillVars(t('reservation.saleWarning'), {
        holder: first.holder, client: first.contactName ?? t('reservation.unknownClient'),
        date: fmtDate(first.dueAt), free: Math.max(real - reserved, 0),
      }),
      duration: 10_000,
    });
  } catch {
    /* avertissement seulement : jamais bloquant */
  }
}
