/**
 * Fiche article -> onglet Stock : les reservations atelier en cours de la piece (pour quel RDV / OR,
 * quel client, quand) — mission 10, carte 6. Rien tant que la migration n'est pas en base.
 */
import { useQuery } from '@tanstack/react-query';
import { CalendarClock } from 'lucide-react';
import { t } from '@/lib/i18n';
import { listArticleReservations, reservationSchemaReady } from './api';
import { fmtDateTime } from './reserved-parts-block';

const fmtQty = (n: number) => (Math.round(n * 1000) / 1000).toString().replace('.', ',');

export function ArticleReservationsPanel({ articleId }: { articleId: string }) {
  const schema = useQuery({ queryKey: ['reservation-schema'], queryFn: reservationSchemaReady, staleTime: Infinity });
  const q = useQuery({ queryKey: ['article-reservations', articleId], queryFn: () => listArticleReservations(articleId), enabled: schema.data === true });
  if (schema.data !== true) return null;
  const rows = q.data ?? [];
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">
        <CalendarClock className="size-3.5" aria-hidden /> {t('reservation.articleTitle')}
      </p>
      {rows.length === 0
        ? <p className="text-[13px] text-muted-foreground">{t('reservation.articleEmpty')}</p>
        : (
          <table className="w-full border-collapse font-data text-[13px]">
            <thead><tr className="text-left text-[11px] uppercase tracking-[0.04em] text-muted-foreground">
              <th className="py-1 pr-3">{t('reservation.colHolder')}</th>
              <th className="py-1 pr-3">{t('reservation.colClient')}</th>
              <th className="py-1 pr-3">{t('reservation.colDate')}</th>
              <th className="py-1 pr-3 text-right">{t('reservation.colReserved')}</th>
              <th className="py-1 text-right">{t('reservation.colMissing')}</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="py-1 pr-3">{r.holder}</td>
                  <td className="py-1 pr-3">{r.contactName ?? ''}</td>
                  <td className="py-1 pr-3 tabular-nums">{fmtDateTime(r.dueAt)}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{fmtQty(r.qtyReserved)}</td>
                  <td className="py-1 text-right tabular-nums">{fmtQty(r.qtyMissing)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </div>
  );
}
