/**
 * M6 — Factures d'acompte d'une réservation, d'un bon de commande ou d'un devis (03/11/2026, étude
 * facturation §3 ligne 9 : CTVA art. 17 §1 al. 3, AR 1 art. 1 et 4).
 *
 * Chaque acompte perçu du client est listé avec sa facture d'acompte (FAA-AAAA-NNNNN) : créée
 * automatiquement en base pour une moto ou un client assujetti, sur demande (bouton) sinon. Tant
 * qu'un acompte n'est pas facturé, la date limite légale (le 15 du mois suivant) est affichée.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Loader2, Receipt } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/status-badge';
import { t } from '@/lib/i18n';
import { errorMessage } from '@/lib/mutation-feedback';
import {
  listPayments, listDepositInvoices, generateDepositInvoice, depositInvoiceItems, depositInvoiceDeadline,
  DEPOSIT_INVOICE_SOURCE_TYPES, isClosedDocStatus, type DocumentRow,
} from './write-api';

const eur = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`;
const dmy = (iso: string) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');

export function showsDepositInvoices(doc: Pick<DocumentRow, 'doc_type' | 'status' | 'contact_id'>): boolean {
  return (DEPOSIT_INVOICE_SOURCE_TYPES as readonly string[]).includes(doc.doc_type) && !isClosedDocStatus(doc.status) && !!doc.contact_id;
}

export function DepositInvoicePanel({ doc, required, readOnly }: {
  doc: DocumentRow;
  /** Moto ou client assujetti : la facture est obligatoire (et normalement automatique). */
  required: boolean;
  readOnly?: boolean;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const paymentsQ = useQuery({ queryKey: ['payments', doc.id], queryFn: () => listPayments(doc.id) });
  const invoicesQ = useQuery({ queryKey: ['deposit-invoices', doc.id], queryFn: () => listDepositInvoices(doc.id) });
  const issue = useMutation({
    meta: { success: false, error: false },
    mutationFn: (paymentId: string) => generateDepositInvoice(paymentId),
    onSuccess: () => {
      toast.success(t('depositInvoice.created'));
      qc.invalidateQueries({ queryKey: ['deposit-invoices', doc.id] });
      qc.invalidateQueries({ queryKey: ['documents'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const items = depositInvoiceItems(
    (paymentsQ.data ?? []) as unknown as Parameters<typeof depositInvoiceItems>[0],
    invoicesQ.data ?? [],
  );
  if (!items.length) return null;
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('depositInvoice.title')}</p>
      <p className="mb-2 text-[12px] text-muted-foreground">{t(required ? 'depositInvoice.hintRequired' : 'depositInvoice.hintOnDemand')}</p>
      <ul className="space-y-1.5 font-data text-[13px]">
        {items.map((it) => (
          <li key={it.paymentId} className="flex flex-wrap items-center gap-2">
            <span className="tabular-nums">{dmy(it.paidAt)}</span>
            <span className="tabular-nums font-medium">{eur(it.amount)}</span>
            <span className="text-muted-foreground">{it.method}</span>
            {it.invoice ? (
              <button
                className="ml-auto inline-flex items-center gap-1 text-info underline"
                onClick={() => navigate({ to: '/sales/$documentId', params: { documentId: it.invoice!.id } })}
              >
                <Receipt className="size-4" /> {t('depositInvoice.issued').replace('{number}', it.invoice.number ?? '—')}
              </button>
            ) : (
              <span className="ml-auto inline-flex items-center gap-2">
                <StatusBadge tone="warning" label={t('depositInvoice.deadline').replace('{date}', dmy(depositInvoiceDeadline(it.paidAt)))} />
                <Button size="sm" variant="outline" disabled={readOnly || issue.isPending} onClick={() => issue.mutate(it.paymentId)}>
                  {issue.isPending ? <Loader2 className="animate-spin" /> : <Receipt />} {t('depositInvoice.issue')}
                </Button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
