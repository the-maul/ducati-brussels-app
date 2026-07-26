import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Plus } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/lib/auth/auth-context';
import { listDocuments, listDocumentLinesFor } from '@/modules/sales/write-api';
import { listStock } from '@/modules/stock/stock-api';
import { computeDocAvailability, AVAILABILITY_DOC_TYPES, type AvailabilityStatus } from '@/modules/sales/availability';
import { AvailabilityBadge } from '@/modules/sales/availability-badge';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/sales/')({
  head: () => ({ meta: [{ title: 'Ventes & Facturation — Ducati Bruxelles' }] }),
  component: SalesList,
});

const eur = (n: number) => `${(Math.round(Number(n) * 100) / 100).toFixed(2).replace('.', ',')} €`;
const statusTone = (s: string) => (s === 'payee' ? 'success' : s === 'annulee' ? 'neutral' : s === 'brouillon' ? 'info' : 'warning');

type AvailFilter = 'all' | 'total' | 'partial' | 'order' | 'none';

function SalesList() {
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  const [availFilter, setAvailFilter] = useState<AvailFilter>('all');
  const { data, isLoading } = useQuery({
    queryKey: ['documents', activeCompanyId],
    queryFn: () => listDocuments(activeCompanyId!),
    enabled: !!activeCompanyId,
  });

  // Dispo : liste bornée à 100 documents (listDocuments) → 2 requêtes groupées
  // (lignes de ces documents + stock disponible société) plutôt qu'une requête par
  // ligne de tableau, pour rester performant.
  const docIds = useMemo(() => (data ?? []).map((d) => d.id), [data]);
  const linesQ = useQuery({
    queryKey: ['doc-lines-availability', docIds],
    queryFn: () => listDocumentLinesFor(docIds),
    enabled: docIds.length > 0,
  });
  const stockQ = useQuery({
    queryKey: ['stock-availability', activeCompanyId],
    queryFn: () => listStock(activeCompanyId!),
    enabled: !!activeCompanyId,
  });

  const availByDoc = useMemo(() => {
    const map = new Map<string, ReturnType<typeof computeDocAvailability>>();
    if (!linesQ.data || !stockQ.data) return map;
    const stockMap = new Map(stockQ.data.map((r) => [r.article_id, r.available_qty]));
    const linesByDoc = new Map<string, { article_id: string | null; quantity: number }[]>();
    for (const l of linesQ.data) {
      const arr = linesByDoc.get(l.document_id) ?? [];
      arr.push({ article_id: l.article_id, quantity: l.quantity });
      linesByDoc.set(l.document_id, arr);
    }
    for (const d of data ?? []) {
      if (!(AVAILABILITY_DOC_TYPES as readonly string[]).includes(d.doc_type)) continue;
      map.set(d.id, computeDocAvailability(linesByDoc.get(d.id) ?? [], stockMap));
    }
    return map;
  }, [data, linesQ.data, stockQ.data]);

  const matchesAvailFilter = (status: AvailabilityStatus | undefined) => {
    if (availFilter === 'all') return true;
    if (!status) return false;
    if (availFilter === 'total') return status === 'disponible';
    if (availFilter === 'partial') return status === 'partiel';
    // "En commande" et "Indisponible" retombent tous deux sur le même statut 0 % faute
    // de rapprochement fiable avec les commandes fournisseur en cours (TODO availability.ts).
    return status === 'indisponible';
  };

  const rows = (data ?? []).filter((d) => matchesAvailFilter(availByDoc.get(d.id)?.status));

  return (
    <>
      <PageHeader
        title={t('nav.sales')}
        description={t('sales.subtitle')}
        actions={<Button onClick={() => navigate({ to: '/sales/new' })}><Plus /> {t('sales.newDoc')}</Button>}
      />
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('availability.filterLabel')}</label>
          <Select value={availFilter} onValueChange={(v) => setAvailFilter(v as AvailFilter)}>
            <SelectTrigger className="h-9 w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('availability.filterAll')}</SelectItem>
              <SelectItem value="total">{t('availability.filterTotal')}</SelectItem>
              <SelectItem value="partial">{t('availability.filterPartial')}</SelectItem>
              <SelectItem value="order">{t('availability.filterOrder')}</SelectItem>
              <SelectItem value="none">{t('availability.filterNone')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted">
            <tr><Th>{t('sales.colNumber')}</Th><Th>{t('sales.colType')}</Th><Th>{t('sales.colDate')}</Th><Th>{t('sales.colStatus')}</Th><Th>{t('availability.colDispo')}</Th><Th className="text-right">{t('sales.colTtc')}</Th><Th className="text-right">{t('sales.colPaid')}</Th></tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={7} className="px-3 py-6 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></td></tr>}
            {data && rows.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">{t('sales.empty')}</td></tr>}
            {rows.map((d) => {
              const avail = availByDoc.get(d.id);
              return (
                <tr key={d.id} onClick={() => navigate({ to: '/sales/$documentId', params: { documentId: d.id } })}
                  className="cursor-pointer border-b border-border last:border-0 hover:bg-accent">
                  <td className="px-3 py-2 font-mono text-[12px]">{d.number ?? '—'}</td>
                  <td className="px-3 py-2">{t(`sales.type_${d.doc_type}`)}</td>
                  <td className="px-3 py-2 font-mono text-[12px]">{d.issue_date}</td>
                  <td className="px-3 py-2"><StatusBadge tone={statusTone(d.status)} label={t(`sales.status_${d.status}`)} /></td>
                  <td className="px-3 py-2">{avail && <AvailabilityBadge status={avail.status} pct={avail.pct} />}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{eur(Number(d.total_ttc))}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{eur(Number(d.paid_amount))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
