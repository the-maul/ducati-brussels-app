/**
 * M4 — « Pour qui ? » sur une commande fournisseur (ou la réception reliée à sa commande) :
 * pour chaque ligne, les clients (commande de pièces, document d'origine) à qui la pièce est
 * destinée, pour la ranger au bon client à la réception (mission 02, carte 4).
 * Rien n'est affiché si la commande ne vient pas de la proposition des commandes de pièces.
 */
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import type { LucideIcon } from 'lucide-react';
import { t } from '@/lib/i18n';
import type { PurchaseLine } from './api';
import { getPurchaseDestinations } from './proposal-api';

const qtyFmt = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',');

export function PurchaseDestinations({ orderId, lines, icon: Icon }: { orderId: string; lines: PurchaseLine[]; icon: LucideIcon }) {
  const q = useQuery({ queryKey: ['purchase-destinations', orderId], queryFn: () => getPurchaseDestinations(orderId) });
  const rows = q.data ?? [];
  if (rows.length === 0) return null;
  const lineLabel = (id: string) => lines.find((l) => l.id === id)?.designation ?? '—';
  return (
    <div className="mt-6">
      <p className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">
        <Icon className="size-3.5" /> {t('purchases.destTitle')}
      </p>
      <p className="mb-2 text-[12px] text-muted-foreground">{t('purchases.destHint')}</p>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted">
            <tr>
              {[t('purchases.destLine'), t('purchases.destClient'), t('purchases.destOrder'), t('purchases.destOrigin')].map((h) => (
                <th key={h} className="px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{h}</th>
              ))}
              <th className="px-3 py-2 text-right font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('purchases.destQtyClient')}</th>
              <th className="px-3 py-2 text-right font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('purchases.destQtyShop')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.part_order_line_id} className="border-b border-border last:border-0">
                <td className="px-3 py-2">{lineLabel(r.purchase_line_id)}</td>
                <td className="px-3 py-2">
                  {r.contact_id
                    ? <Link to="/clients/$contactId" params={{ contactId: r.contact_id }} className="text-info underline">{r.contact_name ?? '—'}</Link>
                    : <span className="text-muted-foreground">{t('purchases.destStock')}</span>}
                </td>
                <td className="px-3 py-2 font-mono text-[12px]">
                  <Link to="/orders/$orderId" params={{ orderId: r.part_order_id }} className="text-info underline">{r.part_order_number ?? '—'}</Link>
                </td>
                <td className="px-3 py-2 font-mono text-[12px]">
                  {r.source_document_id
                    ? <Link to="/sales/$documentId" params={{ documentId: r.source_document_id }} className="text-info underline">{r.source_document_number ?? '—'}</Link>
                    : '—'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{qtyFmt(r.qty_client)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{qtyFmt(r.qty_shop)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
