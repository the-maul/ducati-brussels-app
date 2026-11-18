/**
 * Encaissements (rattrapage G8, 18/11/2026) — onglet « Relances et échéances » de la fiche client :
 * G8 onglet « Relances » (n° facture, date relance, mode, type, adresse e-mail), bouton
 * « Échéances » (liste des échéances du client) et bons d'achat du client.
 */
import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';
import { errorMessage } from '@/lib/mutation-feedback';
import { listContactDunningLetters, listDeferredPayments, listVouchers } from './api';
import { eur, fmtDate } from './helpers';
import { DeferredBadge, Empty, Th } from './ui-bits';
import { VoucherBadge, VoucherCreateDialog, printVoucher } from './vouchers-tab';

export function ClientReceivablesTab({ companyId, contactId, contactName }: { companyId: string; contactId: string; contactName: string }) {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const deferred = useQuery({ queryKey: ['deferred-payments', companyId, 'client', contactId], queryFn: () => listDeferredPayments(companyId, { contactId, withDone: true }), retry: false });
  const letters = useQuery({ queryKey: ['dunning-letters', contactId], queryFn: () => listContactDunningLetters(contactId), retry: false });
  const vouchers = useQuery({ queryKey: ['vouchers', companyId, 'client', contactId], queryFn: () => listVouchers(companyId, null, contactId), retry: false });

  if (deferred.isError && letters.isError) return <p className="rounded-md bg-warning-bg px-3 py-2 text-[13px] text-warning">{t('receivables.notInstalled')}</p>;
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('receivables.clientDeferred')}</p>
          <Link to="/sales/receivables" className="text-[12px] hover:underline">{t('receivables.openPage')}</Link>
        </div>
        {deferred.isLoading ? <Spinner /> : (deferred.data ?? []).length === 0 ? <Empty>{t('receivables.noDeferred')}</Empty> : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full border-collapse font-data text-[12px]">
              <thead className="bg-muted"><tr>
                <Th>{t('receivables.colNumber')}</Th><Th>{t('receivables.colMethod')}</Th><Th>{t('receivables.colInstallment')}</Th><Th>{t('receivables.colDueDate')}</Th>
                <Th className="text-right">{t('receivables.colAmount')}</Th><Th>{t('receivables.colBank')}</Th><Th>{t('receivables.colCheque')}</Th><Th>{t('receivables.colStatus')}</Th>
              </tr></thead>
              <tbody>
                {deferred.data!.map((r) => (
                  <tr key={r.payment_id} className="border-b border-border last:border-0">
                    <td className="px-2 py-1.5 font-mono"><Link to="/sales/$documentId" params={{ documentId: r.document_id }} className="hover:underline">{r.number ?? '—'}</Link></td>
                    <td className="px-2 py-1.5">{r.method_label}</td>
                    <td className="px-2 py-1.5 tabular-nums">{r.installment_no ? `${r.installment_no}/${r.installments ?? '?'}` : ''}</td>
                    <td className="px-2 py-1.5">{fmtDate(r.due_date)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{eur(r.amount)}</td>
                    <td className="px-2 py-1.5">{r.bank_name ?? ''}</td>
                    <td className="px-2 py-1.5 font-mono">{r.cheque_number ?? ''}</td>
                    <td className="px-2 py-1.5" title={r.cancel_reason ?? undefined}><DeferredBadge status={r.status} overdue={r.is_overdue} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('receivables.clientLetters')}</p>
        {letters.isLoading ? <Spinner /> : letters.isError ? <p className="text-[13px] text-danger">{errorMessage(letters.error)}</p>
          : (letters.data ?? []).length === 0 ? <Empty>{t('receivables.noLetters')}</Empty> : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full border-collapse font-data text-[12px]">
              <thead className="bg-muted"><tr>
                <Th>{t('receivables.colNumber')}</Th><Th>{t('receivables.colLastDate')}</Th><Th>{t('receivables.colLastMedia')}</Th><Th>{t('receivables.colLastType')}</Th>
                <Th className="text-right">{t('receivables.colAmountDue')}</Th><Th>{t('receivables.colEmail')}</Th>
              </tr></thead>
              <tbody>
                {letters.data!.map((l) => (
                  <tr key={l.id} className="border-b border-border last:border-0">
                    <td className="px-2 py-1.5 font-mono">{l.documents?.number ?? '—'}</td>
                    <td className="px-2 py-1.5">{fmtDate(l.sent_at)}</td>
                    <td className="px-2 py-1.5">{t(`receivables.media_${l.media}`)}{l.is_test ? ` (${t('receivables.testShort')})` : ''}</td>
                    <td className="px-2 py-1.5">{l.template_code} · {l.template_label ?? ''}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{eur(Number(l.amount_due))}</td>
                    <td className="px-2 py-1.5">{l.sent_to ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('receivables.tabVouchers')}</p>
          <Button size="sm" variant="outline" onClick={() => setCreating(true)}><Plus /> {t('receivables.voucherNew')}</Button>
        </div>
        {vouchers.isLoading ? <Spinner /> : (vouchers.data ?? []).length === 0 ? <Empty>{t('receivables.noVoucher')}</Empty> : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full border-collapse font-data text-[12px]">
              <thead className="bg-muted"><tr>
                <Th>{t('receivables.voucherNumber')}</Th><Th className="text-right">{t('receivables.colAmount')}</Th><Th className="text-right">{t('receivables.voucherRemaining')}</Th>
                <Th>{t('receivables.validUntil')}</Th><Th>{t('receivables.colStatus')}</Th><Th />
              </tr></thead>
              <tbody>
                {vouchers.data!.map((v) => (
                  <tr key={v.id} className="border-b border-border last:border-0">
                    <td className="px-2 py-1.5 font-mono">{v.number}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{eur(v.amount)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{eur(v.remaining)}</td>
                    <td className="px-2 py-1.5">{fmtDate(v.valid_until)}</td>
                    <td className="px-2 py-1.5"><VoucherBadge status={v.effective_status} /></td>
                    <td className="px-2 py-1.5 text-right"><Button size="sm" variant="ghost" onClick={() => void printVoucher(companyId, v, 'A4')}><Printer className="size-4" /></Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <VoucherCreateDialog open={creating} companyId={companyId} onOpenChange={setCreating} presetContact={{ id: contactId, code: null, name: contactName }}
        onCreated={() => qc.invalidateQueries({ queryKey: ['vouchers'] })} />
    </div>
  );
}

function Spinner() { return <div className="grid place-items-center py-6"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>; }
