import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Plus } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getDocumentFull, recordPayment } from '@/modules/sales/write-api';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/sales/$documentId')({
  head: () => ({ meta: [{ title: 'Document — Ducati Bruxelles' }] }),
  component: DocumentView,
});

const eur = (n: number) => `${(Math.round(Number(n) * 100) / 100).toFixed(2).replace('.', ',')} €`;
const statusTone = (s: string) => (s === 'payee' ? 'success' : s === 'annulee' ? 'neutral' : s === 'brouillon' ? 'info' : 'warning');
const METHODS = ['ESP', 'MAE', 'VIR', 'VIC', 'VID', 'CHQC'];

function DocumentView() {
  const { documentId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['doc-full', documentId], queryFn: () => getDocumentFull(documentId) });
  const [method, setMethod] = useState('ESP');
  const [amount, setAmount] = useState('');

  const pay = useMutation({
    mutationFn: () => recordPayment(documentId, method, Number(amount.replace(',', '.'))),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['doc-full', documentId] }); setAmount(''); },
  });

  if (isLoading) return <div className="grid place-items-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  if (!data) return <><PageHeader title="Document" /><p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{t('sales.notFound')}</p></>;

  const { doc, lines } = data;
  const due = Number(doc.total_ttc) - Number(doc.paid_amount);
  const linesHt = lines.reduce((s, l) => s + Number(l.line_ht), 0);
  const discount = Number(doc.global_discount_pct) > 0
    ? linesHt * Number(doc.global_discount_pct) / 100
    : Number(doc.global_discount_amount);
  const shippingHt = Number(doc.shipping_ht);

  return (
    <>
      <PageHeader
        title={`${t(`sales.type_${doc.doc_type}`)} ${doc.number ?? t('sales.draftSuffix')}`}
        description={`${doc.issue_date}${doc.due_date ? ` · ${t('sales.dueDate')} ${doc.due_date}` : ''}`}
        actions={<Button variant="outline" onClick={() => navigate({ to: '/sales' })}><ArrowLeft /> {t('sales.backToList')}</Button>}
      />
      <div className="mb-4 flex items-center gap-3">
        <StatusBadge tone={statusTone(doc.status)} label={t(`sales.status_${doc.status}`)} />
        {doc.tax_exempt && <StatusBadge tone="info" label={t('sales.taxExempt')} />}
      </div>

      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted"><tr><Th>{t('sales.colDesignation')}</Th><Th className="text-right">{t('sales.colQty')}</Th><Th className="text-right">{t('sales.colPuHt')}</Th><Th className="text-right">{t('sales.colVat')}</Th><Th className="text-right">{t('sales.colLineHt')}</Th></tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-b border-border last:border-0">
                <td className="px-3 py-2">{l.designation}</td>
                <td className="px-3 py-2 text-right tabular-nums">{l.quantity}</td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(Number(l.unit_price_ht))}</td>
                <td className="px-3 py-2 text-right tabular-nums">{l.vat_rate}%</td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(Number(l.line_ht))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-col items-end gap-1 font-data text-sm tabular-nums">
        {discount > 0.005 && <span className="text-muted-foreground">{t('sales.totalDiscount')} : − {eur(discount)}</span>}
        {shippingHt > 0.005 && <span className="text-muted-foreground">{t('sales.totalShipping')} : {eur(shippingHt)}</span>}
        <span>{t('sales.totalHt')} : <b>{eur(Number(doc.total_ht))}</b></span>
        <span className="text-muted-foreground">{t('sales.totalVat')} : {eur(Number(doc.total_vat))}</span>
        <span className="text-base">{t('sales.totalTtc')} : <b>{eur(Number(doc.total_ttc))}</b></span>
        <span>{t('sales.paid')} : {eur(Number(doc.paid_amount))}</span>
        {due > 0.005 && <span className="text-danger">{t('sales.due')} : <b>{eur(due)}</b></span>}
      </div>

      {due > 0.005 && doc.status !== 'annulee' && (
        <div className="mt-4 flex flex-wrap items-end gap-2 rounded-md border border-dashed border-border p-3">
          <div className="space-y-1"><label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('sales.payMethod')}</label>
            <Select value={method} onValueChange={setMethod}><SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>{METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent></Select>
          </div>
          <div className="space-y-1"><label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('sales.payAmount')}</label>
            <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={String(due.toFixed(2))} className="w-32 text-right tabular-nums" /></div>
          <Button onClick={() => pay.mutate()} disabled={pay.isPending || !amount.trim()}>{pay.isPending ? <Loader2 className="animate-spin" /> : <Plus />} {t('sales.pay')}</Button>
        </div>
      )}
    </>
  );
}

function Th({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
